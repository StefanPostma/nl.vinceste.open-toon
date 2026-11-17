'use strict';

/*
 * What the device does while ToonWater is on and the page is missing or wrong (ADR-0006 item 6, ADR-0018): a bounded
 * number of requests, one log line in and one out, the status, the warning that follows the rule of ADR-0018, and the
 * one timeline hint of FR-62 that survives a restart. The real app files under the fake Homey against the mock Toon
 * on a fake clock; a day passes in a moment. What a Toon without the add-on really answers is HW-07: the load bound
 * does not depend on it.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { withScenario } = require('../helpers/scenario');
const { jsonFixture } = require('../helpers/fixtures');

const { eras, waterValueVariants } = jsonFixture('eras.json');
const WATER = ['measure_water', 'meter_water.today', 'meter_water.total'];
const WATER_PATH = '/water.html';
const HOUR = 3600e3;
const MINUTE = 60e3;
const WARNING = 'ToonWater is enabled but was not found on this Toon';
const NOT_FOUND = 'Not found on this Toon (HTTP 404)';
const waterRequests = (toon) => toon.requestsTo(WATER_PATH);
const waterLines = (scenario) => scenario.deviceLog().filter((line) => line.startsWith('toonwater'));
const gaps = (entries) => entries.slice(1).map((entry, index) => entry.start - entries[index].start);

/** A device from before this version that has the water items (an era 3), which the migration switches on. */
const legacyWithWater = (water = waterValueVariants.b) => ({
  capabilities: eras.era3.capabilities,
  values: water,
  settings: { address: '192.168.1.50' },
  store: {},
});

describe('FR-55 AC4 / FR-57 / NFR-03 AC2 / NFR-09 AC1: a page that is missing or wrong costs a bounded number of requests, over 24 h', () => {
  const modes = [
    ['404', 97, 'not found', '404 [HW-07] [fixes BD-5]'],
    ['html-200', 100, 'unexpected', '200 with HTML [HW-07]'],
    ['403', 100, 'unexpected', '403'],
    ['500', 100, 'unexpected', '500'],
  ];

  modes.forEach(([mode, limit, entering, name]) => {
    test(`${name}: at most ${limit} requests for the page, the device stays available, the rest is unaffected, one info line in and one out`, async () => {
      await withScenario({ toons: { '192.168.1.50': { water: mode } } }, async (scenario) => {
        const { clock, toon, world } = scenario;
        const device = await scenario.addPaired({ toonwater: true });
        await clock.tick(24 * HOUR);

        const asked = waterRequests(toon());
        assert.ok(asked.length <= limit, `${asked.length} requests for the page in 24 h`);
        assert.ok(asked.length >= 90, `${asked.length}: it keeps asking, rarely`);
        assert.ok(gaps(asked).every((gap) => gap >= 5 * MINUTE), 'never sooner than 5 minutes after the last request (NFR-03 AC2)');
        assert.ok(gaps(asked).every((gap, index, all) => index === 0 || gap >= all[index - 1]), 'and ever less often, never more');
        assert.ok(toon().requestsTo('/happ_thermstat').length >= 2870, 'the thermostat is read every cycle');
        assert.ok(toon().requestsTo('/happ_pwrusage').length >= 2870);
        assert.ok(toon().requestsTo('/hdrv_zwave').length >= 2870);
        assert.equal(toon().maxConcurrent(), 1);
        assert.equal(device.getAvailable(), true);
        assert.equal(world.callsOf('setUnavailable').length, 0);
        assert.equal(device.getCapabilityValue('measure_temperature'), 20.3, 'the other items are as always');
        assert.deepEqual(waterLines(scenario), [`toonwater: ${entering}`], 'one line on entering the state, and not one per request');
        assert.deepEqual(scenario.deviceLog('error'), []);
        assert.equal(device.getSetting('toonwater_status'), mode === '404' ? NOT_FOUND : 'Unexpected response');
        assert.equal(device.fake.warning, mode === '404' ? WARNING : null, 'the warning is for a page that is not found, set by the user');

        toon().configure({ water: 'present' });
        await clock.tick(16 * MINUTE);

        assert.deepEqual(waterLines(scenario), [`toonwater: ${entering}`, 'toonwater: answers again'], 'one line on leaving it');
        assert.equal(device.getSetting('toonwater_status'), 'Detected');
        assert.equal(device.fake.warning, null, 'FR-55 AC2: the warning goes with the first good answer');
        assert.equal(device.getCapabilityValue('meter_water.total'), 7350.214);
        toon().recorder.reset();
        await clock.tick(5 * MINUTE);
        assert.ok(waterRequests(toon()).length >= 9, 'FR-57 AC2: per-cycle polling is back');
        assert.deepEqual(scenario.deviceLog('error'), []);
      });
    });
  });

  test('FR-57 AC2: a user who saves the switch again, or the address, does not wait for the back-off', async () => {
    await withScenario({ toons: { '192.168.1.50': { water: '404' } } }, async (scenario) => {
      const { clock, toon } = scenario;
      const device = await scenario.addPaired({ toonwater: true });
      await clock.tick(5 * MINUTE);
      const before = waterRequests(toon()).length;
      assert.equal(before, 1, 'one request, then the page is left alone for 15 minutes');
      toon().configure({ water: 'present' });

      await device.simulateSettingsSave({ address: '192.168.1.50:80' });
      await clock.tick(1);

      assert.equal(waterRequests(toon()).length > before, true, 'asked again at once');
    });
  });

  test('FR-57 AC2: an explicit refresh of the group asks even while it is held back, and a good answer ends the hold-off', async () => {
    await withScenario({ toons: { '192.168.1.50': { water: '404' } } }, async (scenario) => {
      const { clock, toon } = scenario;
      const device = await scenario.addPaired({ toonwater: true });
      await clock.tick(5 * MINUTE);
      assert.equal(waterRequests(toon()).length, 1);

      const outcomes = await device.refresh(['water']);
      assert.equal(waterRequests(toon()).length, 2);
      assert.equal(outcomes.water.kind, 'http');
      assert.equal(outcomes.water.status, 404);

      toon().configure({ water: 'present' });
      assert.equal((await device.refresh(['water'])).water, null);
      await clock.tick(2 * MINUTE);
      assert.ok(waterRequests(toon()).length >= 6, 'every cycle again');
    });
  });
});

