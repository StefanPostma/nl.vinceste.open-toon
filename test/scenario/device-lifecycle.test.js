'use strict';

/*
 * L2 scenarios: the real app files under the fake Homey against the mock Toon on a fake clock. A paired Toon is
 * polled without any Flow, goes unavailable and recovers by itself, stays quiet in the log, and is cleaned up when
 * the device goes away. Each "[fixes BD-n]" title replaces the characterisation of a defect of the baseline.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('perf_hooks');
const { createScenario } = require('../helpers/scenario');
const { CORE } = require('../../lib/features');
const { jsonFixture } = require('../helpers/fixtures');

const { eras } = jsonFixture('eras.json');
const THERMOSTAT = '/happ_thermstat';
const POWER = '/happ_pwrusage';
const METERS = '/hdrv_zwave';

/** Runs `body` with a started scenario and always gives the global fetch and Date.now back. */
async function withScenario(options, body) {
  const scenario = createScenario(options);
  await scenario.start();
  try {
    return await body(scenario);
  } finally {
    scenario.stop();
  }
}

const reads = (toon, path) => toon.requestsTo(path).filter((entry) => entry.query.action !== 'setSetpoint' && entry.query.action !== 'changeSchemeState');
const gaps = (entries) => entries.slice(1).map((entry, index) => entry.start - entries[index].start);

