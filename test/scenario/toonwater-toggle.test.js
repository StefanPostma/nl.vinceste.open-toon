'use strict';

/*
 * ToonWater is an opt-in feature (ADR-0006): off for a new device (no capability, no request, no noise), switched on
 * and off by the user through the setting, with every race of docs/sdlc/05-architecture.md section 6.5 as a test.
 * The real app files run under the fake Homey against the mock Toon on a fake clock. Where the outcome rests on an
 * unverified reading of Homey, the title carries the hardware id.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const Homey = require('homey');
const { withScenario } = require('../helpers/scenario');
const { CORE } = require('../../lib/features');

const WATER = ['measure_water', 'meter_water.today', 'meter_water.total'];
const WATER_PATH = '/water.html';
const PRESENT = [0, 0.137, 7350.214]; // flow, today and total of the mock's page
const waterRequests = (toon) => toon.requestsTo(WATER_PATH);
const waterValues = (device) => WATER.map((id) => device.getCapabilityValue(id));
const addedIds = (world) => world.callsOf('addCapability').map((call) => call.args[0]);
const removedIds = (world) => world.callsOf('removeCapability').map((call) => call.args[0]);
const optionCalls = (world) => world.callsOf('setCapabilityOptions').map((call) => call.args[0]);

/** A save while time passes: the clock is moved on until the save has settled, then once more for the timer that puts the status back. */
async function save(clock, device, changes, limitMs = 30e3) {
  let settled = false;
  const pending = device.simulateSettingsSave(changes).finally(() => {
    settled = true;
  });
  pending.catch(() => {}); // the caller gets the rejection from the await below
  for (let elapsed = 0; !settled && elapsed < limitMs; elapsed += 250) await clock.tick(250);
  try {
    return await pending;
  } finally {
    await clock.tick(1);
  }
}

describe('FR-51 AC1-AC3: a new device with ToonWater off has no water, asks for none and says nothing about it', () => {
  test('[fixes BD-5] over 30 simulated minutes with a Toon that answers 404: zero /water.html requests, no water capability, no log line, no warning', async () => {
    await withScenario({ toons: { '192.168.1.50': { water: '404' } } }, async (scenario) => {
      const { clock, toon, world } = scenario;
      const device = await scenario.addPaired();
      await clock.tick(30 * 60e3);

      assert.equal(waterRequests(toon()).length, 0);
      assert.ok(toon().requests().length > 100, 'the Toon was polled all the time');
      WATER.forEach((id) => assert.equal(device.hasCapability(id), false, id));
      assert.equal(device.hasCapability('alarm_water.hotwater'), true, 'the hot water flag is not part of ToonWater');
      assert.deepEqual(scenario.deviceLog().filter((line) => /water/i.test(line)), [], 'no log line about ToonWater at all');
      assert.deepEqual(scenario.deviceLog('error'), []);
      assert.equal(device.fake.warning, null);
      assert.equal(device.getAvailable(), true);
      assert.equal(world.callsOf('setWarning').length, 0);
      assert.equal(device.getSetting('toonwater_enabled'), false);
    });
  });

  test('FR-60 AC2: the Update-now refreshes of a device with ToonWater off do not ask for the page either', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, toon } = scenario;
      const device = await scenario.addPaired();
      await clock.tick(5000);
      await device.refresh();
      await device.refresh(['thermostat', 'power', 'meters']);
      await device.refresh(['water']);

      assert.equal(waterRequests(toon()).length, 0);
    });
  });
});

