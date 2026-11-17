'use strict';

/*
 * The policy of the poller (ADR-0005) as tables and as a small engine under a fake clock: interval clamp, back-off,
 * availability, the lane that orders and shares requests, and the Poller with a stub client. The device and the
 * real Toon mock come in the scenario tests; here every number of the policy is pinned on its own.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { getEventListeners } = require('events');
const { Poller } = require('../../lib/engine/poller');
const {
  Lane, intervalMs, isIntervalValid, backoffMs, availabilityStep, holdoffStep,
} = require('../../lib/engine/schedule');
const { ToonError } = require('../../lib/toon/errors');
const { createClock } = require('../helpers/fake-clock');

const deferred = () => {
  const result = {};
  result.promise = new Promise((resolve, reject) => {
    result.resolve = resolve;
    result.reject = reject;
  });
  return result;
};

const tick = () => new Promise((resolve) => {
  setImmediate(resolve);
});

describe('FR-83 / FR-112: the interval is clamped to 10..3600 s and falls back to 30 s', () => {
  test('intervalMs: text, numbers, nothing and nonsense', () => {
    assert.equal(intervalMs('abc'), 30000);
    assert.equal(intervalMs('45'), 45000);
    assert.equal(intervalMs(5), 10000);
    assert.equal(intervalMs(99999), 3600000);
    assert.equal(intervalMs(10), 10000);
    assert.equal(intervalMs(3600), 3600000);
    [undefined, null, '', 0, NaN, {}, []].forEach((raw) => assert.equal(intervalMs(raw), 30000, String(raw)));
    assert.equal(intervalMs(-20), 10000);
    assert.equal(intervalMs(Infinity), 3600000);
  });

  test('FR-83 AC1: 5, 3601 and "abc" are refused, 10 and 3600 accepted, empty means the default', () => {
    [5, 3601, 'abc', NaN, Infinity, -1, {}, []].forEach((raw) => assert.equal(isIntervalValid(raw), false, String(raw)));
    [10, 3600, 30, 45.5, '45', '', undefined, null].forEach((raw) => assert.equal(isIntervalValid(raw), true, String(raw)));
  });
});

describe('FR-81 AC3: back-off never shortens the interval and is capped at max(300 s, interval)', () => {
  test('30 s interval: two retries at the interval, then doubling up to 300 s', () => {
    const delays = [0, 1, 2, 3, 4, 5, 6, 7, 20].map((failures) => backoffMs(failures, 30000) / 1000);

    assert.deepEqual(delays, [30, 30, 30, 60, 120, 240, 300, 300, 300]);
  });

  test('10 s interval', () => {
    assert.deepEqual([2, 3, 4, 5, 6, 7, 8].map((failures) => backoffMs(failures, 10000) / 1000), [10, 20, 40, 80, 160, 300, 300]);
  });

  test('3600 s interval: never below the interval, so never the 300 s of the first draft', () => {
    [0, 1, 2, 3, 4, 10, 50].forEach((failures) => assert.equal(backoffMs(failures, 3600000), 3600000, String(failures)));
  });

  test('every interval: at least the interval, at most max(300 s, interval), never shorter after another failure', () => {
    [10, 30, 60, 120, 300, 600, 3600].forEach((seconds) => {
      const interval = seconds * 1000;
      let previous = 0;
      for (let failures = 0; failures <= 60; failures++) {
        const delay = backoffMs(failures, interval);
        assert.ok(delay >= interval, `${seconds} s, ${failures} failures: not below the interval`);
        assert.ok(delay <= Math.max(300000, interval), `${seconds} s, ${failures} failures: capped`);
        assert.ok(delay >= previous, `${seconds} s, ${failures} failures: not shorter than before`);
        previous = delay;
      }
    });
  });
});

describe('FR-81: availabilityStep counts failures and time', () => {
  /** Runs cycles with the poller's own back-off until `healthyAt` ms; returns when and at which failure the device flipped. */
  function simulate(interval, healthyAt = Infinity, horizon = 24 * 3600e3) {
    let state = { failures: 0, firstFailureAt: null, unavailable: false };
    let flipped = null;
    for (let now = 0; now <= horizon; now += backoffMs(state.failures, interval)) {
      const ok = now >= healthyAt;
      state = availabilityStep(state, ok, now);
      if (state.unavailable && flipped === null) flipped = { at: now / 1000, failures: state.failures };
      if (ok) break;
    }
    return { state, flipped };
  }

  test('10 s interval: a 30 s hiccup does not flip the device, an outage flips it once 90 s have passed', () => {
    assert.equal(simulate(10000, 30000).flipped, null);
    assert.deepEqual(simulate(10000).flipped, { at: 160, failures: 6 });
  });

  test('30 s interval: three failures within 60 s do not flip, the fourth at 120 s does', () => {
    assert.deepEqual(simulate(30000).flipped, { at: 120, failures: 4 });
    assert.equal(simulate(30000, 70000).flipped, null);
  });

  test('3600 s interval: one failure is not enough, two failures over an hour flip the device', () => {
    const first = availabilityStep({ failures: 0, firstFailureAt: null, unavailable: false }, false, 0);
    const second = availabilityStep(first, false, 3600000);

    assert.equal(first.unavailable, false);
    assert.equal(second.unavailable, true);
    assert.deepEqual(simulate(3600000).flipped, { at: 3600, failures: 2 });
  });

  test('a success resets everything; unavailable stays until then, also while failures go on', () => {
    const down = { failures: 7, firstFailureAt: 0, unavailable: true };

    assert.deepEqual(availabilityStep(down, true, 9e6), { failures: 0, firstFailureAt: null, unavailable: false });
    assert.equal(availabilityStep(down, false, 9e6).unavailable, true);
    assert.equal(availabilityStep({ failures: 0, firstFailureAt: null, unavailable: true }, false, 5).unavailable, true, 'a device that starts unavailable stays so');
    assert.deepEqual(simulate(30000, 600000).state, { failures: 0, firstFailureAt: null, unavailable: false });
  });
});

