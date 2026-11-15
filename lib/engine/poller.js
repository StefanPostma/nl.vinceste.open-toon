'use strict';

/*
 * The scheduling core of one device (ADR-0005, docs/sdlc/05-architecture.md section 5): one self-rescheduling timer
 * chain, one cycle at a time. A cycle reads the poll groups of the features that are on, each through the lane (one
 * request in flight) and each in its own try/catch. Only the critical group counts for availability and back-off.
 * Only an address change or a teardown aborts a request; then nothing more goes to the old host. The lane, the
 * numbers of the policy and the ledger of what was seen are in schedule.js. Timers and clock are injected, so a
 * fake clock drives all of it. Nothing here knows a feature or Homey.
 */

const { ToonError, isAborted } = require('../toon/errors');
const {
  Lane, createLedger, backoffMs, runProbe,
} = require('./schedule');

const FIRST_DELAY_MS = 1000;
const FIRST_JITTER_MS = 2000;
const TRANSPORT_KINDS = Object.freeze(['timeout', 'network']);

class Poller {
  /**
   * @param {object} options `client` (the ToonClient of the current address), `timers` (the device's Homey timers), `groups`
   *   (() => the poll groups that are on, in order), `interval` (() => ms), `apply` ((group, {values, notes}, current) => Promise;
   *   `current()` says whether the answer may still be applied), `onEvent` ((event) => Promise that never rejects; types problem,
   *   recovered, success, unavailable, available and, for a group with `report: true`, result), `log`, `onPayload` (raw answers,
   *   for the debug switch) and `unavailable` (the device is unavailable now: the first success announces `available`)
   */
  constructor({
    client, timers, groups, interval, apply, onEvent, log, onPayload, now = Date.now, random = Math.random, unavailable = false,
  }) {
    Object.assign(this, {
      client, timers, groups, interval, apply, onEvent, log, onPayload, now, random,
    });
    this.lane = new Lane();
    this.controller = new AbortController();
    this.ledger = createLedger({ now, emit: (event) => this._emit(event), unavailable });
    this.gen = 0; // bumped when requests are cancelled
    this.cycles = 0;
    this.stopped = false;
    this.busy = false;
    this.timer = null;
    this.sequence = new Map(); // group id -> invalidations so far
    this.soon = new Map(); // refreshSoon key -> timer
  }

  /** The first cycle runs 1 s plus 0-2 s after this call, so that several Toons do not start together. */
  start() {
    this._arm(FIRST_DELAY_MS + Math.floor(this.random() * FIRST_JITTER_MS));
  }

