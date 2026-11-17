'use strict';

/*
 * CT-04 / ADR-0007 / ADR-0018: the Flows of an installation from before 2.0 keep working. The card update_water is
 * the one that depends on a choice that the user may never have made: a device whose ToonWater switch the migration
 * decided (an era-1 device has no water items) lets the card pass as it always did, and a device on which the user
 * made the choice is told that ToonWater is off. The hot-water items never depend on ToonWater at all (FR-31).
 * The real app files under the fake Homey, the mock Toon and a fake clock.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { createScenario } = require('../helpers/scenario');
const { settle } = require('../helpers/fake-clock');
const { jsonFixture } = require('../helpers/fixtures');

const { eras, waterValueVariants } = jsonFixture('eras.json');
const en = jsonFixture('../../locales/en.json');
const nl = jsonFixture('../../locales/nl.json');
const WATER = '/water.html';
const IGNORED = 'update_water ignored: toonwater is off for this device';
const CYCLE = 30e3;
const paths = (toon) => toon.requests().map((entry) => entry.path);

async function withScenario(options, body) {
  const scenario = createScenario(options);
  await scenario.start();
  try {
    return await body(scenario);
  } finally {
    scenario.stop();
  }
}

const card = (scenario, kind, id) => scenario.world.homey.flow.card(kind, id);
const act = (scenario, id, args) => card(scenario, 'action', id).run(args);

/** A device as 1.x left it: the capabilities of its era, the address and nothing else; the migration decides ToonWater. */
const legacy = (era, values = {}) => ({
  capabilities: eras[era].capabilities,
  values,
  settings: { address: '192.168.1.50' },
  store: {},
});
const waterLines = (scenario) => scenario.deviceLog().filter((line) => line.startsWith('update_water'));