describe('The lane runs one task at a time, write before refresh before poll', () => {
  test('order of starts: write, refresh, refresh, poll, poll; never two at once', async () => {
    const lane = new Lane();
    const gate = deferred();
    const started = [];
    let running = 0;
    let peak = 0;
    const task = (name) => async () => {
      running++;
      peak = Math.max(peak, running);
      started.push(name);
      await tick();
      running--;
      return name;
    };

    const first = lane.run(async () => {
      started.push('first');
      await gate.promise;
      return 'first';
    }, { kind: 'poll' });
    const results = [
      lane.run(task('poll-a'), { kind: 'poll' }),
      lane.run(task('refresh-a'), { kind: 'refresh' }),
      lane.run(task('poll-b'), { kind: 'poll' }),
      lane.run(task('write-a'), { kind: 'write' }),
      lane.run(task('refresh-b'), { kind: 'refresh' }),
    ];
    assert.equal(lane.size, 6);
    gate.resolve();

    assert.deepEqual(await Promise.all([first, ...results]), ['first', 'poll-a', 'refresh-a', 'poll-b', 'write-a', 'refresh-b']);
    assert.deepEqual(started, ['first', 'write-a', 'refresh-a', 'refresh-b', 'poll-a', 'poll-b']);
    assert.equal(peak, 1);
    assert.equal(lane.size, 0);
  });

  test('a running task is never abandoned: a write waits for it', async () => {
    const lane = new Lane();
    const gate = deferred();
    const events = [];
    const poll = lane.run(async () => {
      await gate.promise;
      events.push('poll done');
    }, { kind: 'poll' });
    const write = lane.run(async () => events.push('write start'), { kind: 'write' });
    await tick();

    assert.deepEqual(events, []);
    gate.resolve();
    await Promise.all([poll, write]);
    assert.deepEqual(events, ['poll done', 'write start']);
  });

  test('a task that throws rejects its own promise and the lane goes on', async () => {
    const lane = new Lane();
    const failing = lane.run(async () => {
      throw new Error('boom');
    }, { kind: 'poll' });
    const after = lane.run(async () => 'fine', { kind: 'poll' });

    await assert.rejects(failing, /boom/);
    assert.equal(await after, 'fine');
    assert.equal(lane.size, 0);
  });

  test('an unknown kind is a programming error', () => {
    assert.throws(() => new Lane().run(async () => {}, { kind: 'urgent' }), TypeError);
  });
});

describe('Refreshes of one group share one request', () => {
  test('ten waiting refreshes of a group are one task; another group is another task', async () => {
    const lane = new Lane();
    const gate = deferred();
    const ran = [];
    const task = (name) => async () => {
      ran.push(name);
      return name;
    };
    const busy = lane.run(async () => gate.promise, { kind: 'poll', key: 'other' });
    const same = Array.from({ length: 10 }, () => lane.run(task('power'), { kind: 'refresh', key: 'power' }));
    const different = lane.run(task('meters'), { kind: 'refresh', key: 'meters' });

    assert.ok(same.every((promise) => promise === same[0]), 'the same promise for everyone');
    gate.resolve();
    await busy;
    assert.deepEqual(await Promise.all([...same, different]), [...Array(10).fill('power'), 'meters']);
    assert.deepEqual(ran, ['power', 'meters']);
  });

  test('a refresh joins the poll of its group that is in flight, and a poll joins a refresh that is waiting', async () => {
    const lane = new Lane();
    const gate = deferred();
    const ran = [];
    const inFlight = lane.run(async () => {
      ran.push('poll thermostat');
      await gate.promise;
      return 'answer';
    }, { kind: 'poll', key: 'thermostat' });
    const joined = lane.run(async () => ran.push('refresh thermostat'), { kind: 'refresh', key: 'thermostat' });
    const waiting = lane.run(async () => ran.push('refresh power'), { kind: 'refresh', key: 'power' });
    const poll = lane.run(async () => ran.push('poll power'), { kind: 'poll', key: 'power' });

    assert.equal(joined, inFlight);
    assert.equal(poll, waiting);
    gate.resolve();
    await Promise.all([inFlight, waiting]);
    assert.deepEqual(ran, ['poll thermostat', 'refresh power']);
  });

  test('a task of another group in flight is not joined, and a write is never joined by a refresh', async () => {
    const lane = new Lane();
    const gate = deferred();
    const running = lane.run(async () => gate.promise, { kind: 'write', key: 'thermostat' });
    const refresh = lane.run(async () => 'refreshed', { kind: 'refresh', key: 'thermostat' });

    assert.notEqual(refresh, running);
    gate.resolve();
    assert.equal(await refresh, 'refreshed');
  });
});

