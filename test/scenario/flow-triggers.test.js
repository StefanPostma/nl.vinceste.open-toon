'use strict';

/*
 * CT-05 (docs/sdlc/04-compat-contract.md): the triggers of the app fire when a value changes, once, with the token
 * of the baseline, and never for the first value a capability ever got. The real app files under the fake Homey, the
 * mock Toon and a fake clock; `world.triggerCalls` is what Homey would have been asked to fire. Whether Homey fires
 * temperature_state_changed itself is HW-06.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { createScenario } = require('../helpers/scenario');
const { FEATURES } = require('../../lib/features');
const { createFlow } = require('../../lib/flow/cards');

const CYCLE = 30e3;
const ERA1 = ['target_temperature', 'measure_temperature', 'temperature_state', 'meter_power.peak', 'meter_power.offPeak', 'measure_power', 'meter_gas'];
const WATER_ON = 'toonwater_enabled';

async function withScenario(options, body) {
  const scenario = createScenario(options);
  await scenario.start();
  try {
    return await body(scenario);
  } finally {
    scenario.stop();
  }
}

const fired = (scenario, id) => scenario.world.triggerCalls.filter((call) => call.id === id);
const ids = (scenario) => scenario.world.triggerCalls.map((call) => call.id);

/** A device that has had its first values; nothing has fired yet. */
async function settled(scenario, spec) {
  const device = await scenario.addPaired(spec);
  await scenario.clock.tick(5000);
  return device;
}

describe('FR-70 AC4: the first value that a capability ever gets fires nothing', () => {
  test('a new device that gets its first answers: every capability has a value and no trigger fired', async () => {
    await withScenario({}, async (scenario) => {
      const device = await scenario.addPaired();
      await scenario.clock.tick(5000);

      ['meter_gas', 'meter_power.peak', 'meter_power.offPeak', 'alarm_water.hotwater', 'burner_state', 'temperature_state'].forEach((id) => {
        assert.notEqual(device.getCapabilityValue(id), null, id);
      });
      assert.deepEqual(scenario.world.triggerCalls, []);
    });
  });

  test('FR-32 AC4: a device of a version before 2.0 that gets the burner capability and its first value fires nothing for it', async () => {
    await withScenario({}, async (scenario) => {
      const device = await scenario.addDevice({
        capabilities: ERA1,
        settings: { address: '192.168.1.50' },
        store: {},
      });
      await scenario.clock.tick(5000);

      assert.equal(device.getCapabilityValue('burner_state'), 'off');
      assert.equal(device.getCapabilityValue('alarm_water.hotwater'), false);
      assert.deepEqual(ids(scenario).filter((id) => id !== 'temperature_state_changed'), []);
    });
  });

  test('AC4: after a restart the first value is compared with the one that Homey stored, and a change that happened meanwhile fires once', async () => {
    await withScenario({}, async (scenario) => {
      const device = await scenario.addPaired({
        values: { 'alarm_water.hotwater': true, burner_state: 'heating', meter_gas: 5000 },
      });
      await scenario.clock.tick(5000);

      assert.equal(device.getCapabilityValue('alarm_water.hotwater'), false);
      assert.deepEqual(ids(scenario).sort(), ['alarm_water_changed', 'burner_state_changed_to', 'meter_gas_changed']);
      assert.deepEqual(fired(scenario, 'alarm_water_changed')[0].tokens, { 'alarm_water.hotwater': false });
      await scenario.clock.tick(5 * CYCLE);
      assert.equal(scenario.world.triggerCalls.length, 3, 'and not again');
    });
  });
});

