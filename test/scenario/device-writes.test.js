'use strict';

/*
 * L2 scenarios for everything that changes something on the Toon: the target temperature (capability), the
 * temperature state (capability, later the Flow cards), the program, and the refreshes that go with them. The
 * Toon decides what is true: nothing is written to a capability before the Toon confirmed it.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { createScenario } = require('../helpers/scenario');

const THERMOSTAT = '/happ_thermstat';
const POWER = '/happ_pwrusage';
const METERS = '/hdrv_zwave';
const VACATION_TEXT = 'Vacation mode can only be set on the Toon itself.';

async function withScenario(options, body) {
  const scenario = createScenario(options);
  await scenario.start();
  try {
    return await body(scenario);
  } finally {
    scenario.stop();
  }
}

const writes = (toon) => toon.requests().filter((entry) => entry.query.action === 'setSetpoint' || entry.query.action === 'changeSchemeState');
const actions = (toon) => toon.requests().map((entry) => entry.query.action);
const valueWrites = (world, id) => world.callsOf('setCapabilityValue').filter((call) => call.args[0] === id).map((call) => call.args[1]);

/** A running device with its first values in place. */
async function running(scenario, spec) {
  const device = await scenario.addDevice(spec);
  await scenario.clock.tick(5000);
  scenario.toon().recorder.reset();
  return device;
}

describe('FR-11: the target temperature', () => {
  test('AC1: 21.5 sends exactly one request with an integer Setpoint of 2150, and the value is stored once the Toon confirmed', async () => {
    await withScenario({}, async (scenario) => {
      const device = await running(scenario);
      await device.simulateCapabilitySet('target_temperature', 21.5);

      assert.deepEqual(writes(scenario.toon()).map((entry) => entry.query), [{ action: 'setSetpoint', Setpoint: '2150' }]);
      assert.match(writes(scenario.toon())[0].query.Setpoint, /^\d+$/);
      assert.equal(device.getCapabilityValue('target_temperature'), 21.5);
    });
  });

  test('AC1: a half degree and a rounded value never carry floating-point dust', async () => {
    await withScenario({}, async (scenario) => {
      const device = await running(scenario);
      for (const degrees of [19, 19.5, 6, 30, 22.5]) await device.simulateCapabilitySet('target_temperature', degrees);

      assert.deepEqual(writes(scenario.toon()).map((entry) => entry.query.Setpoint), ['1900', '1950', '600', '3000', '2250']);
    });
  });

  test('AC2: a value outside 6..30 is refused with a localized message and no request is sent', async () => {
    await withScenario({}, async (scenario) => {
      const device = await running(scenario);

      for (const degrees of [30.5, 5.5, 100]) {
        await assert.rejects(device.simulateCapabilitySet('target_temperature', degrees), /not valid/);
      }
      assert.deepEqual(writes(scenario.toon()), []);
      assert.equal(device.getCapabilityValue('target_temperature'), 18.5);
    });
  });

  test('AC3 / NFR-08 AC2: a failing write rejects with localized text within 6 s, no value is written to the tile, and the next read shows the Toon\'s own value', async () => {
    await withScenario({}, async (scenario) => {
      const { world, clock } = scenario;
      const device = await running(scenario);
      const before = valueWrites(world, 'target_temperature');

      scenario.toon().fault('500', { path: THERMOSTAT, times: 1 });
      await assert.rejects(device.simulateCapabilitySet('target_temperature', 23), /The Toon answered with an error \(code 500\)/);
      assert.equal(device.getCapabilityValue('target_temperature'), 18.5, 'the tile did not move');
      assert.deepEqual(valueWrites(world, 'target_temperature'), before, 'nothing was written, so no change event can have fired');
      await clock.tick(0); // the read that follows a failed write
      assert.equal(device.getCapabilityValue('target_temperature'), 18.5, 'and the Toon\'s answer equals it');
      assert.deepEqual(actions(scenario.toon()), ['setSetpoint', 'getThermostatInfo']);

      const started = clock.now();
      scenario.toon().fault('timeout', { path: THERMOSTAT, times: 1 });
      const pending = assert.rejects(device.simulateCapabilitySet('target_temperature', 24), /did not answer in time/);
      await clock.tick(6000);
      await pending;
      assert.ok(clock.now() - started <= 6000);
    });
  });

  test('R-04: no value is written to the tile before the Toon confirmed, however long that takes', async () => {
    await withScenario({}, async (scenario) => {
      const { world, clock, toon } = scenario;
      const device = await running(scenario);
      toon().latencyMs = 2000;
      const pending = device.simulateCapabilitySet('target_temperature', 22);
      await clock.tick(1000);

      assert.deepEqual(valueWrites(world, 'target_temperature'), [18.5]);
      assert.equal(device.getCapabilityValue('target_temperature'), 18.5, 'still the Toon\'s value');
      await clock.tick(1000);
      await pending;
      assert.equal(device.getCapabilityValue('target_temperature'), 22);
      await clock.tick(5000);
      assert.deepEqual(valueWrites(world, 'target_temperature'), [18.5], 'and the app never wrote 22 itself: the Toon agrees');
    });
  });

  test('FR-16 AC1: a slider drag of 20 steps sends at most two requests and the last value wins', async () => {
    await withScenario({}, async (scenario) => {
      const device = await running(scenario);
      const steps = Array.from({ length: 20 }, (unused, index) => 18 + index * 0.5);
      await Promise.all(steps.map((degrees) => device.simulateCapabilitySet('target_temperature', degrees)));

      const sent = writes(scenario.toon());
      assert.ok(sent.length <= 2, `${sent.length} requests`);
      assert.equal(sent[sent.length - 1].query.Setpoint, '2750');
      assert.equal(device.getCapabilityValue('target_temperature'), 27.5);
      assert.equal(scenario.toon().state.thermostat.currentSetpoint, '2750');
    });
  });

  test('FR-16 AC1: the same drag on a Toon that takes 400 ms to answer: ten values within 100 ms are two requests', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, toon } = scenario;
      const device = await running(scenario);
      toon().latencyMs = 400;
      const settled = [];
      for (let step = 0; step < 10; step++) {
        settled.push(device.simulateCapabilitySet('target_temperature', 20 + step * 0.5));
        await clock.tick(10);
      }
      await clock.tick(1000);
      await Promise.all(settled);

      assert.deepEqual(writes(toon()).map((entry) => entry.query.Setpoint), ['2000', '2450']);
    });
  });

  test('FR-16 AC2: after a successful write the thermostat is read again within 3 s and the tile shows what the Toon says', async () => {
    await withScenario({}, async (scenario) => {
      const { world, clock, toon } = scenario;
      const device = await running(scenario);
      await device.simulateCapabilitySet('target_temperature', 22);
      toon().state.thermostat.currentSetpoint = '2100'; // the Toon limited the value on its own
      await clock.tick(2999);

      assert.deepEqual(actions(toon()), ['setSetpoint', 'getThermostatInfo']);
      assert.equal(device.getCapabilityValue('target_temperature'), 21);
      assert.deepEqual(valueWrites(world, 'target_temperature'), [18.5, 21]);
    });
  });
});

