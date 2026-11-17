'use strict';

/*
 * The timing of the requests to one Toon (ADR-0005, docs/sdlc/05-architecture.md section 5), in three parts that
 * need no Homey and no clock of their own:
 *  - the Lane, a priority queue that runs one task at a time. The device has two: one for every request to the
 *    Toon, so that two requests are never in flight at once, and one for the multi-step jobs that touch the device
 *    itself (migration, settings), so that they never interleave;
 *  - the numbers of the policy as pure functions: poll interval, back-off, availability and the hold-off of a group,
 *    and the time budget of a probe;
 *  - the ledger that applies them to what a device has seen so far: availability, hold-offs, problem transitions.
 *
 * Lane order: write, then refresh, then poll; first in, first out within a kind. A task that is running is never
 * abandoned for another. Sharing: a write with a key replaces a pending write with the same key (latest wins);
 * a refresh or poll with a key joins the pending refresh or the running task of that key and gets its result.
 */

const { isNotFound } = require('../toon/errors');

const KINDS = Object.freeze(['write', 'refresh', 'poll']);

class Lane {
  constructor() {
    this.queues = { write: [], refresh: [], poll: [] };
    this.current = null;
  }

  /** Tasks that are queued or running. */
  get size() {
    return KINDS.reduce((total, kind) => total + this.queues[kind].length, this.current ? 1 : 0);
  }

  /**
   * @param {() => Promise<*>} task
   * @param {{kind: 'write' | 'refresh' | 'poll', key?: string}} options
   * @returns {Promise<*>} the result of the task, or its rejection
   */
  run(task, { kind, key }) {
    if (!KINDS.includes(kind)) throw new TypeError(`Unknown lane kind: ${String(kind)}`);
    const shared = this._share(task, kind, key);
    if (shared) return shared;
    const entry = { task, kind, key };
    entry.promise = new Promise((resolve, reject) => {
      entry.resolve = resolve;
      entry.reject = reject;
    });
    this.queues[kind].push(entry);
    this._next();
    return entry.promise;
  }

  /** Rejects every task that has not started. The running task is left to finish or to be aborted by its own signal. */
  rejectAll(error) {
    KINDS.forEach((kind) => this.queues[kind].splice(0).forEach((entry) => entry.reject(error)));
  }

  _share(task, kind, key) {
    if (key === undefined) return null;
    if (kind === 'write') {
      const pending = this.queues.write.find((entry) => entry.key === key);
      if (pending) pending.task = task;
      return pending ? pending.promise : null;
    }
    const pending = this.queues.refresh.find((entry) => entry.key === key);
    if (pending) return pending.promise;
    return this.current && this.current.kind !== 'write' && this.current.key === key ? this.current.promise : null;
  }

  _next() {
    if (this.current) return;
    const kind = KINDS.find((name) => this.queues[name].length > 0);
    if (!kind) return;
    const entry = this.queues[kind].shift();
    const done = () => {
      this.current = null;
      this._next();
    };
    this.current = entry;
    Promise.resolve().then(() => entry.task()).then((value) => {
      entry.resolve(value);
      done();
    }, (error) => {
      entry.reject(error);
      done();
    });
  }
}

const INTERVAL = Object.freeze({ default: 30, min: 10, max: 3600 }); // seconds
const BACKOFF_CAP_MS = 300e3;
// Unavailable after 3 failed cycles spanning 90 s, or 2 spanning 15 min (ADR-0005; tuned on hardware).
const OFFLINE = Object.freeze({
  failures: 3, afterMs: 90e3, slowFailures: 2, slowAfterMs: 15 * 60e3,
});

/** The poll interval in ms: the setting as a number, 30 s when it is not one, kept within 10..3600 s. */
function intervalMs(raw) {
  const seconds = Number(raw) || INTERVAL.default;
  return Math.min(INTERVAL.max, Math.max(INTERVAL.min, seconds)) * 1000;
}

/** Whether a saved poll interval is acceptable: empty means "the default", otherwise a number of 10..3600 seconds (FR-83). */
function isIntervalValid(raw) {
  if (raw === undefined || raw === null || raw === '') return true;
  const seconds = typeof raw === 'string' ? Number(raw) : raw;
  return typeof seconds === 'number' && seconds >= INTERVAL.min && seconds <= INTERVAL.max;
}

/** Delay before the next cycle after `failures` failed cycles in a row; never shorter than the interval. */
function backoffMs(failures, interval) {
  if (failures < 3) return interval;
  return Math.min(interval * 2 ** (failures - 2), Math.max(BACKOFF_CAP_MS, interval));
}

/**
 * The health after one cycle. `unavailable` stays set until a cycle succeeds.
 * @param {{failures: number, firstFailureAt: number | null, unavailable: boolean}} state
 * @param {boolean} ok whether the critical group answered
 * @param {number} now ms
 */