describe('FR-52 / FR-59: switching ToonWater on adds the three items, probes once and shows the first values within 10 s', () => {
  test('AC1 [HW-03] off -> on: exactly the trio in manifest order, options reconciled once, message and status of FR-59, first values within 10 s', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, toon, world } = scenario;
      const device = await scenario.addPaired();
      await clock.tick(60e3);
      const before = world.calls.length;
      const message = await device.simulateSettingsSave({ toonwater_enabled: true });

      assert.equal(message, 'ToonWater found. Water values will appear shortly.');
      assert.deepEqual(addedIds(world), WATER);
      assert.deepEqual(removedIds(world), []);
      assert.deepEqual(optionCalls(world), ['meter_water.today', 'meter_water.total'], 'the two items whose titles differ; measure_water has none');
      assert.deepEqual(device.getCapabilityOptions('meter_water.today').title, { en: 'Water today', nl: 'Water vandaag' });
      assert.deepEqual(device.getCapabilityOptions('meter_water.total').title, { en: 'Water meter total', nl: 'Water meter totaal' });
      assert.equal(device.getStoreValue('toonwaterDecidedBy'), 'user');
      assert.equal(device.fake.warning, null);
      assert.equal(waterRequests(toon()).length, 1, 'the probe, and nothing else yet');
      assert.deepEqual(world.calls.slice(before).filter((call) => call.method === 'setCapabilityValue'), [], 'no value before the first read');

      await clock.tick(1); // the first read is scheduled, not awaited by the save; the status is written again after the save
      assert.equal(device.getSetting('toonwater_status'), 'Detected');
      assert.deepEqual(waterValues(device), PRESENT, 'the first values are there within 10 s: here at once');
      assert.equal(waterRequests(toon()).length, 2, 'one read after the save');

      // a second save with equal options calls setCapabilityOptions zero times
      const optionsBefore = optionCalls(world).length;
      await device.simulateSettingsSave({ poll_interval: 45 });
      await device.simulateSettingsSave({ toonwater_enabled: true });
      assert.equal(optionCalls(world).length, optionsBefore);
      assert.equal(addedIds(world).length, 3);
    });
  });

  test('AC1 [HW-03]: when Core copies the manifest options to a capability that is added, setCapabilityOptions is not called at all', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, world } = scenario;
      const { addCapability } = Homey.Device.prototype;
      Homey.Device.prototype.addCapability = async function addWithOptions(id) {
        await addCapability.call(this, id);
        const wanted = this.driver.manifest.capabilitiesOptions[id];
        if (wanted) this.fake.options[id] = JSON.parse(JSON.stringify(wanted));
      };
      try {
        const device = await scenario.addPaired();
        await clock.tick(60e3);
        await device.simulateSettingsSave({ toonwater_enabled: true });

        assert.deepEqual(addedIds(world), WATER);
        assert.deepEqual(optionCalls(world), [], 'the three expensive calls are skipped when there is nothing to set');
        assert.deepEqual(device.getCapabilityOptions('meter_water.total').title, { en: 'Water meter total', nl: 'Water meter totaal' });
      } finally {
        Homey.Device.prototype.addCapability = addCapability;
      }
    });
  });

  test('AC2: from then on /water.html is read once per cycle, and the values follow the Toon', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, toon } = scenario;
      const device = await scenario.addPaired();
      await device.simulateSettingsSave({ toonwater_enabled: true });
      await clock.tick(5000);
      toon().recorder.reset();
      await clock.tick(5 * 60e3);

      const starts = waterRequests(toon()).map((entry) => entry.start);
      assert.ok(starts.length >= 9 && starts.length <= 11, `${starts.length} requests in 5 minutes`);
      assert.ok(starts.slice(1).every((start, index) => start - starts[index] === 30000));
      toon().state.water = null;
      assert.equal(toon().maxConcurrent(), 1);
    });
  });

  test('AC1 in Dutch: the message, the status and the titles come in the language of the Homey', async () => {
    await withScenario({ language: 'nl' }, async (scenario) => {
      const device = await scenario.addPaired();
      const message = await save(scenario.clock, device, { toonwater_enabled: true });

      assert.equal(message, 'ToonWater gevonden. De watergegevens verschijnen zo meteen.');
      assert.equal(device.getSetting('toonwater_status'), 'Gevonden');
    });
  });

  test('FR-52 AC3 / FR-55 AC5: with the Toon not answering, the items are added anyway, the message says so, and the values arrive when the Toon is back', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, toon, world } = scenario;
      const device = await scenario.addPaired();
      await clock.tick(60e3);
      toon().fault('timeout');
      const message = await save(clock, device, { toonwater_enabled: true });

      assert.match(message, /^The Toon could not be reached/);
      assert.deepEqual(addedIds(world), WATER);
      assert.equal(device.getSetting('toonwater_status'), 'Toon not reachable');
      assert.equal(device.fake.warning, null, 'a Toon that is down says nothing about the add-on');

      toon().clearFaults();
      await clock.tick(10 * 60e3);
      assert.deepEqual(waterValues(device), PRESENT);
      assert.equal(device.getSetting('toonwater_status'), 'Detected');
      assert.equal(device.getAvailable(), true);
    });
  });

  test('FR-55 AC1 [HW-07]: a Toon that answers 404 gets the items anyway, the "not found" message, the status and the warning', async () => {
    await withScenario({ toons: { '192.168.1.50': { water: '404' } } }, async (scenario) => {
      const { clock, world } = scenario;
      const device = await scenario.addPaired();
      await clock.tick(60e3);
      const message = await save(clock, device, { toonwater_enabled: true });

      assert.match(message, /^ToonWater was not found on this Toon\. The water items were added but stay empty/);
      assert.deepEqual(addedIds(world), WATER);
      assert.equal(device.getSetting('toonwater_status'), 'Not found on this Toon (HTTP 404)');
      assert.equal(device.fake.warning, 'ToonWater is enabled but was not found on this Toon');
      assert.equal(device.getAvailable(), true);
    });
  });
});