describe('FR-70 AC1/AC2 / FR-31 AC3: a change fires once, an unchanged value never', () => {
  test('meter_gas_changed: the token is the new reading in m3; the same reading in the next cycles fires nothing', async () => {
    await withScenario({}, async (scenario) => {
      const { toon } = scenario;
      await settled(scenario);
      await scenario.clock.tick(3 * CYCLE);
      assert.deepEqual(scenario.world.triggerCalls, [], 'an unchanged value over many polls');

      toon().state.devices['dev_2.1'].CurrentGasQuantity = '5300500';
      await scenario.clock.tick(CYCLE);
      await scenario.clock.tick(5 * CYCLE);

      assert.deepEqual(fired(scenario, 'meter_gas_changed').map((call) => [call.tokens, call.source, call.deviceId]), [[{ meter_gas: 5300.5 }, 'app', 'ENECO-001-12391']]);
      assert.deepEqual(ids(scenario), ['meter_gas_changed']);
    });
  });

  test('alarm_water_changed: the token is under the key alarm_water.hotwater, for true and for false, once each', async () => {
    await withScenario({}, async (scenario) => {
      const { toon } = scenario;
      await settled(scenario);

      toon().state.thermostat.burnerInfo = '2';
      await scenario.clock.tick(3 * CYCLE);
      assert.deepEqual(fired(scenario, 'alarm_water_changed').map((call) => call.tokens), [{ 'alarm_water.hotwater': true }]);
      toon().state.thermostat.burnerInfo = '0';
      await scenario.clock.tick(3 * CYCLE);

      assert.deepEqual(fired(scenario, 'alarm_water_changed').map((call) => call.tokens), [{ 'alarm_water.hotwater': true }, { 'alarm_water.hotwater': false }]);
    });
  });

  test('meter_power_changed: the token is peak plus off-peak in kWh with three decimals, once per cycle even when both changed', async () => {
    await withScenario({}, async (scenario) => {
      const { toon } = scenario;
      const device = await settled(scenario);
      assert.equal(device.getCapabilityValue('meter_power.peak'), 3718.492);
      assert.equal(device.getCapabilityValue('meter_power.offPeak'), 4120.771);

      toon().state.devices['dev_2.4'].CurrentElectricityQuantity = '3718992';
      await scenario.clock.tick(CYCLE);
      toon().state.devices['dev_2.4'].CurrentElectricityQuantity = '3719000';
      toon().state.devices['dev_2.6'].CurrentElectricityQuantity = '4121000';
      await scenario.clock.tick(CYCLE);
      await scenario.clock.tick(3 * CYCLE);

      assert.deepEqual(fired(scenario, 'meter_power_changed').map((call) => call.tokens), [{ meter_power: 7839.763 }, { meter_power: 7840 }]);
    });
  });

  test('FR-114 AC1: the step from whole numbers to three decimals fires once and then never again', async () => {
    await withScenario({}, async (scenario) => {
      const device = await scenario.addPaired({ values: { meter_gas: 5242, 'meter_power.peak': 3718, 'meter_power.offPeak': 4120 } });
      await scenario.clock.tick(5000);

      assert.equal(device.getCapabilityValue('meter_gas'), 5242.11);
      assert.equal(fired(scenario, 'meter_gas_changed').length, 1);
      assert.equal(fired(scenario, 'meter_power_changed').length, 1);
      assert.deepEqual(fired(scenario, 'meter_power_changed')[0].tokens, { meter_power: 7839.263 });
      await scenario.clock.tick(10 * CYCLE);
      assert.equal(fired(scenario, 'meter_gas_changed').length, 1, 'the same reading is no change');
      assert.equal(fired(scenario, 'meter_power_changed').length, 1);
    });
  });

  test('a lower reading that the counter policy holds back fires nothing', async () => {
    await withScenario({}, async (scenario) => {
      const { toon } = scenario;
      await settled(scenario);
      toon().state.devices['dev_2.1'].CurrentGasQuantity = '5000000';
      await scenario.clock.tick(2 * CYCLE);

      assert.deepEqual(scenario.world.triggerCalls, []);
    });
  });
});