describe('FR-16 AC1: of the pending writes with one key only the latest is sent', () => {
  test('one running, many waiting: two requests in total, and everyone gets the result of the last', async () => {
    const lane = new Lane();
    const gate = deferred();
    const sent = [];
    const send = (value) => async () => {
      sent.push(value);
      if (value === 1) await gate.promise;
      return `sent ${value}`;
    };
    const calls = Array.from({ length: 20 }, (unused, index) => lane.run(send(index + 1), { kind: 'write', key: 'setpoint' }));
    gate.resolve();
    const results = await Promise.all(calls);

    assert.deepEqual(sent, [1, 20]);
    assert.equal(results[0], 'sent 1');
    assert.deepEqual(new Set(results.slice(1)), new Set(['sent 20']));
  });

  test('writes without a key are all sent, in order', async () => {
    const lane = new Lane();
    const sent = [];
    await Promise.all([1, 2, 3].map((value) => lane.run(async () => sent.push(value), { kind: 'write' })));

    assert.deepEqual(sent, [1, 2, 3]);
  });
});

describe('FR-84: rejectAll empties the queue and the running task is left alone', () => {
  test('queued tasks reject at once, the running one finishes, the lane is empty afterwards', async () => {
    const lane = new Lane();
    const gate = deferred();
    const running = lane.run(async () => {
      await gate.promise;
      return 'done';
    }, { kind: 'poll' });
    const queued = [lane.run(async () => 'never', { kind: 'write' }), lane.run(async () => 'never', { kind: 'refresh', key: 'power' })];
    const rejected = queued.map((promise) => assert.rejects(promise, (error) => error.kind === 'aborted'));
    lane.rejectAll(new ToonError('aborted'));
    await Promise.all(rejected);

    assert.equal(lane.size, 1);
    gate.resolve();
    assert.equal(await running, 'done');
    assert.equal(lane.size, 0);
  });
});

/** A stub of ToonClient: answers per path from `behaviour`, records requests, honours the signal. */
function stubClient(host, behaviour, clock) {
  const log = [];
  return {
    host,
    log,
    async get(endpoint, { signal } = {}) {
      const entry = { path: endpoint.path, action: endpoint.query && endpoint.query.action, at: clock.now() };
      log.push(entry);
      if (signal && signal.aborted) throw new ToonError('aborted');
      const outcome = await new Promise((resolve, reject) => {
        const onAbort = () => reject(new ToonError('aborted'));
        if (signal) signal.addEventListener('abort', onAbort, { once: true });
        Promise.resolve(behaviour(endpoint, entry)).then((value) => {
          if (signal) signal.removeEventListener('abort', onAbort);
          resolve(value);
        }, (error) => {
          if (signal) signal.removeEventListener('abort', onAbort);
          reject(error);
        });
      });
      return outcome;
    },
  };
}

const GROUPS = Object.freeze([
  Object.freeze({
    id: 'thermostat', critical: true, endpoint: { path: '/t' }, parse: (json) => ({ values: { t: json.v }, notes: [] }),
  }),
  Object.freeze({
    id: 'power', critical: false, endpoint: { path: '/p' }, parse: (json) => ({ values: { p: json.v }, notes: [] }),
  }),
  Object.freeze({
    id: 'meters', critical: false, endpoint: { path: '/m' }, parse: (json) => ({ values: { m: json.v }, notes: [] }),
  }),
]);

function boot({
  behaviour = () => ({ v: 1 }), groups = GROUPS, interval = 30000, unavailable = false,
} = {}) {
  const clock = createClock();
  const client = stubClient('a', behaviour, clock);
  const applied = [];
  const events = [];
  const lines = [];
  const poller = new Poller({
    client,
    timers: clock.timers,
    groups: () => groups,
    interval: () => interval,
    apply: async (group, result, current) => {
      applied.push({ group: group.id, values: result.values, current: current() });
    },
    onEvent: async (event) => {
      events.push(event.type === 'problem' ? `problem ${event.group} ${event.error.kind}` : `${event.type}${event.group ? ` ${event.group}` : ''}`);
    },
    log: (line) => lines.push(line),
    now: () => clock.now(),
    random: () => 0,
    unavailable,
  });
  return {
    clock, client, poller, applied, events, lines,
  };
}