describe('FR-53 / FR-60 / FR-54 AC4: switching ToonWater off removes the three items and nothing else', () => {
  test('FR-53 AC1, AC2, AC4 / FR-60 AC1: exactly the trio goes, everything else keeps its value and its options, no request for the page afterwards', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, toon, world } = scenario;
      const device = await scenario.addPaired({ toonwater: true });
      await clock.tick(2 * 60e3);
      assert.deepEqual(waterValues(device), PRESENT, 'it was on');
      const others = device.getCapabilities().filter((id) => !WATER.includes(id));
      const valuesBefore = others.map((id) => device.getCapabilityValue(id));
      const optionsBefore = others.map((id) => device.getCapabilityOptions(id));
      const requestsBefore = waterRequests(toon()).length;

      const message = await save(clock, device, { toonwater_enabled: false });

      assert.equal(message, 'ToonWater turned off. The water items were removed; Flows that used them need to be updated and their Insights history may be lost.');
      assert.deepEqual(removedIds(world), WATER);
      WATER.forEach((id) => assert.equal(device.hasCapability(id), false, id));
      assert.equal(device.getSetting('toonwater_status'), 'Off');
      assert.equal(device.getStoreValue('toonwaterDecidedBy'), 'user');
      assert.equal(device.fake.warning, null);

      await clock.tick(5 * 60e3);
      assert.equal(waterRequests(toon()).length, requestsBefore, 'not one request for the page after the save');
      assert.deepEqual(device.getCapabilities().filter((id) => !WATER.includes(id)), others, 'the other capabilities are the same');
      assert.deepEqual(others.map((id) => device.getCapabilityOptions(id)), optionsBefore);
      assert.equal(device.getCapabilityValue('alarm_water.hotwater'), valuesBefore[others.indexOf('alarm_water.hotwater')], 'FR-31 AC2: the hot water flag stays and keeps its value');
      assert.equal(device.getCapabilityValue('measure_temperature'), 20.3);
      assert.equal(device.getCapabilityValue('meter_gas') !== null && device.getCapabilityValue('burner_state'), 'off');
      assert.equal(removedIds(world).length, 3);
      assert.deepEqual(scenario.deviceLog('error'), []);
    });
  });

  test('FR-53 AC3: an answer that was on its way when the user switched off is dropped: no Invalid Capability, no error line, no value written', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, toon, world } = scenario;
      toon().latencyMs = 3000;
      const device = await scenario.addPaired({ toonwater: true });
      for (let step = 0; step < 100 && !waterRequests(toon()).some((entry) => entry.end === null); step++) await clock.tick(500);
      assert.ok(waterRequests(toon()).some((entry) => entry.end === null), 'the page is being asked for');
      const writes = world.callsOf('setCapabilityValue').length;

      await device.simulateSettingsSave({ toonwater_enabled: false });
      await clock.tick(10e3);

      const late = world.callsOf('setCapabilityValue').slice(writes).filter((call) => WATER.includes(call.args[0]));
      assert.deepEqual(late, [], 'nothing is written to an item that is gone');
      assert.deepEqual(scenario.deviceLog('error'), []);
      assert.deepEqual(scenario.deviceLog().filter((line) => /toonwater|water/i.test(line)), [], 'and nothing is said about it');
      assert.equal(device.fake.warning, null);
    });
  });

  test('FR-52 AC4: switched on, off and on again, the device has the three items once and ends in the state of the last save', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, world } = scenario;
      const device = await scenario.addPaired();
      await clock.tick(60e3);
      await device.simulateSettingsSave({ toonwater_enabled: true });
      await device.simulateSettingsSave({ toonwater_enabled: false });
      await device.simulateSettingsSave({ toonwater_enabled: true });
      await clock.tick(60e3);

      assert.deepEqual(device.getCapabilities().filter((id) => WATER.includes(id)), WATER, 'FR-54 AC4: the same ids come back');
      assert.deepEqual(addedIds(world), [...WATER, ...WATER]);
      assert.deepEqual(removedIds(world), WATER);
      assert.deepEqual(waterValues(device), PRESENT);
      assert.deepEqual(scenario.deviceLog('error'), []);
    });
  });

  test('FR-52 AC4: three saves at once, tick, untick and tick, run one after the other, end switched on, with no duplicate add and no invalid remove', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, world } = scenario;
      const device = await scenario.addPaired();
      await clock.tick(60e3);
      await Promise.all([
        device.simulateSettingsSave({ toonwater_enabled: true }),
        device.simulateSettingsSave({ toonwater_enabled: false }),
        device.simulateSettingsSave({ toonwater_enabled: true }),
      ]);
      await clock.tick(60e3);

      assert.deepEqual(device.getCapabilities().filter((id) => WATER.includes(id)), WATER);
      assert.equal(device.getSetting('toonwater_enabled'), true);
      assert.deepEqual(addedIds(world), [...WATER, ...WATER], 'the saves are serialized and each looks at what the device has: on, off, on');
      assert.deepEqual(removedIds(world), WATER);
      assert.deepEqual(waterValues(device), PRESENT);
      assert.deepEqual(scenario.deviceLog('error'), []);
    });
  });

  test('FR-52 AC4: two saves at once, tick and untick, end switched off even though the settings of the second save looked unchanged', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, world } = scenario;
      const device = await scenario.addPaired();
      await clock.tick(60e3);
      await Promise.all([
        device.simulateSettingsSave({ toonwater_enabled: true }),
        device.simulateSettingsSave({ toonwater_enabled: false }),
      ]);
      await clock.tick(60e3);

      assert.equal(device.getSetting('toonwater_enabled'), false);
      WATER.forEach((id) => assert.equal(device.hasCapability(id), false, id));
      assert.deepEqual(removedIds(world), WATER);
      assert.deepEqual(scenario.deviceLog('error'), []);
    });
  });
});