describe('FR-32 AC1-AC4: burner_state_changed_to fires for every change; the Flow listens for one state or for any', () => {
  test('off, heating, hot water, pre-heating, off: one trigger for each change, none in between, and the run listener filters on args.state', async () => {
    await withScenario({}, async (scenario) => {
      const { toon, world } = scenario;
      const device = await settled(scenario);
      const card = world.homey.flow.getDeviceTriggerCard('burner_state_changed_to');
      const listens = async (wanted, call) => card.run({ device, state: wanted }, call.state);

      for (const code of ['1', '1', '2', '3', '0', '0']) {
        toon().state.thermostat.burnerInfo = code;
        await scenario.clock.tick(CYCLE);
      }

      const calls = fired(scenario, 'burner_state_changed_to');
      assert.deepEqual(calls.map((call) => call.tokens), [{ burner_state: 'heating' }, { burner_state: 'hot_water' }, { burner_state: 'preheating' }, { burner_state: 'off' }]);
      assert.deepEqual(calls.map((call) => call.state), [{ state: 'heating' }, { state: 'hot_water' }, { state: 'preheating' }, { state: 'off' }]);
      for (const call of calls) {
        assert.equal(await listens('any', call), true, 'any matches every change');
        assert.equal(await listens({ id: 'any' }, call), true);
        for (const wanted of ['off', 'heating', 'hot_water', 'preheating']) {
          assert.equal(await listens(wanted, call), wanted === call.state.state, `${wanted} for ${call.state.state}`);
        }
      }
    });
  });

  test('the run listener answers false, not an exception, for an argument that is missing', async () => {
    await withScenario({}, async (scenario) => {
      const device = await settled(scenario);
      const card = scenario.world.homey.flow.getDeviceTriggerCard('burner_state_changed_to');

      assert.equal(await card.runListener({ device }, { state: 'heating' }), false);
      assert.equal(await card.runListener({ device, state: 'heating' }, undefined), false);
      assert.equal(await card.runListener({ device, state: 'heating' }, {}), false);
    });
  });
});

describe('FR-70 / FR-71 / FR-60: measure_water_changed fires while ToonWater is on and never while it is off', () => {
  test('off: the water page is not asked for and the trigger does not fire; on: the first value fires nothing and a change fires once; off again: nothing', async () => {
    await withScenario({}, async (scenario) => {
      const { toon } = scenario;
      const device = await settled(scenario);
      toon().state.waterPage.water.flow = 4;
      await scenario.clock.tick(3 * CYCLE);
      assert.equal(toon().requestsTo('/water.html').length, 0);
      assert.deepEqual(fired(scenario, 'measure_water_changed'), []);

      await device.simulateSettingsSave({ [WATER_ON]: true });
      await scenario.clock.tick(3 * CYCLE);
      assert.equal(device.getCapabilityValue('measure_water'), 4);
      assert.deepEqual(fired(scenario, 'measure_water_changed'), [], 'the first value');

      toon().state.waterPage.water.flow = 7;
      await scenario.clock.tick(3 * CYCLE);
      assert.deepEqual(fired(scenario, 'measure_water_changed').map((call) => call.tokens), [{ measure_water: 7 }]);

      await device.simulateSettingsSave({ [WATER_ON]: false });
      toon().state.waterPage.water.flow = 9;
      await scenario.clock.tick(3 * CYCLE);
      assert.equal(fired(scenario, 'measure_water_changed').length, 1);
    });
  });

  test('a device on which the migration switched ToonWater on, with a value that changes', async () => {
    await withScenario({}, async (scenario) => {
      const { toon } = scenario;
      await scenario.addDevice({
        capabilities: [...ERA1, 'measure_water', 'meter_water.today', 'meter_water.total'],
        values: { measure_water: 0, 'meter_water.today': 0, 'meter_water.total': 12.345 },
        settings: { address: '192.168.1.50' },
        store: {},
      });
      await scenario.clock.tick(5000);
      assert.deepEqual(fired(scenario, 'measure_water_changed').map((call) => call.tokens), [], 'flow 0 is the stored 0');

      toon().state.waterPage.water.flow = 3;
      await scenario.clock.tick(3 * CYCLE);

      assert.deepEqual(fired(scenario, 'measure_water_changed').map((call) => call.tokens), [{ measure_water: 3 }]);
    });
  });
});