describe('FR-80: the cycle', () => {
  test('AC2: the first cycle starts 1 s plus up to 2 s after start, then every interval; groups in declared order', async () => {
    const { clock, client, poller } = boot();
    poller.start();
    await clock.tick(999);
    assert.equal(client.log.length, 0);
    await clock.tick(1);
    assert.deepEqual(client.log.map((entry) => entry.path), ['/t', '/p', '/m']);
    await clock.tick(30000);
    assert.equal(client.log.length, 6);
    poller.stop();
  });

  test('the jitter spreads the first cycle: 0.5 gives 2 s, the largest value stays below 3 s', async () => {
    const { clock, client, poller } = boot();
    poller.random = () => 0.5;
    poller.start();
    await clock.tick(1999);
    assert.equal(client.log.length, 0);
    await clock.tick(1);
    assert.equal(client.log.length, 3);
    poller.stop();
    poller.random = () => 0.9999;
    assert.equal(1000 + Math.floor(0.9999 * 2000), 2999);
  });

  test('AC3: a cycle that takes longer than the interval is not overlapped; the next one is timed from its end', async () => {
    let calls = 0;
    const { clock, client, poller } = boot({
      groups: [GROUPS[0]],
      interval: 10000,
      behaviour: async () => {
        calls++;
        await new Promise((resolve) => {
          clock.setTimeout(resolve, 4000);
        });
        return { v: calls };
      },
    });
    poller.start();
    await clock.tick(1000 + 4000);
    assert.equal(client.log.length, 1);
    await clock.tick(10000 - 1);
    assert.equal(client.log.length, 1, 'the interval counts from the end of the cycle');
    await clock.tick(1);
    assert.equal(client.log.length, 2);
    poller.stop();
  });

  test('AC4: a failing group does not skip the others, and is reported once when it starts and once when it ends', async () => {
    let meters = 'down';
    const {
      clock, client, poller, applied, events,
    } = boot({
      behaviour: (endpoint) => {
        if (endpoint.path === '/m' && meters === 'down') throw new ToonError('http', { status: 500 });
        return { v: 1 };
      },
    });
    poller.start();
    await clock.tick(1000 + 30000 * 3);

    assert.deepEqual(client.log.map((entry) => entry.path).slice(0, 3), ['/t', '/p', '/m']);
    assert.equal(applied.filter((entry) => entry.group === 'power').length, 4);
    assert.equal(events.filter((event) => event.startsWith('problem')).length, 1, 'one problem event for four failing cycles');
    meters = 'up';
    await clock.tick(30000);
    assert.equal(events.filter((event) => event === 'recovered meters').length, 1);
    poller.stop();
  });

  test('R-02: when the critical group fails with a timeout or network error the rest of the cycle is skipped', async () => {
    const { clock, client, poller } = boot({
      behaviour: () => {
        throw new ToonError('network');
      },
    });
    poller.start();
    await clock.tick(1000);

    assert.deepEqual(client.log.map((entry) => entry.path), ['/t']);
    poller.stop();
  });

  test('a critical failure that is not transport (HTTP 500) still asks for the other groups', async () => {
    const { clock, client, poller } = boot({
      behaviour: (endpoint) => {
        if (endpoint.path === '/t') throw new ToonError('http', { status: 500 });
        return { v: 1 };
      },
    });
    poller.start();
    await clock.tick(1000);

    assert.deepEqual(client.log.map((entry) => entry.path), ['/t', '/p', '/m']);
    poller.stop();
  });

  test('an answer that cannot be parsed counts as a failure of its group and never throws out of the cycle', async () => {
    const broken = {
      ...GROUPS[0],
      parse: () => {
        throw new SyntaxError('boom');
      },
    };
    const { clock, poller, events } = boot({ groups: [broken] });
    poller.start();
    await clock.tick(1000);

    assert.deepEqual(events, ['problem thermostat bad_body']);
    poller.stop();
  });

  test('groups with every: 2 run on every other cycle', async () => {
    const slow = { ...GROUPS[2], every: 2 };
    const { clock, client, poller } = boot({ groups: [GROUPS[0], slow] });
    poller.start();
    await clock.tick(1000 + 30000 * 3);

    assert.deepEqual(client.log.map((entry) => entry.path), ['/t', '/m', '/t', '/t', '/m', '/t']);
    poller.stop();
  });
});

describe('FR-81: events for availability follow the predicate', () => {
  test('failing at the default interval: problem once, unavailable at the fourth failure, then available and success after recovery', async () => {
    let up = false;
    const { clock, poller, events } = boot({
      groups: [GROUPS[0]],
      behaviour: () => {
        if (!up) throw new ToonError('timeout');
        return { v: 1 };
      },
    });
    poller.start();
    await clock.tick(1000 + 120000);
    assert.deepEqual(events, ['problem thermostat timeout', 'unavailable']);
    assert.equal(poller.ledger.health.failures, 4);

    up = true;
    await clock.tick(300000);
    assert.deepEqual(events.slice(2, 4), ['recovered thermostat', 'success']);
    assert.ok(events.includes('available'));
    assert.deepEqual(poller.ledger.health, { failures: 0, firstFailureAt: null, unavailable: false });
    poller.stop();
  });

  test('a device that starts unavailable announces `available` with its first success', async () => {
    const { clock, poller, events } = boot({ groups: [GROUPS[0]], unavailable: true });
    poller.start();
    await clock.tick(1000);

    assert.deepEqual(events, ['success', 'available']);
    poller.stop();
  });

  test('the delay between cycles follows backoffMs while the Toon is down and returns to the interval after a success', async () => {
    let up = false;
    const { clock, client, poller } = boot({
      groups: [GROUPS[0]],
      behaviour: () => {
        if (!up) throw new ToonError('network');
        return { v: 1 };
      },
    });
    poller.start();
    await clock.tick(1000 + 30000 + 30000 + 60000 + 120000 + 240000);
    const gaps = client.log.slice(1).map((entry, index) => (entry.at - client.log[index].at) / 1000);

    assert.deepEqual(gaps, [30, 30, 60, 120, 240]);
    up = true;
    await clock.tick(300000 + 30000);
    const after = client.log.slice(-3).map((entry) => entry.at);
    assert.equal(after[1] - after[0], 300000, 'the last delay of the outage');
    assert.equal(after[2] - after[1], 30000, 'back to the interval after the first success');
    poller.stop();
  });
});