describe('FR-57 AC3 / AC4: the page never spoils the rest, nor the other Toon', () => {
  ['junk', 'slow'].forEach((mode) => {
    const answer = mode === 'junk' ? 'garbage' : 'later than the 5 s of the client';
    test(`FR-57 AC3: an answer that is ${answer}: the other groups are applied in the same cycle and the device is not set unavailable`, async () => {
      await withScenario({ toons: { '192.168.1.50': { water: mode } } }, async (scenario) => {
        const { clock, toon, world } = scenario;
        toon().state.power.powerUsage.value = 512;
        const device = await scenario.addPaired({ toonwater: true });
        await clock.tick(4000);

        assert.equal(device.getCapabilityValue('measure_power'), 512, 'applied in the first cycle, whatever the page does');
        assert.equal(device.getCapabilityValue('measure_temperature'), 20.3);
        await clock.tick(30 * MINUTE);
        assert.equal(device.getAvailable(), true);
        assert.equal(world.callsOf('setUnavailable').length, 0);
        assert.equal(device.getSetting('toonwater_status'), mode === 'junk' ? 'Unexpected response' : 'Toon not reachable');
        assert.deepEqual(scenario.deviceLog('error'), []);
        assert.equal(device.getCapabilityValue('meter_water.total'), null, 'nothing is made up');
        assert.equal(toon().maxConcurrent(), 1);
      });
    });
  });

  test('FR-55 AC6: {"result":"error"} and HTML keep the last values, say "Unexpected response" and leave the device available', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, toon } = scenario;
      const device = await scenario.addPaired({ toonwater: true });
      await clock.tick(MINUTE);
      const values = WATER.map((id) => device.getCapabilityValue(id));
      assert.deepEqual(values, [0, 0.137, 7350.214]);

      toon().fault('result-error', { path: WATER_PATH, times: 1 });
      await clock.tick(40 * MINUTE);
      assert.equal(device.getSetting('toonwater_status'), 'Detected', 'one bad answer is followed by a good one');

      toon().configure({ water: 'html-200' });
      await clock.tick(40 * MINUTE);
      assert.equal(device.getSetting('toonwater_status'), 'Unexpected response');
      assert.equal(device.getAvailable(), true);
      assert.deepEqual(WATER.map((id) => device.getCapabilityValue(id)), values, 'the last values are kept');
    });
  });

  test('FR-57 AC4: of two devices on two Toons, the one whose page is missing does not slow the other', async () => {
    await withScenario({ toons: { '192.168.1.50': { water: '404' }, '192.168.1.51': {} } }, async (scenario) => {
      const { clock, toon } = scenario;
      await scenario.addPaired({ toonwater: true, address: '192.168.1.50', data: { id: 'ENECO-001-1' } });
      const other = await scenario.addPaired({ toonwater: true, address: '192.168.1.51', data: { id: 'ENECO-001-2' } });
      await clock.tick(30 * MINUTE);

      assert.ok(waterRequests(toon('192.168.1.50')).length <= 3, 'one request, one more after 15 minutes');
      const normal = waterRequests(toon('192.168.1.51'));
      assert.ok(normal.length >= 59, `${normal.length} requests`);
      assert.ok(gaps(normal).every((gap) => gap === 30000), 'the normal cadence');
      assert.equal(other.getCapabilityValue('meter_water.total'), 7350.214);
    });
  });
});

