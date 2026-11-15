'use strict';

/*
 * Deterministic clock behind `homey.setTimeout` and the `timers` injected into the Toon client.
 * Time moves only through tick()/runAll(); after every fired timer the promise queue is flushed so
 * that async callbacks and the promises they resolve have run before the next timer fires.
 */

const MAX_FIRED = 100000;

function flush() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function createClock(startMs = 0) {
  let current = startMs;
  let nextId = 1;
  let nextOrder = 1;
  const armed = new Map();

  function arm(callback, delay, args, repeat) {
    if (typeof callback !== 'function') throw new TypeError('The timer callback must be a function');
    const wait = Math.max(0, Number(delay) || 0);
    const handle = {
      id: nextId++,
      ref() {
        return handle;
      },
      unref() {
        return handle;
      },
      hasRef() {
        return true;
      },
      refresh() {
        return handle;
      },
      [Symbol.toPrimitive]() {
        return handle.id;
      },
    };
    armed.set(handle.id, {
      handle, callback, args, repeat: repeat ? wait : null, due: current + wait, order: nextOrder++,
    });
    return handle;
  }

  function disarm(handle) {
    if (handle && typeof handle === 'object') armed.delete(handle.id);
    else if (typeof handle === 'number') armed.delete(handle);
  }

  function nextTimer(limit) {
    let best = null;
    armed.forEach((timer) => {
      if (timer.due > limit) return;
      if (!best || timer.due < best.due || (timer.due === best.due && timer.order < best.order)) best = timer;
    });
    return best;
  }

  async function fire(timer) {
    if (timer.repeat === null) armed.delete(timer.handle.id);
    else {
      timer.due = current + Math.max(1, timer.repeat);
      timer.order = nextOrder++;
    }
    timer.callback(...timer.args);
    await flush();
  }

  const clock = {
    now: () => current,
    setTimeout: (callback, delay, ...args) => arm(callback, delay, args, false),
    clearTimeout: disarm,
    setInterval: (callback, delay, ...args) => arm(callback, delay, args, true),
    clearInterval: disarm,
    /** Number of timers that are scheduled and not yet fired or cleared. */
    armed: () => armed.size,

    /** Moves time forward by `ms`, firing every timer that falls due, in order. */
    async tick(ms) {
      const target = current + Math.max(0, ms);
      await flush();
      let fired = 0;
      for (let timer = nextTimer(target); timer; timer = nextTimer(target)) {
        if (++fired > MAX_FIRED) throw new Error('fake clock: too many timers fired in one tick');
        current = Math.max(current, timer.due);
        await fire(timer);
      }
      current = target;
      await flush();
    },

    /** Fires timers until none is armed. Throws when a repeating timer would never let it finish. */
    async runAll(limit = MAX_FIRED) {
      await flush();
      let fired = 0;
      for (let timer = nextTimer(Infinity); timer; timer = nextTimer(Infinity)) {
        if (++fired > limit) throw new Error('fake clock: runAll did not settle (repeating timer?)');
        current = Math.max(current, timer.due);
        await fire(timer);
      }
    },

    /** The `{setTimeout, clearTimeout}` pair that the Toon client receives by injection. */
    timers: null,
  };
  clock.timers = { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout };
  return clock;
}

/**
 * Lets the clock run until a promise has settled, so that a test can await work that waits for timers.
 * @param {{now: () => number, tick: (ms: number) => Promise<void>}} clock
 * @param {Promise<unknown>} promise
 * @param {{stepMs?: number, limitMs?: number}} [options] the clock moves by `stepMs` at a time, for at most `limitMs`
 * @returns {Promise<{value?: unknown, error?: unknown, tookMs: number}>} how the promise settled, and how much fake time that took
 */
async function settle(clock, promise, { stepMs = 100, limitMs = 60000 } = {}) {
  let outcome;
  const started = clock.now();
  const pending = promise.then((value) => {
    outcome = { value };
  }, (error) => {
    outcome = { error };
  });
  await flush(); // a promise that is settled already, or settles on microtasks, costs no time
  while (outcome === undefined && clock.now() - started < limitMs) await clock.tick(stepMs);
  if (outcome === undefined) throw new Error(`settle: the promise did not settle within ${limitMs} ms of fake time`);
  await pending;
  return { ...outcome, tookMs: clock.now() - started };
}

module.exports = { createClock, flush, settle };
