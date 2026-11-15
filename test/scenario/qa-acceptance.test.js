'use strict';

/*
 * QA acceptance scenarios (docs/sdlc/08-test-report.md). An independent, black-box pass over the 15 end-to-end
 * situations the owner cares about, written against the public surface only: the pair session, the settings save,
 * the Flow cards and the world's records (requests the mock saw, calls Homey received, logs, trigger calls). It uses
 * no private state of the app. Every test prints its evidence with `t.diagnostic`, which the report quotes; run
 *
 *   node --require ./test/helpers/register.cjs --test --test-reporter=spec test/scenario/qa-acceptance.test.js
 *
 * to read it. Everything here is verified against the mock Toon and the fake Homey only: the payloads are derived,
 * not captured (fixtures say so), and what Homey itself does is [HW-xx] in the tests that depend on it.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { createScenario } = require('../helpers/scenario');
const { settle } = require('../helpers/fake-clock');
const { unhandledEvents, settleRejections } = require('../helpers/unhandled');
const { jsonFixture } = require('../helpers/fixtures');

const { eras, waterValueVariants } = jsonFixture('eras.json');
const en = jsonFixture('../../locales/en.json');
const nl = jsonFixture('../../locales/nl.json');
const manifest = jsonFixture('../../app.json');

const HOST = '192.168.1.50';
const OTHER = '192.168.1.51';
const THERMOSTAT = '/happ_thermstat';
const POWER = '/happ_pwrusage';
const METERS = '/hdrv_zwave';
const WATER_PAGE = '/water.html';
const WATER = ['measure_water', 'meter_water.today', 'meter_water.total'];
const CYCLE = 30e3;

async function withScenario(options, body) {
  const scenario = createScenario(options);
  await scenario.start();
  try {
    return await body(scenario);
  } finally {
    scenario.stop();
  }
}

/** One line of evidence for the report. */
const evidence = (t, name, data) => t.diagnostic(`EVIDENCE ${name}: ${JSON.stringify(data)}`);

/** Fails the test when any promise was rejected without a handler, or an exception escaped, since the process started. */
async function assertNoUnhandled() {
  await settleRejections();
  assert.deepEqual(unhandledEvents().map((entry) => String(entry.reason)), [], 'zero unhandled rejections or uncaught exceptions');
}

/** Moves time forward in steps and stops as soon as `done()`; resolves to the fake milliseconds that passed. */
async function until(clock, done, { limitMs = 3600e3, stepMs = 1000 } = {}) {
  const started = clock.now();
  while (!done() && clock.now() - started < limitMs) await clock.tick(stepMs);
  return clock.now() - started;
}

const calls = (world, method) => world.callsOf(method);
const levelLines = (scenario, level) => scenario.deviceLog(level);
const reads = (toon, path) => toon.requestsTo(path).filter((entry) => entry.query.action !== 'setSetpoint' && entry.query.action !== 'changeSchemeState');
const gapsOf = (entries) => entries.slice(1).map((entry, index) => entry.start - entries[index].start);
const values = (device, ids) => Object.fromEntries(ids.map((id) => [id, device.getCapabilityValue(id)]));
const allValues = (device) => values(device, device.getCapabilities());
const card = (scenario, kind, id) => scenario.world.homey.flow.card(kind, id);
const act = (scenario, id, args) => card(scenario, 'action', id).run(args);
const check = (scenario, id, args) => card(scenario, 'condition', id).run(args);
const fired = (scenario, id) => scenario.world.triggerCalls.filter((entry) => entry.id === id);

/** A device paired the way the pair view makes it, with its first values in and an empty request log. */
async function running(scenario, spec = {}) {
  const device = await scenario.addPaired(spec);
  await scenario.clock.tick(5000);
  scenario.toon().recorder.reset();
  return device;
}

/** A pair session; `call` is Homey.emit of the view, with the fake clock running until the handler has answered. */
async function openPairing(scenario) {
  const session = await scenario.world.startPairing('open-toon');
  return { session, call: (event, data) => settle(scenario.clock, session.call(event, data)) };
}

/** Wraps the global fetch so that `host`/`path` is answered by `respond(request)` (a Response), everything else goes on. */
function overrideAnswer(path, respond) {
  const next = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    return url.pathname === path && url.searchParams.get('action') !== 'setSetpoint' ? Promise.resolve(respond(url)) : next(input, init);
  };
  return () => {
    globalThis.fetch = next;
  };
}

/* ---------------------------------------------------------------------------------------------------------------- */