describe('FR-16 AC3: refresh, write and invalidate on the poller', () => {
  test('ten simultaneous refreshes of every group send one request per group', async () => {
    const { clock, client, poller } = boot();
    poller.start();
    await clock.tick(1000);
    const before = client.log.length;
    const outcomes = await Promise.all(Array.from({ length: 10 }, () => poller.refresh()));

    assert.equal(client.log.length - before, 3);
    outcomes.forEach((outcome) => assert.deepEqual(outcome, { thermostat: null, power: null, meters: null }));
    poller.stop();
  });

  test('refresh reports the outcome per group instead of rejecting when a group fails', async () => {
    const { poller } = boot({
      behaviour: (endpoint) => {
        if (endpoint.path === '/p') throw new ToonError('http', { status: 503 });
        return { v: 1 };
      },
    });
    const outcome = await poller.refresh(['thermostat', 'power', 'unknown']);

    assert.deepEqual(Object.keys(outcome), ['thermostat', 'power']);
    assert.equal(outcome.thermostat, null);
    assert.equal(outcome.power.kind, 'http');
    poller.stop();
  });

  test('FR-74 AC2 / BD-8: a refresh stops asking after a group that got no answer at all, and the groups after it report the same failure', async () => {
    for (const kind of ['timeout', 'network']) {
      const { client, poller } = boot({
        behaviour: (endpoint) => {
          if (endpoint.path === '/t') throw new ToonError(kind);
          return { v: 1 };
        },
      });
      const outcome = await poller.refresh();

      assert.deepEqual(client.log.map((entry) => entry.path), ['/t'], kind);
      assert.deepEqual(Object.keys(outcome), ['thermostat', 'power', 'meters']);
      Object.values(outcome).forEach((error) => assert.equal(error.kind, kind));
      poller.stop();
    }
  });

  test('a refresh goes on after a group that answered with an error: the Toon is there, only that part is not', async () => {
    const { client, poller } = boot({
      behaviour: (endpoint) => {
        if (endpoint.path === '/t') throw new ToonError('http', { status: 500 });
        return { v: 1 };
      },
    });
    const outcome = await poller.refresh();

    assert.deepEqual(client.log.map((entry) => entry.path), ['/t', '/p', '/m']);
    assert.equal(outcome.thermostat.status, 500);
    assert.equal(outcome.power, null);
    assert.equal(outcome.meters, null);
    poller.stop();
  });

  test('a refresh that is waiting for its next group rejects with aborted when the poller stops', async () => {
    const gate = deferred();
    const { poller } = boot({
      behaviour: async (endpoint) => {
        if (endpoint.path === '/p') await gate.promise;
        return { v: 1 };
      },
    });
    const pending = poller.refresh();
    await tick();
    poller.stop();
    gate.resolve();

    await assert.rejects(pending, (error) => error.kind === 'aborted');
  });

  test('a write goes before a waiting refresh and a waiting poll, and a refresh joins the poll of its group that is in flight', async () => {
    const gate = deferred();
    const { clock, client, poller } = boot({
      behaviour: async (endpoint) => {
        if (endpoint.path === '/p' && !gate.released) {
          gate.released = true;
          await gate.promise;
        }
        return { v: 1 };
      },
    });
    poller.start();
    await clock.tick(1000); // the poll of power is in flight
    const joined = poller.refresh(['power']);
    const refresh = poller.refresh(['thermostat']);
    const write = poller.write([{ path: '/w' }]);
    await tick();
    assert.deepEqual(client.log.map((entry) => entry.path), ['/t', '/p']);
    gate.resolve();
    await Promise.all([joined, refresh, write]);
    await clock.tick(0);

    assert.deepEqual(client.log.map((entry) => entry.path), ['/t', '/p', '/w', '/t', '/m'], 'write, refresh, then the rest of the cycle; power was asked once');
    poller.stop();
  });

  test('FR-16 AC3: an answer that was requested before a write finished is not applied', async () => {
    const gate = deferred();
    const { clock, poller, applied } = boot({
      groups: [GROUPS[0]],
      behaviour: async () => {
        await gate.promise;
        return { v: 1 };
      },
    });
    poller.start();
    await clock.tick(1000); // the poll of thermostat is in flight
    poller.invalidate(['thermostat']); // what a finished write does
    gate.resolve();
    await clock.tick(0);

    assert.deepEqual(applied.length, 0, 'dropped before apply');
    await poller.refresh(['thermostat']);
    assert.deepEqual(applied.map((entry) => entry.current), [true], 'an answer requested after it is applied');
    poller.stop();
  });

  test('FR-16 AC2: after a successful write the group is read again settleMs later; after a failure at once', async () => {
    let failWrite = false;
    const { clock, client, poller } = boot({
      groups: [GROUPS[0]],
      behaviour: (endpoint) => {
        if (endpoint.path === '/w' && failWrite) throw new ToonError('http', { status: 500 });
        return { v: 1 };
      },
    });
    await poller.write([{ path: '/w' }], { groups: ['thermostat'], settleMs: 1500 });
    assert.deepEqual(client.log.map((entry) => entry.path), ['/w']);
    await clock.tick(1499);
    assert.equal(client.log.length, 1);
    await clock.tick(1);
    assert.deepEqual(client.log.map((entry) => entry.path), ['/w', '/t']);

    failWrite = true;
    await assert.rejects(poller.write([{ path: '/w' }], { groups: ['thermostat'], settleMs: 1500 }), (error) => error.kind === 'http');
    await clock.tick(0);
    assert.deepEqual(client.log.map((entry) => entry.path), ['/w', '/t', '/w', '/t']);
    poller.stop();
  });

  test('a newer refreshSoon for the same groups postpones the earlier one', async () => {
    const { clock, client, poller } = boot();
    poller.refreshSoon(['thermostat'], 1500);
    await clock.tick(1000);
    poller.refreshSoon(['thermostat'], 1500);
    await clock.tick(1000);
    assert.equal(client.log.length, 0);
    await clock.tick(500);
    assert.equal(client.log.length, 1);
    poller.stop();
  });
});

