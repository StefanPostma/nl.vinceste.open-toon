'use strict';

/*
 * The ledger and the probe runner of lib/engine/schedule.js on their own (ADR-0005, ADR-0006). The numbers of the
 * policy and the Lane have their tables in poller.test.js; here the two pieces that moved out of the poller with the
 * release hygiene are pinned through their own interface, without a poller around them.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { createLedger, runProbe } = require('../../lib/engine/schedule');
const { ToonError } = require('../../lib/toon/errors');
const { createClock } = require('../helpers/fake-clock');

function ledgerAt(options = {}) {
  const events = [];
  const clock = { now: 1000 };
  const ledger = createLedger({ now: () => clock.now, emit: (event) => events.push(event), ...options });
  return { ledger, events, clock };
}

const group = {
  id: 'water', report: true, absentOn404: { backoffMs: 900e3 }, failBackoffMs: 300e3, failEscalateAfter: 3, escalatedBackoffMs: 900e3,
};

describe('NFR-09 AC1 / FR-81: the ledger announces a problem once, its end once, and the availability when it changes', () => {
  test('a problem is announced on its first cycle and again only when it changes; its end is announced once', () => {
    const { ledger, events } = ledgerAt();

    ledger.track('thermostat', new ToonError('timeout'));
    ledger.track('thermostat', new ToonError('timeout'));
    ledger.track('thermostat', new ToonError('http', { status: 500 }));
    ledger.track('thermostat', null);
    ledger.track('thermostat', null);

    assert.deepEqual(events.map((event) => event.type), ['problem', 'problem', 'recovered']);
    assert.equal(events[1].error.status, 500);
  });

  test('a cycle that succeeds announces success; the device becomes unavailable after three failed cycles over 90 s and available again once', () => {
    const { ledger, events, clock } = ledgerAt();

    [0, 45e3, 90e3].forEach((offset) => {
      clock.now = 1000 + offset;
      ledger.score(new ToonError('timeout'));
    });
    assert.deepEqual(events.map((event) => event.type), ['unavailable']);
    assert.equal(ledger.health.unavailable, true);

    ledger.score(new ToonError('timeout'));
    assert.equal(events.length, 1, 'unavailable is announced once');

    ledger.score(null);
    assert.deepEqual(events.map((event) => event.type), ['unavailable', 'success', 'available']);
    assert.deepEqual(ledger.health, { failures: 0, firstFailureAt: null, unavailable: false });
  });

  test('a device that starts unavailable announces `available` with its first success', () => {
    const { ledger, events } = ledgerAt({ unavailable: true });

    ledger.score(null);

    assert.deepEqual(events.map((event) => event.type), ['success', 'available']);
  });

  test('reset forgets failures, hold-offs and announced problems, but a device stays unavailable until a cycle succeeds', () => {
    const { ledger, events } = ledgerAt({ unavailable: true });
    ledger.health.failures = 5;
    ledger.track('thermostat', new ToonError('network'));
    ledger.record(group, new ToonError('http', { status: 404 }), null);

    ledger.reset();
    ledger.track('thermostat', new ToonError('network'));

    assert.deepEqual(ledger.health, { failures: 0, firstFailureAt: null, unavailable: true });
    assert.equal(ledger.holdoff.size, 0);
    assert.equal(events.filter((event) => event.type === 'problem').length, 2, 'the same problem is announced again for the new address');
  });
});

describe('ADR-0006: the ledger holds a group back after its answer, and says what the answer was', () => {
  test('a 404 holds the group for 15 minutes, a good answer ends the hold-off, release ends it at once', () => {
    const { ledger, clock } = ledgerAt();

    ledger.record(group, new ToonError('http', { status: 404 }), null);
    assert.equal(ledger.held(group), true);
    clock.now += 900e3;
    assert.equal(ledger.held(group), false, 'the hold-off is over after 15 minutes');

    ledger.record(group, new ToonError('http', { status: 404 }), null);
    ledger.release(['water']);
    assert.equal(ledger.held(group), false);

    ledger.record(group, new ToonError('timeout'), null);
    ledger.record(group, null, { values: {} });
    assert.equal(ledger.held(group), false);
  });

  test('a group that asks for it gets a result event for every answer, with the reason that the answer was unusable', () => {
    const { ledger, events } = ledgerAt();

    ledger.record(group, new ToonError('bad_body'), { values: {}, unusable: 'sensor_module' });
    ledger.record(group, null, { values: { measure_water: 1 } });
    ledger.record(group, new ToonError('timeout'), null);
    ledger.record({ id: 'power' }, null, { values: {} });

    assert.deepEqual(events.map((event) => [event.type, event.group, event.reason]), [
      ['result', 'water', 'sensor_module'],
      ['result', 'water', undefined],
      ['result', 'water', undefined],
    ]);
  });
});

describe('ADR-0006 item 5: runProbe gives a probe its time budget and the cancellation of the device', () => {
  const probeThat = (answer) => ({ probeBudgetMs: 3000, probe: (client, { signal }) => answer(client, signal) });

  test('the probe gets the client and a signal; the budget timer is gone when it answers', async () => {
    const clock = createClock();
    const timers = { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout };
    const seen = [];

    const result = await runProbe(probeThat((client, signal) => {
      seen.push(client, signal.aborted);
      return { outcome: 'detected' };
    }), 'client', timers, new AbortController().signal);

    assert.deepEqual(result, { outcome: 'detected' });
    assert.deepEqual(seen, ['client', false]);
    assert.equal(clock.armed(), 0);
  });

  test('a probe that runs out of its 3 s budget is cancelled, and a probe of a device that goes away is cancelled at once', async () => {
    const clock = createClock();
    const timers = { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout };
    const waits = (client, signal) => new Promise((resolve) => {
      signal.addEventListener('abort', () => resolve({ outcome: 'unreachable' }), { once: true });
    });

    const slow = runProbe(probeThat(waits), 'client', timers, new AbortController().signal);
    await clock.tick(2999);
    assert.equal(clock.armed(), 1, 'still waiting');
    await clock.tick(1);
    assert.deepEqual(await slow, { outcome: 'unreachable' });
    assert.equal(clock.armed(), 0);

    const device = new AbortController();
    const cancelled = runProbe(probeThat(waits), 'client', timers, device.signal);
    device.abort();
    assert.deepEqual(await cancelled, { outcome: 'unreachable' });
    assert.equal(clock.armed(), 0, 'the budget timer is cleared');
  });
});
