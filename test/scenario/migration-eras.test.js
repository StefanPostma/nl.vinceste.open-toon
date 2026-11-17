'use strict';

/*
 * CT-02 / CT-07 (docs/sdlc/04-compat-contract.md): every era of a paired device, with every kind of settings the
 * field can hold, is brought up to date offline, additively and once, without a re-pair, an Invalid Capability or an
 * unhandled rejection. The expected capability lists are the plan of docs/sdlc/05-architecture.md section 9.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const Homey = require('homey');
const { createScenario } = require('../helpers/scenario');
const { CORE } = require('../../lib/features');
const { jsonFixture } = require('../helpers/fixtures');

const { eras, waterValueVariants, addressVariants } = jsonFixture('eras.json');
const baseline = jsonFixture('baseline-app.json');

const WATER = ['measure_water', 'meter_water.today', 'meter_water.total'];
const ADDED = {
  era0: ['meter_power.peak', 'meter_power.offPeak', 'alarm_water.hotwater', 'burner_state'],
  era1: ['alarm_water.hotwater', 'burner_state'],
  era2: ['alarm_water.hotwater', 'burner_state'],
  era3: ['burner_state'],
  newPair: [],
};
const MIGRATION_CALLS = ['addCapability', 'removeCapability', 'setCapabilityOptions', 'setSettings', 'setStoreValue'];
const IDENTITY = { id: 'ENECO-001-12391' };

async function withScenario(options, body) {
  const scenario = createScenario(options);
  await scenario.start();
  try {
    return await body(scenario);
  } finally {
    scenario.stop();
  }
}

const eraCapabilities = (era) => (era === 'newPair' ? [...CORE] : eras[era].capabilities);

/** What the device held before the update, as a spec for scenario.addDevice. */
function legacySpec(era, {
  address, extraSetting = false, extraCapability = false, water = waterValueVariants.a,
} = {}) {
  const capabilities = [...eraCapabilities(era), ...(extraCapability ? ['unknown_extra_capability'] : [])];
  const values = {};
  if (era === 'era0') values.meter_power = 12.5;
  if (era === 'era2' || era === 'era3') Object.assign(values, water);
  return {
    name: 'Woonkamer Toon',
    data: { ...IDENTITY },
    capabilities,
    values,
    store: era === 'newPair' ? { migrationVersion: 1 } : {},
    // a legacy device has the address and nothing else, a new pair has what the pairing wrote
    settings: {
      address,
      ...(era === 'newPair' ? { poll_interval: 30, toonwater_enabled: false, export_enabled: false } : {}),
      ...(extraSetting ? { unknown_extra_setting: 'kept' } : {}),
    },
  };
}

const migrationCalls = (world) => world.calls.filter((call) => MIGRATION_CALLS.includes(call.method)).map((call) => call.method);
const methodsSince = (world, index) => world.calls.slice(index).map((call) => call.method);

const EXTRAS = [
  { label: 'plain', options: {} },
  { label: 'an unknown extra setting', options: { extraSetting: true } },
  { label: 'an unknown extra capability', options: { extraCapability: true } },
  { label: 'an unknown extra setting and capability', options: { extraSetting: true, extraCapability: true } },
];