function availabilityStep(state, ok, now) {
  if (ok) return { failures: 0, firstFailureAt: null, unavailable: false };
  const failures = state.failures + 1;
  const firstFailureAt = state.failures === 0 ? now : state.firstFailureAt;
  const elapsed = now - firstFailureAt;
  const unavailable = state.unavailable
    || (failures >= OFFLINE.failures && elapsed >= OFFLINE.afterMs)
    || (failures >= OFFLINE.slowFailures && elapsed >= OFFLINE.slowAfterMs);
  return { failures, firstFailureAt, unavailable };
}

/**
 * Whether a poll group sits out for a while after its answer (the back-off of the group itself, ADR-0006). A page
 * that is missing (`absentOn404`) is asked for again after a long time at once; any other failure after
 * `failBackoffMs`, and after `escalatedBackoffMs` once more than `failEscalateAfter` failures came in a row. A group
 * without these settings is read every cycle, and a good answer ends the hold-off.
 * @param {{until: number, strikes: number} | undefined} previous
 * @param {object} group
 * @param {ToonError | null} error
 * @param {number} now ms
 * @returns {{until: number, strikes: number} | null} null: the group is read in the next cycle
 */
function holdoffStep(previous, group, error, now) {
  if (error === null) return null;
  if (isNotFound(error) && group.absentOn404) return { until: now + group.absentOn404.backoffMs, strikes: 0 };
  if (!group.failBackoffMs) return null;
  const strikes = (previous ? previous.strikes : 0) + 1;
  return { until: now + (strikes > group.failEscalateAfter ? group.escalatedBackoffMs : group.failBackoffMs), strikes };
}

/**
 * Runs the probe of a feature within its time budget. A probe that is cancelled (by `signal`, a teardown or an address
 * change) or runs out of budget gets the cancelled signal and says what it says of an unreachable Toon.
 * @param {{probe: Function, probeBudgetMs: number}} feature `probe(client, {signal})` never throws
 * @param {object} client the ToonClient of the current address
 * @param {{setTimeout: Function, clearTimeout: Function}} timers
 * @param {AbortSignal} [signal] the cancellation of the device; the pair view has none
 */
async function runProbe({ probe, probeBudgetMs }, client, timers, signal) {
  const budget = new AbortController();
  const stop = () => budget.abort();
  if (signal) signal.addEventListener('abort', stop, { once: true });
  const timer = timers.setTimeout(stop, probeBudgetMs);
  try {
    return await probe(client, { signal: budget.signal });
  } finally {
    timers.clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', stop);
  }
}

/**
 * What a device has seen so far: its availability, the groups that sit out and the problems it has announced.
 * @param {{now: () => number, emit: (event: object) => void, unavailable?: boolean}} options
 *   `unavailable`: the device is unavailable now, so the first success announces `available`
 */
function createLedger({ now, emit, unavailable = false }) {
  return {
    health: { failures: 0, firstFailureAt: null, unavailable },
    holdoff: new Map(), // group id -> {until, strikes}: groups that sit out for a while
    failing: new Map(), // group id -> problem key, for the transition events

    /** The address changed: the failures and hold-offs belonged to the old host. A device stays unavailable until a cycle succeeds. */
    reset() {
      this.health = { failures: 0, firstFailureAt: null, unavailable: this.health.unavailable };
      this.failing.clear();
      this.holdoff.clear();
    },

    /** Ends the hold-off of these groups: they are read again in the next cycle. */
    release(groupIds) {
      groupIds.forEach((id) => this.holdoff.delete(id));
    },

    /** Whether the group still sits out. */
    held(group) {
      const hold = this.holdoff.get(group.id);
      return hold !== undefined && now() < hold.until;
    },

    /** Remembers how a group fared: its hold-off, and for a group that asks for it, a `result` event. */
    record(group, error, result) {
      const hold = holdoffStep(this.holdoff.get(group.id), group, error, now());
      if (hold === null) this.holdoff.delete(group.id);
      else this.holdoff.set(group.id, hold);
      if (group.report) {
        emit({
          type: 'result', group: group.id, error, reason: result === null ? undefined : result.unusable,
        });
      }
    },

    /** Announces the start and the end of a problem of a group once, not once per cycle. */
    track(groupId, error) {
      const key = error === null ? null : error.message; // a ToonError says its kind and status: "http 404"
      if (key === (this.failing.get(groupId) || null)) return;
      if (key === null) this.failing.delete(groupId);
      else this.failing.set(groupId, key);
      emit(key === null ? { type: 'recovered', group: groupId } : { type: 'problem', group: groupId, error });
    },

    /** Counts a cycle of the critical group for the availability of the device. */
    score(error) {
      const before = this.health;
      this.health = availabilityStep(before, error === null, now());
      if (error === null) {
        emit({ type: 'success', at: now() });
        if (before.unavailable) emit({ type: 'available' });
      } else if (!before.unavailable && this.health.unavailable) {
        emit({ type: 'unavailable' });
      }
    },
  };
}

module.exports = {
  Lane, INTERVAL, createLedger, intervalMs, isIntervalValid, backoffMs, availabilityStep, holdoffStep, runProbe,
};