describe('FR-80: a paired Toon is polled without any Flow', () => {
  test('AC1: at the default interval each group is read every 30 s, 10 times in 5 minutes', async () => {
    await withScenario({}, async ({ clock, toon, addDevice }) => {
      await addDevice();
      await clock.tick(5 * 60e3);

      [THERMOSTAT, POWER, METERS].forEach((path) => {
        const entries = reads(toon(), path);
        assert.ok(entries.length >= 9 && entries.length <= 11, `${path}: ${entries.length} requests`);
        assert.ok(gaps(entries).every((gap) => gap === 30000), `${path}: a request every 30 s`);
      });
      assert.equal(toon().maxConcurrent(), 1, 'strictly sequential');
    });
  });

  test('AC2 / NFR-08 AC1: onInit returns at once with an unroutable address; the first request goes out 1-3 s later in the background', async () => {
    await withScenario({}, async ({ clock, toon, addDevice }) => {
      toon().fault('timeout');
      const before = performance.now();
      const device = await addDevice({ values: { measure_temperature: 19.5 } });

      assert.ok(performance.now() - before < 1000, 'onInit did not wait for the network');
      assert.equal(clock.now(), 0, 'and no fake time passed either');
      assert.equal(toon().requests().length, 0);
      assert.equal(device.getCapabilityValue('measure_temperature'), 19.5, 'the device shows its last values');
      await clock.tick(3000);
      assert.equal(toon().requests().length, 1, 'one request, in the background');
      assert.equal(device.getCapabilityValue('measure_temperature'), 19.5);
    });
  });

  test('NFR-08 AC3: a healthy Toon gives every capability a value within 10 s', async () => {
    await withScenario({}, async ({ clock, addDevice }) => {
      const device = await addDevice();
      await clock.tick(10e3);

      CORE.forEach((id) => assert.notEqual(device.getCapabilityValue(id), null, id));
      assert.equal(device.getCapabilityValue('measure_temperature'), 20.3);
      assert.equal(device.getCapabilityValue('target_temperature'), 18.5);
      assert.equal(device.getCapabilityValue('temperature_state'), 'home');
      assert.equal(device.getCapabilityValue('burner_state'), 'off');
      assert.equal(device.getCapabilityValue('alarm_water.hotwater'), false);
    });
  });

  test('AC3: a cycle that takes longer than the interval is never overlapped', async () => {
    await withScenario({}, async ({ clock, toon, addDevice }) => {
      toon().latencyMs = 4000;
      await addDevice({ settings: { address: '192.168.1.50', poll_interval: 10 } });
      await clock.tick(5 * 60e3);

      assert.equal(toon().maxConcurrent(), 1);
      const starts = reads(toon(), THERMOSTAT).map((entry) => entry.start);
      assert.ok(gaps(reads(toon(), THERMOSTAT)).every((gap) => gap >= 10000 + 3 * 4000), `a cycle of three requests of 4 s, then the interval: ${gaps(reads(toon(), THERMOSTAT))}`);
      assert.ok(starts.length >= 10);
    });
  });

  test('AC4: when the meters group answers 500 the thermostat and power values are still applied, and the problem is logged once', async () => {
    await withScenario({}, async ({
      clock, toon, addDevice, deviceLog,
    }) => {
      toon().fault('500', { path: METERS });
      toon().state.power.powerUsage.value = 512;
      const device = await addDevice();
      await clock.tick(5 * 60e3);

      assert.equal(device.getCapabilityValue('measure_power'), 512);
      assert.equal(device.getCapabilityValue('measure_temperature'), 20.3);
      assert.equal(device.getCapabilityValue('meter_gas'), null, 'nothing is made up for the group that failed');
      assert.equal(device.getAvailable(), true, 'an optional group never makes the device unavailable');
      assert.ok(reads(toon(), METERS).length >= 9, 'and it is asked again every cycle');
      assert.deepEqual(deviceLog('error'), []);
      assert.deepEqual(deviceLog().filter((line) => line.includes('meters')), ['meters: http 500']);
    });
  });

  test('FR-83 AC2: a new interval applies to the next schedule without restarting', async () => {
    await withScenario({}, async ({ clock, toon, addDevice }) => {
      const device = await addDevice();
      await clock.tick(95e3);
      await device.simulateSettingsSave({ poll_interval: 60 });
      toon().recorder.reset();
      await clock.tick(5 * 60e3);

      const starts = reads(toon(), THERMOSTAT);
      assert.ok(starts.length >= 5 && starts.length <= 6, `${starts.length} requests in 5 minutes at 60 s`);
      assert.ok(gaps(starts).every((gap) => gap === 60000));
    });
  });

  test('FR-83 AC2: a shorter interval takes effect at once: from 3600 s to 30 s the next cycle is 30 s after the save, not an hour', async () => {
    await withScenario({}, async ({ clock, toon, addDevice }) => {
      const device = await addDevice({ settings: { address: '192.168.1.50', poll_interval: 3600 } });
      await clock.tick(5000);
      assert.equal(reads(toon(), THERMOSTAT).length, 1);
      await clock.tick(20 * 60e3);
      await device.simulateSettingsSave({ poll_interval: 30 });
      const saved = clock.now();
      await clock.tick(30e3);

      assert.equal(reads(toon(), THERMOSTAT).length, 2);
      assert.equal(reads(toon(), THERMOSTAT)[1].start - saved, 30000);
    });
  });

  test('FR-112 AC1: settings that hold only the address poll at 30 s; poll_interval is not written back', async () => {
    await withScenario({}, async ({
      world, clock, toon, addDevice,
    }) => {
      const device = await addDevice({ settings: { address: '192.168.1.50' } });
      await clock.tick(2 * 60e3);

      assert.ok(gaps(reads(toon(), THERMOSTAT)).every((gap) => gap === 30000));
      assert.equal(Object.hasOwn(device.getSettings(), 'poll_interval'), false);
      assert.equal(world.callsOf('setSettings').some((call) => Object.hasOwn(call.args[0], 'poll_interval')), false);
    });
  });

  test('FR-112 AC2: a poll_interval of an invalid type is replaced by the default, with one log line', async () => {
    await withScenario({}, async ({
      clock, toon, addDevice, deviceLog,
    }) => {
      await addDevice({ settings: { address: '192.168.1.50', poll_interval: 'soon' } });
      await clock.tick(2 * 60e3);

      assert.ok(gaps(reads(toon(), THERMOSTAT)).every((gap) => gap === 30000));
      assert.deepEqual(deviceLog().filter((line) => line.includes('poll_interval')), ['poll_interval is not a number, using 30 s']);
    });
  });
});

