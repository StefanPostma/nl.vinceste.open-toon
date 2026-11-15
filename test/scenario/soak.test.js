'use strict';

/*
 * NFR-12 / NFR-01 / NFR-15: 1,000 poll cycles under a fake clock with random faults, writes and refreshes (a seeded
 * generator, so a failure repeats). Resources are counted, not weighed (ADR-0013): when the Toon is quiet again there
 * is exactly one armed timer per device, no listener piles up on the epoch signal, the lane is empty, the Toon mock has
 * no request that is still being served, Node has no resource that it did not have before, nothing was unhandled
 * (the harness fails the file otherwise), and nothing but the configured Toon was ever contacted.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { getEventListeners } = require('events');
const { createScenario } = require('../helpers/scenario');
const { FAULT_KINDS } = require('../helpers/mock-toon');

const PATHS = ['/happ_thermstat', '/happ_pwrusage', '/hdrv_zwave'];
const WATER_PATH = '/water.html';
const CYCLES = 1000;
const STEP_MS = 5000;

/** A small seeded generator (mulberry32): the same faults on every run. */
function generator(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const resources = () => {
  const counts = {};
  process.getActiveResourcesInfo().filter((name) => name !== 'Immediate').forEach((name) => {
    counts[name] = (counts[name] || 0) + 1;
  });
  return counts;
};

async function nextImmediate() {
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/** Lets everything that is still in motion finish: stuck requests of the mock end after 10 minutes of fake time. */
async function settle(scenario, poller) {
  scenario.toon().clearFaults();
  for (let step = 0; step < 140; step++) await scenario.clock.tick(STEP_MS);
  for (let step = 0; step < 60 && (poller.busy || scenario.clock.armed() !== 1); step++) await scenario.clock.tick(1000);
}

/**
 * 1,000 cycles of one device with random faults, writes and refreshes. With `water` the device has ToonWater on and the
 * faults also hit its page; the user also switches ToonWater and the export on and off along the way.
 */
async function soak({ water }) {
  const scenario = createScenario();
  await scenario.start();
  try {
    const random = generator(water ? 20261114 : 20261113);
    const pick = (list) => list[Math.floor(random() * list.length)];
    const paths = water ? [...PATHS, WATER_PATH] : PATHS;
    const before = resources();
    const { clock, world } = scenario;
    const toon = scenario.toon();
    const device = await scenario.addPaired({ toonwater: water });
    const pending = [];
    let outage = 0;

    for (let step = 0; device._poller.cycles < CYCLES; step++) {
      assert.ok(step < 100000, 'the soak did not make progress');
      if (outage > 0 && --outage === 0) toon.clearFaults();
      else if (outage === 0 && random() < 0.01) {
        toon.fault(pick(['refused', 'timeout', '500']));
        outage = 5 + Math.floor(random() * 40);
      } else if (random() < 0.15) {
        toon.fault(pick(FAULT_KINDS), { path: random() < 0.5 ? pick(paths) : undefined, times: 1 + Math.floor(random() * 3) });
      }
      if (random() < 0.05) pending.push(device.simulateCapabilitySet('target_temperature', 15 + Math.floor(random() * 30) / 2).catch(() => {}));
      if (random() < 0.05) pending.push(device.refresh(random() < 0.5 ? undefined : [pick(['thermostat', 'power', 'meters'])]).catch(() => {}));
      if (random() < 0.02) pending.push(device.setTemperatureState(pick(['comfort', 'home', 'sleep', 'away']), pick(['yes', 'no'])).catch(() => {}));
      if (water && random() < 0.01) pending.push(device.simulateSettingsSave({ toonwater_enabled: random() < 0.5, export_enabled: random() < 0.5 }).catch(() => {}));
      if (water && random() < 0.02) toon.configure({ water: pick(['present', '404', 'html-200', 'old-shape', 'junk', 'slow']) });
      await clock.tick(STEP_MS);
    }
    await settle(scenario, device._poller);
    await Promise.all(pending);
    await clock.tick(1);
    await nextImmediate();

    assert.equal(clock.armed(), 1, 'exactly one armed timer for the one device');
    assert.ok(getEventListeners(device._poller.controller.signal, 'abort').length <= 1);
    assert.equal(device._poller.lane.size, 0, 'the lane is empty');
    assert.equal(device._serial.size, 0, 'and so is the queue of the settings');
    assert.equal(toon.openHandlers(), 0, 'the Toon has no request left that it is still serving');
    assert.deepEqual(resources(), before, 'no resource that Node did not have before');
    assert.deepEqual(scenario.hostsContacted(), ['192.168.1.50'], 'nothing but the configured Toon');
    assert.equal(device.getAvailable(), true, 'recovered by itself');
    assert.deepEqual(scenario.deviceLog('error'), []);
    const answered = toon.requests().filter((entry) => !entry.abortedByClient).sort((a, b) => a.start - b.start);
    assert.ok(answered.length > CYCLES, 'a lot of requests were answered');
    answered.slice(1).forEach((entry, index) => assert.ok(entry.start >= answered[index].end, `request ${entry.id} started while request ${answered[index].id} was still being answered`));
    assert.ok(world.callsOf('setCapabilityValue').every((call) => call.args[1] !== undefined && call.args[1] !== null && !Number.isNaN(call.args[1])), 'no empty value ever');
    if (water) {
      assert.equal(device.hasCapability('meter_water.total'), device.getSetting('toonwater_enabled'), 'the items follow the last switch that was saved');
      assert.equal(device.hasCapability('measure_power.export'), device.getSetting('export_enabled'));
      assert.ok(toon.requestsTo(WATER_PATH).length > 0);
      assert.ok(world.callsOf('addCapability').length >= 6 && world.callsOf('removeCapability').length >= 6, 'the switches really were used');
    }
  } finally {
    scenario.stop();
  }
}

describe('NFR-12 / NFR-01 / NFR-15: 1,000 cycles with random faults leave nothing behind', () => {
  test('NFR-12: one timer, no listener, an empty lane, no open handler, no new resource, no unhandled rejection, only the configured host', async () => {
    await soak({ water: false });
  });

  test('NFR-12 with ToonWater on, its page failing too, and the user switching ToonWater and the export on and off: the same counts hold', async () => {
    await soak({ water: true });
  });

  test('the same with the address moving between two Toons and the device deleted at the end: zero timers, zero requests after', async () => {
    const scenario = createScenario({ toons: { '192.168.1.50': {}, '192.168.1.51': {} } });
    await scenario.start();
    try {
      const random = generator(7);
      const { clock, world } = scenario;
      const [first, second] = [scenario.toon('192.168.1.50'), scenario.toon('192.168.1.51')];
      const device = await scenario.addDevice();
      const hosts = ['192.168.1.51', '192.168.1.50'];
      const pending = [];

      for (let step = 0; step < 4000; step++) {
        if (step % 400 === 399) pending.push(device.simulateSettingsSave({ address: hosts[(step / 400 | 0) % 2] }).catch(() => {}));
        if (random() < 0.1) scenario.toon(hosts[Math.floor(random() * 2)]).fault(['500', 'refused', 'timeout'][Math.floor(random() * 3)], { times: 2 });
        if (random() < 0.05) pending.push(device.simulateCapabilitySet('target_temperature', 16 + Math.floor(random() * 20) / 2).catch(() => {}));
        await clock.tick(STEP_MS);
      }
      first.clearFaults();
      second.clearFaults();
      await Promise.all(pending);
      await world.deleteDevice(device);
      const requests = first.requests().length + second.requests().length;
      await clock.tick(11 * 60e3);

      assert.equal(first.requests().length + second.requests().length, requests, 'not one request after the delete');
      assert.equal(clock.armed(), 0, 'not one timer');
      assert.deepEqual(scenario.hostsContacted().sort(), ['192.168.1.50', '192.168.1.51']);
      assert.deepEqual(scenario.deviceLog('error'), []);
    } finally {
      scenario.stop();
    }
  });
});
