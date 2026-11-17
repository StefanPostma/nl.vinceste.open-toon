'use strict';

/*
 * The single capability writer (NFR-01 AC2) and the counter-decrease policy of ADR-0014, against a stub device.
 * The device and the Homey rules (Invalid Capability, enum values, off-step numbers) are in the scenario tests.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { COUNTERS, createMeterGuard, createApplier } = require('../../lib/engine/apply');
const { read, walk } = require('../helpers/paths');

/** Feeds a sequence of readings through the guard the way the writer does: the stored value is the last one accepted. */
function feed(id, sequence) {
  const lines = [];
  const guard = createMeterGuard((line) => lines.push(line));
  let stored = null;
  const accepted = sequence.map((reading) => {
    const ok = guard(id, reading, stored);
    if (ok) stored = reading;
    return ok;
  });
  return { accepted, stored, lines };
}

describe('FR-28 / ADR-0014: counters never fall back on a bad reading, and follow a real decrease after three cycles', () => {
  test('[100, 99]: the lower value is held back', () => {
    const { accepted, stored, lines } = feed('meter_gas', [100, 99]);

    assert.deepEqual(accepted, [true, false]);
    assert.equal(stored, 100);
    assert.deepEqual(lines, []);
  });

  test('[100, 99, 99, 99]: the third lower reading in a row becomes the new baseline, with one info line', () => {
    const { accepted, stored, lines } = feed('meter_power.peak', [100, 99, 99, 99]);

    assert.deepEqual(accepted, [true, false, false, true]);
    assert.equal(stored, 99);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /meter_power\.peak/);
  });

  test('[100, "NaN", 100]: text that is not a number is ignored and does not count as a lower reading', () => {
    const { accepted, stored, lines } = feed('meter_power.offPeak', [100, 'NaN', 100]);

    assert.deepEqual(accepted, [true, false, true]);
    assert.equal(stored, 100);
    assert.deepEqual(lines, []);
  });

  test('[100, 0, 0, 0]: zero is never a reading of a counter, however often it comes', () => {
    const { accepted, stored } = feed('meter_gas', [100, 0, 0, 0, 0]);

    assert.deepEqual(accepted, [true, false, false, false, false]);
    assert.equal(stored, 100);
  });

  test('NaN, infinity, negative and null readings are ignored too', () => {
    const { accepted } = feed('meter_gas', [100, NaN, Infinity, -5, null, undefined, true]);

    assert.deepEqual(accepted, [true, false, false, false, false, false, false]);
  });

  test('a reading that is not lower resets the count; the counts of different counters are separate', () => {
    assert.deepEqual(feed('meter_gas', [100, 99, 99, 100, 99, 99]).accepted, [true, false, false, true, false, false]);
    const guard = createMeterGuard(() => {});
    assert.equal(guard('meter_gas', 99, 100), false);
    assert.equal(guard('meter_gas', 99, 100), false);
    assert.equal(guard('meter_power.peak', 99, 100), false, 'its own count starts at one');
    assert.equal(guard('meter_gas', 99, 100), true, 'the third lower reading of meter_gas');
  });

  test('the first reading is accepted when nothing is stored yet, and the old whole-kWh value gives way to a three-decimal one', () => {
    assert.deepEqual(feed('meter_gas', [1234.567]).accepted, [true]);
    assert.deepEqual(feed('meter_gas', [1234, 1234.567]).accepted, [true, true], 'FR-114 AC1');
  });

  test('meter_water.today resets at midnight by design and is exempt; so is every capability that is not a counter', () => {
    assert.equal(COUNTERS.includes('meter_water.today'), false);
    assert.deepEqual(feed('meter_water.today', [12.5, 0, 3]).accepted, [true, true, true]);
    assert.deepEqual(feed('measure_power', [800, 0, 5]).accepted, [true, true, true]);
    assert.deepEqual(feed('meter_water.total', [10, 9]).accepted, [true, false], 'the water total is a counter');
  });
});

/** A stand-in for the Homey device: holds capabilities and values, records every write. */
function stubDevice(capabilities, values = {}) {
  const state = { ...Object.fromEntries(capabilities.map((id) => [id, null])), ...values };
  const writes = [];
  return {
    writes,
    fail: new Set(),
    hasCapability: (id) => Object.hasOwn(state, id),
    getCapabilityValue(id) {
      if (!Object.hasOwn(state, id)) throw new Error(`Invalid Capability: ${id}`);
      return state[id];
    },
    async setCapabilityValue(id, value) {
      if (!Object.hasOwn(state, id)) throw new Error(`Invalid Capability: ${id}`);
      writes.push([id, value]);
      if (this.fail.has(id)) throw new Error(`refused ${id}`);
      state[id] = value;
    },
  };
}

function applier(device, extra = {}) {
  const lines = { log: [], error: [] };
  const changes = [];
  const apply = createApplier({
    device,
    log: (line) => lines.log.push(line),
    error: (line) => lines.error.push(line),
    onChanges: (list) => changes.push(list),
    ...extra,
  });
  return { apply, lines, changes };
}

const always = () => true;