describe('FR-81: availability follows the predicate and recovers without a Flow', () => {
  test('[fixes BD-6] FR-81 AC1-AC4: unavailable after the fourth failed cycle (90 s have passed), available again by itself, values never cleared', async () => {
    await withScenario({}, async ({
      world, clock, toon, addDevice,
    }) => {
      const device = await addDevice();
      await clock.tick(60e3);
      const known = Object.fromEntries(CORE.map((id) => [id, device.getCapabilityValue(id)]));
      toon().recorder.reset();
      toon().fault('timeout');

      let failures = 0;
      for (let second = 0; second < 10 * 60 && device.getAvailable(); second++) {
        await clock.tick(1000);
        failures = toon().requests().length;
      }
      assert.equal(device.getAvailable(), false);
      assert.equal(failures, 4, 'not after the third failed cycle: those spanned less than 90 s');
      assert.equal(device.fake.unavailableMessage, 'Your Toon cannot be reached');
      assert.deepEqual(world.callsOf('setUnavailable').map((call) => call.args[0]), ['Your Toon cannot be reached']);

      await clock.tick(10 * 60e3);
      CORE.forEach((id) => assert.deepEqual(device.getCapabilityValue(id), known[id], `${id} keeps its value while the Toon is away`));
      assert.equal(world.callsOf('setCapabilityValue').some((call) => call.args[1] === null || call.args[1] === undefined), false);

      toon().clearFaults();
      toon().state.power.powerUsage.value = 777;
      await clock.tick(5 * 60e3);
      assert.equal(device.getAvailable(), true);
      assert.equal(device.fake.unavailableMessage, null);
      assert.equal(device.getCapabilityValue('measure_power'), 777, 'values refresh after the recovery, without a Flow and without a restart');
      assert.equal(world.callsOf('setAvailable').length, 1);
    });
  });

  test('while the Toon is unreachable only the thermostat is asked, once per cycle, and ever less often', async () => {
    await withScenario({}, async ({ clock, toon, addDevice }) => {
      await addDevice();
      await clock.tick(60e3);
      toon().recorder.reset();
      toon().fault('timeout');
      await clock.tick(10 * 60e3);

      const requests = toon().requests();
      assert.ok(requests.length >= 4 && requests.length <= 7, `${requests.length} requests in 10 minutes`);
      assert.ok(requests.every((entry) => entry.path === THERMOSTAT), 'a down host is not asked for power and meters as well');
      const waits = gaps(requests);
      assert.deepEqual(waits, [...waits].sort((a, b) => a - b), 'the gaps never shrink');
      assert.ok(waits.every((gap) => gap >= 30000), 'never faster than the interval');
      assert.equal(toon().requests().length, toon().requests().filter((entry) => entry.abortedByClient).length, 'every request was cut off by the 5 s timeout');
    });
  });

  test('a short hiccup does not flip the device: two failed cycles in a row, then the Toon is back', async () => {
    await withScenario({}, async ({
      world, clock, toon, addDevice,
    }) => {
      const device = await addDevice();
      await clock.tick(60e3);
      toon().fault('refused', { times: 2 });
      await clock.tick(5 * 60e3);

      assert.equal(device.getAvailable(), true);
      assert.equal(world.callsOf('setUnavailable').length, 0);
    });
  });

  test('a healthy hour writes no log line at all; an outage writes one per change of state, never one per cycle, never at error level', async () => {
    await withScenario({}, async ({
      clock, toon, addDevice, deviceLog,
    }) => {
      await addDevice();
      await clock.tick(60 * 60e3);
      assert.deepEqual(deviceLog(), []);

      toon().fault('timeout');
      await clock.tick(30 * 60e3);
      toon().clearFaults();
      await clock.tick(10 * 60e3);

      assert.deepEqual(deviceLog(), [
        'thermostat: timeout',
        'the Toon cannot be reached: device set unavailable',
        'thermostat: answers again',
        'the Toon answers again: device set available',
      ]);
      assert.deepEqual(deviceLog('error'), []);
    });
  });

  test('FR-85: the status labels show when the last update succeeded (at most every 15 minutes) and the last problem (once per kind)', async () => {
    await withScenario({}, async ({
      world, clock, toon, addDevice,
    }) => {
      const device = await addDevice();
      await clock.tick(14 * 60e3);
      const stamped = world.callsOf('setSettings').filter((call) => Object.hasOwn(call.args[0], 'last_update'));

      assert.equal(stamped.length, 1, 'one write for 28 successful cycles');
      assert.match(device.getSetting('last_update'), /^\d{1,2}\/\d{1,2}\/\d{2}, \d{1,2}:\d{2} [AP]M$/);
      assert.equal(device.getSetting('last_problem'), '-');

      await clock.tick(2 * 60e3);
      assert.equal(world.callsOf('setSettings').filter((call) => Object.hasOwn(call.args[0], 'last_update')).length, 2, 'the next write is 15 minutes later');

      toon().fault('timeout');
      await clock.tick(20 * 60e3);
      toon().clearFaults();
      toon().fault('500', { path: THERMOSTAT });
      await clock.tick(20 * 60e3);
      const problems = world.callsOf('setSettings').filter((call) => Object.hasOwn(call.args[0], 'last_problem')).map((call) => call.args[0].last_problem);

      assert.equal(problems.length, 2, 'once for the timeouts, once when the reason changes; never one per cycle');
      assert.match(problems[0], /The Toon did not answer in time/);
      assert.match(problems[1], /The Toon answered with an error \(code 500\)/);
      assert.equal(device.getSetting('last_problem'), problems[1], 'the text is replaced, not appended');
    });
  });

  test('FR-85: the labels follow the language of the Homey', async () => {
    await withScenario({ language: 'nl' }, async ({ clock, toon, addDevice }) => {
      const device = await addDevice();
      await clock.tick(5000);
      toon().fault('refused');
      await clock.tick(2 * 60e3);

      assert.match(device.getSetting('last_update'), /^\d{2}-\d{2}-\d{4},? \d{2}:\d{2}$/);
      assert.match(device.getSetting('last_problem'), /Homey kan de Toon niet bereiken/);
    });
  });
});