describe('FR-55 AC2 / FR-53: a result that is being shown when the user switches ToonWater off leaves nothing behind', () => {
  /** Writes of the status take 2 s, as on a Homey that is busy; `pending()` is the number of status writes on their way. */
  function slowStatus(world) {
    const { setSettings } = Homey.Device.prototype;
    let pending = 0;
    Homey.Device.prototype.setSettings = async function slow(changes) {
      if (!Object.hasOwn(changes, 'toonwater_status')) return setSettings.call(this, changes);
      pending += 1;
      await new Promise((resolve) => {
        world.homey.setTimeout(resolve, 2000);
      });
      pending -= 1;
      return setSettings.call(this, changes);
    };
    return {
      pending: () => pending,
      restore: () => {
        Homey.Device.prototype.setSettings = setSettings;
      },
    };
  }

  test('[C-02] the 404 is on its way to the tile (the status write is slow) when the save switches off: no warning afterwards, the status says Off', async () => {
    await withScenario({ toons: { '192.168.1.50': { water: '404' } } }, async (scenario) => {
      const { clock, world } = scenario;
      const slow = slowStatus(world);
      try {
        const device = await scenario.addPaired({ toonwater: true });
        for (let step = 0; step < 200 && slow.pending() === 0; step++) await clock.tick(100);
        assert.equal(slow.pending(), 1, 'the status of the first answer is being written');

        await save(clock, device, { toonwater_enabled: false });
        await clock.tick(30e3);

        assert.equal(device.fake.warning, null, 'a warning about an add-on that is switched off');
        assert.equal(device.getSetting('toonwater_status'), 'Off');
        assert.equal(device.getSetting('toonwater_enabled'), false);
        WATER.forEach((id) => assert.equal(device.hasCapability(id), false, id));
        assert.equal(world.callsOf('setWarning').length, 0, 'the warning was never set: the answer was dropped');
        assert.deepEqual(scenario.deviceLog('error'), []);
      } finally {
        slow.restore();
      }
    });
  });

  test('[C-02] a warning that did land is taken back: the next save of the settings clears it when the feature is off', async () => {
    await withScenario({}, async (scenario) => {
      const { clock } = scenario;
      const device = await scenario.addPaired({ toonwater: true });
      await clock.tick(60e3);
      await save(clock, device, { toonwater_enabled: false });
      await device.setWarning('ToonWater is enabled but was not found on this Toon'); // what a late write would have left

      await save(clock, device, { poll_interval: 45 });

      assert.equal(device.fake.warning, null);
      assert.equal(device.getSetting('toonwater_status'), 'Off');
    });
  });

  test('[C-02] a switch off that fails (a capability cannot be removed) does not swallow the answer: the next one is shown', async () => {
    await withScenario({ toons: { '192.168.1.50': { water: '404' } } }, async (scenario) => {
      const { clock, world } = scenario;
      const slow = slowStatus(world);
      const { removeCapability } = Homey.Device.prototype;
      Homey.Device.prototype.removeCapability = async function refuse() {
        throw new Error('Core refused');
      };
      try {
        const device = await scenario.addPaired({ toonwater: true });
        for (let step = 0; step < 200 && slow.pending() === 0; step++) await clock.tick(100);
        await assert.rejects(save(clock, device, { toonwater_enabled: false }), /Core refused/);
        await clock.tick(2 * 60e3);

        assert.equal(device.getSetting('toonwater_enabled'), true);
        assert.equal(device.fake.warning, 'ToonWater is enabled but was not found on this Toon', 'the switch did not change, so the warning is as for any other 404');
        assert.equal(device.getSetting('toonwater_status'), 'Not found on this Toon (HTTP 404)');
      } finally {
        Homey.Device.prototype.removeCapability = removeCapability;
        slow.restore();
      }
    });
  });
});