describe('FR-74 AC4 / FR-54 AC2 (ADR-0018): update_water on a device where ToonWater is off', () => {
  test('era 1 (the migration decided off): the card resolves, the page is never asked for, and one line is logged', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, toon } = scenario;
      const device = await scenario.addDevice(legacy('era1'));
      await clock.tick(5000);
      assert.equal(device.getSetting('toonwater_enabled'), false);
      assert.equal(device.getStoreValue('toonwaterDecidedBy'), 'migration');
      toon().recorder.reset();

      await act(scenario, 'update_water', { device });

      assert.deepEqual(toon().requests(), [], 'sends nothing');
      assert.deepEqual(waterLines(scenario), [IGNORED]);
      assert.deepEqual(scenario.deviceLog('error'), []);
      await clock.tick(10 * CYCLE);
      assert.equal(toon().requestsTo(WATER).length, 0, 'zero requests for the page');
    });
  });

  test('era 0, too: the Flow that chains every update card of the maintainer workaround (#5, #25) runs to the end, as it did before', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, toon } = scenario;
      const device = await scenario.addDevice({ ...legacy('era0', { meter_power: 12.5 }) });
      await clock.tick(5000);
      toon().recorder.reset();

      for (const id of ['update_status', 'update_powerusage', 'update_water', 'update_metertotals']) await act(scenario, id, { device });

      assert.deepEqual(paths(toon()), ['/happ_thermstat', '/happ_pwrusage', '/hdrv_zwave', '/happ_pwrusage', '/hdrv_zwave'], 'update_water is the one that asks for nothing');
      assert.deepEqual(waterLines(scenario), [IGNORED]);
    });
  });

  test('a user who switched ToonWater off (the user decided): the card rejects with the text of FR-59 and sends nothing', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, toon } = scenario;
      const device = await scenario.addPaired({ toonwater: true });
      await clock.tick(5000);
      await device.simulateSettingsSave({ toonwater_enabled: false });
      await clock.tick(5000);
      assert.equal(device.getStoreValue('toonwaterDecidedBy'), 'user');
      toon().recorder.reset();

      await assert.rejects(act(scenario, 'update_water', { device }), { message: 'ToonWater is not enabled for this device' });

      assert.deepEqual(toon().requests(), []);
      assert.deepEqual(waterLines(scenario), []);
      assert.deepEqual(scenario.deviceLog('error'), [], 'and nothing is logged at error level');
    });
  });

  test('a device that was paired without ToonWater (the user decided by not ticking it) rejects, and so does one without the record of who decided', async () => {
    await withScenario({}, async (scenario) => {
      const paired = await scenario.addPaired();
      const fork = await scenario.addPaired({ store: { migrationVersion: 1, toonwaterDecidedBy: undefined } });
      await scenario.clock.tick(5000);
      scenario.toon().recorder.reset();

      await assert.rejects(act(scenario, 'update_water', { device: paired }), { message: en.toonwater.not_enabled });
      await assert.rejects(act(scenario, 'update_water', { device: fork }), { message: en.toonwater.not_enabled });
      assert.deepEqual(scenario.toon().requests(), []);
    });
  });

  test('an era-1 device on which the user then switched ToonWater on and off again is a device that the user decided', async () => {
    await withScenario({}, async (scenario) => {
      const { clock } = scenario;
      const device = await scenario.addDevice(legacy('era1'));
      await clock.tick(5000);
      await act(scenario, 'update_water', { device });
      await device.simulateSettingsSave({ toonwater_enabled: true });
      await clock.tick(5000);
      await act(scenario, 'update_water', { device });
      assert.equal(device.getCapabilityValue('meter_water.total'), 7350.214);
      await device.simulateSettingsSave({ toonwater_enabled: false });

      await assert.rejects(act(scenario, 'update_water', { device }), { message: en.toonwater.not_enabled });
    });
  });

  test('the text comes in the language of the Homey', async () => {
    await withScenario({ language: 'nl' }, async (scenario) => {
      const device = await scenario.addPaired();

      await assert.rejects(act(scenario, 'update_water', { device }), { message: nl.toonwater.not_enabled });
      assert.equal(nl.toonwater.not_enabled, 'ToonWater staat niet aan voor dit apparaat');
    });
  });
});

describe('FR-74 / FR-54: update_water on a device where ToonWater is on (eras 2 and 3: the migration switched it on)', () => {
  ['era2', 'era3'].forEach((era) => {
    test(`${era}: the card asks for the page and for nothing else, and the values are in when it resolves`, async () => {
      await withScenario({}, async (scenario) => {
        const { clock, toon } = scenario;
        const device = await scenario.addDevice(legacy(era, waterValueVariants.a));
        await clock.tick(5000);
        assert.equal(device.getSetting('toonwater_enabled'), true);
        assert.equal(device.getStoreValue('toonwaterDecidedBy'), 'migration');
        toon().state.waterPage.water.flow = 5;
        toon().recorder.reset();

        await act(scenario, 'update_water', { device });

        assert.deepEqual(paths(toon()), [WATER]);
        assert.equal(device.getCapabilityValue('measure_water'), 5);
        assert.deepEqual(waterLines(scenario), []);
      });
    });

    test(`${era}: when the page is not there (404) the card resolves, and the device says so in its status and not as an error`, async () => {
      await withScenario({ toons: { '192.168.1.50': { water: '404' } } }, async (scenario) => {
        const { clock, toon } = scenario;
        const device = await scenario.addDevice(legacy(era, waterValueVariants.c));
        await clock.tick(5000);
        toon().recorder.reset();

        await act(scenario, 'update_water', { device });
        await act(scenario, 'update_water', { device });

        assert.equal(toon().requestsTo(WATER).length, 2);
        assert.equal(device.getCapabilityValue('meter_water.total'), 12.345, 'the last value stays');
        assert.deepEqual(scenario.deviceLog('error'), []);
      });
    });
  });

  test('a page that does not answer fails the card in 5 s, with a sentence, without touching the other parts', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, toon } = scenario;
      const device = await scenario.addDevice(legacy('era3', waterValueVariants.a));
      await clock.tick(5000);
      toon().recorder.reset();
      toon().fault('timeout', { path: WATER });

      const outcome = await settle(clock, act(scenario, 'update_water', { device }));

      assert.equal(outcome.error.message, en.error.timeout);
      assert.ok(outcome.tookMs <= 6000);
      assert.deepEqual(paths(toon()), [WATER]);
      assert.equal(device.getAvailable(), true);
    });
  });
});