describe('NFR-01 AC2 / FR-24: only usable values reach setCapabilityValue', () => {
  test('numbers must be finite, text non-empty; booleans pass; undefined, null, NaN and objects never', async () => {
    const device = stubDevice(['measure_power', 'meter_gas', 'burner_state', 'alarm_water.hotwater', 'measure_temperature', 'target_temperature', 'temperature_state']);
    const { apply } = applier(device);
    await apply({
      values: {
        measure_power: NaN,
        meter_gas: Infinity,
        burner_state: '',
        'alarm_water.hotwater': false,
        measure_temperature: undefined,
        target_temperature: null,
        temperature_state: { id: 'home' },
      },
    }, always);

    assert.deepEqual(device.writes, [['alarm_water.hotwater', false]]);
  });

  test('FR-20 AC3 / BD-1: an id the device does not have is skipped and never written (meter_power on a device without it)', async () => {
    const device = stubDevice(['measure_power']);
    const { apply, lines } = applier(device);
    const changes = await apply({ values: { measure_power: 324, meter_power: 5.2, 'measure_power.export': 0 } }, always);

    assert.deepEqual(device.writes, [['measure_power', 324]]);
    assert.deepEqual(changes, [{ id: 'measure_power', prev: null, next: 324 }]);
    assert.deepEqual(lines.error, []);
  });

  test('a value that did not change is not written again, and nothing is reported', async () => {
    const device = stubDevice(['measure_power', 'meter_gas'], { measure_power: 324, meter_gas: 10 });
    const { apply, changes } = applier(device);
    const result = await apply({ values: { measure_power: 324, meter_gas: 10 } }, always);

    assert.deepEqual(result, []);
    assert.deepEqual(device.writes, []);
    assert.deepEqual(changes, []);
  });

  test('the changes carry the previous value, and the callback gets all of them in one call', async () => {
    const device = stubDevice(['measure_power', 'meter_gas'], { measure_power: 100 });
    const { apply, changes } = applier(device);
    await apply({ values: { measure_power: 200, meter_gas: 1.5 } }, always);

    assert.deepEqual(changes, [[{ id: 'measure_power', prev: 100, next: 200 }, { id: 'meter_gas', prev: null, next: 1.5 }]]);
  });

  test('NFR-01 / FR-70 AC3: a callback that throws does not fail the write; the values are in and one line says what happened', async () => {
    const device = stubDevice(['measure_power']);
    const { apply, lines } = applier(device, {
      onChanges: () => {
        throw new Error('no Flow engine');
      },
    });
    const changes = await apply({ values: { measure_power: 5 } }, always);

    assert.deepEqual(changes, [{ id: 'measure_power', prev: null, next: 5 }]);
    assert.deepEqual(device.writes, [['measure_power', 5]]);
    assert.deepEqual(lines.error, ['the changes could not be passed on: no Flow engine']);
  });

  test('a counter that comes in lower is held back, an unchanged one stays quiet, and the writes follow the policy', async () => {
    const device = stubDevice(['meter_gas'], { meter_gas: 100 });
    const { apply, lines } = applier(device);
    await apply({ values: { meter_gas: 99 } }, always);
    await apply({ values: { meter_gas: 99 } }, always);
    assert.deepEqual(device.writes, []);
    await apply({ values: { meter_gas: 99 } }, always);

    assert.deepEqual(device.writes, [['meter_gas', 99]]);
    assert.equal(lines.log.length, 1);
  });

  test('FR-84 AC2: an answer that is not current any more is dropped before any write, and a write that fails then is not an error line', async () => {
    const device = stubDevice(['measure_power']);
    const { apply, lines } = applier(device);

    assert.deepEqual(await apply({ values: { measure_power: 1 } }, () => false), []);
    assert.deepEqual(device.writes, []);

    let valid = true;
    device.fail.add('measure_power');
    const pending = apply({ values: { measure_power: 2 } }, () => valid);
    valid = false;
    assert.deepEqual(await pending, []);
    assert.deepEqual(lines.error, [], 'the device went away while the write was running');
  });

  test('a failing write is caught, logged once until it works again, and does not stop the other values', async () => {
    const device = stubDevice(['measure_power', 'meter_gas']);
    const { apply, lines } = applier(device);
    device.fail.add('measure_power');

    const first = await apply({ values: { measure_power: 1, meter_gas: 5 } }, always);
    await apply({ values: { measure_power: 2 } }, always);
    device.fail.clear();
    await apply({ values: { measure_power: 3 } }, always);
    device.fail.add('measure_power');
    await apply({ values: { measure_power: 4 } }, always);

    assert.deepEqual(first, [{ id: 'meter_gas', prev: null, next: 5 }]);
    assert.equal(lines.error.length, 2, 'once per streak');
    assert.match(lines.error[0], /measure_power/);
  });

  test('FR-12 AC2 / FR-22 AC2: a note is logged once, and at most 20 different ones are remembered', async () => {
    const device = stubDevice(['measure_power']);
    const { apply, lines } = applier(device);
    await apply({ values: {}, notes: ['activeState is not known: "7"'] }, always);
    await apply({ values: {}, notes: ['activeState is not known: "7"'] }, always);
    for (let index = 0; index < 40; index++) await apply({ values: {}, notes: [`note ${index}`] }, always);

    assert.equal(lines.log.length, 20);
    assert.equal(lines.log[0], 'activeState is not known: "7"');
  });

  test('a result without notes is fine', async () => {
    const { apply } = applier(stubDevice(['measure_power']));

    assert.deepEqual(await apply({ values: {} }, always), []);
  });
});

describe('NFR-01 AC2: setCapabilityValue is called in one place only', () => {
  test('apply.js is the only file of app.js, drivers/ and lib/ that sets a capability value', () => {
    const files = ['app.js', ...walk('drivers'), ...walk('lib')].filter((file) => file.endsWith('.js'));
    const callers = files.filter((file) => /\.setCapabilityValue\(/.test(read(file)));

    assert.deepEqual(callers, ['lib/engine/apply.js']);
  });
});