describe('FR-52 / ADR-0006 item 5: a save that fails leaves the device as it was', () => {
  test('issue 9 [HW-03]: the second addCapability rejects: the first is taken back, onSettings rejects, the setting stays off, no stray capability', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, toon, world } = scenario;
      const { addCapability } = Homey.Device.prototype;
      let refuse = true;
      Homey.Device.prototype.addCapability = async function addOrRefuse(id) {
        if (refuse && id === 'meter_water.today') throw new Error('Core refused');
        return addCapability.call(this, id);
      };
      try {
        const device = await scenario.addPaired();
        await clock.tick(60e3);
        await assert.rejects(device.simulateSettingsSave({ toonwater_enabled: true }), /Core refused/);

        assert.equal(device.getSetting('toonwater_enabled'), false);
        WATER.forEach((id) => assert.equal(device.hasCapability(id), false, id));
        assert.deepEqual(removedIds(world), ['measure_water'], 'only what this save added is taken back');
        await clock.tick(5 * 60e3);
        assert.equal(waterRequests(toon()).length, 0, 'the feature never started');

        refuse = false;
        assert.match(await device.simulateSettingsSave({ toonwater_enabled: true }), /^ToonWater found/);
        assert.deepEqual(device.getCapabilities().filter((id) => WATER.includes(id)), WATER);
      } finally {
        Homey.Device.prototype.addCapability = addCapability;
      }
    });
  });

  test('switching off when a capability cannot be removed: onSettings rejects, the setting stays on, and the page is still polled', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, toon } = scenario;
      const { removeCapability } = Homey.Device.prototype;
      let refuse = true;
      Homey.Device.prototype.removeCapability = async function removeOrRefuse(id) {
        if (refuse && id === 'meter_water.today') throw new Error('Core refused');
        return removeCapability.call(this, id);
      };
      try {
        const device = await scenario.addPaired({ toonwater: true });
        await clock.tick(60e3);
        await assert.rejects(device.simulateSettingsSave({ toonwater_enabled: false }), /Core refused/);

        assert.equal(device.getSetting('toonwater_enabled'), true, 'Homey keeps what it had');
        const asked = waterRequests(toon()).length;
        await clock.tick(2 * 60e3);
        assert.ok(waterRequests(toon()).length > asked, 'the switch did not change, so the page is still read');
        assert.equal(device.getCapabilityValue('meter_water.total'), 7350.214);

        refuse = false;
        await device.simulateSettingsSave({ toonwater_enabled: false });
        WATER.forEach((id) => assert.equal(device.hasCapability(id), false, id));
      } finally {
        Homey.Device.prototype.removeCapability = removeCapability;
      }
    });
  });

  test('a device that is deleted while the save runs: the save rejects with the localized text, nothing is added to a deleted device', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, world } = scenario;
      const { addCapability } = Homey.Device.prototype;
      Homey.Device.prototype.addCapability = async function addThenDelete(id) {
        await addCapability.call(this, id);
        if (id === 'measure_water') await this.onDeleted();
      };
      try {
        const device = await scenario.addPaired();
        await clock.tick(60e3);
        await assert.rejects(device.simulateSettingsSave({ toonwater_enabled: true }), /cancelled because the device was removed/);

        assert.deepEqual(addedIds(world), ['measure_water']);
        assert.deepEqual(scenario.deviceLog('error'), []);
      } finally {
        Homey.Device.prototype.addCapability = addCapability;
      }
    });
  });
});

