'use strict';

/*
 * What an optional feature does on one device while it runs (ADR-0006, ADR-0018, docs/sdlc/05-architecture.md 6.5
 * and 6.6): switching it on and off, and what the device shows while the feature polls. The engine knows a feature
 * only through its registry entry (lib/features/index.js): a probe, a classifier, a status setting and its texts.
 *
 * On: the answers on their way are dropped, the capabilities are added (and taken back when one add fails), the options
 * reconciled, one probe asks the Toon, and the first values are read after the save. Off: the answers on their way are
 * dropped first (no request is aborted), then the capabilities, the warning and the status go. Both run in the device's
 * serial queue and check that the device still exists.
 * Shown: one status text per outcome, written on a change only; a warning while the add-on is not found, unless the
 * migration switched the feature on and the device never held a value (ADR-0018); one timeline hint after 24 h of
 * not found for such a device, kept in the store (FR-62).
 */

const { ToonError } = require('../toon/errors');
const { reconcile } = require('./capabilities');

class OptionalFeature {
  /**
   * @param {object} options `feature` (of the registry), `device`, `state` (the features that are on; updated here), `getPoller`
   *   (null while there is no usable address), `options` (the manifest's options per capability id), `isStopped`, `log`
   */
  constructor({
    feature, device, state, getPoller, options, isStopped, log,
  }) {
    Object.assign(this, {
      feature, device, state, getPoller, isStopped, log,
    });
    this.homey = device.homey;
    this.options = Object.fromEntries(feature.capabilities.filter((id) => Object.hasOwn(options, id)).map((id) => [id, options[id]]));
    this.groupIds = (feature.pollGroups || []).map((group) => group.id);
    this.watched = typeof feature.statusSetting === 'string';
    this.shown = null; // what the status says now while the feature is on: {outcome, kind}
    this.disabled = false; // the user switched it off while the app ran: the status says "off"
    this.switchedOff = 0; // counts the switches off: an answer that was on its way to the screen when one happened must not finish after it
    this.hinting = false;
  }

  owns(groupId) {
    return this.groupIds.includes(groupId);
  }

  /** At the start of the device: a feature that is off leaves no warning behind (FR-55 AC2). */
  async init() {
    if (this.watched && !this.state[this.feature.id]) await this._clearWarning();
  }

  /** Brings the device in line with a switch; resolves to the message of the save, if any. Throws when nothing could change. */
  async switchTo(on) {
    if ((this.state[this.feature.id] === true) === on) return undefined;
    return on ? this._enable() : this._disable();
  }

  /** The address changed: the Toon is asked again whether the feature is there (FR-82 AC2). */
  async recheck() {
    const { feature } = this;
    if (!this.state[feature.id] || !feature.probe) return;
    this._release();
    await this._forgetFirstNotFound();
    const found = await this._probe();
    this._alive();
    await this._show(found, false);
    this._refresh();
  }

  /** A poll group of the feature answered (or failed): shows what that means. */
  async onResult(error, reason) {
    if (this.watched && this.state[this.feature.id] && !this.isStopped()) await this._show(this.feature.classify(error, reason), false);
  }

  /** Writes the status again: a save of the settings may have replaced a status that was written while it ran (HW-13). */
  async assertStatus() {
    if (!this.watched || this.isStopped()) return;
    if (this.state[this.feature.id]) {
      if (this.shown) await this._label(this.shown.kind);
    } else if (this.disabled) {
      await this._label('off');
      await this._clearWarning(); // a write that was on its way when the feature went off can never leave a warning behind
    }
  }

  /** The device is deleted: a warning must not outlive it. */
  async forget() {
    if (this.watched) await this._try('warning', () => this.device.unsetWarning());
  }

  async _enable() {
    const { feature } = this;
    this._release();
    await reconcile(this.device, { add: feature.capabilities }, { options: this.options, isStopped: this.isStopped, log: this.log });
    this._alive();
    const found = feature.probe ? await this._probe() : null;
    this._alive();
    this.state[feature.id] = true;
    this.disabled = false;
    await this._decide();
    const message = found ? await this._show(found, true) : undefined;
    this._refresh();
    return message;
  }

  async _disable() {
    const { feature } = this;
    this._release();
    this.state[feature.id] = false;
    this.switchedOff += 1;
    try {
      await reconcile(this.device, { remove: feature.capabilities }, { isStopped: this.isStopped, log: this.log });
    } catch (error) {
      this.state[feature.id] = true; // the capabilities are still there: the switch did not change
      throw error;
    }
    this._alive();
    await this._decide();
    await this._off();
    return this.watched ? this.homey.__(feature.texts.saved.off) : undefined;
  }

  /** Records that the user decided the switch, and starts the window of FR-62 over. */
  async _decide() {
    const { feature, device } = this;
    if (typeof feature.decidedByKey === 'string') await this._try('store', () => device.setStoreValue(feature.decidedByKey, 'user'));
    await this._forgetFirstNotFound();
  }