describe('FR-20 AC3 [fixes BD-1]: the power poll never touches a capability the device does not have', () => {
  test('[fixes BD-1] a power answer with dayUsage does not write meter_power, no Invalid Capability on any device', async () => {
    await withScenario({}, async ({
      world, clock, toon, addDevice, deviceLog,
    }) => {
      Object.assign(toon().state.power.powerUsage, { dayUsage: 5000, dayLowUsage: 3000 });
      const fresh = await addDevice({ data: { id: 'fresh' } });
      const old = await addDevice({
        data: { id: 'era0' }, settings: { address: '192.168.1.50' }, capabilities: eras.era0.capabilities, values: { meter_power: 12.5 },
      });
      await clock.tick(3 * 60e3);

      assert.equal(fresh.getCapabilityValue('measure_power'), 324);
      assert.equal(world.callsOf('setCapabilityValue').some((call) => call.args[0] === 'meter_power'), false, 'never written');
      assert.equal(old.getCapabilityValue('meter_power'), 12.5, 'the old meter keeps its last value, frozen');
      assert.equal(old.getCapabilityValue('measure_power'), 324);
      assert.deepEqual(deviceLog('error'), []);
    });
  });
});

describe('FR-03 AC3: a device without a usable address', () => {
  test('a legacy 0.0.0.0 sends nothing, shows why it is unavailable and sets no warning; a valid address saved later starts it without a restart', async () => {
    await withScenario({}, async ({
      world, clock, toon, addDevice,
    }) => {
      const device = await addDevice({ settings: { address: '0.0.0.0' } });
      await clock.tick(10 * 60e3);

      assert.equal(toon().requests().length, 0, 'not a single request to 0.0.0.0 or anywhere else');
      assert.equal(device.getAvailable(), false);
      assert.equal(device.fake.unavailableMessage, 'Set the IP address of your Toon in the device settings.');
      assert.equal(clock.armed(), 0, 'no poller, no timer');
      for (const action of [() => device.refresh(), () => device.programOn(), () => device.setTemperatureState('home'), () => device.simulateCapabilitySet('target_temperature', 20)]) {
        await assert.rejects(action(), { message: 'Set the IP address of your Toon in the device settings.' });
      }
      assert.equal(toon().requests().length, 0);

      await device.simulateSettingsSave({ address: '192.168.1.50' });
      assert.equal(device.getSetting('address'), '192.168.1.50');
      await clock.tick(3000);
      assert.ok(toon().requests().length >= 3);
      assert.equal(device.getAvailable(), true, 'the first success sets it available');
      assert.equal(device.fake.unavailableMessage, null);
      assert.equal(world.callsOf('setWarning').length, 0);
      assert.equal(device.fake.warning, null);
      assert.equal(device.getCapabilityValue('measure_temperature'), 20.3);
    });
  });

  test('FR-03 AC2: an invalid address is refused with a localized message and nothing changes', async () => {
    await withScenario({}, async ({ clock, toon, addDevice }) => {
      const device = await addDevice();
      await clock.tick(5000);
      const before = toon().requests().length;
      const refused = {
        'https://192.168.1.50': /plain http/,
        'fe80::1': /IPv6/,
        '192.168.1.50/foo': /not a valid address/,
        '0.0.0.0': /not a valid address/,
      };

      for (const [address, message] of Object.entries(refused)) {
        await assert.rejects(device.simulateSettingsSave({ address }), message);
        assert.equal(device.getSetting('address'), '192.168.1.50');
      }
      await assert.rejects(device.simulateSettingsSave({ poll_interval: 5 }), /from 10 to 3600/);
      await assert.rejects(device.simulateSettingsSave({ poll_interval: 3601 }), /from 10 to 3600/);
      assert.equal(device.getSetting('poll_interval'), 30);
      await clock.tick(1000);
      assert.equal(toon().requests().length, before, 'the poller was not disturbed');
    });
  });

  test('the messages of the settings follow the language', async () => {
    await withScenario({ language: 'nl' }, async ({ addDevice }) => {
      const device = await addDevice();

      await assert.rejects(device.simulateSettingsSave({ address: 'https://192.168.1.50' }), /gewoon http/);
      await assert.rejects(device.simulateSettingsSave({ poll_interval: 5 }), /van 10 tot 3600/);
    });
  });

  test('after a change of address nothing more is sent to the old host and nothing of it is applied; the new host is polled within 3 s', async () => {
    await withScenario({ toons: { '192.168.1.50': {}, '192.168.1.51': {} } }, async ({
      clock, toon, addDevice, hostsContacted,
    }) => {
      const old = toon('192.168.1.50');
      const next = toon('192.168.1.51');
      next.state.thermostat.currentTemp = '1850';
      old.fault('timeout');
      const device = await addDevice();
      await clock.tick(3000);
      assert.equal(old.requests().length, 1, 'a request is in flight to the old host');

      await device.simulateSettingsSave({ address: '192.168.1.51' });
      assert.equal(old.requests()[0].abortedByClient, true, 'and it is cancelled');
      await clock.tick(3000);
      assert.deepEqual(next.requests().map((entry) => entry.path), [THERMOSTAT, POWER, METERS]);
      assert.equal(device.getCapabilityValue('measure_temperature'), 18.5);

      await clock.tick(15 * 60e3);
      assert.equal(old.requests().length, 1, 'the old host sees nothing more, also after its stuck request would have been answered');
      assert.deepEqual(hostsContacted(), ['192.168.1.50', '192.168.1.51']);
      assert.equal(device.getCapabilityValue('measure_temperature'), 18.5, 'nothing of the old host is applied');
    });
  });

  test('saving an address that only differs in spelling, or the status labels, keeps the poller as it is', async () => {
    await withScenario({}, async ({ clock, toon, addDevice }) => {
      const device = await addDevice();
      await clock.tick(5000);
      await device.simulateSettingsSave({ address: ' http://192.168.1.50/ ' });
      await clock.tick(1000);

      assert.equal(toon().requests().length, 3, 'no new first cycle');
      assert.equal(device.getSetting('address'), ' http://192.168.1.50/ ', 'the text is stored as typed');
    });
  });
});