describe('FR-58 AC2 [fixes BD-3]: a payload without total keeps the total', () => {
  test('an add-on that sends flow and today only updates those two and leaves the total as it was', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, toon } = scenario;
      const device = await scenario.addPaired({ toonwater: true });
      await clock.tick(MINUTE);
      assert.deepEqual(WATER.map((id) => device.getCapabilityValue(id)), [0, 0.137, 7350.214]);

      toon().configure({ water: 'old-shape' });
      await clock.tick(MINUTE);

      assert.deepEqual(WATER.map((id) => device.getCapabilityValue(id)), [0, 1.668, 7350.214]);
      assert.deepEqual(scenario.deviceLog('error'), []);
    });
  });
});

describe('NFR-03 AC1: a healthy Toon with ToonWater on sees at most 4 requests per 30 s, one at a time', () => {
  test('ten minutes: thermostat, power, meters and the page, each once per cycle, never two at once', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, toon } = scenario;
      await scenario.addPaired({ toonwater: true });
      await clock.tick(10 * MINUTE);

      const all = toon().requests();
      assert.ok(all.length >= 76 && all.length <= 84, `${all.length} requests in 10 minutes`);
      all.forEach((entry) => {
        assert.ok(all.filter((other) => other.start >= entry.start && other.start < entry.start + 30000).length <= 4, `window at ${entry.start}`);
      });
      assert.equal(toon().maxConcurrent(), 1);
      assert.equal(waterRequests(toon()).length, 20);
    });
  });
});