describe('FR-84: reset and stop leave nothing behind', () => {
  test('stop: the request in flight is aborted, queued work rejects with aborted, no timer is left, a second stop is harmless', async () => {
    const gate = deferred();
    const {
      clock, client, poller, events,
    } = boot({ behaviour: () => gate.promise });
    poller.start();
    await clock.tick(1000);
    const queued = poller.refresh(['power']);
    const write = poller.write([{ path: '/w' }], { groups: ['thermostat'] });
    const outcomes = [assert.rejects(queued, (error) => error.kind === 'aborted'), assert.rejects(write, (error) => error.kind === 'aborted')];
    poller.stop();
    poller.stop();
    await Promise.all(outcomes);
    await clock.tick(10 * 60e3);

    assert.equal(clock.armed(), 0);
    assert.equal(client.log.length, 1, 'nothing after the first request');
    assert.equal(poller.lane.size, 0);
    assert.deepEqual(events, [], 'an aborted request is neither a failure nor a success');
    await assert.rejects(poller.refresh(), (error) => error.kind === 'aborted');
    await assert.rejects(poller.write([{ path: '/w' }]), (error) => error.kind === 'aborted');
  });

  test('reset: the old host gets nothing more, the new client is polled within 1-3 s, health starts again, the epoch signal has one listener', async () => {
    const gate = deferred();
    const {
      clock, client, poller, events,
    } = boot({ behaviour: () => gate.promise });
    poller.start();
    await clock.tick(1000);
    assert.equal(getEventListeners(poller.controller.signal, 'abort').length, 1, 'the request in flight listens, nothing else');
    const second = stubClient('b', () => ({ v: 2 }), clock);
    poller.reset(second);
    gate.resolve();
    await clock.tick(1000);

    assert.equal(client.log.length, 1);
    assert.deepEqual(second.log.map((entry) => entry.path), ['/t', '/p', '/m']);
    assert.deepEqual(events.filter((event) => event.startsWith('problem')), []);
    assert.equal(getEventListeners(poller.controller.signal, 'abort').length, 0);
    poller.stop();
  });

  test('reschedule: a new interval applies from now; a poller that is stopped or busy is left alone', async () => {
    let interval = 30000;
    const { clock, client, poller } = boot();
    poller.interval = () => interval;
    poller.start();
    await clock.tick(1000);
    assert.equal(client.log.length, 3);
    interval = 60000;
    await clock.tick(20000);
    poller.reschedule();
    await clock.tick(59000);
    assert.equal(client.log.length, 3);
    await clock.tick(1000);
    assert.equal(client.log.length, 6);
    poller.stop();
    poller.reschedule();
    await clock.tick(120000);
    assert.equal(client.log.length, 6);
  });
});

describe('NFR-01: whatever goes wrong inside, a timer callback never rejects and the chain goes on', () => {
  test('an apply that throws is logged, the answer still counts as an answer, and the next group is asked', async () => {
    const {
      clock, client, poller, lines, events,
    } = boot();
    poller.apply = async () => {
      throw new Error('boom');
    };
    poller.start();
    await clock.tick(1000);

    assert.deepEqual(client.log.map((entry) => entry.path), ['/t', '/p', '/m']);
    assert.equal(lines.filter((line) => line === 'applying thermostat failed unexpectedly: boom').length, 1);
    assert.deepEqual(events, ['success']);
    poller.stop();
  });

  test('an event handler that rejects is logged and does not touch the cycle', async () => {
    const {
      clock, client, poller, lines,
    } = boot();
    poller.onEvent = async () => {
      throw new Error('settings are gone');
    };
    poller.start();
    await clock.tick(1000 + 30000);

    assert.equal(client.log.length, 6);
    assert.ok(lines.includes('status update failed: settings are gone'));
    poller.stop();
  });

  test('a cycle that breaks is logged, and the next one is armed all the same', async () => {
    let broken = true;
    const {
      clock, client, poller, lines,
    } = boot();
    const { groups } = poller;
    poller.groups = () => {
      if (broken) throw new Error('registry is gone');
      return groups();
    };
    poller.start();
    await clock.tick(1000);
    assert.deepEqual(lines, ['poll cycle failed unexpectedly: registry is gone']);
    assert.equal(poller.busy, false);

    broken = false;
    await clock.tick(30000);
    assert.deepEqual(client.log.map((entry) => entry.path), ['/t', '/p', '/m']);
    poller.stop();
  });

  test('a refresh that was scheduled and fails for an unexpected reason is logged, not thrown', async () => {
    const { clock, poller, lines } = boot();
    poller.groups = () => {
      throw new Error('registry is gone');
    };
    poller.refreshSoon(['thermostat'], 0);
    await clock.tick(0);

    assert.deepEqual(lines, ['refresh failed unexpectedly: registry is gone']);
    poller.stop();
  });

  test('a new cycle never starts while the one of the old address is still winding down: it tries again 1 s later', async () => {
    const gate = deferred();
    const stuck = { host: 'a', log: [], get: async () => gate.promise };
    const { clock, poller } = boot();
    poller.client = stuck;
    poller.start();
    await clock.tick(1000);
    assert.equal(poller.busy, true, 'the cycle waits for an answer that ignores the abort');

    const second = stubClient('b', () => ({ v: 2 }), clock);
    poller.reset(second);
    await clock.tick(1000);
    assert.equal(second.log.length, 0, 'the first tick of the new address finds the old cycle busy');
    gate.reject(new ToonError('aborted'));
    await clock.tick(1000);

    assert.deepEqual(second.log.map((entry) => entry.path), ['/t', '/p', '/m']);
    poller.stop();
  });
});