describe('FR-70 / ADR-0009 [HW-06]: temperature_state_changed is fired by Homey, not by the app, unless the rule says otherwise', () => {
  test('by default the app never fires it, with Homey firing it itself or not', async () => {
    await withScenario({}, async (scenario) => {
      const { toon, world } = scenario;
      const device = await settled(scenario);

      toon().state.thermostat.activeState = '2';
      await scenario.clock.tick(CYCLE);
      assert.equal(device.getCapabilityValue('temperature_state'), 'sleep');
      assert.deepEqual(world.triggerCalls.filter((call) => call.source === 'app'), []);

      world.autoFireCustomTriggers = true;
      toon().state.thermostat.activeState = '3';
      await scenario.clock.tick(CYCLE);

      assert.deepEqual(
        world.triggerCalls.map((call) => [call.id, call.source, call.tokens]),
        [['temperature_state_changed', 'homey', { temperature_state: 'away' }]],
        'Homey fires it once, the app adds nothing',
      );
    });
  });

  test('when the rule table says app: exactly one fire with the id of the state, and none for the first value', async () => {
    await withScenario({}, async (scenario) => {
      const { toon, world } = scenario;
      const device = await settled(scenario);
      const asApp = FEATURES.map((feature) => (feature.id !== 'core' ? feature : {
        ...feature,
        rules: feature.rules.map((rule) => (rule.card === 'temperature_state_changed' ? { ...rule, source: 'app' } : rule)),
      }));
      const flow = createFlow(world.homey, asApp);
      assert.equal(world.autoFireCustomTriggers, false);

      toon().state.thermostat.activeState = '2';
      await scenario.clock.tick(CYCLE);
      assert.deepEqual(world.triggerCalls, [], 'the device of the driver still follows the default table');
      flow.fire(device, [{ id: 'temperature_state', prev: 'home', next: 'sleep' }]);
      flow.fire(device, [{ id: 'temperature_state', prev: null, next: 'sleep' }]);

      assert.deepEqual(world.triggerCalls.map((call) => [call.id, call.source, call.tokens]), [['temperature_state_changed', 'app', { temperature_state: 'sleep' }]]);
    });
  });
});

describe('FR-70 AC3 / NFR-01: a trigger that cannot be fired is logged and does not stop anything', () => {
  test('a card.trigger that rejects, and one that throws: the other triggers still fire, polling goes on, no unhandled rejection', async () => {
    await withScenario({}, async (scenario) => {
      const { toon, world } = scenario;
      const device = await settled(scenario);
      world.homey.flow.getDeviceTriggerCard('alarm_water_changed').trigger = async () => {
        throw new Error('the Flow engine is busy');
      };
      world.homey.flow.getDeviceTriggerCard('meter_gas_changed').trigger = () => {
        throw new Error('not a promise');
      };

      toon().state.thermostat.burnerInfo = '2';
      toon().state.devices['dev_2.1'].CurrentGasQuantity = '5300500';
      await scenario.clock.tick(CYCLE);
      await scenario.clock.tick(CYCLE);

      assert.deepEqual(ids(scenario), ['burner_state_changed_to'], 'the one that works fired');
      assert.deepEqual(scenario.deviceLog('error'), [
        'alarm_water_changed could not be fired: the Flow engine is busy',
        'meter_gas_changed could not be fired: not a promise',
      ]);
      assert.equal(device.getCapabilityValue('alarm_water.hotwater'), true, 'the values are in');
      assert.equal(device.getCapabilityValue('meter_gas'), 5300.5);
      toon().state.thermostat.burnerInfo = '0';
      await scenario.clock.tick(CYCLE);
      assert.equal(device.getCapabilityValue('burner_state'), 'off', 'polling goes on');
      assert.equal(fired(scenario, 'burner_state_changed_to').length, 2);
    });
  });

  test('a device that was deleted fires nothing for an answer that was on its way', async () => {
    await withScenario({}, async (scenario) => {
      const { toon, world, clock } = scenario;
      const device = await settled(scenario);
      toon().latencyMs = 2000;
      toon().state.thermostat.burnerInfo = '2';
      await clock.tick(28e3); // the second cycle started at 32 s and asks the thermostat, which answers 2 s later
      assert.ok(toon().requests().some((entry) => entry.end === null), 'an answer is on its way');
      await world.deleteDevice(device);
      await clock.tick(10e3);

      assert.deepEqual(scenario.world.triggerCalls, []);
    });
  });
});