describe('FR-55 / ADR-0018 item 3: the warning, and when it goes', () => {
  test('a device whose switch the user decided gets the status and the warning at the first 404; the log has one line', async () => {
    await withScenario({ toons: { '192.168.1.50': { water: '404' } } }, async (scenario) => {
      const { clock, world } = scenario;
      const device = await scenario.addPaired({ toonwater: true });
      await clock.tick(MINUTE);

      assert.equal(device.fake.warning, WARNING);
      assert.equal(device.getSetting('toonwater_status'), NOT_FOUND);
      assert.equal(world.callsOf('setWarning').length, 1, 'once, not at every answer');
      assert.deepEqual(waterLines(scenario), ['toonwater: not found']);
    });
  });

  test('FR-56 AC6 as amended: a device that the migration switched on and that never held a value gets the status, and no warning', async () => {
    await withScenario({ toons: { '192.168.1.50': { water: '404' } } }, async (scenario) => {
      const { clock, world } = scenario;
      const device = await scenario.addDevice(legacyWithWater(waterValueVariants.b));
      await clock.tick(MINUTE);

      assert.equal(device.getSetting('toonwater_enabled'), true);
      assert.equal(device.getStoreValue('toonwaterDecidedBy'), 'migration');
      assert.equal(device.getSetting('toonwater_status'), NOT_FOUND);
      assert.equal(device.fake.warning, null);
      assert.equal(world.callsOf('setWarning').length, 0);
      assert.equal(device.getAvailable(), true);
    });
  });

  for (const [name, water] of [['a flow and a day total of 0', waterValueVariants.a], ['only a total', waterValueVariants.c]]) {
    test(`FR-56 AC6: a device that the migration switched on and that held a value once (${name}) gets the warning`, async () => {
      await withScenario({ toons: { '192.168.1.50': { water: '404' } } }, async (scenario) => {
        const { clock } = scenario;
        const device = await scenario.addDevice(legacyWithWater(water));
        await clock.tick(MINUTE);

        assert.equal(device.fake.warning, WARNING, 'the add-on existed once, so a 404 is a real fault');
        assert.equal(device.getSetting('toonwater_status'), NOT_FOUND);
      });
    });
  }

  test('FR-55 AC2: the warning goes with the first good answer, and comes back with the next 404', async () => {
    await withScenario({ toons: { '192.168.1.50': { water: '404' } } }, async (scenario) => {
      const { clock, toon, world } = scenario;
      const device = await scenario.addPaired({ toonwater: true });
      await clock.tick(MINUTE);
      assert.equal(device.fake.warning, WARNING);

      toon().configure({ water: 'present' });
      await clock.tick(16 * MINUTE);
      assert.equal(device.fake.warning, null);
      assert.equal(world.callsOf('unsetWarning').length, 1);

      toon().configure({ water: '404' });
      await clock.tick(16 * MINUTE);
      assert.equal(device.fake.warning, WARNING);
    });
  });

  test('FR-55 AC2: the warning goes when the user switches ToonWater off, and the status says Off', async () => {
    await withScenario({ toons: { '192.168.1.50': { water: '404' } } }, async (scenario) => {
      const { clock } = scenario;
      const device = await scenario.addPaired({ toonwater: true });
      await clock.tick(MINUTE);
      assert.equal(device.fake.warning, WARNING);

      await device.simulateSettingsSave({ toonwater_enabled: false });
      await clock.tick(1);

      assert.equal(device.fake.warning, null);
      assert.equal(device.getSetting('toonwater_status'), 'Off');
    });
  });

  test('FR-55 AC2: the warning goes when the device is deleted', async () => {
    await withScenario({ toons: { '192.168.1.50': { water: '404' } } }, async (scenario) => {
      const { clock, world } = scenario;
      const device = await scenario.addPaired({ toonwater: true });
      await clock.tick(MINUTE);
      assert.equal(device.fake.warning, WARNING);

      await world.deleteDevice(device);

      assert.equal(device.fake.warning, null);
      assert.deepEqual(scenario.deviceLog('error'), []);
    });
  });

  test('FR-55 AC2: a warning that an earlier run left behind is gone at every start while ToonWater is off, and the status is not touched', async () => {
    await withScenario({}, async (scenario) => {
      const { world } = scenario;
      const device = await scenario.addPaired();
      device.fake.warning = 'stale warning of an earlier run';

      await world.restartApp();
      assert.equal(world.devices()[0].fake.warning, null);

      world.devices()[0].fake.warning = 'and another one';
      await world.restartApp();
      assert.equal(world.devices()[0].fake.warning, null);
      assert.equal(world.devices()[0].getSetting('toonwater_status'), '-', 'a device that never had ToonWater says nothing about it');
      assert.equal(world.callsOf('setSettings').filter((call) => Object.hasOwn(call.args[0], 'toonwater_status')).length, 0);
    });
  });
});