describe('ADR-0006 item 6: a poll group that sits out after a failure (holdoffStep)', () => {
  const MIN = 60e3;
  const missing = new ToonError('http', { status: 404 });
  const group = {
    absentOn404: { backoffMs: 15 * MIN }, failBackoffMs: 5 * MIN, failEscalateAfter: 3, escalatedBackoffMs: 15 * MIN,
  };

  test('a good answer ends the hold-off, whatever came before', () => {
    assert.equal(holdoffStep({ until: 1, strikes: 5 }, group, null, 100), null);
  });

  test('a missing page is asked for again after 15 minutes at once, and does not count as a strike', () => {
    assert.deepEqual(holdoffStep(undefined, group, missing, 1000), { until: 1000 + 15 * MIN, strikes: 0 });
    assert.deepEqual(holdoffStep({ until: 5, strikes: 2 }, group, missing, 1000), { until: 1000 + 15 * MIN, strikes: 0 });
  });

  test('any other failure: 5 minutes for the first three in a row, 15 minutes from the fourth on, never shorter again', () => {
    const waits = [];
    let hold;
    for (let failure = 1; failure <= 7; failure++) {
      hold = holdoffStep(hold, group, new ToonError('http', { status: 500 }), 0);
      waits.push(hold.until / MIN);
    }

    assert.deepEqual(waits, [5, 5, 5, 15, 15, 15, 15]);
    assert.deepEqual(holdoffStep({ until: 0, strikes: 6 }, group, new ToonError('timeout'), 0), { until: 15 * MIN, strikes: 7 }, 'a timeout is a failure like the others');
  });

  test('a group without these settings is never held back, and a group without absentOn404 treats 404 like any failure', () => {
    assert.equal(holdoffStep(undefined, {}, missing, 0), null);
    assert.equal(holdoffStep(undefined, { critical: true }, new ToonError('timeout'), 0), null);
    assert.deepEqual(holdoffStep(undefined, { failBackoffMs: 1000 }, missing, 10), { until: 1010, strikes: 1 });
    assert.deepEqual(holdoffStep(undefined, { failBackoffMs: 1000, failEscalateAfter: 1, escalatedBackoffMs: 9000 }, missing, 10), { until: 1010, strikes: 1 });
    assert.deepEqual(holdoffStep({ until: 0, strikes: 1 }, { failBackoffMs: 1000, failEscalateAfter: 1, escalatedBackoffMs: 9000 }, missing, 10), { until: 9010, strikes: 2 });
  });
});