describe('FR-13 / FR-14: the temperature state and the program', () => {
  test('FR-13 AC1/AC2/AC3: the two settings of resume_program send different requests, the tile behaves like yes, and the state follows the confirming read', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, toon } = scenario;
      const device = await running(scenario);

      await device.setTemperatureState('sleep', 'yes');
      await device.setTemperatureState('sleep', 'no');
      await device.setTemperatureState('sleep');
      await device.simulateCapabilitySet('temperature_state', 'away');
      await clock.tick(2000);

      assert.deepEqual(writes(toon()).map((entry) => entry.query), [
        { action: 'changeSchemeState', state: '2', temperatureState: '2' },
        { action: 'changeSchemeState', state: '0', temperatureState: '2' },
        { action: 'changeSchemeState', state: '2', temperatureState: '2' },
        { action: 'changeSchemeState', state: '2', temperatureState: '3' },
      ]);
      assert.equal(device.getCapabilityValue('temperature_state'), 'away');
      assert.equal(device.getCapabilityValue('target_temperature'), 15, 'the preset of away');
    });
  });

  test('FR-13 AC4: a Toon that refuses rejects with localized text and the state does not move; so does a state that is not writable', async () => {
    await withScenario({}, async (scenario) => {
      const { world } = scenario;
      world.autoFireCustomTriggers = true;
      const device = await running(scenario);
      const events = world.triggerCalls.length;
      scenario.toon().fault('result-error', { path: THERMOSTAT, times: 1 });

      await assert.rejects(device.simulateCapabilitySet('temperature_state', 'away'), /The Toon refused the request/);
      await scenario.clock.tick(5000);
      assert.equal(device.getCapabilityValue('temperature_state'), 'home', 'also after the read that follows: the Toon did not change');
      assert.equal(world.triggerCalls.length, events, 'no change event for a write that failed');
      scenario.toon().recorder.reset();
      await assert.rejects(device.simulateCapabilitySet('temperature_state', 'none'), /not valid/);
      assert.deepEqual(writes(scenario.toon()), []);
    });
  });

  test('FR-14 AC1: enabling and disabling the program is one request each and resolves after the Toon answered', async () => {
    await withScenario({}, async (scenario) => {
      const device = await running(scenario);
      await device.programOn();
      await device.programOff();

      assert.deepEqual(writes(scenario.toon()).map((entry) => entry.query), [
        { action: 'changeSchemeState', state: '1' },
        { action: 'changeSchemeState', state: '0' },
      ]);
    });
  });

  test('FR-14 AC2: with the Toon unreachable the program actions reject within 6 s with a localized error', async () => {
    await withScenario({}, async (scenario) => {
      const { clock } = scenario;
      const device = await running(scenario);
      scenario.toon().fault('timeout');
      const started = clock.now();
      const outcomes = [assert.rejects(device.programOn(), /did not answer in time/), assert.rejects(device.programOff(), /did not answer in time/)];
      await clock.tick(11000);
      await Promise.all(outcomes);

      assert.ok(clock.now() - started <= 11000, 'two writes in a row: each within its own 5 s');
    });
  });

  test('FR-12 AC1 [fixes BD-4]: a Toon in holiday mode shows vacation, and undefined is never written', async () => {
    await withScenario({ toons: { '192.168.1.50': { vacation: true } } }, async (scenario) => {
      const { world, clock } = scenario;
      const device = await scenario.addDevice();
      await clock.tick(5000);

      assert.equal(device.getCapabilityValue('temperature_state'), 'vacation');
      assert.equal(world.callsOf('setCapabilityValue').some((call) => call.args[1] === undefined || call.args[1] === null), false);
      assert.deepEqual(scenario.deviceLog('error'), []);
    });
  });

  test('FR-12 [fixes BD-4]: the same for every code the Toon can send, and an unknown one keeps the old value with one log line', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, toon } = scenario;
      const device = await scenario.addDevice();
      const seen = [];
      for (const [code, expected] of [['0', 'comfort'], ['1', 'home'], ['2', 'sleep'], ['3', 'away'], ['4', 'vacation'], ['-1', 'none']]) {
        toon().state.thermostat.activeState = code;
        await clock.tick(30000);
        seen.push(device.getCapabilityValue('temperature_state'));
        assert.equal(seen[seen.length - 1], expected, code);
      }
      toon().state.thermostat.activeState = '7';
      await clock.tick(30000 * 3);

      assert.equal(device.getCapabilityValue('temperature_state'), 'none', 'the previous value stays');
      assert.equal(scenario.deviceLog().filter((line) => line.includes('activeState')).length, 1);
    });
  });

  test('ADR-0014: selecting vacation on the tile rejects with the read-only text in both languages and sends nothing', async () => {
    await withScenario({}, async (scenario) => {
      const { world } = scenario;
      const device = await running(scenario);

      await assert.rejects(device.simulateCapabilitySet('temperature_state', 'vacation'), { message: VACATION_TEXT });
      assert.deepEqual(scenario.toon().requests(), []);
      assert.equal(device.getCapabilityValue('temperature_state'), 'home');
      world.setLanguage('nl');
      await assert.rejects(device.setTemperatureState('vacation'), { message: 'De vakantiestand kan alleen op de Toon zelf worden ingesteld.' });
      assert.deepEqual(scenario.toon().requests(), []);
    });
  });
});