describe('FR-110 / FR-111 / FR-112 (CT-02, CT-07): every era, address and extra is migrated to the plan of 05 section 9', () => {
  for (const era of ['era0', 'era1', 'era2', 'era3', 'newPair']) {
    for (const address of addressVariants) {
      for (const { label, options } of EXTRAS) {
        test(`${era}, address ${JSON.stringify(address)}, ${label}`, async () => {
          await withScenario({}, async (scenario) => {
            const { world, clock, toon } = scenario;
            const spec = legacySpec(era, { address, ...options });
            const device = await scenario.addDevice(spec);
            const reachable = address !== '0.0.0.0';

            // offline, additive, and the marker last
            assert.deepEqual(device.getCapabilities(), [...spec.capabilities, ...ADDED[era]]);
            assert.equal(device.getStoreValue('migrationVersion'), 1);
            if (era !== 'newPair') assert.equal(migrationCalls(world).at(-1), 'setStoreValue', 'the marker is written last');
            assert.equal(migrationCalls(world).filter((method) => method === 'removeCapability').length, 0, 'nothing is removed');
            assert.equal(toon().requests().length, 0, 'no request before the marker, none during onInit');
            if (era === 'newPair') assert.deepEqual(migrationCalls(world), [], 'a new pair carries the marker and needs no migration');

            // identity
            assert.deepEqual(device.getData(), IDENTITY);
            assert.equal(device.getName(), 'Woonkamer Toon');
            assert.equal(device.getClass(), 'thermostat');
            assert.deepEqual(world.driver('open-toon').manifest.energy, baseline.drivers[0].energy);

            // settings: resolved on read, never rewritten
            assert.equal(device.getSetting('address'), address);
            assert.equal(device.getSetting('unknown_extra_setting'), options.extraSetting ? 'kept' : undefined);
            if (era !== 'newPair') assert.equal(Object.hasOwn(device.getSettings(), 'poll_interval'), false, 'poll_interval is not persisted');

            await clock.tick(2 * 60e3 + 5000);

            assert.deepEqual(scenario.deviceLog('error'), [], 'no Invalid Capability, no failure of any kind');
            const written = world.callsOf('setCapabilityValue').map((call) => call.args[0]);
            const waterOn = era === 'era2' || era === 'era3'; // the migration switches ToonWater on for a device that has the water items (FR-56)
            assert.equal(written.includes('meter_power'), false, 'the old meter is never written');
            assert.equal(written.some((id) => WATER.includes(id)), waterOn && reachable, 'the water items are written when ToonWater is on, and by nobody else');
            assert.equal(toon().requestsTo('/water.html').length > 0, waterOn && reachable, 'ToonWater is asked for when it is on, and for nothing else');
            if (era === 'era0') assert.equal(device.getCapabilityValue('meter_power'), 12.5, 'the old meter keeps its last value');
            if (waterOn) {
              WATER.forEach((id) => assert.ok(device.hasCapability(id), id));
              const expected = reachable ? [0, 0.137, 7350.214] : WATER.map((id) => waterValueVariants.a[id]);
              assert.deepEqual(WATER.map((id) => device.getCapabilityValue(id)), expected, 'the add-on answered, or the values are as they were');
            }
            if (reachable) {
              assert.equal(device.getAvailable(), true);
              assert.equal(device.getCapabilityValue('measure_temperature'), 20.3);
              assert.equal(device.getCapabilityValue('meter_power.peak'), 3718.492);
              assert.equal(device.getCapabilityValue('burner_state'), 'off');
              const starts = toon().requestsTo('/happ_thermstat').map((entry) => entry.start);
              assert.ok(starts.slice(1).every((start, index) => start - starts[index] === 30000), 'every 30 s, the default');
            } else {
              assert.equal(toon().requests().length, 0, 'not a request to 0.0.0.0');
              assert.equal(device.getAvailable(), false);
              assert.equal(device.fake.warning, null);
            }

            // a second start changes nothing
            const before = world.calls.length;
            await world.restartApp();
            assert.deepEqual(methodsSince(world, before).filter((method) => MIGRATION_CALLS.includes(method)), [], 'no add, remove, options, settings or marker at the second start');
            assert.deepEqual(world.devices()[0].getCapabilities(), [...spec.capabilities, ...ADDED[era]]);
          });
        });
      }
    }
  }
});

describe('FR-111 / FR-110: the water items of eras 2 and 3 survive with whatever values they hold, on a Toon without the add-on', () => {
  for (const era of ['era2', 'era3']) {
    for (const [name, water] of Object.entries(waterValueVariants)) {
      test(`${era}, water values ${name}: ${JSON.stringify(water)}`, async () => {
        await withScenario({ toons: { '192.168.1.50': { water: '404' } } }, async (scenario) => {
          const { world, clock } = scenario;
          const device = await scenario.addDevice(legacySpec(era, { address: '192.168.1.50', water }));
          await clock.tick(3 * 60e3);

          assert.deepEqual(WATER.map((id) => device.getCapabilityValue(id)), WATER.map((id) => water[id]));
          assert.deepEqual(device.getCapabilities().filter((id) => WATER.includes(id)), WATER);
          assert.equal(world.callsOf('removeCapability').length, 0);
          assert.deepEqual(scenario.deviceLog('error'), []);
        });
      });
    }
  }
});