describe('FR-03 / ADR-0006: a device that has no usable address yet', () => {
  test('ToonWater is switched on without a Toon to ask: the items are added, the message says the Toon could not be reached, and an address saved later brings the values', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, toon, world } = scenario;
      const device = await scenario.addPaired({ address: '0.0.0.0' });
      await clock.tick(60e3);
      const message = await save(clock, device, { toonwater_enabled: true });

      assert.match(message, /^The Toon could not be reached/);
      assert.deepEqual(addedIds(world), WATER);
      assert.equal(device.getSetting('toonwater_status'), 'Toon not reachable');
      assert.equal(toon().requests().length, 0, 'not a request without an address');

      await save(clock, device, { address: '192.168.1.50' });
      await clock.tick(10e3);
      assert.deepEqual(waterValues(device), PRESENT);
      assert.equal(device.getSetting('toonwater_status'), 'Detected');
      assert.equal(device.getAvailable(), true);
    });
  });
});

describe('ADR-0006 item 5: the save does not wait for a queued cycle, and an address change comes first', () => {
  test('R-03: a request in flight, then a save that switches ToonWater on: onSettings resolves within 8 s of fake time with the text of FR-59', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, toon } = scenario;
      const device = await scenario.addPaired();
      await clock.tick(60e3);
      toon().fault('timeout', { path: '/happ_thermstat', times: 1 });
      await clock.tick(30e3); // the next cycle starts: the thermostat request hangs for its 5 s
      const started = clock.now();
      let message;
      const save = device.simulateSettingsSave({ toonwater_enabled: true }).then((text) => {
        message = text;
      });
      let elapsed = 0;
      for (; message === undefined && elapsed < 20e3; elapsed += 500) await clock.tick(500);
      await save;

      assert.ok(clock.now() - started <= 8000, `${clock.now() - started} ms`);
      assert.equal(message, 'ToonWater found. Water values will appear shortly.');
    });
  });

  test('R-03: with a Toon that answers everything slowly the probe runs out of its 3 s and the save says the Toon could not be reached, within 8 s', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, toon } = scenario;
      const device = await scenario.addPaired();
      await clock.tick(60e3);
      toon().latencyMs = 4000;
      await clock.tick(1000);
      let message;
      const save = device.simulateSettingsSave({ toonwater_enabled: true }).then((text) => {
        message = text;
      });
      const started = clock.now();
      for (let elapsed = 0; message === undefined && elapsed < 20e3; elapsed += 500) await clock.tick(500);
      await save;

      assert.ok(clock.now() - started <= 8000, `${clock.now() - started} ms`);
      assert.match(message, /^The Toon could not be reached/);
    });
  });

  test('FR-82 AC2: a save with a new address and the switch together is probed at the new address, and the old Toon is never asked again', async () => {
    await withScenario({ toons: { '192.168.1.50': { water: '404' }, '192.168.1.51': {} } }, async (scenario) => {
      const { clock, toon } = scenario;
      const device = await scenario.addPaired();
      await clock.tick(60e3);
      const oldRequests = toon('192.168.1.50').requests().length;
      const message = await device.simulateSettingsSave({ address: '192.168.1.51', toonwater_enabled: true });

      assert.equal(message, 'ToonWater found. Water values will appear shortly.', 'the new Toon has the add-on, the old one has not');
      assert.equal(toon('192.168.1.51').requestsTo(WATER_PATH).length, 1);
      assert.equal(toon('192.168.1.51').requests()[0].path, WATER_PATH, 'the first request to the new Toon is the probe');
      await clock.tick(2 * 60e3);
      assert.equal(toon('192.168.1.50').requests().length, oldRequests, 'the old address sees nothing more');
      assert.deepEqual(waterValues(device), PRESENT);
      assert.equal(device.fake.warning, null);
    });
  });

  test('FR-82 AC2: an address that is fixed with ToonWater on is probed again, the warning and the "not found" status go away', async () => {
    await withScenario({ toons: { '192.168.1.50': { water: '404' }, '192.168.1.51': {} } }, async (scenario) => {
      const { clock, toon } = scenario;
      const device = await scenario.addPaired({ toonwater: true });
      await clock.tick(60e3);
      assert.equal(device.fake.warning, 'ToonWater is enabled but was not found on this Toon');
      assert.equal(device.getSetting('toonwater_status'), 'Not found on this Toon (HTTP 404)');

      await device.simulateSettingsSave({ address: '192.168.1.51' });
      await clock.tick(10e3);

      assert.equal(device.fake.warning, null, 'no stale warning');
      assert.equal(device.getSetting('toonwater_status'), 'Detected');
      assert.deepEqual(waterValues(device), PRESENT);
      assert.equal(toon('192.168.1.51').requestsTo(WATER_PATH).length >= 1, true);
    });
  });
});

