'use strict';

/*
 * CT-03 / FR-56 / FR-113 (docs/sdlc/04-compat-contract.md, ADR-0006 item 4, ADR-0010, ADR-0018): a device from before
 * ToonWater was an opt-in feature keeps its water exactly as it has it. The switch is decided once, from the list of
 * capabilities, never from the stored setting, never from the manifest default, never from the network, and never by
 * removing anything. The marker of the migration (store.migrationVersion) tells a device that has been decided from
 * one that has not; the store records who decided (toonwaterDecidedBy).
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { withScenario } = require('../helpers/scenario');
const { CORE } = require('../../lib/features');
const { jsonFixture } = require('../helpers/fixtures');

const { eras, waterValueVariants } = jsonFixture('eras.json');
const manifest = jsonFixture('../../app.json');

const WATER = ['measure_water', 'meter_water.today', 'meter_water.total'];
const WATER_PATH = '/water.html';
const MINUTE = 60e3;
const VARIANTS = {
  present: { capabilities: WATER, values: waterValueVariants.a },
  'all null': { capabilities: WATER, values: waterValueVariants.b },
  'only meter_water.total': { capabilities: WATER, values: waterValueVariants.c },
  'partial capability set': { capabilities: ['meter_water.today'], values: { 'meter_water.today': 0.5 } },
  none: { capabilities: [], values: {} },
};
const SETTINGS = ['absent', 'false', 'true'];
const WATER_OPTIONS = manifest.drivers[0].capabilitiesOptions;

/** The capabilities of an era with the water items of a variant instead of the ones it had. */
const capabilitiesOf = (era, variant) => [...eras[era].capabilities.filter((id) => !WATER.includes(id)), ...VARIANTS[variant].capabilities];

function deviceSpec(era, variant, setting, marker) {
  return {
    capabilities: capabilitiesOf(era, variant),
    values: { ...(era === 'era0' ? { meter_power: 12.5 } : {}), ...VARIANTS[variant].values },
    settings: { address: '192.168.1.50', ...(setting === 'absent' ? {} : { toonwater_enabled: setting === 'true' }) },
    store: marker ? { migrationVersion: 1 } : {},
    capabilitiesOptions: {}, // Core did not keep the titles of items that the driver does not list
  };
}

const waterRequests = (toon) => toon.requestsTo(WATER_PATH);
const methods = (world, ...names) => world.calls.filter((call) => names.includes(call.method));
const switchWrites = (world) => world.callsOf('setSettings').filter((call) => ['toonwater_enabled', 'export_enabled'].some((key) => Object.hasOwn(call.args[0], key)));

describe('FR-56 / FR-113 (CT-03) [HW-03]: the switch is decided from the capability list while the marker is absent', () => {
  Object.keys(eras).forEach((era) => {
    Object.keys(VARIANTS).forEach((variant) => {
      SETTINGS.forEach((setting) => {
        test(`${era}, water ${variant}, stored setting ${setting}, no marker: ${variant === 'none' ? 'off, nothing added' : 'on, the missing items added, nothing removed'}`, async () => {
          await withScenario({}, async (scenario) => {
            const { world, clock, toon } = scenario;
            const spec = deviceSpec(era, variant, setting, false);
            const enabled = variant !== 'none'; // the stored setting is never read: it may say anything, and nothing was stored
            const device = await scenario.addDevice(spec);

            assert.equal(device.getSetting('toonwater_enabled'), enabled);
            assert.equal(device.getSetting('export_enabled'), false);
            assert.equal(device.getStoreValue('toonwaterDecidedBy'), 'migration');
            assert.equal(device.getStoreValue('migrationVersion'), 1);
            const desired = [...CORE, ...(enabled ? WATER : [])];
            assert.deepEqual(device.getCapabilities(), [...spec.capabilities, ...desired.filter((id) => !spec.capabilities.includes(id))]);
            assert.equal(methods(world, 'removeCapability').length, 0, 'the migration never removes');
            assert.equal(methods(world, 'setStoreValue').at(-1).args[0], 'migrationVersion', 'the marker is written last');
            assert.equal(toon().requests().length, 0, 'nothing is asked of the Toon before the marker, and no ToonWater probe at all');
            VARIANTS[variant].capabilities.forEach((id) => assert.equal(device.getCapabilityValue(id), VARIANTS[variant].values[id], `${id} keeps its value`));

            // titles of items that are present but not listed by the driver come from the options reconciliation
            WATER.filter((id) => device.hasCapability(id)).forEach((id) => assert.deepEqual(device.getCapabilityOptions(id), WATER_OPTIONS[id], id));

            await clock.tick(2 * MINUTE + 5000);
            assert.equal(waterRequests(toon()).length > 0, enabled, 'the page is asked for when the result is on, and never otherwise');
            if (enabled) assert.deepEqual(device.getCapabilities().filter((id) => WATER.includes(id)).sort(), [...WATER].sort());
            if (enabled) assert.equal(device.getCapabilityValue('meter_water.today'), 0.137, 'the first answer of the add-on is applied');
            assert.deepEqual(scenario.deviceLog('error'), [], 'no Invalid Capability, no error of any kind');
            assert.equal(device.getAvailable(), true);
          });
        });
      });
    });
  });
});