describe('FR-111 AC3: a device without the water items never raises Invalid Capability', () => {
  test('[fixes BD-2] FR-111 AC3: an era-1 device is polled for five minutes and gets no water capability and no error', async () => {
    await withScenario({}, async (scenario) => {
      const { world, clock } = scenario;
      const device = await scenario.addDevice(legacySpec('era1', { address: '192.168.1.50' }));
      await clock.tick(5 * 60e3);

      WATER.forEach((id) => assert.equal(device.hasCapability(id), false, id));
      assert.deepEqual(scenario.deviceLog('error'), []);
      assert.equal(world.callsOf('setCapabilityValue').some((call) => WATER.includes(call.args[0])), false);
      assert.equal(device.getCapabilityValue('alarm_water.hotwater'), false, 'the hot water flag, which is not water, was added and is read');
    });
  });
});

describe('FR-110 AC1 / FR-111: the capabilities of the Toon that has one tariff or two', () => {
  for (const era of ['era0', 'era1', 'era2', 'era3']) {
    for (const tariff of ['two', 'single']) {
      test(`${era} with a ${tariff}-tariff Toon: three cycles, the values of that meter, no error`, async () => {
        await withScenario({ toons: { '192.168.1.50': { tariff } } }, async (scenario) => {
          const { clock } = scenario;
          const device = await scenario.addDevice(legacySpec(era, { address: '192.168.1.50' }));
          await clock.tick(3 * 30e3 + 5000);

          assert.deepEqual(scenario.deviceLog('error'), []);
          assert.notEqual(device.getCapabilityValue('meter_power.peak'), null, 'the peak total, from the single-tariff node when the peak node says NaN');
          assert.equal(device.getCapabilityValue('meter_power.offPeak') === null, tariff === 'single', 'off-peak stays untouched on a single-tariff meter');
          assert.notEqual(device.getCapabilityValue('meter_gas'), null);
        });
      });
    }
  }
});

describe('FR-111 (M-6): a migration that fails leaves no marker, no stray capability, and an available device', () => {
  test('addCapability refuses: the device polls on, the failure is logged, and the next start completes the migration', async () => {
    await withScenario({}, async (scenario) => {
      const { world, clock } = scenario;
      const { addCapability } = Homey.Device.prototype;
      let refuse = true;
      Homey.Device.prototype.addCapability = async function addOrRefuse(id) {
        if (refuse && id === 'burner_state') throw new Error('Core refused');
        return addCapability.call(this, id);
      };
      try {
        const device = await scenario.addDevice(legacySpec('era1', { address: '192.168.1.50' }));
        await clock.tick(60e3);

        assert.equal(device.getStoreValue('migrationVersion'), undefined, 'no marker');
        assert.deepEqual(device.getCapabilities(), eras.era1.capabilities, 'what was added before the failure was taken back');
        assert.equal(device.getAvailable(), true, 'a migration problem never makes the device unavailable');
        assert.equal(device.getCapabilityValue('measure_temperature'), 20.3, 'it keeps polling');
        assert.equal(scenario.deviceLog('error').length, 1);
        assert.match(scenario.deviceLog('error')[0], /migration failed, it is tried again at the next start: Core refused/);

        refuse = false;
        await world.restartApp();
        const again = world.devices()[0];
        assert.deepEqual(again.getCapabilities(), [...eras.era1.capabilities, ...ADDED.era1]);
        assert.equal(again.getStoreValue('migrationVersion'), 1);
      } finally {
        Homey.Device.prototype.addCapability = addCapability;
      }
    });
  });

  test('a device deleted while its migration runs gets no marker and no further call', async () => {
    await withScenario({}, async (scenario) => {
      const { world } = scenario;
      const { addCapability } = Homey.Device.prototype;
      let device;
      Homey.Device.prototype.addCapability = async function addThenDelete(id) {
        await addCapability.call(this, id);
        if (id === 'alarm_water.hotwater') await this.onDeleted();
      };
      try {
        device = await scenario.addDevice(legacySpec('era1', { address: '192.168.1.50' }));
        assert.deepEqual(world.callsOf('addCapability').map((call) => call.args[0]), ['alarm_water.hotwater']);
        assert.equal(device.getStoreValue('migrationVersion'), undefined);
        assert.equal(world.callsOf('setUnavailable').length, 0);
        assert.equal(scenario.clock.armed(), 0, 'and it never started to poll');
      } finally {
        Homey.Device.prototype.addCapability = addCapability;
      }
    });
  });
});
