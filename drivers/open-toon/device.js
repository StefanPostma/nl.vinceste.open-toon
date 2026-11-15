'use strict';

const Homey = require('homey');
const { Poller } = require('../../lib/engine/poller');
const { Lane, intervalMs } = require('../../lib/engine/schedule');
const { createApplier } = require('../../lib/engine/apply');
const { migrate, planSettingsChange } = require('../../lib/engine/capabilities');
const { OptionalFeature } = require('../../lib/engine/optional');
const { FEATURES, featureState, activeGroups } = require('../../lib/features');
const { normalizeAddress } = require('../../lib/toon/address');
const { homeyTimers } = require('../../lib/toon/client');
const {
  ToonError, isAborted, toUserMessage, addressMessage,
} = require('../../lib/toon/errors');
const {
  setpoint, scheme, programOn, programOff,
} = require('../../lib/toon/commands');

const SETTLE_MS = 1500; // the Toon needs a moment before it reports what a write changed
const LAST_UPDATE_EVERY_MS = 15 * 60e3; // every status write is a database write on the Homey

/** Thin Homey glue: everything that decides something lives in lib/. */
class ToonDevice extends Homey.Device {
  constructor(...args) {
    super(...args);
    this._stopped = false;
    this._serial = new Lane(); // migration and settings never interleave
    this._poller = null;
    this._optional = new Map(); // feature id -> OptionalFeature, filled in onInit
    this._reassertTimer = null;
    this._lastUpdateAt = 0;
    this._timers = homeyTimers(this);
  }

  /** Never waits for the Toon: the first request goes out in the background, 1-3 s after this returns. */
  async onInit() {
    this._address = this.getSetting('address');
    this._interval = this.getSetting('poll_interval');
    if (this._interval !== undefined && typeof this._interval !== 'number') this.log(`poll_interval is not a number, using ${intervalMs(this._interval) / 1000} s`);
    await this._queue(async () => { // a save of the settings waits until the device is set up
      await this._migrate();
      if (this._stopped) return;
      this._state = featureState(this.getSettings());
      this._apply = createApplier({
        device: this,
        log: (line) => this.log(line),
        error: (line) => this.error(line),
        onChanges: (changes) => this._fire(changes),
      });
      this._optional = this._createOptional();
      this.registerCapabilityListener('target_temperature', (value) => this._setTargetTemperature(value));
      this.registerCapabilityListener('temperature_state', (state) => this.setTemperatureState(state));
      for (const optional of this._optional.values()) await optional.init();
      await this._connect();
    });
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    try {
      return await this._queue(async () => {
        const plan = planSettingsChange({
          oldSettings, newSettings, changedKeys, state: this._state,
        });
        if (plan.errors.length > 0) throw new Error(this._settingError(plan.errors[0]));
        if (changedKeys.includes('poll_interval')) this._interval = newSettings.poll_interval;
        if (plan.address !== null) this._address = newSettings.address;
        if (this._stopped) return undefined;
        if (plan.startPoller) await this._connect();
        else if (plan.address !== null && this._poller) this._poller.reset(this._client(plan.address));
        if (plan.interval && this._poller) this._poller.reschedule();
        // the address first: a feature that is switched on in the same save is probed at the new address
        const messages = [];
        for (const toggle of plan.toggles) messages.push(await this._optional.get(toggle.id).switchTo(toggle.on));
        if (plan.address !== null) {
          for (const optional of this._optional.values()) if (!plan.toggles.some((toggle) => toggle.id === optional.feature.id)) await optional.recheck();
        }
        this._reassertSoon();
        return messages.filter(Boolean).join(' ') || undefined;
      });
    } catch (error) {
      throw isAborted(error) ? new Error(toUserMessage(this.homey, error)) : error;
    }
  }

  async onDeleted() {
    this._teardown();
    for (const optional of this._optional.values()) await optional.forget(); // a warning would outlive the device
  }

  async onUninit() {
    this._teardown();
  }

  /** Whether a feature is on for this device: the part that every device has, or an optional one that the user switched on. */
  isFeatureOn(id) {
    return this._state !== undefined && this._state[id] === true;
  }

  /**
   * Reads groups now. Waiting refreshes of a group share one request.
   * @param {string[]} [groupIds] default: every group that is on
   * @returns {Promise<Object<string, ToonError | null>>} the outcome per group; rejects with a localized message when the device went away
   */
  async refresh(groupIds) {
    const poller = this._need();
    return this._asUserError(() => poller.refresh(groupIds));
  }

  /** @param {string} state comfort, home, sleep or away @param {string} [resume] yes or no (ADR-0015) */
  async setTemperatureState(state, resume) {
    if (state === 'vacation') throw new Error(this.homey.__('error.vacation_readonly'));
    await this._write(() => scheme(state, resume));
  }

  async programOn() {
    await this._write(programOn);
  }

  async programOff() {
    await this._write(programOff);
  }

  async _setTargetTemperature(value) {
    await this._write(() => setpoint(value), 'setpoint'); // a drag of the slider sends the first and the last value
  }