describe('FR-56 AC5 / FR-113: with the marker present the stored switch stands and nothing is decided, added or removed', () => {
  Object.keys(eras).forEach((era) => {
    Object.keys(VARIANTS).forEach((variant) => {
      SETTINGS.forEach((setting) => {
        test(`${era}, water ${variant}, stored setting ${setting}, marker: ${setting === 'true' ? 'the page is polled' : 'no request for the page'}, the capabilities are as they were`, async () => {
          await withScenario({}, async (scenario) => {
            const { world, clock, toon } = scenario;
            const spec = deviceSpec(era, variant, setting, true);
            const device = await scenario.addDevice(spec);
            await clock.tick(2 * MINUTE + 5000);

            assert.deepEqual(methods(world, 'addCapability', 'removeCapability', 'setCapabilityOptions'), []);
            assert.deepEqual(switchWrites(world), [], 'the switches are not written');
            assert.deepEqual(device.getCapabilities(), spec.capabilities);
            assert.equal(device.getStoreValue('toonwaterDecidedBy'), undefined, 'nobody decided: it counts as the user');
            assert.equal(waterRequests(toon()).length > 0, setting === 'true');
            assert.equal(device.getSetting('toonwater_enabled'), setting === 'absent' ? undefined : setting === 'true');
            assert.deepEqual(scenario.deviceLog('error'), []);
          });
        });
      });
    });
  });
});

describe('FR-56 AC5: a switch-off by the user survives a restart of the app, and nothing is added again', () => {
  for (const era of ['era2', 'era3']) {
    test(`${era}: migrated on, switched off, the app restarts twice: off, no water item, no request, nothing added`, async () => {
      await withScenario({}, async (scenario) => {
        const { world, clock, toon } = scenario;
        const device = await scenario.addDevice(deviceSpec(era, 'present', 'absent', false));
        await clock.tick(MINUTE);
        assert.equal(device.getSetting('toonwater_enabled'), true);
        await device.simulateSettingsSave({ toonwater_enabled: false });
        assert.equal(device.getStoreValue('toonwaterDecidedBy'), 'user');

        for (let restart = 0; restart < 2; restart++) {
          const before = world.calls.length;
          const requests = waterRequests(toon()).length;
          await world.restartApp();
          await clock.tick(5 * MINUTE);
          const [restarted] = world.devices();

          assert.equal(restarted.getSetting('toonwater_enabled'), false);
          WATER.forEach((id) => assert.equal(restarted.hasCapability(id), false, id));
          assert.deepEqual(world.calls.slice(before).filter((call) => ['addCapability', 'removeCapability'].includes(call.method)), []);
          assert.equal(waterRequests(toon()).length, requests, 'not one request for the page');
        }
        assert.deepEqual(scenario.deviceLog('error'), []);
      });
    });
  }
});

describe('ADR-0018: a device that has no record of who decided counts as decided by the user', () => {
  test('marker present, ToonWater on, all values null, page missing: the warning is set (a user\'s device), and no hint is ever sent', async () => {
    await withScenario({ toons: { '192.168.1.50': { water: '404' } } }, async (scenario) => {
      const { world, clock } = scenario;
      const device = await scenario.addDevice(deviceSpec('era3', 'all null', 'true', true));
      await clock.tick(72 * 3600e3);

      assert.equal(device.fake.warning, 'ToonWater is enabled but was not found on this Toon');
      assert.deepEqual(world.notifications, []);
      assert.equal(device.getStoreValue('waterFirst404At'), undefined, 'no window is kept for a device that never gets the hint');
    });
  });
});

describe('FR-113 AC1: the legacy fixtures against a Toon with and without ToonWater, with one tariff or two', () => {
  Object.keys(eras).forEach((era) => {
    ['present', '404'].forEach((water) => {
      ['two', 'single'].forEach((tariff) => {
        test(`${era}, Toon with water ${water}, ${tariff} tariff: three cycles, the expected capabilities, switch and requests, no error`, async () => {
          await withScenario({ toons: { '192.168.1.50': { water, tariff } } }, async (scenario) => {
            const { clock, toon } = scenario;
            const native = eras[era].capabilities;
            const hasWater = WATER.some((id) => native.includes(id));
            const device = await scenario.addDevice({
              capabilities: native, values: hasWater ? waterValueVariants.b : {}, settings: { address: '192.168.1.50' }, store: {},
            });
            await clock.tick(3 * 30e3 + 5000);

            assert.deepEqual(device.getCapabilities(), [...native, ...[...CORE, ...(hasWater ? WATER : [])].filter((id) => !native.includes(id))]);
            assert.equal(device.getSetting('toonwater_enabled'), hasWater);
            assert.equal(waterRequests(toon()).length > 0, hasWater, 'the page only for a device that has the items');
            assert.notEqual(device.getCapabilityValue('meter_power.peak'), null);
            if (hasWater && water === 'present') assert.equal(device.getCapabilityValue('meter_water.total'), 7350.214);
            if (hasWater && water === '404') assert.equal(device.getCapabilityValue('meter_water.total'), null, 'no value is made up');
            assert.deepEqual(scenario.deviceLog('error'), []);
            assert.equal(device.getAvailable(), true);
          });
        });
      });
    });
  });
});