describe('FR-31 AC2 / R-36: with ToonWater off the hot-water items work, whoever decided that it is off', () => {
  [
    ['an era-1 device (the migration decided)', async (scenario) => scenario.addDevice(legacy('era1'))],
    ['an era-3 device that had the water items, after the user switched ToonWater off', async (scenario) => {
      const device = await scenario.addDevice(legacy('era3', waterValueVariants.a));
      await scenario.clock.tick(5000);
      await device.simulateSettingsSave({ toonwater_enabled: false });
      return device;
    }],
    ['a device paired without ToonWater', async (scenario) => scenario.addPaired()],
  ].forEach(([name, create]) => {
    test(`${name}: alarm_water.hotwater, hotwater_dispensing and alarm_water_changed all work`, async () => {
      await withScenario({}, async (scenario) => {
        const { clock, toon, world } = scenario;
        const device = await create(scenario);
        await clock.tick(5000);
        assert.equal(device.getSetting('toonwater_enabled'), false);
        assert.equal(device.hasCapability('measure_water'), false);
        const dispensing = () => card(scenario, 'condition', 'hotwater_dispensing').run({ device });
        assert.equal(await dispensing(), false);
        const before = world.triggerCalls.length;
        toon().recorder.reset();

        toon().state.thermostat.burnerInfo = '2';
        await clock.tick(CYCLE);

        assert.equal(device.getCapabilityValue('alarm_water.hotwater'), true);
        assert.equal(await dispensing(), true);
        assert.deepEqual(world.triggerCalls.slice(before).filter((call) => call.id === 'alarm_water_changed').map((call) => call.tokens), [{ 'alarm_water.hotwater': true }]);
        assert.equal(toon().requestsTo(WATER).length, 0, 'and the page of ToonWater is not asked for any more');
        assert.deepEqual(scenario.deviceLog('error'), []);
      });
    });
  });

  test('the actions that are not about water are not touched by a device without ToonWater, whoever decided', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, toon } = scenario;
      const device = await scenario.addDevice(legacy('era1'));
      await clock.tick(5000);
      toon().recorder.reset();

      await act(scenario, 'set_temperature_state', { device, state: 'away' });
      await act(scenario, 'update_status', { device });

      assert.equal(toon().requests().length, 4);
      assert.equal(toon().requestsTo(WATER).length, 0);
    });
  });
});

describe('FR-54 AC4: a Flow that uses the water items finds them again with the same ids after ToonWater was off and is on again', () => {
  test('switched off and on: the same three ids, the same cards, update_water works again', async () => {
    await withScenario({}, async (scenario) => {
      const { clock } = scenario;
      const device = await scenario.addPaired({ toonwater: true });
      await clock.tick(60e3);
      await device.simulateSettingsSave({ toonwater_enabled: false });
      await assert.rejects(act(scenario, 'update_water', { device }), { message: en.toonwater.not_enabled });
      await device.simulateSettingsSave({ toonwater_enabled: true });
      await clock.tick(5000);

      await act(scenario, 'update_water', { device });

      assert.deepEqual(device.getCapabilities().filter((id) => id.includes('water') && id !== 'alarm_water.hotwater'), ['measure_water', 'meter_water.today', 'meter_water.total']);
      assert.equal(device.getCapabilityValue('meter_water.total'), 7350.214);
    });
  });
});