describe('NFR-08 AC2: one request at a time, writes first, nobody waits longer than the request in flight', () => {
  // NFR-03 AC1: server-side overlap, measured by the mock and not by the client
  test('a write during a slow poll waits for it, goes before the rest of the cycle, and settles within 6 s', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, toon } = scenario;
      toon().latencyMs = 2000;
      const device = await scenario.addDevice();
      await clock.tick(2500); // the poll of the thermostat is in flight until 4000
      const asked = clock.now();
      const pending = device.simulateCapabilitySet('target_temperature', 22);
      await clock.tick(0);
      assert.equal(writes(toon()).length, 0, 'not started while the poll request is in flight');
      await clock.tick(1500);
      await clock.tick(2000);
      await pending;

      assert.ok(clock.now() - asked <= 6000, 'settled in time');
      assert.equal(toon().maxConcurrent(), 1, 'the Toon never saw two requests at once');
      const request = writes(toon())[0];
      assert.equal(request.start, 4000, 'started at the moment the poll request settled');
      await clock.tick(10000);
      assert.deepEqual(actions(toon()).slice(0, 3), ['getThermostatInfo', 'setSetpoint', 'GetCurrentUsage'], 'the write jumped the queue of the cycle');
      assert.ok(actions(toon()).includes('getDevices.json'), 'and the cycle went on');
      assert.equal(toon().maxConcurrent(), 1);
    });
  });

  test('under a poll request that times out the write starts when that request is given up and settles within 10 s', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, toon } = scenario;
      toon().fault('timeout', { path: THERMOSTAT, times: 1 });
      const device = await scenario.addDevice();
      await clock.tick(2500);
      const asked = clock.now();
      const pending = device.simulateCapabilitySet('target_temperature', 22);
      await clock.tick(4500);
      await pending;

      assert.ok(clock.now() - asked <= 10000);
      const [poll, write] = [toon().requests()[0], writes(toon())[0]];
      assert.equal(poll.abortedByClient, true);
      assert.equal(write.start, poll.start + 5000, 'when the 5 s timeout gave the request up');
    });
  });

  test('an address change while a write is in flight rejects the write with the localized aborted text, and the next request goes to the new host', async () => {
    await withScenario({ toons: { '192.168.1.50': {}, '192.168.1.51': {} } }, async (scenario) => {
      const { clock } = scenario;
      const [old, next] = [scenario.toon('192.168.1.50'), scenario.toon('192.168.1.51')];
      const device = await running(scenario);
      old.fault('timeout', { path: THERMOSTAT, times: 1 });
      const refused = assert.rejects(device.simulateCapabilitySet('target_temperature', 22), { message: 'The request was cancelled because the device was removed or its address changed.' });
      await clock.tick(1000);
      assert.equal(writes(old).length, 1, 'the write is in flight');

      await device.simulateSettingsSave({ address: '192.168.1.51' });
      await refused;
      assert.equal(old.requests().at(-1).abortedByClient, true);
      await clock.tick(60e3);
      assert.equal(writes(old).length, 1, 'the old host is not asked again');
      assert.equal(writes(next).length, 0, 'and the cancelled write is not repeated on the new one');
      assert.ok(next.requests().length >= 3, 'the cycle goes on with the new host');
      assert.equal(device.getCapabilityValue('target_temperature'), 18.5);
    });
  });

  test('ten refreshes at once are one request per group, and a refresh of one group is one request', async () => {
    await withScenario({}, async (scenario) => {
      const { toon } = scenario;
      const device = await running(scenario);
      const outcomes = await Promise.all(Array.from({ length: 10 }, () => device.refresh()));
      assert.deepEqual(toon().requests().map((entry) => entry.path), [THERMOSTAT, POWER, METERS]);
      outcomes.forEach((outcome) => assert.deepEqual(outcome, { thermostat: null, power: null, meters: null }));

      toon().recorder.reset();
      await Promise.all(Array.from({ length: 10 }, () => device.refresh(['power'])));
      assert.deepEqual(toon().requests().map((entry) => entry.path), [POWER]);
    });
  });

  test('a refresh reports which group failed instead of throwing, and a refresh of a group that is not on is ignored', async () => {
    await withScenario({}, async (scenario) => {
      const device = await running(scenario);
      scenario.toon().fault('500', { path: METERS });
      const outcome = await device.refresh(['power', 'meters', 'water']);

      assert.deepEqual(Object.keys(outcome), ['power', 'meters']);
      assert.equal(outcome.power, null);
      assert.equal(outcome.meters.kind, 'http');
      assert.equal(outcome.meters.status, 500);
    });
  });

  test('R-15 / FR-16: a write every 2 s for 5 minutes does not starve power and meters; the device still goes unavailable when the Toon goes away mid-storm', async () => {
    await withScenario({}, async (scenario) => {
      const { world, clock, toon } = scenario;
      toon().latencyMs = 200;
      const device = await running(scenario);
      let degrees = 18;
      const sent = [];
      const storm = async (seconds) => {
        for (let second = 0; second < seconds; second += 2) {
          degrees = degrees >= 24 ? 18 : degrees + 0.5;
          sent.push(device.simulateCapabilitySet('target_temperature', degrees).catch(() => {}));
          await clock.tick(2000);
        }
      };
      await storm(300);

      [POWER, METERS].forEach((path) => {
        const entries = toon().requestsTo(path);
        assert.ok(entries.length >= 9, `${path}: ${entries.length} requests`);
        assert.ok(Math.max(...entries.slice(1).map((entry, index) => entry.start - entries[index].start)) <= 60000, `${path} is refreshed at least every 2 intervals`);
      });
      assert.equal(device.getAvailable(), true);
      assert.equal(toon().maxConcurrent(), 1);

      toon().fault('refused');
      await storm(300);
      await Promise.all(sent);
      assert.equal(device.getAvailable(), false, 'the cycles still count while the writes pile up');
      assert.equal(world.callsOf('setUnavailable').length, 1);
    });
  });
});