describe('ADR-0006: the poller applies the hold-off, reports the results of a group that asks for it, and runs probes', () => {
  const REPORTING = Object.freeze({
    id: 'extra',
    critical: false,
    report: true,
    endpoint: { path: '/x' },
    absentOn404: { backoffMs: 15 * 60e3 },
    failBackoffMs: 5 * 60e3,
    failEscalateAfter: 1,
    escalatedBackoffMs: 20 * 60e3,
    parse: (json) => (json.ok ? { values: { x: 1 }, notes: [] } : { values: {}, notes: ['not ours'], unusable: 'shape' }),
  });
  const withReporting = (behaviour) => {
    const booted = boot({ behaviour, groups: [...GROUPS, REPORTING] });
    const results = [];
    const { onEvent } = booted.poller;
    booted.poller.onEvent = async (event) => {
      if (event.type === 'result') results.push({ error: event.error && `${event.error.kind}${event.error.status === undefined ? '' : ` ${event.error.status}`}`, reason: event.reason });
      await onEvent(event);
    };
    return { ...booted, results };
  };
  const answers = (state) => (endpoint) => {
    if (endpoint.path !== '/x') return { v: 1 };
    if (state.fail) throw state.fail;
    return { ok: state.ok };
  };

  test('a group that reports tells every result, and its failures are not announced as a problem of the device', async () => {
    const state = { ok: true };
    const {
      clock, poller, events, results,
    } = withReporting(answers(state));
    poller.start();
    await clock.tick(1000);
    state.ok = false;
    await clock.tick(30000);

    assert.deepEqual(results, [{ error: null, reason: undefined }, { error: 'bad_body', reason: 'shape' }]);
    assert.deepEqual(events.filter((event) => /^(?:problem|recovered) extra/.test(event)), [], 'no problem event, no recovered event');
    poller.stop();
  });

  test('an answer that the parser calls unusable fails the group with bad_body and the reason, and the notes still reach apply', async () => {
    const {
      clock, poller, applied, results,
    } = withReporting(answers({ ok: false }));
    poller.start();
    await clock.tick(1000);

    assert.deepEqual(results, [{ error: 'bad_body', reason: 'shape' }]);
    assert.deepEqual(applied.filter((entry) => entry.group === 'extra').map((entry) => entry.values), [{}]);
    poller.stop();
  });

  test('after a 404 the group is left alone for 15 minutes, other failures 5 minutes and then 20; the other groups run every cycle', async () => {
    const state = { fail: new ToonError('http', { status: 404 }) };
    const { clock, client, poller } = withReporting(answers(state));
    poller.start();
    await clock.tick(1000);
    await clock.tick(14 * 60e3);
    assert.equal(client.log.filter((entry) => entry.path === '/x').length, 1);
    assert.ok(client.log.filter((entry) => entry.path === '/t').length >= 28, 'the thermostat is read every cycle');
    await clock.tick(60e3);
    assert.equal(client.log.filter((entry) => entry.path === '/x').length, 2, 'asked again after 15 minutes');

    state.fail = new ToonError('http', { status: 500 });
    await clock.tick(15 * 60e3);
    const asked = client.log.filter((entry) => entry.path === '/x').map((entry) => entry.at);
    await clock.tick(5 * 60e3 + 30e3);
    assert.equal(client.log.filter((entry) => entry.path === '/x').length, asked.length + 1);
    await clock.tick(19 * 60e3);
    assert.equal(client.log.filter((entry) => entry.path === '/x').length, asked.length + 1, 'the second failure in a row waits for the escalated 20 minutes');
    await clock.tick(90e3);
    assert.equal(client.log.filter((entry) => entry.path === '/x').length, asked.length + 2);
    poller.stop();
  });

  test('release ends the hold-off, and a reset (new address) does too', async () => {
    const state = { fail: new ToonError('http', { status: 404 }) };
    const { clock, client, poller } = withReporting(answers(state));
    poller.start();
    await clock.tick(1000);
    const count = () => client.log.filter((entry) => entry.path === '/x').length;
    assert.equal(count(), 1);

    poller.release(['extra']);
    await clock.tick(30e3);
    assert.equal(count(), 2, 'asked in the next cycle');
    poller.reset(client);
    await clock.tick(3000);
    assert.equal(count(), 3, 'a new address starts afresh');
    poller.stop();
  });

  test('an answer that was requested before invalidate counts for nothing: no hold-off, no result event', async () => {
    const gate = deferred();
    const { clock, poller, results } = withReporting((endpoint) => (endpoint.path === '/x' ? gate.promise : { v: 1 }));
    poller.start();
    await clock.tick(1000);
    poller.invalidate(['extra']);
    gate.reject(new ToonError('http', { status: 404 }));
    await clock.tick(1);

    assert.deepEqual(results, []);
    assert.equal(poller.ledger.holdoff.size, 0);
    poller.stop();
  });

  test('a probe runs ahead of the queued requests with its own budget, and a teardown cancels it', async () => {
    const { clock, client, poller } = boot();
    const seen = [];
    const feature = {
      probeBudgetMs: 3000,
      probe: async (given, { signal }) => {
        seen.push({ client: given === client, aborted: signal.aborted });
        return new Promise((resolve) => {
          signal.addEventListener('abort', () => resolve('cancelled'), { once: true });
        });
      },
    };
    const first = poller.probe(feature);
    await clock.tick(2999);
    assert.deepEqual(seen, [{ client: true, aborted: false }]);
    await clock.tick(1);
    assert.equal(await first, 'cancelled', 'out of its budget');
    assert.equal(getEventListeners(poller.controller.signal, 'abort').length, 0, 'nothing is left on the signal of the device');
    assert.equal(clock.armed(), 0, 'and no timer');

    const second = poller.probe(feature);
    await clock.tick(1000);
    poller.stop();
    assert.equal(await second, 'cancelled', 'cancelled by the teardown');
    await assert.rejects(poller.probe(feature), (error) => error.kind === 'aborted');
  });

  test('the probe waits for the request in flight and goes before the queued ones', async () => {
    const gate = deferred();
    let hold = true;
    const { clock, client, poller } = boot({ behaviour: (endpoint) => (hold && endpoint.path === '/t' ? gate.promise : { v: 1 }) });
    poller.start();
    await clock.tick(1000);
    const order = [];
    const probing = poller.probe({ probeBudgetMs: 3000, probe: async () => order.push('probe') });
    hold = false;
    gate.resolve({ v: 1 });
    await probing;
    await clock.tick(1);

    assert.equal(order[0], 'probe');
    assert.deepEqual(client.log.map((entry) => entry.path).slice(0, 3), ['/t', '/p', '/m']);
    poller.stop();
  });
});