describe('FR-84: nothing runs after the device is gone', () => {
  test('[fixes BD-9] FR-84 AC1/AC3: deleting a device with a request in flight does not throw, cancels it and leaves no timer and no later request', async () => {
    await withScenario({}, async ({
      world, clock, toon, addDevice, deviceLog,
    }) => {
      toon().fault('timeout');
      const device = await addDevice();
      await clock.tick(3000);
      assert.equal(toon().requests().length, 1);

      await world.deleteDevice(device);
      await clock.tick(60 * 60e3);

      assert.equal(toon().requests().length, 1, 'zero requests after the delete');
      assert.equal(toon().requests()[0].abortedByClient, true);
      assert.equal(clock.armed(), 0);
      assert.deepEqual(deviceLog('error'), []);
    });
  });

  test('[fixes BD-9] FR-84 AC3: teardown is idempotent: onDeleted and onUninit twice, and _teardown directly, never throw', async () => {
    await withScenario({}, async ({ world, clock, addDevice }) => {
      const device = await addDevice();
      await clock.tick(5000);
      await world.deleteDevice(device);

      await device.onDeleted();
      await device.onUninit();
      device._teardown();
      device._teardown();
      assert.equal(clock.armed(), 0);
    });
  });

  test('[fixes BD-9] delete while a refresh is queued: it rejects with the localized aborted text in the same tick, and nothing is left running', async () => {
    await withScenario({}, async ({
      world, clock, toon, addDevice,
    }) => {
      toon().fault('timeout');
      const device = await addDevice();
      await clock.tick(3000);
      const queued = [device.refresh(['power']), device.refresh()];
      const settled = queued.map((promise) => assert.rejects(promise, { message: 'The request was cancelled because the device was removed or its address changed.' }));
      const at = clock.now();

      await world.deleteDevice(device);
      await Promise.all(settled);
      assert.equal(clock.now(), at, 'no time passed: the refreshes did not wait for a timeout');
      await clock.tick(10 * 60e3);
      assert.equal(toon().requests().length, 1);
      assert.equal(clock.armed(), 0);
      await assert.rejects(device.refresh(), /cancelled/, 'also when asked after the delete');
    });
  });

  test('FR-84 AC2: an answer that arrives after the delete is ignored: no write, no error line', async () => {
    await withScenario({}, async ({
      world, clock, toon, addDevice, deviceLog,
    }) => {
      toon().latencyMs = 3000;
      const device = await addDevice();
      await clock.tick(2000 + 1000);
      await world.deleteDevice(device);
      const writes = world.callsOf('setCapabilityValue').length;
      await clock.tick(30e3);

      assert.equal(world.callsOf('setCapabilityValue').length, writes);
      assert.deepEqual(deviceLog('error'), []);
    });
  });

  test('FR-84 AC1: onUninit (an app restart) stops everything, and the restarted device polls again', async () => {
    await withScenario({}, async ({
      world, clock, toon, addDevice,
    }) => {
      await addDevice();
      await clock.tick(5000);
      await world.restartApp();
      toon().recorder.reset();
      await clock.tick(3000);

      assert.equal(world.devices().length, 1);
      assert.deepEqual(toon().requests().map((entry) => entry.path), [THERMOSTAT, POWER, METERS]);
      assert.equal(clock.armed(), 1, 'one timer for one device');
    });
  });
});

describe('NFR-15: the only way out is the fetch that the driver hands over', () => {
  test('the driver is the only place that gives the device the network, and its client is the one the Toon mock sees', async () => {
    await withScenario({}, async ({
      world, clock, toon, addDevice,
    }) => {
      await addDevice();
      await clock.tick(2000);

      assert.equal(typeof world.driver('open-toon').createClient, 'function');
      assert.ok(toon().requests().every((entry) => entry.headers.connection === 'close' && entry.headers['accept-encoding'] === 'identity'));
    });
  });
});