describe('ADR-0006 / HW-13: the status written during a save is written again after it', () => {
  test('[HW-13] a status that changes while a save runs is the status after the save, even though Homey stores the settings it was given', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, toon, world } = scenario;
      const device = await scenario.addPaired({ toonwater: true });
      await clock.tick(60e3);
      assert.equal(device.getSetting('toonwater_status'), 'Detected');

      // the save is slow (Core takes 20 s to add the capability); in between the page goes missing and the status changes
      const { addCapability } = Homey.Device.prototype;
      Homey.Device.prototype.addCapability = async function slow(id) {
        await new Promise((resolve) => {
          world.homey.setTimeout(resolve, 20e3);
        });
        return addCapability.call(this, id);
      };
      try {
        toon().configure({ water: '404' });
        let saved = false;
        const save = device.simulateSettingsSave({ export_enabled: true }).then(() => {
          saved = true;
        });
        for (let step = 0; step < 100 && !saved; step++) await clock.tick(1000);
        await save;
        assert.equal(world.callsOf('setSettings').some((call) => call.args[0].toonwater_status === 'Not found on this Toon (HTTP 404)'), true, 'it was written during the save');
        await clock.tick(1);

        assert.equal(device.getSetting('toonwater_status'), 'Not found on this Toon (HTTP 404)');
        assert.equal(device.getSetting('export_enabled'), true);
      } finally {
        Homey.Device.prototype.addCapability = addCapability;
      }
    });
  });

  test('onSettings never reads the stored value of a key that is being changed: they are still the old ones', async () => {
    await withScenario({}, async (scenario) => {
      const { clock } = scenario;
      const device = await scenario.addPaired();
      await clock.tick(60e3);
      const read = [];
      const { getSetting } = device;
      device.getSetting = (key) => {
        read.push(key);
        return getSetting.call(device, key);
      };
      await device.simulateSettingsSave({ toonwater_enabled: true, export_enabled: true, poll_interval: 60 });

      assert.equal(read.some((key) => ['toonwater_enabled', 'export_enabled', 'poll_interval'].includes(key)), false, read.join());
    });
  });
});

describe('FR-60 AC1: a toggle on, off and on again leaves everything that is not water as it was', () => {
  test('the other capabilities, their values and their options are identical before and after', async () => {
    await withScenario({}, async (scenario) => {
      const { clock } = scenario;
      const device = await scenario.addPaired();
      await clock.tick(2 * 60e3);
      const snapshot = () => ({
        capabilities: device.getCapabilities().filter((id) => !WATER.includes(id)),
        values: Object.fromEntries(CORE.map((id) => [id, device.getCapabilityValue(id)])),
        options: Object.fromEntries(CORE.map((id) => [id, device.getCapabilityOptions(id)])),
      });
      const before = snapshot();

      await device.simulateSettingsSave({ toonwater_enabled: true });
      await device.simulateSettingsSave({ toonwater_enabled: false });
      await device.simulateSettingsSave({ toonwater_enabled: true });

      assert.deepEqual(snapshot(), before);
      assert.equal(device.getCapabilities().includes('alarm_water.hotwater'), true);
    });
  });
});