  async _write(build, key) {
    const poller = this._need();
    await this._asUserError(() => poller.write(build(), { key, groups: ['thermostat'], settleMs: SETTLE_MS }));
  }

  _fire(changes) {
    if (!this._stopped) this.driver.fireTriggers(this, changes);
  }

  _need() {
    if (!this._poller) throw new Error(this.homey.__('address_missing'));
    return this._poller;
  }

  /** Whatever goes wrong while talking to the Toon reaches the user as a sentence, never as an error of ours. */
  async _asUserError(action) {
    try {
      return await action();
    } catch (error) {
      throw new Error(toUserMessage(this.homey, error));
    }
  }

  _queue(task) {
    return this._serial.run(task, { kind: 'write' });
  }

  async _migrate() {
    try {
      await migrate(this, {
        options: this.driver.manifest.capabilitiesOptions,
        isStopped: () => this._stopped,
        log: (line) => this.log(line),
      });
    } catch (error) {
      this.error(`migration failed, it is tried again at the next start: ${error.message}`);
    }
  }

  _createOptional() {
    return new Map(FEATURES.filter((feature) => feature.optional === true).map((feature) => [feature.id, new OptionalFeature({
      feature,
      device: this,
      state: this._state,
      getPoller: () => this._poller,
      options: this.driver.manifest.capabilitiesOptions,
      isStopped: () => this._stopped,
      log: (line) => this.log(line),
    })]));
  }

  _client(host) {
    return this.driver.createClient(host, this._timers);
  }

  /** Starts polling, or marks the device unavailable while there is no usable address (the one place that does). */
  async _connect() {
    const address = normalizeAddress(this._address);
    if (!address.ok) {
      await this.setUnavailable(this.homey.__('address_missing'));
      return;
    }
    const debug = this.homey.app.debugPayloads ? (group, payload) => this.log(`${group}: ${JSON.stringify(payload)}`) : undefined;
    this._poller = new Poller({
      client: this._client(address.host),
      timers: this._timers,
      groups: () => activeGroups(this._state),
      interval: () => intervalMs(this._interval),
      apply: (group, result, current) => this._apply(result, current),
      onEvent: (event) => this._onEvent(event),
      onPayload: debug,
      log: (line) => this.log(line),
      unavailable: !this.getAvailable(),
    });
    this._poller.start();
  }

  /** One log line per change of state, never one per cycle (NFR-09). */
  async _onEvent(event) {
    try {
      if (this._stopped) return;
      if (event.type === 'problem') {
        this.log(`${event.group}: ${event.error.message}`);
        await this._status('last_problem', `${this._stamp(Date.now())}: ${toUserMessage(this.homey, event.error)}`);
      } else if (event.type === 'result') {
        const optional = [...this._optional.values()].find((candidate) => candidate.owns(event.group));
        if (optional) await optional.onResult(event.error, event.reason);
      } else if (event.type === 'recovered') {
        this.log(`${event.group}: answers again`);
      } else if (event.type === 'success' && event.at - this._lastUpdateAt >= LAST_UPDATE_EVERY_MS) {
        this._lastUpdateAt = event.at;
        await this._status('last_update', this._stamp(event.at));
      } else if (event.type === 'unavailable') {
        this.log('the Toon cannot be reached: device set unavailable');
        await this.setUnavailable(this.homey.__('offline'));
      } else if (event.type === 'available') {
        this.log('the Toon answers again: device set available');
        await this.setAvailable();
      }
    } catch (error) {
      if (!this._stopped) this.error(`status update failed: ${error.message}`);
    }
  }

  async _status(key, text) {
    await this.setSettings({ [key]: text });
  }

  _stamp(ms) {
    return new Intl.DateTimeFormat(this.homey.i18n.getLanguage(), { dateStyle: 'short', timeStyle: 'short', timeZone: this.homey.clock.getTimezone() }).format(ms);
  }

  /** A save may store the settings it was given after our own status writes; one write after it puts the status back (HW-13). */
  _reassertSoon() {
    if (this._reassertTimer === null) this._reassertTimer = this._timers.setTimeout(() => this._reassert(), 0);
  }

  async _reassert() {
    try {
      this._reassertTimer = null;
      if (this._stopped) return;
      for (const optional of this._optional.values()) await optional.assertStatus();
    } catch (error) {
      if (!this._stopped) this.error(`status update failed: ${error.message}`);
    }
  }

  _settingError({ key, reason }) {
    return key === 'address' ? addressMessage(this.homey, reason) : this.homey.__('error.interval_invalid');
  }

  /** Stops everything for good: timers, the request in flight, queued work. Safe to call twice, never throws. */
  _teardown() {
    if (this._stopped) return;
    this._stopped = true;
    if (this._reassertTimer !== null) this._timers.clearTimeout(this._reassertTimer);
    this._reassertTimer = null;
    if (this._poller) this._poller.stop();
    this._serial.rejectAll(new ToonError('aborted'));
  }
}

module.exports = ToonDevice;