describe('FR-62: one hint after 24 h, for a device that the migration switched on and that never found the add-on', () => {
  const notFound = { toons: { '192.168.1.50': { water: '404' } } };

  test('AC1: exactly one timeline notification at 24 h, in the language of the Homey, naming the device; nothing more in the days after', async () => {
    await withScenario(notFound, async (scenario) => {
      const { clock, world } = scenario;
      const device = await scenario.addDevice({ ...legacyWithWater(), name: 'Woonkamer' });
      await clock.tick(24 * HOUR - 20 * MINUTE);
      assert.deepEqual(world.notifications, [], 'not yet');
      await clock.tick(21 * MINUTE);

      assert.equal(world.notifications.length, 1);
      assert.equal(
        world.notifications[0].excerpt,
        'ToonWater is switched on for Woonkamer, but it has not been found on this Toon for 24 hours. If you do not use ToonWater, switch it off in the settings of this device.',
      );
      assert.equal(device.getStoreValue('waterHintSent'), true);
      await clock.tick(72 * HOUR);
      assert.equal(world.notifications.length, 1, 'never a second one');
      assert.equal(device.fake.warning, null, 'and no tile warning for a device that never held a value');
    });
  });

  test('AC1 in Dutch', async () => {
    await withScenario({ ...notFound, language: 'nl' }, async (scenario) => {
      const { clock, world } = scenario;
      await scenario.addDevice({ ...legacyWithWater(), name: 'Woonkamer' });
      await clock.tick(25 * HOUR);

      assert.equal(world.notifications.length, 1);
      assert.match(world.notifications[0].excerpt, /^ToonWater staat aan voor Woonkamer, maar is de afgelopen 24 uur niet gevonden/);
    });
  });

  test('AC1: the window and the origin survive a restart of the app: a restart at 12 h does not lose the hint, nor repeat it', async () => {
    await withScenario(notFound, async (scenario) => {
      const { clock, world } = scenario;
      await scenario.addDevice(legacyWithWater());
      await clock.tick(12 * HOUR);
      assert.equal(world.notifications.length, 0);
      assert.equal(typeof world.devices()[0].getStoreValue('waterFirst404At'), 'number');

      await world.restartApp();
      await clock.tick(11 * HOUR + 50 * MINUTE);
      assert.equal(world.notifications.length, 0, 'the window did not start over');
      await clock.tick(30 * MINUTE);
      assert.equal(world.notifications.length, 1);

      await world.restartApp();
      await clock.tick(48 * HOUR);
      assert.equal(world.notifications.length, 1, 'a restart after the hint does not send it again');
    });
  });

  test('AC1: when createNotification fails once, waterHintSent stays unset, the hint is tried again at the next attempt and delivered once', async () => {
    await withScenario(notFound, async (scenario) => {
      const { clock, world } = scenario;
      const device = await scenario.addDevice(legacyWithWater());
      world.failNextNotification();
      await clock.tick(24 * HOUR + MINUTE);

      assert.equal(world.notifications.length, 0);
      assert.equal(device.getStoreValue('waterHintSent'), undefined, 'not marked as sent');
      assert.deepEqual(scenario.deviceLog('error'), [], 'a failed notification is not an error of ours');
      await clock.tick(16 * MINUTE);
      assert.equal(world.notifications.length, 1);
      assert.equal(device.getStoreValue('waterHintSent'), true);
      await clock.tick(2 * HOUR);
      assert.equal(world.notifications.length, 1);
    });
  });

  test('AC2: a device whose switch the user decided never gets a notification, however long the page is missing', async () => {
    await withScenario(notFound, async (scenario) => {
      const { clock, world } = scenario;
      const device = await scenario.addPaired({ toonwater: true });
      await clock.tick(72 * HOUR);

      assert.deepEqual(world.notifications, []);
      assert.equal(device.fake.warning, WARNING, 'it has the warning instead');
    });
  });

  test('AC2: a device that the user switched on by hand after the migration is a user\'s device from then on', async () => {
    await withScenario(notFound, async (scenario) => {
      const { clock, world } = scenario;
      const device = await scenario.addDevice(legacyWithWater());
      await clock.tick(10 * HOUR);
      await device.simulateSettingsSave({ toonwater_enabled: false });
      await device.simulateSettingsSave({ toonwater_enabled: true });
      await clock.tick(72 * HOUR);

      assert.equal(device.getStoreValue('toonwaterDecidedBy'), 'user');
      assert.deepEqual(world.notifications, []);
    });
  });

  test('AC3: switched off or deleted before the 24 h are over, nothing is created, whenever the time passes', async () => {
    await withScenario(notFound, async (scenario) => {
      const { clock, world } = scenario;
      const off = await scenario.addDevice({ ...legacyWithWater(), data: { id: 'ENECO-001-1' } });
      const gone = await scenario.addDevice({ ...legacyWithWater(), data: { id: 'ENECO-001-2' } });
      await clock.tick(12 * HOUR);
      await off.simulateSettingsSave({ toonwater_enabled: false });
      await world.deleteDevice(gone);
      await clock.tick(72 * HOUR);

      assert.deepEqual(world.notifications, []);
      assert.equal(off.getStoreValue('waterFirst404At'), undefined);
    });
  });

  test('a device with a value in the past gets the warning and, being migration-decided, the hint too', async () => {
    await withScenario(notFound, async (scenario) => {
      const { clock, world } = scenario;
      const device = await scenario.addDevice(legacyWithWater(waterValueVariants.c));
      await clock.tick(25 * HOUR);

      assert.equal(device.fake.warning, WARNING);
      assert.equal(world.notifications.length, 1);
    });
  });

  test('the add-on shows up at 20 h: the window is over, nothing is ever sent, the status says detected', async () => {
    await withScenario(notFound, async (scenario) => {
      const { clock, toon, world } = scenario;
      const device = await scenario.addDevice(legacyWithWater());
      await clock.tick(20 * HOUR);
      toon().configure({ water: 'present' });
      await clock.tick(30 * HOUR);

      assert.deepEqual(world.notifications, []);
      assert.equal(device.getSetting('toonwater_status'), 'Detected');
      assert.equal(device.getStoreValue('waterFirst404At'), undefined, 'a good answer ends the window');
    });
  });
});