  /** Sends nothing more: aborts the request in flight, rejects queued tasks with `aborted`. Safe to call twice. */
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this._cancel();
    this.soon.forEach((handle) => this.timers.clearTimeout(handle));
    this.soon.clear();
  }

  /** The address changed: cancel what is meant for the old host and start over with the new client. */
  reset(client) {
    if (this.stopped) return;
    this._cancel();
    this.controller = new AbortController();
    this.client = client;
    this.ledger.reset();
    this.start();
  }

  /** The interval changed: the next cycle follows the new interval, counted from now. */
  reschedule() {
    if (!this.stopped && !this.busy && this.timer !== null) this._arm(backoffMs(this.ledger.health.failures, this.interval()));
  }

  /** Drops the answers of these groups that were requested before this call. */
  invalidate(groupIds) {
    groupIds.forEach((id) => this.sequence.set(id, (this.sequence.get(id) || 0) + 1));
  }

  /** Ends the hold-off of these groups: they are read again in the next cycle. */
  release(groupIds) {
    this.ledger.release(groupIds);
  }

  /**
   * Runs the probe of a feature ahead of every queued request, within the time budget of the feature. A probe that is
   * cancelled by a teardown or an address change gets the cancelled signal and says what it says of an unreachable Toon.
   * @param {{probe: Function, probeBudgetMs: number}} feature `probe(client, {signal})` never throws
   */
  async probe(feature) {
    if (this.stopped) throw new ToonError('aborted');
    return this.lane.run(() => runProbe(feature, this.client, this.timers, this.controller.signal), { kind: 'write' });
  }

  /**
   * Reads groups now, ahead of the cycle, one after the other. Waiting refreshes of one group share one request. When
   * the Toon does not answer at all (timeout, network), the groups after that one are not asked and report the same failure:
   * the caller hears at once, and the queue is not held for another 5 s per group.
   * @param {string[]} [groupIds] default: every group that is on
   * @returns {Promise<Object<string, ToonError | null>>} the outcome per group; rejects with `aborted` when the device went away
   */
  async refresh(groupIds) {
    if (this.stopped) throw new ToonError('aborted');
    const wanted = this.groups().filter((group) => groupIds === undefined || groupIds.includes(group.id));
    const outcomes = {};
    let down = null;
    for (const group of wanted) {
      outcomes[group.id] = down || await this.lane.run(() => this._attempt(group), { kind: 'refresh', key: group.id });
      if (isAborted(outcomes[group.id])) throw outcomes[group.id];
      if (outcomes[group.id] !== null && TRANSPORT_KINDS.includes(outcomes[group.id].kind)) down = outcomes[group.id];
    }
    return outcomes;
  }

  /** `refresh` after a delay; a newer call for the same groups postpones it. */
  refreshSoon(groupIds, delayMs) {
    if (this.stopped || groupIds.length === 0) return;
    const key = groupIds.join(',');
    this.timers.clearTimeout(this.soon.get(key));
    this.soon.set(key, this.timers.setTimeout(() => this._soon(key, groupIds), delayMs));
  }

  /**
   * Sends the requests one after the other, ahead of every poll and refresh. After a success the groups are
   * invalidated and read again `settleMs` later; after a failure they are read again at once.
   * @param {{path: string, query?: object}[]} requests
   * @param {{key?: string, groups?: string[], settleMs?: number}} [options] `key`: latest wins among pending writes
   */
  async write(requests, { key, groups = [], settleMs = 0 } = {}) {
    if (this.stopped) throw new ToonError('aborted');
    try {
      await this.lane.run(() => this._send(requests), { kind: 'write', key });
    } catch (error) {
      if (!isAborted(error)) this.refreshSoon(groups, 0);
      throw error;
    }
    this.invalidate(groups);
    this.refreshSoon(groups, settleMs);
  }

  async _send(requests) {
    const { client, controller } = this;
    for (const request of requests) await client.get(request, { signal: controller.signal });
  }

  async _soon(key, groupIds) {
    try {
      this.soon.delete(key);
      await this.refresh(groupIds);
    } catch (error) {
      if (!isAborted(error)) this.log(`refresh failed unexpectedly: ${error.message}`);
    }
  }

  _cancel() {
    this.gen += 1;
    this.controller.abort();
    this._disarm();
    this.lane.rejectAll(new ToonError('aborted'));
  }

  _arm(delayMs) {
    this._disarm();
    this.timer = this.timers.setTimeout(() => this._tick(), delayMs);
  }

  _disarm() {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
  }

  _gone(gen) {
    return this.stopped || this.gen !== gen;
  }

  async _tick() {
    const { gen } = this;
    let ran = false;
    try {
      this.timer = null;
      if (this.stopped) return;
      if (this.busy) {
        this._arm(FIRST_DELAY_MS); // the cycle of a cancelled address is still winding down
        return;
      }
      ran = true;
      this.busy = true;
      await this._cycle(gen);
    } catch (error) {
      this.log(`poll cycle failed unexpectedly: ${error.message}`);
    } finally {
      if (ran) {
        this.busy = false;
        if (!this._gone(gen)) this._arm(backoffMs(this.ledger.health.failures, this.interval()));
      }
    }
  }

  async _cycle(gen) {
    const cycle = this.cycles++;
    let critical;
    for (const group of this.groups()) {
      if (cycle % (group.every || 1) !== 0 || !this.groups().includes(group) || this.ledger.held(group)) continue;
      const error = await this.lane.run(() => this._attempt(group), { kind: 'poll', key: group.id }).catch((rejection) => rejection);
      if (this._gone(gen)) return;
      if (!group.report) this.ledger.track(group.id, error);
      if (group.critical) {
        critical = error;
        if (error !== null && TRANSPORT_KINDS.includes(error.kind)) break; // the host is down: ask for nothing else
      }
    }
    if (critical !== undefined) this.ledger.score(critical);
  }

  /** One request for one group and the application of its answer. Resolves to the ToonError, or null on success. */
  async _attempt(group) {
    const { client, controller, gen } = this;
    const sequence = this.sequence.get(group.id) || 0;
    const current = () => !this._gone(gen) && (this.sequence.get(group.id) || 0) === sequence;
    let result = null;
    let error = null;
    try {
      const payload = await client.get(group.endpoint, { signal: controller.signal });
      if (this.onPayload && !this._gone(gen)) this.onPayload(group.id, payload);
      result = group.parse(payload);
      if (result.unusable) error = new ToonError('bad_body'); // the Toon answered, but not with what this group reads
    } catch (cause) {
      error = cause instanceof ToonError ? cause : new ToonError('bad_body', { cause });
    }
    try {
      if (result !== null && current()) await this.apply(group, result, current);
    } catch (cause) {
      this.log(`applying ${group.id} failed unexpectedly: ${cause.message}`);
    }
    if (!isAborted(error) && current()) this.ledger.record(group, error, result); // an answer that is dropped counts for nothing
    return error;
  }

  _emit(event) {
    if (this.stopped) return;
    Promise.resolve().then(() => this.onEvent(event)).catch((error) => this.log(`status update failed: ${error.message}`));
  }
}

module.exports = { Poller };