  _forgetFirstNotFound() {
    const { feature, device } = this;
    return typeof feature.firstNotFoundKey === 'string' ? this._try('store', () => device.unsetStoreValue(feature.firstNotFoundKey)) : undefined;
  }

  _probe() {
    const poller = this.getPoller();
    return poller ? poller.probe(this.feature) : Promise.resolve({ outcome: 'unreachable' });
  }

  /** The groups drop what is on its way and are read in the next cycle, whatever they held back. */
  _release() {
    const poller = this.getPoller();
    if (!poller) return;
    poller.invalidate(this.groupIds);
    poller.release(this.groupIds);
  }

  _refresh() {
    const poller = this.getPoller();
    if (poller) poller.refreshSoon(this.feature.refreshOnEnable || [], 0);
  }

  _alive() {
    if (this.isStopped()) throw new ToonError('aborted');
  }

  /** Shows an outcome `{outcome, hint?}`; with `saved` the result is the message of the save. A switch off during a write drops the rest. */
  async _show(found, saved) {
    const kind = found.hint || found.outcome;
    const previous = this.shown;
    const switches = this.switchedOff;
    const current = () => this.state[this.feature.id] === true && this.switchedOff === switches;
    const changed = previous === null || previous.kind !== kind;
    const shown = { outcome: found.outcome, kind };
    this.shown = shown;
    if (changed) {
      this._announce(previous, found, kind);
      await this._label(kind);
    }
    if (current() && found.outcome === 'detected') await this._detected(changed);
    if (current() && found.outcome === 'not_found') await this._notFound(changed);
    if (current()) return saved ? this.homey.__(this.feature.texts.saved[kind]) : undefined;
    if (this.shown === shown) this.shown = previous; // the switch did not hold (a capability could not be removed): the next answer shows itself again
    if (!this.state[this.feature.id] && this.watched) await this._clearWarning();
    return undefined;
  }

  /** One info line on entering a state that is not "detected", one on leaving it (NFR-09). */
  _announce(previous, found, kind) {
    if (found.outcome !== 'detected') this.log(`${this.feature.id}: ${kind.replace(/_/g, ' ')}`);
    else if (previous !== null && previous.outcome !== 'detected') this.log(`${this.feature.id}: answers again`);
  }

  async _detected(changed) {
    const { feature, device } = this;
    if (changed) await this._clearWarning();
    if (device.getStoreValue(feature.firstNotFoundKey) !== undefined) await this._try('store', () => device.unsetStoreValue(feature.firstNotFoundKey));
  }

  /** ADR-0018: a device that the migration switched on and that never held a value gets the status and the hint, no warning. */
  async _notFound(changed) {
    const { feature, device } = this;
    const migrated = device.getStoreValue(feature.decidedByKey) === 'migration';
    const hasHistory = () => feature.capabilities.some((id) => device.hasCapability(id) && ![null, undefined].includes(device.getCapabilityValue(id)));
    if (changed && (!migrated || feature.warnWhenMigrationDecided || hasHistory())) {
      await this._try('warning', () => device.setWarning(this.homey.__(feature.texts.warning)));
    }
    if (migrated && this.state[feature.id]) await this._hint();
  }

  /** FR-62: one notification after 24 h of not found; `hintSent` is written only after it was delivered, a failure is retried at the next answer. */
  async _hint() {
    const { feature, device, homey } = this;
    let since = device.getStoreValue(feature.firstNotFoundKey);
    if (since === undefined) {
      since = Date.now();
      await this._try('store', () => device.setStoreValue(feature.firstNotFoundKey, since));
    }
    if (this.hinting || device.getStoreValue(feature.hintSentKey) === true || Date.now() - since < feature.hintAfter404Ms) return;
    this.hinting = true;
    try {
      await homey.notifications.createNotification({ excerpt: homey.__(feature.texts.hint, { name: device.getName() }) });
      await device.setStoreValue(feature.hintSentKey, true);
    } catch (error) {
      this.log(`${feature.id}: the hint could not be sent, trying again later: ${error.message}`);
    } finally {
      this.hinting = false;
    }
  }

  async _off() {
    this.shown = null;
    this.disabled = true;
    if (!this.watched) return;
    await this._clearWarning();
    await this._label('off');
  }

  _clearWarning() {
    return this._try('warning', () => this.device.unsetWarning());
  }

  async _label(kind) {
    const { feature, device, homey } = this;
    const text = homey.__(feature.texts.status[kind]);
    if (device.getSetting(feature.statusSetting) !== text) await this._try('status', () => device.setSettings({ [feature.statusSetting]: text }));
  }

  /** A status, warning or store write that fails (the device is gone, or Homey has a problem) never fails the feature. */
  async _try(what, action) {
    try {
      await action();
    } catch (error) {
      if (!this.isStopped()) this.log(`${this.feature.id}: ${what} could not be updated: ${error.message}`);
    }
  }
}

module.exports = { OptionalFeature };
