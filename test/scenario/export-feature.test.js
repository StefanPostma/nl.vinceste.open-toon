'use strict';

/*
 * Power export is the second optional feature on the same engine (ADR-0016, FR-25): the setting export_enabled adds
 * and removes measure_power.export, and the value comes from the answer of the power group that is polled anyway.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { withScenario } = require('../helpers/scenario');
const { toonPayload } = require('../helpers/fixtures');

const EXPORT = 'measure_power.export';
const POWER_PATH = '/happ_pwrusage';
const writesOf = (world, id) => world.callsOf('setCapabilityValue').filter((call) => call.args[0] === id).map((call) => call.args[1]);

describe('FR-25 AC3: export_enabled adds and removes measure_power.export, and nothing else', () => {
  test('a device with export off never gets the capability and never has it written, whatever the Toon says', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, toon, world } = scenario;
      toon().state.power = toonPayload('power-feed-in');
      const device = await scenario.addPaired();
      await clock.tick(5 * 60e3);

      assert.equal(device.hasCapability(EXPORT), false);
      assert.equal(world.callsOf('addCapability').length, 0);
      assert.deepEqual(writesOf(world, EXPORT), []);
      assert.equal(device.getCapabilityValue('measure_power'), 324, 'the import is there as always');
      assert.deepEqual(scenario.deviceLog('error'), []);
    });
  });

  test('FR-25 AC1: switched on, the capability is added with its title and holds the powerProduction of the answer; measure_power is still the import', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, toon, world } = scenario;
      toon().state.power = toonPayload('power-feed-in');
      const device = await scenario.addPaired();
      await clock.tick(60e3);
      const message = await device.simulateSettingsSave({ export_enabled: true });

      assert.equal(message, undefined, 'a switch without a status has no message');
      assert.deepEqual(world.callsOf('addCapability').map((call) => call.args[0]), [EXPORT]);
      assert.deepEqual(device.getCapabilityOptions(EXPORT).title, { en: 'Power export', nl: 'Teruglevering' });
      await clock.tick(1);
      assert.equal(device.getCapabilityValue(EXPORT), 1250, 'the first value does not wait for the next cycle');
      assert.equal(device.getCapabilityValue('measure_power'), 324);

      toon().state.power.powerProduction.value = 1200;
      toon().state.power.powerUsage.value = 0;
      await clock.tick(35e3);
      assert.equal(device.getCapabilityValue(EXPORT), 1200);
      assert.equal(device.getCapabilityValue('measure_power'), 0);
      assert.deepEqual(scenario.deviceLog('error'), []);
    });
  });

  test('NFR-03: the export costs no request of its own: the power group is read as often as without it', async () => {
    const counts = {};
    for (const exportPower of [false, true]) {
      await withScenario({}, async (scenario) => {
        const { clock, toon } = scenario;
        const device = await scenario.addPaired({ exportPower });
        await clock.tick(60e3); // the first value of a feature that was switched on at pairing: with the first cycle
        toon().recorder.reset();
        await clock.tick(10 * 60e3);
        counts[exportPower] = { power: toon().requestsTo(POWER_PATH).length, all: toon().requests().length };
        assert.equal(device.hasCapability(EXPORT), exportPower);
      });
    }

    assert.deepEqual(counts[true], counts[false]);
    assert.ok(counts[true].power >= 19 && counts[true].power <= 21);
  });

  test('FR-25 AC2: a Toon that sends no powerProduction leaves the export as it was and throws nothing', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, toon } = scenario;
      toon().state.power = toonPayload('power-feed-in');
      const device = await scenario.addPaired({ exportPower: true });
      await clock.tick(60e3);
      assert.equal(device.getCapabilityValue(EXPORT), 1250);

      toon().state.power = toonPayload('power-no-production');
      await clock.tick(2 * 60e3);

      assert.equal(device.getCapabilityValue(EXPORT), 1250, 'untouched');
      assert.equal(device.getCapabilityValue('measure_power'), 324);
      assert.deepEqual(scenario.deviceLog('error'), []);
    });
  });

  test('switched off again, exactly the capability goes; the rest and the other feature stay', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, world } = scenario;
      const device = await scenario.addPaired({ exportPower: true, toonwater: true });
      await clock.tick(2 * 60e3);
      const others = device.getCapabilities().filter((id) => id !== EXPORT);
      const before = others.map((id) => device.getCapabilityValue(id));

      await device.simulateSettingsSave({ export_enabled: false });
      await clock.tick(2 * 60e3);

      assert.deepEqual(world.callsOf('removeCapability').map((call) => call.args[0]), [EXPORT]);
      assert.deepEqual(device.getCapabilities(), others);
      assert.deepEqual(others.map((id) => device.getCapabilityValue(id)), before);
      assert.equal(device.getSetting('toonwater_status'), 'Detected', 'the water side is untouched');
      assert.deepEqual(scenario.deviceLog('error'), []);
    });
  });

  test('FR-27: measure_power is never negative, however the Toon reports a feed-in', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, toon, world } = scenario;
      const device = await scenario.addPaired({ exportPower: true });
      for (const [usage, production] of [[300, 0], [-1250, 1250], [0, 1250], [-5, 0], ['abc', 'abc'], [-1, -1]]) {
        toon().state.power.powerUsage.value = usage;
        toon().state.power.powerProduction.value = production;
        await clock.tick(30e3);
      }

      assert.ok(writesOf(world, 'measure_power').length > 0);
      assert.ok(writesOf(world, 'measure_power').every((value) => value >= 0), writesOf(world, 'measure_power').join());
      assert.ok(writesOf(world, EXPORT).every((value) => value >= 0));
      assert.equal(device.getCapabilityValue('measure_power'), 0);
      assert.deepEqual(scenario.deviceLog('error'), []);
    });
  });

  test('a legacy device is migrated with export off and gets no capability', async () => {
    await withScenario({}, async (scenario) => {
      const { clock } = scenario;
      const device = await scenario.addDevice({
        capabilities: ['target_temperature', 'measure_temperature', 'temperature_state', 'meter_power.peak', 'meter_power.offPeak', 'measure_power', 'meter_gas'],
        settings: { address: '192.168.1.50' },
      });
      await clock.tick(60e3);

      assert.equal(device.getSetting('export_enabled'), false);
      assert.equal(device.hasCapability(EXPORT), false);
    });
  });
});