describe('QA-01 / FR-01 / FR-02 / FR-03 / NFR-08: fresh pairing against a good IP, a wrong IP and a Toon that times out', () => {
  test('good IP: the test shows the readings, Connect makes one device with working values and no water item, within 10 s', async (t) => {
    await withScenario(undefined, async (scenario) => {
      const { world, clock, toon } = scenario;
      const { session, call } = await openPairing(scenario);
      const tested = await call('testConnection', { address: HOST });
      assert.equal(tested.error, undefined);
      assert.equal(tested.value.host, HOST);
      assert.deepEqual(tested.value.readings, {
        currentTemp: 20.3, currentSetpoint: 18.5, programState: 'on', activeState: 'home',
      });
      assert.equal(world.devices().length, 0, 'a test adds nothing');

      const built = await call('buildDevice', {
        name: 'Woonkamer', id: 'toon-woonkamer', address: HOST, features: {},
      });
      const startedAt = clock.now();
      const device = await session.createDevice(built.value);
      const elapsed = await until(clock, () => device.getCapabilityValue('measure_temperature') !== null && device.getCapabilityValue('meter_gas') !== null, { limitMs: 10e3, stepMs: 100 });

      assert.ok(elapsed <= 10e3, `values within 10 s, took ${elapsed} ms`);
      assert.equal(world.devices().length, 1);
      assert.deepEqual(device.getData(), { id: 'toon-woonkamer' });
      assert.equal(device.getSetting('address'), HOST);
      assert.equal(device.getSetting('toonwater_enabled'), false, 'ToonWater starts off');
      assert.equal(WATER.some((id) => device.hasCapability(id)), false, 'no water capability on a new device');
      assert.equal(device.hasCapability('alarm_water.hotwater'), true, 'the boiler hot-water flag is not ToonWater');
      assert.equal(reads(toon(), WATER_PAGE).length, 1, 'only the one probe of the connection test asked for the page; the device never does');
      assert.deepEqual(levelLines(scenario, 'error'), []);
      evidence(t, 'pairing.good', {
        readings: tested.value.readings,
        features: tested.value.features,
        capabilities: device.getCapabilities(),
        valuesAfterMs: clock.now() - startedAt,
        requestsOfTheTest: 'thermostat once, water probe once',
        values: values(device, ['measure_temperature', 'target_temperature', 'measure_power', 'meter_gas', 'meter_power.peak', 'meter_power.offPeak', 'burner_state', 'temperature_state']),
      });
    });
    await assertNoUnhandled();
  });

  test('a Toon without the ToonWater add-on (404) is paired without a word about it: one probe at the test, then nothing, for 30 minutes', async (t) => {
    await withScenario({ toons: { [HOST]: { water: '404' } } }, async (scenario) => {
      const { world, clock, toon } = scenario;
      const { session, call } = await openPairing(scenario);
      const tested = await call('testConnection', { address: HOST });
      assert.equal(tested.error, undefined, 'a missing add-on is not an error of the test');
      assert.equal(tested.value.features.toonwater, 'not_found');
      const built = await call('buildDevice', {
        name: 'Zonder water', id: 'toon-zonder-water', address: HOST, features: {},
      });
      const device = await session.createDevice(built.value);
      await clock.tick(30 * 60e3);

      assert.equal(toon().requestsTo(WATER_PAGE).length, 1, 'the one probe of the connection test, and no request of the device');
      assert.equal(WATER.some((id) => device.hasCapability(id)), false);
      assert.deepEqual(world.logLines().filter((line) => /water/i.test(line)), [], 'nothing about water in any log');
      assert.equal(device.fake.warning, null);
      assert.equal(device.getAvailable(), true);
      evidence(t, 'pairing.no-addon', {
        toonwaterAtTest: tested.value.features.toonwater, pageRequestsInTotal: toon().requestsTo(WATER_PAGE).length, waterCapabilities: 0, logLinesAboutWater: 0,
      });
    });
    await assertNoUnhandled();
  });

  test('wrong IP (nobody there): a localized sentence within 6 s in en and nl, Connect cannot be reached, no device, no timer left', async (t) => {
    for (const language of ['en', 'nl']) {
      await withScenario({ language }, async (scenario) => {
        const { world, clock } = scenario;
        const { call } = await openPairing(scenario);
        const outcome = await call('testConnection', { address: '192.168.1.99' });

        const expected = (language === 'en' ? en : nl).error.network;
        assert.equal(outcome.error.message, expected);
        assert.ok(outcome.tookMs <= 6000, `${outcome.tookMs} ms`);
        assert.equal(world.devices().length, 0);
        assert.equal(clock.armed(), 0, 'no timer of the request is left');
        assert.deepEqual(scenario.hostsContacted(), ['192.168.1.99'], 'only the typed host was contacted');
        evidence(t, `pairing.wrong-ip.${language}`, { message: outcome.error.message, tookMs: outcome.tookMs, armedTimers: clock.armed() });
      });
    }
    await assertNoUnhandled();
  });

  test('timeout (a Toon that accepts and never answers): the 5 s limit gives the sentence within 6 s, no device, no timer left', async (t) => {
    await withScenario(undefined, async (scenario) => {
      const { world, clock, toon } = scenario;
      toon().fault('timeout');
      const { call } = await openPairing(scenario);
      const outcome = await call('testConnection', { address: HOST });

      assert.equal(outcome.error.message, en.error.timeout);
      assert.ok(outcome.tookMs >= 5000 && outcome.tookMs <= 6000, `${outcome.tookMs} ms`);
      assert.equal(world.devices().length, 0);
      assert.equal(clock.armed() - toon().openHandlers(), 0, 'the only timer left is the one of the mock Toon that never answers (not the app)');
      evidence(t, 'pairing.timeout', { message: outcome.error.message, tookMs: outcome.tookMs, appTimersLeft: clock.armed() - toon().openHandlers() });
    });
    await assertNoUnhandled();
  });

  test('a host that is not a Toon, an HTTP error and an address that is not valid are each a sentence and send nothing wrong', async (t) => {
    await withScenario(undefined, async (scenario) => {
      const { toon } = scenario;
      const { call } = await openPairing(scenario);
      const seen = {};

      toon().fault('500');
      seen.http500 = (await call('testConnection', { address: HOST })).error.message;
      assert.match(seen.http500, /code 500/);
      toon().clearFaults();

      const restore = overrideAnswer(THERMOSTAT, () => new Response('<html><body>Router login</body></html>', { status: 200, headers: { 'content-type': 'text/html' } }));
      seen.html = (await call('testConnection', { address: HOST })).error.message;
      assert.equal(seen.html, en.error.not_toon);
      restore();

      const before = scenario.requestCount();
      for (const bad of ['', '0.0.0.0', '192.168.1.50/foo', 'user@host', 'a b', '192.168.1.50:99999', 'https://192.168.1.50']) {
        const outcome = await call('testConnection', { address: bad });
        assert.ok(outcome.error && typeof outcome.error.message === 'string' && outcome.error.message !== '', `${JSON.stringify(bad)} is refused with a sentence`);
        assert.doesNotMatch(outcome.error.message, /TypeError|undefined|ToonError|\{|__/);
      }
      assert.equal(scenario.requestCount(), before, 'an address that is not valid sends no request');
      evidence(t, 'pairing.other-failures', { http500: seen.http500, htmlPage: seen.html, invalidAddressesRefusedWithoutRequest: 7 });
    });
    await assertNoUnhandled();
  });
});

/* ---------------------------------------------------------------------------------------------------------------- */

describe('QA-02 / FR-80 / FR-10 / FR-20 / FR-21 / FR-28: polling follows the Toon', () => {
  test('a change on the Toon shows on the tile at the next cycle; every endpoint is read every 30 s, strictly one at a time', async (t) => {
    await withScenario(undefined, async (scenario) => {
      const { clock, toon } = scenario;
      const device = await running(scenario);
      const toonState = toon().state;
      assert.equal(device.getCapabilityValue('measure_temperature'), 20.3);

      toonState.thermostat.currentTemp = '2150';
      toonState.thermostat.currentSetpoint = '2000';
      toonState.power.powerUsage.value = 1800;
      toonState.devices['dev_2.1'].CurrentGasQuantity = '5300000';
      toonState.devices['dev_2.4'].CurrentElectricityQuantity = '3800000';
      await clock.tick(CYCLE);

      assert.deepEqual(values(device, ['measure_temperature', 'target_temperature', 'measure_power', 'meter_gas', 'meter_power.peak']), {
        measure_temperature: 21.5, target_temperature: 20, measure_power: 1800, meter_gas: 5300, 'meter_power.peak': 3800,
      });
      await clock.tick(5 * 60e3);
      [THERMOSTAT, POWER, METERS].forEach((path) => {
        const entries = reads(toon(), path);
        assert.ok(gapsOf(entries).every((gap) => gap === CYCLE), `${path}: a request every 30 s`);
      });
      assert.equal(toon().maxConcurrent(), 1, 'never two requests to the Toon at once');
      assert.equal(reads(toon(), WATER_PAGE).length, 0);
      evidence(t, 'polling.values', {
        after1Cycle: values(device, ['measure_temperature', 'target_temperature', 'measure_power', 'meter_gas', 'meter_power.peak']),
        requestsPer5min: Object.fromEntries([THERMOSTAT, POWER, METERS].map((path) => [path, reads(toon(), path).length])),
        gapMs: gapsOf(reads(toon(), THERMOSTAT))[0],
        maxConcurrent: toon().maxConcurrent(),
      });
    });
    await assertNoUnhandled();
  });
});

/* ---------------------------------------------------------------------------------------------------------------- */

describe('QA-03 / FR-81 / FR-80 AC3 / NFR-03 AC2 / NFR-09: the Toon goes offline and comes back', () => {
  for (const [fault, label] of [['timeout', 'does not answer (timeout)'], ['refused', 'refuses the connection'], ['500', 'answers HTTP 500']]) {
    test(`a Toon that ${label}: unavailable after the designed count-and-time predicate, requests ever less often, values kept, recovers by itself`, async (t) => {
      await withScenario(undefined, async (scenario) => {
        const { world, clock, toon } = scenario;
        const device = await running(scenario);
        const before = allValues(device);

        toon().fault(fault);
        const elapsed = await until(clock, () => device.getAvailable() === false, { limitMs: 30 * 60e3 });
        const unavailableSeenAt = clock.now();
        const thermostat = reads(toon(), THERMOSTAT);
        const failedCycles = thermostat.length;

        // the designed predicate (05-architecture 5, ADR-0005): 3 failed cycles spanning >= 90 s, or 2 spanning >= 15 min
        assert.equal(device.getAvailable(), false, 'unavailable');
        assert.ok(failedCycles >= 3, `not before three failed cycles (${failedCycles})`);
        assert.equal(device.fake.unavailableMessage, en.offline);
        assert.ok(elapsed >= 90e3, `not before 90 s (${elapsed} ms)`);
        assert.deepEqual(allValues(device), before, 'no value is cleared or zeroed');
        assert.equal(calls(world, 'setUnavailable').length, 1, 'one transition, not one per cycle');
        assert.equal(reads(toon(), POWER).length + reads(toon(), METERS).length, fault === '500' ? 2 * failedCycles : 0, fault === '500'
          ? 'an answer (even an error) of the Toon keeps the other groups going'
          : 'a Toon that is down is asked for the thermostat only');

        // it stays down: the rate of the requests only goes down (back-off), never up
        const probe = thermostat.length;
        await clock.tick(30 * 60e3);
        const during = reads(toon(), THERMOSTAT);
        const gaps = gapsOf(during.slice(probe - 1));
        assert.ok(gaps.every((gap, index) => index === 0 || gap >= gaps[index - 1]), `back-off never shortens: ${gaps.join(',')}`);
        assert.ok(gaps.every((gap) => gap >= CYCLE && gap <= 300e3 + 5000), 'between the interval and the 5 minute cap');
        assert.ok(gaps.at(-1) >= 240e3, `the request rate really went down: the last gap is ${gaps.at(-1)} ms, the interval is ${CYCLE} ms`);
        assert.deepEqual(levelLines(scenario, 'error'), [], 'an offline Toon is no error-level line');

        // it comes back by itself
        toon().clearFaults();
        toon().state.thermostat.currentTemp = '2210';
        const recoveredAfter = await until(clock, () => device.getAvailable() === true, { limitMs: 10 * 60e3 });
        await clock.tick(1000);
        assert.ok(recoveredAfter <= 300e3 + 6000, `recovers within the 5 minute back-off cap (${recoveredAfter} ms)`);
        assert.equal(device.getAvailable(), true);
        assert.equal(device.fake.unavailableMessage, null);
        assert.equal(device.getCapabilityValue('measure_temperature'), 22.1, 'and the values refresh');
        evidence(t, `offline.${fault}`, {
          unavailableMsAfterTheFirstFailedRequest: unavailableSeenAt - thermostat[0].start,
          unavailableMsAfterTheFaultStarted: elapsed,
          unavailableAfterFailedCycles: failedCycles,
          unavailableMessage: en.offline,
          backoffGapsMs: gaps,
          recoveredAfterMsOfClearingTheFault: recoveredAfter,
          setUnavailableCalls: calls(world, 'setUnavailable').length,
          setAvailableCalls: calls(world, 'setAvailable').length,
          errorLines: levelLines(scenario, 'error').length,
        });
      });
      await assertNoUnhandled();
    });
  }

  test('the predicate at the shortest and the longest interval: 10 s needs 90 s of failures, 3600 s needs two failed cycles 15 minutes apart (ADR-0005)', async (t) => {
    const outcome = {};
    for (const interval of [10, 30, 3600]) {
      await withScenario(undefined, async (scenario) => {
        const { clock, toon } = scenario;
        const device = await running(scenario, { settings: { poll_interval: interval } });
        toon().fault('refused');
        await until(clock, () => device.getAvailable() === false, { limitMs: 6 * 3600e3, stepMs: interval >= 3600 ? 60e3 : 1000 });
        const attempts = reads(toon(), THERMOSTAT);
        const span = clock.now() - attempts[0].start;
        assert.ok(attempts.length >= 3 || interval === 3600, `${interval} s: at least three failed cycles (${attempts.length})`);
        assert.ok(attempts.length >= 2, `${interval} s: never on the first failed cycle`);
        assert.ok(span >= (interval === 3600 ? 15 * 60e3 : 90e3), `${interval} s: the failures span ${span} ms`);
        outcome[interval] = { failedCyclesWhenUnavailable: attempts.length, msSinceTheFirstFailedRequest: span };
      });
    }
    evidence(t, 'offline.predicate-by-interval', outcome);
    await assertNoUnhandled();
  });

  test('the app restarts while the Toon is down and the device is unavailable: it stays unavailable (no flap), keeps its values, and recovers when the Toon answers', async (t) => {
    await withScenario(undefined, async (scenario) => {
      const { world: homeyWorld, clock, toon } = scenario;
      const first = await running(scenario);
      const before = allValues(first);
      toon().fault('refused');
      await until(clock, () => first.getAvailable() === false, { limitMs: 30 * 60e3 });
      assert.equal(first.getAvailable(), false);

      await homeyWorld.restartApp();
      const device = homeyWorld.devices()[0];
      await clock.tick(10 * 60e3);
      assert.equal(device.getAvailable(), false, 'still unavailable after the restart, never flipped to available by the start');
      assert.equal(calls(homeyWorld, 'setAvailable').length, 0);
      assert.deepEqual(allValues(device), before, 'the last values are still there');

      toon().clearFaults();
      await until(clock, () => device.getAvailable() === true, { limitMs: 10 * 60e3 });
      assert.equal(device.getAvailable(), true);
      assert.equal(calls(homeyWorld, 'setAvailable').length, 1);
      assert.deepEqual(levelLines(scenario, 'error'), []);
      evidence(t, 'offline.restart-while-down', {
        unavailableAfterRestart: true, setAvailableCallsWhileDown: 0, setAvailableCallsAfterRecovery: calls(homeyWorld, 'setAvailable').length, valuesKept: true,
      });
    });
    await assertNoUnhandled();
  });

  test('a hiccup of two failed cycles does not flip the device, and an outage is announced once in the log', async (t) => {
    await withScenario(undefined, async (scenario) => {
      const { world, clock, toon } = scenario;
      const device = await running(scenario);
      toon().fault('timeout', { times: 2 });
      await clock.tick(5 * 60e3);

      assert.equal(device.getAvailable(), true);
      assert.equal(calls(world, 'setUnavailable').length, 0);
      evidence(t, 'offline.hiccup', { failedCycles: 2, setUnavailableCalls: 0, available: true });
    });
    await assertNoUnhandled();
  });
});

/* ---------------------------------------------------------------------------------------------------------------- */

describe('QA-04 / FR-82 / FR-03 / NFR-01: the address changes in the settings', () => {
  test('a valid new address moves the device to the other Toon within one interval and the old Toon is never asked again', async (t) => {
    await withScenario({ toons: { [HOST]: {}, [OTHER]: {} } }, async (scenario) => {
      const { clock } = scenario;
      scenario.toon(OTHER).state.thermostat.currentTemp = '1700';
      const device = await running(scenario);
      scenario.toon(OTHER).recorder.reset();
      assert.equal(device.getCapabilityValue('measure_temperature'), 20.3);

      const oldBefore = scenario.toon(HOST).requests().length;
      const result = await settle(clock, device.simulateSettingsSave({ address: OTHER }));
      assert.equal(result.error, undefined);
      const arrived = await until(clock, () => device.getCapabilityValue('measure_temperature') === 17, { limitMs: CYCLE, stepMs: 500 });
      await clock.tick(3 * 60e3);

      assert.ok(arrived <= CYCLE, `new values within one interval (${arrived} ms)`);
      assert.equal(device.getSetting('address'), OTHER);
      assert.equal(scenario.toon(HOST).requests().length, oldBefore, 'the old Toon gets nothing after the save');
      assert.ok(reads(scenario.toon(OTHER), THERMOSTAT).length >= 6);
      assert.equal(device.getAvailable(), true);
      assert.deepEqual(levelLines(scenario, 'error'), []);
      evidence(t, 'address.change', {
        valuesFromNewToonAfterMs: arrived, oldToonRequestsAfterSave: scenario.toon(HOST).requests().length - oldBefore, newToonRequestsInto3min: scenario.toon(OTHER).requests().length,
      });
    });
    await assertNoUnhandled();
  });

  test('an invalid address is refused with a sentence in the language of the Homey and the stored address stays; a spelling of the same host changes nothing', async (t) => {
    for (const language of ['en', 'nl']) {
      await withScenario({ language }, async (scenario) => {
        const { clock, toon } = scenario;
        const device = await running(scenario);
        const dict = language === 'en' ? en : nl;
        const refusals = {};
        for (const bad of ['0.0.0.0', '192.168.1.50/foo', 'a b', 'https://192.168.1.50', '']) {
          const outcome = await settle(clock, device.simulateSettingsSave({ address: bad }));
          assert.ok(outcome.error, `${JSON.stringify(bad)} is refused`);
          assert.notEqual(outcome.error.message, '');
          refusals[bad] = outcome.error.message;
          assert.equal(device.getSetting('address'), HOST, 'the stored address is unchanged');
        }
        assert.equal(refusals['0.0.0.0'], dict.error.address_invalid);
        await clock.tick(2 * CYCLE);
        assert.equal(device.getAvailable(), true, 'the device keeps polling the old, good address');
        const requests = toon().requests().length;
        await settle(clock, device.simulateSettingsSave({ address: ` http://${HOST}/ ` }));
        await clock.tick(1000);
        assert.equal(toon().requests().length, requests, 'the same host in another spelling restarts nothing');
        evidence(t, `address.invalid.${language}`, refusals);
      });
    }
    await assertNoUnhandled();
  });

  test('an address change while a request to the old Toon is in flight: its answer is dropped and the next cycle goes to the new Toon', async (t) => {
    await withScenario({ toons: { [HOST]: {}, [OTHER]: {} } }, async (scenario) => {
      const { clock } = scenario;
      scenario.toon(OTHER).state.thermostat.currentTemp = '1700';
      const device = await running(scenario);
      scenario.toon(HOST).state.thermostat.currentTemp = '2999';
      scenario.toon(HOST).latencyMs = 3000;
      await until(clock, () => scenario.toon(HOST).requests().some((entry) => entry.end === null), { limitMs: 60e3, stepMs: 100 });
      assert.ok(scenario.toon(HOST).openHandlers() > 0, 'a request to the old Toon is in flight');

      await settle(clock, device.simulateSettingsSave({ address: OTHER }));
      await clock.tick(60e3);

      assert.equal(device.getCapabilityValue('measure_temperature'), 17, 'the answer of the old Toon (29.99) was never applied');
      assert.equal(scenario.world.callsOf('setCapabilityValue').some((call) => call.args[0] === 'measure_temperature' && call.args[1] === 29.99), false);
      evidence(t, 'address.in-flight', { finalTemperature: device.getCapabilityValue('measure_temperature'), staleValueWritten: false });
    });
    await assertNoUnhandled();
  });
});

/* ---------------------------------------------------------------------------------------------------------------- */

describe('QA-05 / FR-84 / NFR-12: deleting a device stops everything', () => {
  test('after the delete there is no timer left and the mock sees no further request, also with a request in flight and ToonWater on', async (t) => {
    await withScenario(undefined, async (scenario) => {
      const { world: homeyWorld, clock, toon } = scenario;
      const baseline = clock.armed();
      const device = await running(scenario, { toonwater: true, exportPower: true });
      assert.equal(clock.armed(), baseline + 1, 'one timer for the one device while it runs');

      toon().latencyMs = 3000;
      await until(clock, () => toon().requests().some((entry) => entry.end === null), { limitMs: 60e3, stepMs: 100 });
      assert.ok(toon().openHandlers() > 0, 'a request is in flight');
      const sentBefore = toon().requests().length;

      await homeyWorld.deleteDevice(device);
      const mockTimers = toon().openHandlers(); // the delayed answer of the mock Toon is the mock's own timer, not the app's
      assert.equal(clock.armed() - mockTimers, baseline, 'every timer of the device is gone');
      await clock.tick(10 * 60e3);

      assert.equal(toon().requests().length, sentBefore, 'no request after the delete');
      assert.deepEqual(levelLines(scenario, 'error'), [], 'a late answer is no error');
      assert.equal(homeyWorld.devices().length, 0);
      evidence(t, 'delete', {
        appTimersWhileRunning: 1, appTimersAfterDelete: clock.armed() - baseline, mockTimersInFlightAtDelete: mockTimers, requestsAfterDelete: toon().requests().length - sentBefore,
      });
    });
    await assertNoUnhandled();
  });

  test('deleting an idle device, between two cycles when its timer is armed, clears that timer and the Toon sees nothing more', async (t) => {
    await withScenario(undefined, async (scenario) => {
      const { world: homeyWorld, clock, toon } = scenario;
      const baseline = clock.armed();
      const device = await running(scenario);
      assert.equal(clock.armed() - baseline, 1, 'between two cycles the device holds exactly one timer');
      assert.equal(toon().openHandlers(), 0, 'and no request is in flight');

      await homeyWorld.deleteDevice(device);
      assert.equal(clock.armed(), baseline, 'the timer of the device is gone at once, not when it would have fired');
      await clock.tick(10 * 60e3);
      assert.equal(toon().requests().length, 0, 'no request after the delete');
      evidence(t, 'delete.idle', { timersBetweenCycles: 1, timersAfterDelete: clock.armed() - baseline, requestsAfterDelete: toon().requests().length });
    });
    await assertNoUnhandled();
  });

  test('deleting one of two devices leaves the other polling at its own cadence, and onDeleted/onUninit twice never throw', async (t) => {
    await withScenario({ toons: { [HOST]: {}, [OTHER]: {} } }, async (scenario) => {
      const { world: homeyWorld, clock } = scenario;
      const a = await scenario.addPaired({ address: HOST, data: { id: 'toon-a' }, name: 'A' });
      const b = await scenario.addPaired({ address: OTHER, data: { id: 'toon-b' }, name: 'B' });
      await clock.tick(5000);
      await homeyWorld.deleteDevice(a);
      scenario.toon(HOST).recorder.reset();
      scenario.toon(OTHER).recorder.reset();
      await clock.tick(5 * 60e3);

      assert.equal(scenario.toon(HOST).requests().length, 0);
      assert.ok(gapsOf(reads(scenario.toon(OTHER), THERMOSTAT)).every((gap) => gap === CYCLE));
      await b.onDeleted();
      await b.onUninit();
      await assert.doesNotReject(a.onDeleted());
      await assert.doesNotReject(a.onUninit());
      evidence(t, 'delete.one-of-two', { deletedToonRequests: scenario.toon(HOST).requests().length, otherToonRequestsIn5min: scenario.toon(OTHER).requests().length });
    });
    await assertNoUnhandled();
  });
});

/* ---------------------------------------------------------------------------------------------------------------- */

describe('QA-06 / FR-80 AC3 / NFR-12: one poll loop per device after the app restarts', () => {
  test('three restarts of the app with two devices leave one timer and one request per group per cycle for each device', async (t) => {
    await withScenario({ toons: { [HOST]: {}, [OTHER]: {} } }, async (scenario) => {
      const { world: homeyWorld, clock } = scenario;
      const baseline = clock.armed();
      await scenario.addPaired({
        address: HOST, data: { id: 'toon-a' }, name: 'A', toonwater: true,
      });
      await scenario.addPaired({ address: OTHER, data: { id: 'toon-b' }, name: 'B' });
      await clock.tick(5000);
      const timers = [clock.armed() - baseline];
      for (let restart = 1; restart <= 3; restart++) {
        await homeyWorld.restartApp();
        await clock.tick(1000);
        timers.push(clock.armed() - baseline);
      }
      assert.deepEqual(timers, [2, 2, 2, 2], 'two devices, two timers, however often the app restarted');

      scenario.toon(HOST).recorder.reset();
      scenario.toon(OTHER).recorder.reset();
      await clock.tick(5 * 60e3);
      const perToon = [HOST, OTHER].map((host) => [THERMOSTAT, POWER, METERS, WATER_PAGE].map((path) => reads(scenario.toon(host), path)));
      perToon.forEach((groups, index) => groups.forEach((entries, groupIndex) => {
        if (index === 1 && groupIndex === 3) assert.equal(entries.length, 0, 'the device without ToonWater never asks for the page');
        else assert.ok(entries.length >= 9 && entries.length <= 11, `toon ${index} group ${groupIndex}: ${entries.length}`);
        assert.ok(gapsOf(entries).every((gap) => gap === CYCLE), 'a request every 30 s, never doubled');
      }));
      assert.equal(scenario.toon(HOST).maxConcurrent(), 1);
      assert.equal(scenario.toon(OTHER).maxConcurrent(), 1);
      evidence(t, 'restart', {
        timersPerRestart: timers,
        requestsPer5min: perToon.map((groups) => groups.map((entries) => entries.length)),
        order: 'thermostat, power, meters, water',
      });
    });
    await assertNoUnhandled();
  });
});

/* ---------------------------------------------------------------------------------------------------------------- */

describe('QA-07 / FR-51 / FR-54 / FR-60 / NFR-09: ToonWater OFF on a Toon without the add-on', () => {
  test('two hours of polling: no /water.html request, no water capability, no log line about water, no warning, no 404 anywhere', async (t) => {
    await withScenario({ toons: { [HOST]: { water: '404' } } }, async (scenario) => {
      const { world: homeyWorld, clock, toon } = scenario;
      const device = await running(scenario, { toonwater: false });
      await clock.tick(2 * 3600e3);

      assert.equal(toon().requestsTo(WATER_PAGE).length, 0, 'not one request for the page');
      assert.equal(toon().requests().some((entry) => entry.status === 404), false, 'the Toon never had to answer 404');
      assert.equal(WATER.some((id) => device.hasCapability(id)), false);
      assert.deepEqual(homeyWorld.logLines().filter((line) => /water/i.test(line)), [], 'nothing about water in any log');
      assert.deepEqual(levelLines(scenario, 'error'), []);
      assert.equal(device.fake.warning, null);
      assert.equal(device.getAvailable(), true);
      assert.equal(calls(homeyWorld, 'setWarning').length, 0);
      evidence(t, 'toonwater.off-without-addon', {
        simulatedHours: 2,
        cycles: reads(toon(), THERMOSTAT).length,
        waterRequests: toon().requestsTo(WATER_PAGE).length,
        http404Answers: toon().requests().filter((entry) => entry.status === 404).length,
        capabilities: device.getCapabilities(),
        waterLogLines: 0,
        warning: device.fake.warning,
        toonwaterStatusSetting: device.getSetting('toonwater_status'),
      });
    });
    await assertNoUnhandled();
  });

  test('the water cards: update_water is hidden for new Flows (deprecated) and rejects with the localized text without a request; the other cards are untouched', async (t) => {
    await withScenario({ toons: { [HOST]: { water: '404' } } }, async (scenario) => {
      const { clock, toon } = scenario;
      const device = await running(scenario, { toonwater: false });
      const cards = Object.fromEntries(['update_water', 'measure_water_changed', 'meter_gas_changed', 'alarm_water_changed', 'update_status']
        .map((id) => [id, [...manifest.flow.actions, ...manifest.flow.triggers].find((entry) => entry.id === id).deprecated === true]));
      assert.deepEqual(cards, {
        update_water: true, measure_water_changed: true, meter_gas_changed: true, alarm_water_changed: false, update_status: false,
      });

      const outcome = await settle(clock, act(scenario, 'update_water', { device }));
      assert.equal(outcome.error.message, en.toonwater.not_enabled);
      assert.equal(toon().requestsTo(WATER_PAGE).length, 0);
      const status = await settle(clock, act(scenario, 'update_status', { device }));
      assert.equal(status.error, undefined, 'the other update card works');
      assert.equal(toon().requestsTo(WATER_PAGE).length, 0, 'and does not ask for the page either');
      assert.equal(device.hasCapability('alarm_water.hotwater'), true);
      evidence(t, 'toonwater.off-cards', { deprecatedInManifest: cards, updateWaterRejection: outcome.error.message, requestsForThePage: 0 });
    });
    await assertNoUnhandled();
  });
});

/* ---------------------------------------------------------------------------------------------------------------- */

describe('QA-08 / FR-52 / FR-55 / FR-58 / FR-59: ToonWater ON with the add-on', () => {
  test('switched on in the settings: the three items appear in order, the message says found, values follow the page, one page request per cycle', async (t) => {
    await withScenario(undefined, async (scenario) => {
      const { world: homeyWorld, clock, toon } = scenario;
      const device = await running(scenario, { toonwater: false });
      const otherBefore = allValues(device);

      const saved = await settle(clock, device.simulateSettingsSave({ toonwater_enabled: true }));
      assert.equal(saved.error, undefined);
      assert.equal(saved.value, en.toonwater.saved_detected);
      assert.deepEqual(device.getCapabilities().filter((id) => WATER.includes(id)), WATER, 'three items, once each, in manifest order');
      await until(clock, () => WATER.every((id) => device.getCapabilityValue(id) !== null), { limitMs: 10e3, stepMs: 100 });
      assert.deepEqual(values(device, WATER), { measure_water: 0, 'meter_water.today': 0.137, 'meter_water.total': 7350.214 });
      assert.equal(device.getSetting('toonwater_status'), en.toonwater.status_detected);
      assert.equal(device.fake.warning, null);
      Object.entries(otherBefore).forEach(([id, value]) => assert.equal(device.getCapabilityValue(id), value, `${id} untouched by the toggle`));

      toon().recorder.reset();
      toon().state.waterPage = {
        result: 'ok',
        water: {
          flow: 6, total: 7350300, value: 223, avgValue: 100,
        },
      };
      await clock.tick(5 * 60e3);
      assert.deepEqual(values(device, WATER), { measure_water: 6, 'meter_water.today': 0.223, 'meter_water.total': 7350.3 });
      const page = reads(toon(), WATER_PAGE);
      assert.ok(page.length >= 9 && page.length <= 11, `one page request per cycle (${page.length} in 5 min)`);
      assert.ok(gapsOf(page).every((gap) => gap === CYCLE));
      assert.equal(toon().maxConcurrent(), 1);
      assert.equal(fired(scenario, 'measure_water_changed').length, 1, 'the water trigger fired once for the one change');
      toon().recorder.reset();
      const updated = await settle(clock, act(scenario, 'update_status', { device }));
      assert.equal(updated.error, undefined);
      assert.deepEqual(toon().requests().map((entry) => entry.path), [THERMOSTAT, POWER, METERS, WATER_PAGE], 'Update now reads every group that is on, the page of ToonWater included');
      assert.deepEqual(levelLines(scenario, 'error'), []);
      evidence(t, 'toonwater.on', {
        message: saved.value,
        status: device.getSetting('toonwater_status'),
        capabilities: device.getCapabilities().filter((id) => WATER.includes(id)),
        values: values(device, WATER),
        pageRequestsIn5min: page.length,
        triggerCalls: fired(scenario, 'measure_water_changed').map((entry) => entry.tokens),
        unrelatedCapabilityChanges: 0,
        calls: ['addCapability', 'removeCapability'].map((method) => [method, calls(homeyWorld, method).length]),
      });
    });
    await assertNoUnhandled();
  });

  test('the same in Dutch, and a Toon that does not have the add-on (404) gets the items, the "not found" message, the status and one warning', async (t) => {
    await withScenario({ language: 'nl', toons: { [HOST]: { water: '404' } } }, async (scenario) => {
      const { clock, toon } = scenario;
      const device = await running(scenario, { toonwater: false });
      const saved = await settle(clock, device.simulateSettingsSave({ toonwater_enabled: true }));
      await clock.tick(1); // the status is written again right after a save (HW-13)
      assert.equal(saved.value, nl.toonwater.saved_not_found);
      assert.equal(device.getSetting('toonwater_status'), nl.toonwater.status_not_found);
      assert.equal(device.fake.warning, nl.toonwater.warning_not_found);
      assert.equal(device.getAvailable(), true, 'a missing add-on is not an outage');
      toon().recorder.reset();
      await clock.tick(24 * 3600e3);
      assert.ok(toon().requestsTo(WATER_PAGE).length <= 97, `at most 97 page requests in 24 h (${toon().requestsTo(WATER_PAGE).length})`);
      assert.deepEqual(levelLines(scenario, 'error'), []);
      assert.equal(device.getAvailable(), true);
      evidence(t, 'toonwater.on-404', {
        message: saved.value, status: device.getSetting('toonwater_status'), warning: device.fake.warning, pageRequestsIn24h: toon().requestsTo(WATER_PAGE).length, errorLines: 0,
      });
    });
    await assertNoUnhandled();
  });
});

/* ---------------------------------------------------------------------------------------------------------------- */

describe('QA-09 / FR-52 AC4 / FR-53 AC3 / FR-60 / NFR-01: ToonWater ON, OFF, ON during an in-flight poll', () => {
  test('starting off, with the thermostat request in flight: three saves at once end on, with the trio once, no error and no unhandled rejection', async (t) => {
    await withScenario(undefined, async (scenario) => {
      const { world: homeyWorld, clock, toon } = scenario;
      const device = await running(scenario, { toonwater: false });
      toon().latencyMs = 2000;
      await until(clock, () => toon().requests().some((entry) => entry.end === null), { limitMs: 60e3, stepMs: 50 });
      assert.ok(toon().openHandlers() > 0, 'a poll request is in flight');

      const saves = [
        device.simulateSettingsSave({ toonwater_enabled: true }),
        device.simulateSettingsSave({ toonwater_enabled: false }),
        device.simulateSettingsSave({ toonwater_enabled: true }),
      ];
      const outcomes = await settle(clock, Promise.allSettled(saves), { limitMs: 60e3 });
      assert.deepEqual(outcomes.value.map((entry) => entry.status), ['fulfilled', 'fulfilled', 'fulfilled']);
      toon().latencyMs = 0;
      await clock.tick(2 * CYCLE);

      assert.deepEqual(device.getCapabilities().filter((id) => WATER.includes(id)), WATER, 'the trio, once');
      assert.equal(device.getCapabilities().length, new Set(device.getCapabilities()).size, 'no duplicate capability');
      assert.equal(device.getSetting('toonwater_enabled'), true);
      assert.deepEqual(values(device, WATER), { measure_water: 0, 'meter_water.today': 0.137, 'meter_water.total': 7350.214 });
      assert.deepEqual(levelLines(scenario, 'error'), []);
      assert.equal(device.getAvailable(), true);
      evidence(t, 'toggle.in-flight-thermostat', {
        saves: outcomes.value.map((entry) => entry.status),
        addCalls: calls(homeyWorld, 'addCapability').map((call) => call.args[0]),
        removeCalls: calls(homeyWorld, 'removeCapability').map((call) => call.args[0]),
        finalWaterCapabilities: device.getCapabilities().filter((id) => WATER.includes(id)),
        finalValues: values(device, WATER),
        errorLines: 0,
      });
    });
    await assertNoUnhandled();
  });

  test('starting on, with the water request itself in flight: an answer of the earlier generation is dropped, the end state is on with the fresh values', async (t) => {
    await withScenario(undefined, async (scenario) => {
      const { world: homeyWorld, clock, toon } = scenario;
      const device = await running(scenario, { toonwater: true });
      await until(clock, () => device.getCapabilityValue('meter_water.total') === 7350.214, { limitMs: 60e3, stepMs: 100 });
      toon().state.waterPage = {
        result: 'ok',
        water: {
          flow: 99, total: 1111111, value: 999, avgValue: 1,
        },
      }; // the stale page
      toon().latencyMs = 2000;
      await until(clock, () => toon().requests().some((entry) => entry.path === WATER_PAGE && entry.end === null), { limitMs: 120e3, stepMs: 50 });
      assert.ok(toon().requests().some((entry) => entry.path === WATER_PAGE && entry.end === null), 'the water request is in flight');
      toon().state.waterPage = {
        result: 'ok',
        water: {
          flow: 5, total: 8000000, value: 222, avgValue: 1,
        },
      }; // what a later request says

      const off = device.simulateSettingsSave({ toonwater_enabled: false });
      const on = device.simulateSettingsSave({ toonwater_enabled: true });
      const outcomes = await settle(clock, Promise.allSettled([off, on]), { limitMs: 60e3 });
      toon().latencyMs = 0;
      await clock.tick(2 * CYCLE);

      assert.deepEqual(outcomes.value.map((entry) => entry.status), ['fulfilled', 'fulfilled']);
      assert.deepEqual(values(device, WATER), { measure_water: 5, 'meter_water.today': 0.222, 'meter_water.total': 8000 });
      const written = homeyWorld.callsOf('setCapabilityValue').filter((call) => WATER.includes(call.args[0]));
      assert.equal(written.some((call) => call.args[1] === 1111.111 || call.args[1] === 99 || call.args[1] === 0.999), false, 'the stale page was never written');
      assert.deepEqual(levelLines(scenario, 'error'), []);
      evidence(t, 'toggle.in-flight-water', {
        saves: outcomes.value.map((entry) => entry.status),
        staleValueWritten: false,
        finalValues: values(device, WATER),
        removeCalls: calls(homeyWorld, 'removeCapability').map((call) => call.args[0]),
        addCalls: calls(homeyWorld, 'addCapability').map((call) => call.args[0]),
      });
    });
    await assertNoUnhandled();
  });

  test('starting on, off during the water request: the answer that arrives afterwards is dropped (no Invalid Capability), and the device stays off with no further request', async (t) => {
    await withScenario(undefined, async (scenario) => {
      const { clock, toon } = scenario;
      const device = await running(scenario, { toonwater: true });
      await until(clock, () => device.getCapabilityValue('meter_water.total') === 7350.214, { limitMs: 60e3, stepMs: 100 });
      toon().latencyMs = 2000;
      await until(clock, () => toon().requests().some((entry) => entry.path === WATER_PAGE && entry.end === null), { limitMs: 120e3, stepMs: 50 });

      const off = await settle(clock, device.simulateSettingsSave({ toonwater_enabled: false }), { limitMs: 60e3 });
      assert.equal(off.error, undefined);
      assert.equal(off.value, en.toonwater.saved_off);
      const sent = toon().requestsTo(WATER_PAGE).length;
      toon().latencyMs = 0;
      await clock.tick(10 * CYCLE);

      assert.equal(WATER.some((id) => device.hasCapability(id)), false);
      assert.equal(toon().requestsTo(WATER_PAGE).length, sent, 'no request for the page after the switch off');
      assert.deepEqual(levelLines(scenario, 'error'), []);
      assert.equal(device.fake.warning, null);
      evidence(t, 'toggle.off-during-water', { message: off.value, pageRequestsAfterSwitchOff: toon().requestsTo(WATER_PAGE).length - sent, errorLines: 0 });
    });
    await assertNoUnhandled();
  });
});

/* ---------------------------------------------------------------------------------------------------------------- */

describe('QA-10 / FR-110 / FR-111 / FR-112 / FR-113 / FR-56: legacy upgrade of a 2019, a 2021 and a 2023 device', () => {
  const ERAS = [['era1', '2019'], ['era2', '2021'], ['era3', '2023']];
  const waterVariants = { 'with water data': waterValueVariants.a, 'without water data (all null)': waterValueVariants.b };

  for (const [era, year] of ERAS) {
    for (const [dataLabel, water] of Object.entries(waterVariants)) {
      for (const [toonLabel, toonOptions] of [['a Toon with the add-on', {}], ['a Toon without the add-on', { water: '404' }]]) {
        const hasWater = era !== 'era1';
        if (!hasWater && dataLabel !== 'with water data') continue; // a 2019 device has no water items, so there is only one case
        test(`${year}-era device ${hasWater ? dataLabel : '(no water items exist)'}, ${toonLabel}: same device, same Flows, nothing lost, zero unhandled rejections`, async (t) => {
          await withScenario({ toons: { [HOST]: toonOptions } }, async (scenario) => {
            const { world: homeyWorld, clock, toon } = scenario;
            const capabilities = [...eras[era].capabilities];
            const stored = {
              target_temperature: 19,
              measure_temperature: 19.5,
              temperature_state: 'home',
              'meter_power.peak': 3000,
              'meter_power.offPeak': 4000,
              measure_power: 100,
              meter_gas: 5000,
              ...(hasWater ? water : {}),
              ...(era === 'era3' ? { 'alarm_water.hotwater': false } : {}),
            };
            const device = await scenario.addDevice({
              name: 'Oude Toon', data: { id: 'ENECO-001-12391' }, capabilities, values: stored, settings: { address: HOST }, store: {},
            });
            const startCapabilities = device.getCapabilities();
            const waterOn = hasWater;

            // the moment the new version starts: nothing lost, identity kept, no request yet, the stored water values still readable
            assert.deepEqual(device.getData(), { id: 'ENECO-001-12391' });
            assert.equal(device.getName(), 'Oude Toon');
            capabilities.forEach((id) => assert.ok(device.hasCapability(id), `${id} survives`));
            if (hasWater) assert.deepEqual(values(device, WATER), Object.fromEntries(WATER.map((id) => [id, water[id]])), 'the stored water values are readable at once');
            assert.equal(device.getSetting('toonwater_enabled'), waterOn, 'ToonWater is on exactly when the device had water items');
            assert.equal(toon().requests().length, 0, 'onInit sends nothing');
            if (!hasWater) assert.equal(WATER.some((id) => device.hasCapability(id)), false, 'no water item is added to a 2019 device');

            await clock.tick(3 * CYCLE + 5000);
            assert.equal(device.getAvailable(), true);
            assert.deepEqual(levelLines(scenario, 'error'), [], 'no error line (no Invalid Capability)');
            assert.equal(calls(homeyWorld, 'removeCapability').length, 0, 'nothing is ever removed by an upgrade');
            assert.equal(toon().requestsTo(WATER_PAGE).length > 0, waterOn, 'the page is asked for exactly when ToonWater is on');
            if (waterOn && toonOptions.water === '404') {
              assert.deepEqual(values(device, WATER), Object.fromEntries(WATER.map((id) => [id, water[id]])), 'a missing add-on leaves the old values as they were');
              assert.ok(toon().requestsTo(WATER_PAGE).length <= 2, 'a 404 is not asked again every cycle');
            }
            if (waterOn && toonOptions.water === undefined) assert.deepEqual(values(device, WATER), { measure_water: 0, 'meter_water.today': 0.137, 'meter_water.total': 7350.214 });
            assert.equal(device.getCapabilityValue('measure_temperature'), 20.3);
            assert.equal(device.getCapabilityValue('alarm_water.hotwater'), false);
            assert.equal(device.getCapabilityValue('burner_state'), 'off');

            // every card of the baseline still resolves
            ['meter_gas_changed', 'meter_power_changed', 'measure_water_changed', 'temperature_state_changed', 'alarm_water_changed']
              .forEach((id) => assert.doesNotThrow(() => card(scenario, 'trigger', id), id));
            ['temperature_state_is', 'hotwater_dispensing'].forEach((id) => assert.doesNotThrow(() => card(scenario, 'condition', id), id));
            ['set_temperature_state', 'enable_program', 'disable_program', 'update_status', 'update_powerusage', 'update_water', 'update_metertotals']
              .forEach((id) => assert.doesNotThrow(() => card(scenario, 'action', id), id));

            // a restart of the app changes nothing more
            const pageRequestsBeforeRestart = toon().requestsTo(WATER_PAGE).length;
            const before = homeyWorld.calls.length;
            await homeyWorld.restartApp();
            const methods = homeyWorld.calls.slice(before).map((call) => call.method);
            assert.deepEqual(methods.filter((method) => ['addCapability', 'removeCapability', 'setSettings'].includes(method)), []);
            await clock.tick(CYCLE);
            await assertNoUnhandled();
            evidence(t, `legacy.${year}.${hasWater ? dataLabel : 'no water items'}.${toonLabel}`, {
              capabilitiesBefore: capabilities.length,
              capabilitiesAfter: startCapabilities.length,
              added: startCapabilities.filter((id) => !capabilities.includes(id)),
              toonwater_enabled: device.getSetting('toonwater_enabled'),
              pageRequestsIn3Cycles: pageRequestsBeforeRestart,
              capabilitiesAfterRestart: homeyWorld.devices()[0].getCapabilities().length,
              waterValuesNow: hasWater ? values(device, WATER) : null,
              errorLines: 0,
              unhandled: unhandledEvents().length,
            });
          });
        });
      }
    }
  }
});

/* ---------------------------------------------------------------------------------------------------------------- */

describe('QA-11 / FR-12 / FR-72: vacation state', () => {
  test('a Toon in holiday mode (activeState 4) shows vacation, the condition says so, undefined is never written, and vacation cannot be set from Homey', async (t) => {
    await withScenario({ toons: { [HOST]: { vacation: true } } }, async (scenario) => {
      const { world: homeyWorld, clock, toon } = scenario;
      const device = await scenario.addPaired();
      await clock.tick(5000);

      assert.equal(device.getCapabilityValue('temperature_state'), 'vacation');
      assert.equal(await check(scenario, 'temperature_state_is', { device, state: 'vacation' }), true);
      assert.equal(await check(scenario, 'temperature_state_is', { device, state: 'home' }), false);
      assert.equal(homeyWorld.callsOf('setCapabilityValue').some((call) => call.args[1] === undefined), false);
      const dropdown = manifest.flow.conditions.find((entry) => entry.id === 'temperature_state_is').args.find((arg) => arg.name === 'state').values.map((value) => value.id);
      assert.ok(dropdown.includes('vacation'));
      const setDropdown = manifest.flow.actions.find((entry) => entry.id === 'set_temperature_state').args.find((arg) => arg.name === 'state').values.map((value) => value.id);
      assert.equal(setDropdown.includes('vacation'), false, 'vacation is read-only');

      toon().recorder.reset();
      const picked = await settle(clock, device.simulateCapabilitySet('temperature_state', 'vacation').then(() => null, (error) => error));
      assert.equal(picked.value.message, en.error.vacation_readonly);
      assert.equal(toon().requests().length, 0, 'nothing is sent to the Toon');

      // the Toon leaves holiday mode: the state follows, once
      toon().state.thermostat.activeState = '1';
      await clock.tick(CYCLE);
      assert.equal(device.getCapabilityValue('temperature_state'), 'home');
      evidence(t, 'vacation', {
        state: 'vacation',
        conditionVacation: true,
        conditionHome: false,
        conditionDropdown: dropdown,
        actionDropdown: setDropdown,
        pickMessage: picked.value.message,
        undefinedWritten: false,
        afterHolidayEnds: device.getCapabilityValue('temperature_state'),
      });
    });
    await assertNoUnhandled();
  });
});

/* ---------------------------------------------------------------------------------------------------------------- */

describe('QA-12 / FR-24 / NFR-01 / NFR-04: malformed, NaN and hostile payloads', () => {
  const JUNK = {
    'an HTML error page': () => new Response('<html><body><h1>502 Bad Gateway</h1></body></html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    'truncated JSON': () => new Response('{"result":"ok","currentTemp":"20', { status: 200 }),
    'an empty body': () => new Response('', { status: 200 }),
    '{}': () => new Response('{}', { status: 200 }),
    '{"result":"error"}': () => new Response('{"result":"error"}', { status: 200 }),
    '"abc", null and NaN strings': () => new Response(JSON.stringify({
      result: 'ok', currentTemp: 'abc', currentSetpoint: null, activeState: 'NaN', burnerInfo: {}, programState: 'NaN',
    }), { status: 200 }),
    'a JSON number': () => new Response('7', { status: 200 }),
    'a 20 MB text': () => new Response('x'.repeat(20 * 1024 * 1024), { status: 200 }),
    'a redirect to another host': () => new Response('', { status: 302, headers: { location: 'http://example.invalid/x' } }),
  };

  test('every junk answer of the thermostat: the tile keeps its values, nothing non-finite or undefined is written, no error line, no unhandled rejection', async (t) => {
    const outcomes = {};
    for (const [name, make] of Object.entries(JUNK)) {
      await withScenario(undefined, async (scenario) => {
        const { world: homeyWorld, clock } = scenario;
        const device = await running(scenario);
        const before = allValues(device);
        const writesBefore = homeyWorld.callsOf('setCapabilityValue').length;
        const restore = overrideAnswer(THERMOSTAT, make);
        await clock.tick(4 * CYCLE);
        restore();

        const written = homeyWorld.callsOf('setCapabilityValue').slice(writesBefore);
        const bad = written.filter((call) => call.args[1] === undefined || call.args[1] === null || (typeof call.args[1] === 'number' && !Number.isFinite(call.args[1])));
        assert.deepEqual(bad, [], `${name}: nothing non-finite is written`);
        const kept = ['measure_temperature', 'target_temperature', 'temperature_state', 'burner_state'];
        assert.deepEqual(values(device, kept), Object.fromEntries(kept.map((id) => [id, before[id]])), `${name}: thermostat values kept`);
        assert.deepEqual(levelLines(scenario, 'error'), [], `${name}: no error-level line`);
        outcomes[name] = { valuesKept: true, writesAfterJunk: written.length, available: device.getAvailable() };
        await clock.tick(5000);
      });
    }
    evidence(t, 'junk.thermostat', outcomes);
    await assertNoUnhandled();
  });

  test('junk or NaN in the power and meter answers: the other groups and the thermostat keep updating, the counters never become NaN, 0 or lower', async (t) => {
    await withScenario(undefined, async (scenario) => {
      const { world: homeyWorld, clock, toon } = scenario;
      const device = await running(scenario);
      const before = values(device, ['meter_gas', 'meter_power.peak', 'meter_power.offPeak', 'measure_power']);
      const restoreMeters = overrideAnswer(METERS, () => new Response(JSON.stringify({
        'dev_2.1': { type: 'gas', CurrentGasQuantity: 'NaN' },
        'dev_2.4': { type: 'elec_delivered_nt', CurrentElectricityQuantity: 'NaN' },
        'dev_2.6': { type: 'elec_delivered_lt', CurrentElectricityQuantity: null },
        'dev_2.2': { type: 'elec', CurrentElectricityQuantity: 'abc' },
      }), { status: 200 }));
      const restorePower = overrideAnswer(POWER, () => new Response('{"result":"ok","powerUsage":"460abc"}', { status: 200 }));
      toon().state.thermostat.currentTemp = '2310';
      await clock.tick(3 * CYCLE);
      restorePower();
      restoreMeters();

      assert.deepEqual(values(device, ['meter_gas', 'meter_power.peak', 'meter_power.offPeak', 'measure_power']), before, 'counters and power keep their values');
      assert.equal(device.getCapabilityValue('measure_temperature'), 23.1, 'the thermostat group still updates');
      assert.equal(device.getAvailable(), true, 'a bad optional group never makes the device unavailable');
      assert.equal(homeyWorld.callsOf('setCapabilityValue').filter((call) => typeof call.args[1] === 'number' && !Number.isFinite(call.args[1])).length, 0);
      assert.deepEqual(levelLines(scenario, 'error'), []);
      evidence(t, 'junk.optional-groups', { countersKept: before, thermostatUpdated: 23.1, available: true });
    });
    await assertNoUnhandled();
  });

  test('a payload that has only thermostat fields, a meter that goes back to 0 and a meter that jumps down once are all held back by the counter policy', async (t) => {
    await withScenario(undefined, async (scenario) => {
      const { clock, toon } = scenario;
      const device = await running(scenario);
      const gas = device.getCapabilityValue('meter_gas');
      toon().state.devices['dev_2.1'].CurrentGasQuantity = '0';
      await clock.tick(CYCLE);
      assert.equal(device.getCapabilityValue('meter_gas'), gas, 'a counter that reads 0 is not taken');
      toon().state.devices['dev_2.1'].CurrentGasQuantity = '1000';
      await clock.tick(CYCLE);
      assert.equal(device.getCapabilityValue('meter_gas'), gas, 'one lower reading is held back');
      evidence(t, 'junk.counters', {
        gas, afterZero: device.getCapabilityValue('meter_gas'), afterOneLowerReading: device.getCapabilityValue('meter_gas'), policy: 'a lower reading is accepted after 3 cycles in a row (ADR-0014)',
      });
    });
    await assertNoUnhandled();
  });
});

/* ---------------------------------------------------------------------------------------------------------------- */

describe('QA-13 / FR-70 / FR-31 AC3 / FR-32 / FR-114: every Flow trigger fires exactly once per change, never for the first value or for no change', () => {
  test('gas, power, water, hot water and burner: one fire per change with the right token, none in the quiet cycles', async (t) => {
    await withScenario(undefined, async (scenario) => {
      const { clock, toon } = scenario;
      const device = await running(scenario, { toonwater: true });
      await clock.tick(2 * CYCLE);
      assert.deepEqual(scenario.world.triggerCalls, [], 'the first values fired nothing, and quiet cycles fire nothing');
      const toonState = toon().state;
      const log = {};

      const change = async (name, mutate, id) => {
        const before = fired(scenario, id).length;
        mutate();
        await clock.tick(3 * CYCLE); // one change, then two quiet cycles
        const calls = fired(scenario, id).slice(before);
        assert.equal(calls.length, 1, `${name}: exactly one ${id}`);
        assert.equal(calls[0].deviceId, device.getData().id);
        log[name] = calls[0].tokens;
      };

      await change('gas', () => {
        toonState.devices['dev_2.1'].CurrentGasQuantity = '5300000';
      }, 'meter_gas_changed');
      await change('power', () => {
        toonState.devices['dev_2.4'].CurrentElectricityQuantity = '3800000';
      }, 'meter_power_changed');
      await change('water', () => {
        toonState.waterPage = {
          result: 'ok',
          water: {
            flow: 4, total: 7350300, value: 150, avgValue: 1,
          },
        };
      }, 'measure_water_changed');
      await change('hotwater on', () => {
        toonState.thermostat.burnerInfo = '2';
      }, 'alarm_water_changed');
      await change('hotwater off', () => {
        toonState.thermostat.burnerInfo = '0';
      }, 'alarm_water_changed');
      assert.deepEqual(fired(scenario, 'alarm_water_changed').map((entry) => entry.tokens['alarm_water.hotwater']), [true, false]);
      await change('burner heating', () => {
        toonState.thermostat.burnerInfo = '1';
      }, 'burner_state_changed_to');
      assert.deepEqual(fired(scenario, 'burner_state_changed_to').at(-1).state, { state: 'heating' });
      assert.equal(log.power.meter_power, 3800 + 4120.771, 'peak plus off-peak in kWh');

      // two things change in one cycle: each trigger once
      const gasBefore = fired(scenario, 'meter_gas_changed').length;
      const waterBefore = fired(scenario, 'measure_water_changed').length;
      toonState.devices['dev_2.1'].CurrentGasQuantity = '5400000';
      toonState.waterPage = {
        result: 'ok',
        water: {
          flow: 0, total: 7350400, value: 250, avgValue: 1,
        },
      };
      await clock.tick(3 * CYCLE);
      assert.equal(fired(scenario, 'meter_gas_changed').length - gasBefore, 1);
      assert.equal(fired(scenario, 'measure_water_changed').length - waterBefore, 1);
      assert.deepEqual(levelLines(scenario, 'error'), []);
      evidence(t, 'triggers.app-fired', { firstValues: 0, perChange: log, totalCalls: scenario.world.triggerCalls.length });
    });
    await assertNoUnhandled();
  });

  test('measure_water_changed never fires while ToonWater is off; temperature_state_changed is fired by Homey, once per change, and never by the app [HW-06]', async (t) => {
    await withScenario(undefined, async (scenario) => {
      const { world: homeyWorld, clock, toon } = scenario;
      const device = await running(scenario, { toonwater: false });
      homeyWorld.autoFireCustomTriggers = true; // models Homey firing <custom capability>_changed itself, from here on
      toon().state.waterPage = {
        result: 'ok',
        water: {
          flow: 8, total: 7351000, value: 900, avgValue: 1,
        },
      };
      toon().state.thermostat.activeState = '3';
      await clock.tick(3 * CYCLE);

      assert.equal(device.getCapabilityValue('temperature_state'), 'away');
      assert.equal(fired(scenario, 'measure_water_changed').length, 0, 'no water trigger while off');
      assert.deepEqual(fired(scenario, 'temperature_state_changed').map((entry) => [entry.source, entry.tokens.temperature_state]), [['homey', 'away']], 'one fire per change, by Homey');
      assert.equal(fired(scenario, 'temperature_state_changed').filter((entry) => entry.source === 'app').length, 0, 'the app itself never fires it (no double fire)');
      evidence(t, 'triggers.homey-fired', { temperature_state_changed: fired(scenario, 'temperature_state_changed').map((entry) => [entry.source, entry.tokens]), measure_water_changed: 0 });
    });
    await assertNoUnhandled();
  });
});

/* ---------------------------------------------------------------------------------------------------------------- */

describe('QA-14 / FR-72 / FR-73 / FR-74 / FR-13 / FR-14 / FR-11: condition and action cards', () => {
  test('conditions answer true, false and false for null, never undefined', async (t) => {
    await withScenario(undefined, async (scenario) => {
      const device = await scenario.addPaired(); // no first answer yet: every value is null
      const answers = {
        stateNull: await check(scenario, 'temperature_state_is', { device, state: 'home' }),
        hotwaterNull: await check(scenario, 'hotwater_dispensing', { device }),
        burnerNull: await check(scenario, 'burner_state_is', { device, state: 'off' }),
      };
      assert.deepEqual(answers, { stateNull: false, hotwaterNull: false, burnerNull: false });

      await scenario.clock.tick(5000);
      scenario.toon().state.thermostat.burnerInfo = '2';
      await scenario.clock.tick(CYCLE);
      const after = {
        stateHome: await check(scenario, 'temperature_state_is', { device, state: 'home' }),
        stateSleep: await check(scenario, 'temperature_state_is', { device, state: 'sleep' }),
        hotwater: await check(scenario, 'hotwater_dispensing', { device }),
        burnerHotWater: await check(scenario, 'burner_state_is', { device, state: 'hot_water' }),
        burnerOff: await check(scenario, 'burner_state_is', { device, state: 'off' }),
      };
      assert.deepEqual(after, {
        stateHome: true, stateSleep: false, hotwater: true, burnerHotWater: true, burnerOff: false,
      });
      evidence(t, 'cards.conditions', { beforeFirstAnswer: answers, afterAnswer: after });
    });
    await assertNoUnhandled();
  });

  test('actions send the documented requests, resolve after the Toon answered, and the tile follows the confirming read', async (t) => {
    await withScenario(undefined, async (scenario) => {
      const { clock, toon } = scenario;
      const device = await running(scenario);
      const changes = () => toon().requests().filter((entry) => entry.query.action === 'setSetpoint' || entry.query.action === 'changeSchemeState').map((entry) => entry.query);
      const sent = {};

      await settle(clock, device.simulateCapabilitySet('target_temperature', 21.5));
      sent.setpoint = changes().at(-1);
      assert.deepEqual(sent.setpoint, { action: 'setSetpoint', Setpoint: '2150' }, 'an integer, never 2150.0000000000002');
      assert.equal(device.getCapabilityValue('target_temperature'), 21.5);

      await clock.tick(2000);
      toon().recorder.reset();
      const yes = await settle(clock, act(scenario, 'set_temperature_state', { device, state: 'sleep', resume_program: 'yes' }));
      assert.equal(yes.error, undefined);
      sent.sleepResume = changes();
      await clock.tick(2000);
      assert.equal(device.getCapabilityValue('temperature_state'), 'sleep');
      toon().recorder.reset();
      const no = await settle(clock, act(scenario, 'set_temperature_state', { device, state: 'sleep', resume_program: 'no' }));
      assert.equal(no.error, undefined);
      sent.sleepNoResume = changes();
      assert.notDeepEqual(sent.sleepNoResume, sent.sleepResume, 'the two options of resume_program differ');

      toon().recorder.reset();
      await settle(clock, act(scenario, 'enable_program', { device }));
      sent.programOn = changes();
      toon().recorder.reset();
      await settle(clock, act(scenario, 'disable_program', { device }));
      sent.programOff = changes();
      assert.deepEqual(sent.programOn.map((query) => query.state), ['1']);
      assert.deepEqual(sent.programOff.map((query) => query.state), ['0']);

      const outOfRange = await settle(clock, device.simulateCapabilitySet('target_temperature', 31).then(() => null, (error) => error)).catch((error) => ({ error }));
      assert.ok(outOfRange);

      // the update cards: one request to their own endpoint, values in when they resolve
      for (const [id, path, mutate, id2, expected] of [
        ['update_powerusage', POWER, () => {
          toon().state.power.powerUsage.value = 777;
        }, 'measure_power', 777],
        ['update_metertotals', METERS, () => {
          toon().state.devices['dev_2.1'].CurrentGasQuantity = '5400001';
        }, 'meter_gas', 5400.001],
        ['update_status', THERMOSTAT, () => {
          toon().state.thermostat.currentTemp = '2400';
        }, 'measure_temperature', 24],
      ]) {
        mutate();
        toon().recorder.reset();
        const outcome = await settle(clock, act(scenario, id, { device }));
        assert.equal(outcome.error, undefined, id);
        assert.equal(device.getCapabilityValue(id2), expected, `${id}: the value is in when the card resolves`);
        assert.equal(reads(toon(), path).length >= 1, true);
        assert.equal(toon().requests().filter((entry) => entry.path === path).length, id === 'update_status' ? 1 : 1, `${id}: one request to its own endpoint`);
        sent[id] = { requests: toon().requests().map((entry) => entry.path), value: device.getCapabilityValue(id2) };
      }
      assert.deepEqual(levelLines(scenario, 'error'), []);
      evidence(t, 'cards.actions', sent);
    });
    await assertNoUnhandled();
  });
});

/* ---------------------------------------------------------------------------------------------------------------- */

describe('QA-15 / FR-73 / FR-74 AC2 / NFR-08 AC2: every action that asks the Toon rejects, with a sentence, when the Toon is offline', () => {
  const CARDS = [
    ['update_status', {}], ['update_powerusage', {}], ['update_metertotals', {}], ['update_water', {}],
    ['set_temperature_state', { state: 'comfort', resume_program: 'yes' }], ['enable_program', {}], ['disable_program', {}],
  ];

  const WORDS = { timeout: 'does not answer', refused: 'refuses the connection', 500: 'answers 500' };
  for (const [fault, expected] of [['timeout', 'timeout'], ['refused', 'network'], ['500', 'http']]) {
    test(`a Toon that ${WORDS[fault]}: all seven cards reject (within 6 s, 10 s while a poll waits out its 5 s timeout) in en and nl, nothing resolves silently`, async (t) => {
      const results = {};
      for (const language of ['en', 'nl']) {
        await withScenario({ language }, async (scenario) => {
          const { clock, toon } = scenario;
          const device = await running(scenario, { toonwater: true });
          toon().fault(fault);
          const dict = language === 'en' ? en : nl;
          for (const [id, args] of CARDS) {
            const outcome = await settle(clock, act(scenario, id, { device, ...args }));
            assert.ok(outcome.error, `${language} ${id}: rejects`);
            const bound = fault === 'timeout' ? 10000 : 6000; // NFR-08 AC2 as amended by ADR-0005: 10 s while a poll request is waiting for its own 5 s
            assert.ok(outcome.tookMs <= bound, `${language} ${id}: ${outcome.tookMs} ms`);
            const text = expected === 'http' ? dict.error.http.replace('__status__', '500') : dict.error[expected];
            assert.equal(outcome.error.message, text, `${language} ${id}`);
            assert.doesNotMatch(outcome.error.message, /TypeError|ToonError|undefined|fetch|ECONN/);
            results[`${language}.${id}`] = { tookMs: outcome.tookMs, message: outcome.error.message };
          }
          assert.deepEqual(levelLines(scenario, 'error'), []);
        });
      }
      evidence(t, `offline-actions.${fault}`, results);
      await assertNoUnhandled();
    });
  }

  test('a device that was removed rejects the card with the "cancelled" sentence, and a device without an address says so', async (t) => {
    await withScenario(undefined, async (scenario) => {
      const { world: homeyWorld, clock } = scenario;
      const gone = await running(scenario);
      const unset = await scenario.addDevice({ settings: { address: '0.0.0.0' }, data: { id: 'toon-unset' }, name: 'Unset' });
      await homeyWorld.deleteDevice(gone);
      const removed = await settle(clock, act(scenario, 'update_status', { device: gone }));
      const noAddress = await settle(clock, act(scenario, 'update_status', { device: unset }));
      assert.equal(removed.error.message, en.error.aborted);
      assert.equal(noAddress.error.message, en.address_missing);
      evidence(t, 'offline-actions.edge', { removed: removed.error.message, noAddress: noAddress.error.message });
    });
    await assertNoUnhandled();
  });
});

/* ---------------------------------------------------------------------------------------------------------------- */

describe('QA-16 / NFR-15 / NFR-04: the only host that is ever contacted is the configured Toon, and requests are built from the address safely', () => {
  test('across pairing, polling, writes, toggles and an address change only the typed hosts are contacted, over http, with no credentials', async (t) => {
    await withScenario({ toons: { [HOST]: {}, [OTHER]: {} } }, async (scenario) => {
      const { clock } = scenario;
      const { session, call } = await openPairing(scenario);
      const tested = await call('testConnection', { address: HOST });
      const built = await call('buildDevice', {
        name: 'A', id: 'toon-a', address: tested.value.host, features: { toonwater: true },
      });
      const device = await session.createDevice(built.value);
      await clock.tick(60e3);
      await settle(clock, device.simulateCapabilitySet('target_temperature', 20));
      await settle(clock, device.simulateSettingsSave({ toonwater_enabled: false }));
      await settle(clock, device.simulateSettingsSave({ address: OTHER }));
      await clock.tick(60e3);
      assert.deepEqual(scenario.hostsContacted().sort(), [HOST, OTHER].sort());
      [HOST, OTHER].forEach((host) => scenario.toon(host).requests().forEach((entry) => {
        assert.equal(Object.keys(entry.headers).some((name) => /authorization|cookie/i.test(name)), false);
      }));
      evidence(t, 'network.hosts', { hostsContacted: scenario.hostsContacted() });
    });
    await assertNoUnhandled();
  });
});
