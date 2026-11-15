'use strict';

/*
 * lib/engine/pairing.js (ADR-0008): the checks of what the pair view sends, the connection test over the real client
 * against the mock Toon on a fake clock, and the device that the pairing builds. The Homey side (the two handlers of
 * the driver, the view) is in test/scenario/pairing.test.js.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  PairingProblem, pairingMessage, readAddress, testConnection, buildNewDevice,
} = require('../../lib/engine/pairing');
const { FEATURES, CORE } = require('../../lib/features');
const { INTERVAL } = require('../../lib/engine/schedule');
const toonwater = require('../../lib/features/toonwater');
const { ToonClient } = require('../../lib/toon/client');
const { ToonError } = require('../../lib/toon/errors');
const { createClock, settle: settleOn } = require('../helpers/fake-clock');
const { createMockToon } = require('../helpers/mock-toon');
const { createWorld } = require('../helpers/fake-homey/world');
const { withScenario } = require('../helpers/scenario');
const synthetic = require('../helpers/feature-synthetic');
const manifest = require('../../app.json');

const driverManifest = manifest.drivers[0];
const WATER = ['measure_water', 'meter_water.today', 'meter_water.total'];
const options = driverManifest.capabilitiesOptions;
const problemKey = (action) => {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof PairingProblem, `a PairingProblem, not ${error && error.name}: ${error && error.message}`);
    return error.key;
  }
  return assert.fail('nothing was thrown');
};
/** The options of the manifest for the capabilities that a device holds, nothing for an item that it does not hold. */
const heldOptions = (held) => Object.fromEntries(held.filter((id) => Object.hasOwn(options, id)).map((id) => [id, options[id]]));
const entered = (changes = {}) => ({
  name: 'Living room', id: 'ENECO-001-12391', address: '192.168.1.50', features: {}, ...changes,
});

describe('FR-03 AC1 / NFR-04: the address of a connection test is checked before anything is sent', () => {
  [
    ['192.168.1.50', '192.168.1.50'],
    ['192.168.1.50:80', '192.168.1.50:80'],
    [' http://192.168.1.50/ ', '192.168.1.50'],
    ['toon.local', 'toon.local'],
  ].forEach(([typed, host]) => {
    test(`${JSON.stringify(typed)} becomes the host ${host}`, () => {
      assert.equal(readAddress({ address: typed }), host);
    });
  });

  [
    ['', 'pair.address_required'],
    ['   ', 'pair.address_required'],
    ['0.0.0.0', 'error.address_invalid'],
    ['192.168.1.50/foo', 'error.address_invalid'],
    ['192.168.1.50?x=1', 'error.address_invalid'],
    ['user@host', 'error.address_invalid'],
    ['a b', 'error.address_invalid'],
    ['192.168.1.50:99999', 'error.address_invalid'],
    ['https://192.168.1.50', 'error.address_https'],
    ['fe80::1', 'error.address_ipv6'],
    ['[fe80::1]', 'error.address_ipv6'],
  ].forEach(([typed, key]) => {
    test(`FR-03 AC2: ${JSON.stringify(typed)} is refused with ${key}`, () => {
      assert.equal(problemKey(() => readAddress({ address: typed })), key);
    });
  });

  test('R-11: an address that is not a string, and a request that is not an object, are refused without throwing anything else', () => {
    [12, null, undefined, {}, [], true, ['192.168.1.50']].forEach((address) => {
      assert.equal(problemKey(() => readAddress({ address })), 'pair.invalid_input', String(address));
    });
    [null, undefined, 12, '192.168.1.50', [], () => '192.168.1.50'].forEach((request) => {
      assert.equal(problemKey(() => readAddress(request)), 'pair.invalid_input', String(request));
    });
  });

  test('only an own property of the request counts', () => {
    assert.equal(problemKey(() => readAddress(Object.create({ address: '192.168.1.50' }))), 'pair.invalid_input');
  });
});

describe('FR-01 AC1 / FR-51 / FR-04 AC1: the device that the pairing builds', () => {
  test('FR-51 / ADR-0008: with ToonWater left off the device is the core device, with the marker of the migration', () => {
    assert.deepEqual(buildNewDevice(entered(), { options }), {
      name: 'Living room',
      data: { id: 'ENECO-001-12391' },
      settings: {
        address: '192.168.1.50', poll_interval: 30, toonwater_enabled: false, export_enabled: false,
      },
      store: { migrationVersion: 1, toonwaterDecidedBy: 'user' },
      capabilities: CORE,
      capabilitiesOptions: heldOptions(CORE),
    });
  });

  test('FR-51 AC1: none of the three water capabilities is in the list unless it was ticked', () => {
    const device = buildNewDevice(entered({ features: { toonwater: false } }), { options });

    assert.equal(WATER.some((id) => device.capabilities.includes(id)), false);
    assert.equal(device.capabilities.includes('alarm_water.hotwater'), true, 'the hot-water flag is not a ToonWater item');
    assert.equal(device.settings.toonwater_enabled, false);
  });

  test('FR-61 AC1: a ticked ToonWater adds the three capabilities and their options, as the manifest has them', () => {
    const device = buildNewDevice(entered({ features: { toonwater: true } }), { options });

    assert.deepEqual(device.capabilities, [...CORE, ...WATER]);
    assert.equal(device.settings.toonwater_enabled, true);
    assert.deepEqual(device.capabilitiesOptions, heldOptions([...CORE, ...WATER]));
    assert.deepEqual(device.capabilitiesOptions['meter_water.today'].title, { en: 'Water today', nl: 'Water vandaag' });
    assert.deepEqual(device.capabilitiesOptions['meter_water.total'].title, { en: 'Water meter total', nl: 'Water meter totaal' });
    assert.deepEqual(device.store, { migrationVersion: 1, toonwaterDecidedBy: 'user' }, 'the user decided, also for a ticked box');
    assert.equal(device.settings.export_enabled, false, 'nothing else is switched on');
  });

  test('[C-03 / HW-03] the options are those of every capability the device holds, not only of a ticked feature: the setpoint keeps its step and range, the meters their titles', () => {
    [{}, { toonwater: true }].forEach((features) => {
      const device = buildNewDevice(entered({ features }), { options });

      assert.deepEqual(device.capabilitiesOptions.target_temperature, { step: 0.5, min: 6, max: 30 }, JSON.stringify(features));
      assert.deepEqual(device.capabilitiesOptions['meter_power.peak'].title, { en: 'Power meter peak (total)', nl: 'Stroom meterstand piek' });
      assert.deepEqual(device.capabilitiesOptions['meter_power.offPeak'].title, { en: 'Power meter off-peak (total)', nl: 'Stroom meterstand dal' });
      assert.deepEqual(device.capabilitiesOptions['alarm_water.hotwater'].title, { en: 'Hot water dispensing', nl: 'Warm water afgifte' });
      assert.deepEqual(Object.keys(device.capabilitiesOptions).filter((id) => !device.capabilities.includes(id)), [], 'and nothing for an item that is not on the device');
    });
    assert.equal(Object.hasOwn(buildNewDevice(entered(), { options }).capabilitiesOptions, 'meter_water.total'), false);
    assert.equal(Object.hasOwn(buildNewDevice(entered(), { options }).capabilitiesOptions, 'measure_power.export'), false);
  });

  test('the options are copies: changing the device does not change the manifest', () => {
    const device = buildNewDevice(entered({ features: { toonwater: true } }), { options });
    device.capabilitiesOptions['meter_water.today'].title.en = 'changed';

    assert.equal(options['meter_water.today'].title.en, 'Water today');
  });

  test('a switch counts only when it is exactly true, for an own property of a known optional feature', () => {
    [{ toonwater: 'true' }, { toonwater: 1 }, { toonwater: null }, { core: true }, { unknown: true }, Object.create({ toonwater: true })].forEach((features) => {
      const device = buildNewDevice(entered({ features }), { options });

      assert.equal(device.settings.toonwater_enabled, false, JSON.stringify(features));
      assert.deepEqual(device.capabilities, CORE);
    });
    assert.equal(buildNewDevice(entered({ features: undefined }), { options }).settings.toonwater_enabled, false, 'no choice is off');
  });

  test('FR-04 AC1: the id is stored trimmed; the name is trimmed and defaults to the id', () => {
    assert.deepEqual(buildNewDevice(entered({ id: '  ENECO-001  ', name: '' }), { options }).data, { id: 'ENECO-001' });
    assert.equal(buildNewDevice(entered({ id: '  ENECO-001  ', name: '' }), { options }).name, 'ENECO-001');
    assert.equal(buildNewDevice(entered({ name: '   ' }), { options }).name, 'ENECO-001-12391');
    assert.equal(buildNewDevice(entered({ name: undefined }), { options }).name, 'ENECO-001-12391');
    assert.equal(buildNewDevice(entered({ name: '  Living room ' }), { options }).name, 'Living room');
  });

  test('FR-03 AC1: the address is stored normalised', () => {
    assert.equal(buildNewDevice(entered({ address: ' http://192.168.1.50/ ' }), { options }).settings.address, '192.168.1.50');
  });

  test('an empty id is refused, also when it is only spaces (FR-04 AC1); an id that is taken is refused', () => {
    assert.equal(problemKey(() => buildNewDevice(entered({ id: '' }), { options })), 'pair.id_required');
    assert.equal(problemKey(() => buildNewDevice(entered({ id: ' \t ' }), { options })), 'pair.id_required');
    assert.equal(problemKey(() => buildNewDevice(entered({ id: ' ENECO-001 ' }), { options, taken: ['ENECO-001'] })), 'pair.id_taken');
    assert.equal(buildNewDevice(entered({ id: 'ENECO-002' }), { options, taken: ['ENECO-001'] }).data.id, 'ENECO-002');
  });

  test('FR-03 AC2: an address that is empty or not valid is refused', () => {
    assert.equal(problemKey(() => buildNewDevice(entered({ address: '' }), { options })), 'pair.address_required');
    assert.equal(problemKey(() => buildNewDevice(entered({ address: '0.0.0.0' }), { options })), 'error.address_invalid');
    assert.equal(problemKey(() => buildNewDevice(entered({ address: 'https://192.168.1.50' }), { options })), 'error.address_https');
    assert.equal(problemKey(() => buildNewDevice(entered({ address: 'fe80::1' }), { options })), 'error.address_ipv6');
  });

  test('R-11: a field of the wrong type is refused, whichever field it is, and nothing but a PairingProblem is thrown', () => {
    [
      { id: 12 }, { id: null }, { id: undefined }, { id: {} }, { address: 5 }, { address: undefined }, { address: ['192.168.1.50'] },
      { name: 5 }, { name: {} }, { features: 'toonwater' }, { features: [] }, { features: 1 }, { features: null },
    ].forEach((changes) => {
      assert.equal(problemKey(() => buildNewDevice(entered(changes), { options })), 'pair.invalid_input', JSON.stringify(changes));
    });
    [null, undefined, 'text', 12, []].forEach((input) => {
      assert.equal(problemKey(() => buildNewDevice(input, { options })), 'pair.invalid_input', String(input));
    });
  });

  test('the settings and the store are what the manifest and the migration expect', () => {
    const device = buildNewDevice(entered(), { options });
    const settingIds = driverManifest.settings.flatMap((entry) => (entry.type === 'group' ? entry.children : [entry])).map((entry) => entry.id);
    const pollInterval = driverManifest.settings.flatMap((entry) => entry.children || []).find((entry) => entry.id === 'poll_interval');

    assert.equal(Object.keys(device.settings).every((key) => settingIds.includes(key)), true, 'every setting is one of the driver');
    assert.equal(device.settings.poll_interval, pollInterval.value, 'the default of the setting');
    assert.equal(INTERVAL.default, pollInterval.value, 'the default of the code and the one of the setting file are one number');
    assert.equal(device.capabilities.every((id) => driverManifest.capabilities.includes(id)), true);
  });

  test('FR-111: a feature that is registered gets its setting, its decision and its options with no edit to the pairing', () => {
    const registry = [...FEATURES, synthetic];
    const withOptions = { ...options, measure_pressure: { title: { en: 'Pressure', nl: 'Druk' } } };
    const off = buildNewDevice(entered(), { registry, options: withOptions });
    const on = buildNewDevice(entered({ features: { synthetic: true } }), { registry, options: withOptions });

    assert.equal(off.settings.synthetic_enabled, false);
    assert.equal(off.capabilities.includes('measure_pressure'), false);
    assert.equal(on.settings.synthetic_enabled, true);
    assert.equal(on.capabilities.includes('measure_pressure'), true);
    assert.deepEqual(on.capabilitiesOptions, { ...heldOptions(CORE), measure_pressure: withOptions.measure_pressure });
    assert.equal(Object.hasOwn(off.capabilitiesOptions, 'measure_pressure'), false);
  });
});

/**
 * A client for a mock Toon, and a way to let the fake clock run until a promise has settled. The timers of the client
 * and of the test are watched: `timersLeft()` is the number that was armed by them and neither fired nor cleared (the
 * mock Toon keeps its own timers, as a real Toon keeps working after the client has gone).
 */
function boot(toonOptions = {}, clientOptions = {}) {
  const clock = createClock();
  const toon = createMockToon(toonOptions);
  const pending = new Set();
  const timers = {
    setTimeout(callback, ms) {
      const handle = clock.setTimeout(() => {
        pending.delete(handle);
        callback();
      }, ms);
      pending.add(handle);
      return handle;
    },
    clearTimeout(handle) {
      pending.delete(handle);
      clock.clearTimeout(handle);
    },
  };
  const client = new ToonClient({
    host: '192.168.1.50', fetch: toon.fetchWith(clock), timers, ...clientOptions,
  });
  const settle = (promise) => settleOn(clock, promise);
  const run = (registry = FEATURES) => settle(testConnection(client, { registry, timers }));
  return {
    clock, toon, client, settle, run, timersLeft: () => pending.size,
  };
}

describe('FR-02 AC1: the connection test reads the thermostat and tells what the Toon reported', () => {
  test('a Toon with ToonWater: the readings in degrees, the program and the state, and what the probe found', async () => {
    const { run, toon } = boot();
    const { value, error } = await run();

    assert.equal(error, undefined);
    assert.deepEqual(value, {
      host: '192.168.1.50',
      readings: {
        currentTemp: 20.3, currentSetpoint: 18.5, programState: 'on', activeState: 'home',
      },
      features: { toonwater: 'detected' },
    });
    assert.deepEqual(toon.requests().map((entry) => `${entry.path}${entry.query.action ? `?${entry.query.action}` : ''}`), ['/happ_thermstat?getThermostatInfo', '/water.html']);
    assert.equal(toon.maxConcurrent(), 1, 'NFR-03: one request at a time');
  });

  test('the program of the Toon and its vacation state', async () => {
    const { run, toon } = boot({ vacation: true });
    const { value } = await run();

    assert.equal(value.readings.activeState, 'vacation');
    assert.equal(value.readings.programState, null, 'programState 4 is not reported');
    toon.state.thermostat.programState = '0';
    assert.equal((await run()).value.readings.programState, 'off');
  });

  test('the host is the one the client talks to', async () => {
    const { run } = boot({}, { host: 'toon.local:80' });

    assert.equal((await run()).value.host, 'toon.local:80');
  });
});

describe('FR-61: the probe tells whether the add-on is there, without failing the test', () => {
  [
    ['present', 'detected'],
    ['old-shape', 'detected'],
    ['404', 'not_found'],
    ['html-200', 'unknown'],
    ['403', 'unknown'],
    ['500', 'unknown'],
    ['junk', 'unknown'],
    ['flat-ESP', 'unknown'],
  ].forEach(([mode, expected]) => {
    test(`FR-61 AC1/AC2: the page answers ${mode}: ${expected}${mode === '404' ? ' [HW-07]' : ''}`, async () => {
      const { run } = boot({ water: mode });
      const { value, error } = await run();

      assert.equal(error, undefined);
      assert.equal(value.features.toonwater, expected);
      assert.equal(value.readings.currentTemp, 20.3, 'the test itself succeeded');
    });
  });

  test('FR-61 AC3: a page that is slow, refused or never answered is unknown, and the probe is over within 3 s', async () => {
    for (const [name, toonOptions, fault] of [['slow', { water: 'slow' }], ['refused', {}, 'refused'], ['never answers', {}, 'timeout'], ['redirects', {}, 'redirect'], ['too big', {}, 'oversize']]) {
      const { run, toon, timersLeft } = boot(toonOptions);
      if (fault) toon.fault(fault, { path: '/water.html' });
      const { value, error, tookMs } = await run();

      assert.equal(error, undefined, name);
      assert.equal(value.features.toonwater, 'unknown', name);
      assert.ok(tookMs <= 3000, `${name}: ${tookMs} ms for the probe`);
      assert.equal(timersLeft(), 0, `${name}: no timer of the test is left behind`);
    }
  });

  test('FR-61 AC3: a probe that throws, against its contract, is unknown too', async () => {
    const broken = {
      ...toonwater,
      id: 'broken',
      probe: async () => {
        throw new Error('boom');
      },
    };
    const { run } = boot();
    const { value, error } = await run([...FEATURES, broken]);

    assert.equal(error, undefined);
    assert.deepEqual(value.features, { toonwater: 'detected', broken: 'unknown' });
  });

  test('only optional features that have a probe are asked; the others get no entry and cost no request', async () => {
    const { run, toon } = boot();
    const { value } = await run(FEATURES.filter((feature) => feature.id !== 'toonwater'));

    assert.deepEqual(value.features, {});
    assert.equal(toon.requests().length, 1);
  });

  test('a probe gets the budget of its feature as its signal, and the timer is removed again', async () => {
    const seen = [];
    const probing = {
      id: 'probing',
      optional: true,
      probeBudgetMs: 1234,
      probe: async (client, { signal }) => {
        seen.push(signal); return { outcome: 'detected' };
      },
    };
    const { run, timersLeft } = boot();
    const { value } = await run([probing]);

    assert.deepEqual(value.features, { probing: 'detected' });
    assert.equal(seen[0] instanceof AbortSignal, true);
    assert.equal(seen[0].aborted, false);
    assert.equal(timersLeft(), 0);
  });
});

describe('FR-02 AC2 / AC3 / AC4: what is not a working Toon is told apart', () => {
  test('FR-02 AC3: JSON without currentTemp and currentSetpoint is not a Toon', async () => {
    const answers = [
      {}, { hello: 'world' }, { currentTemp: '2034' }, { currentSetpoint: '1850' },
      { currentTemp: 'abc', currentSetpoint: '1850' }, { currentTemp: '2034', currentSetpoint: '0' },
    ];
    for (const answer of answers) {
      const { run, toon } = boot();
      toon.state.thermostat = answer;
      const { error } = await run();

      assert.ok(error instanceof PairingProblem, JSON.stringify(answer));
      assert.equal(error.key, 'error.not_toon', JSON.stringify(answer));
      assert.equal(toon.requestsTo('/water.html').length, 0, 'the add-on is not asked about at an address that is not a Toon');
    }
  });

  test('FR-02 AC3: a redirect, an answer that is too big and a page that is not JSON are not a Toon either', async () => {
    for (const fault of ['redirect', 'oversize']) {
      const { run, toon } = boot();
      toon.fault(fault);

      assert.equal((await run()).error.key, 'error.not_toon', fault);
    }
    const clock = createClock();
    const router = async () => new Response('<html>router</html>', { status: 200, headers: { 'content-type': 'text/html' } });
    const client = new ToonClient({ host: '192.168.1.1', fetch: router, timers: clock.timers });

    await assert.rejects(testConnection(client, { timers: clock.timers }), (error) => error instanceof PairingProblem && error.key === 'error.not_toon');
  });

  test('FR-02 AC4: a status of the host comes through as it is, for the message with the code', async () => {
    const { run, toon } = boot();
    toon.fault('500');
    const { error } = await run();

    assert.ok(error instanceof ToonError);
    assert.equal(error.kind, 'http');
    assert.equal(error.status, 500);
  });

  test('FR-02 AC2: a Toon that does not answer is a timeout within 6 s, one that refuses is a network problem, and the add-on is not asked', async () => {
    const slow = boot();
    slow.toon.fault('timeout');
    const timedOut = await slow.run();
    const refused = boot();
    refused.toon.fault('refused');
    const refusal = await refused.run();

    assert.equal(timedOut.error.kind, 'timeout');
    assert.ok(timedOut.tookMs <= 6000, `${timedOut.tookMs} ms`);
    assert.equal(refusal.error.kind, 'network');
    assert.equal(slow.timersLeft(), 0);
    assert.equal(refused.toon.requestsTo('/water.html').length, 0);
  });

  test('{"result":"error"} is the Toon refusing, and keeps its own message', async () => {
    const { run, toon } = boot();
    toon.fault('result-error');
    const { error } = await run();

    assert.ok(error instanceof ToonError);
    assert.equal(error.kind, 'toon_error');
  });
});

describe('FR-100 / NFR-16: every problem of the pairing is a plain sentence in en and nl', () => {
  const keys = ['pair.address_required', 'pair.id_required', 'pair.id_taken', 'pair.invalid_input', 'error.not_toon', 'error.address_https', 'error.address_ipv6', 'error.address_invalid'];
  const INTERNALS = /fetch|undici|ECONN|ToonError|PairingProblem|TypeError|stack|undefined|kind|measure_|meter_|\{|\}|__/i;

  test('a PairingProblem has the text of its key, in the language of the Homey', () => {
    for (const language of ['en', 'nl']) {
      const { homey, locales } = createWorld({ language });
      for (const key of keys) {
        const text = pairingMessage(homey, new PairingProblem(key));
        const expected = key.split('.').reduce((node, part) => node[part], locales[language]);

        assert.equal(text, expected, `${language} ${key}`);
        assert.doesNotMatch(text, INTERNALS, `${language} ${key}: ${text}`);
      }
    }
  });

  test('a ToonError has the message of toUserMessage, with the status for http', () => {
    const { homey } = createWorld({ language: 'en' });
    const { homey: dutch } = createWorld({ language: 'nl' });

    assert.match(pairingMessage(homey, new ToonError('http', { status: 404 })), /code 404/);
    assert.match(pairingMessage(dutch, new ToonError('http', { status: 500 })), /code 500/);
    assert.match(pairingMessage(homey, new ToonError('timeout')), /did not answer in time/);
    assert.match(pairingMessage(dutch, new ToonError('network')), /Homey kan de Toon niet bereiken/);
  });

  test('an error that is neither one gives the general sentence and none of its own words', () => {
    const { homey } = createWorld({ language: 'en' });
    const text = pairingMessage(homey, new TypeError('Cannot read properties of undefined'));

    assert.match(text, /Something went wrong/);
    assert.doesNotMatch(text, /properties|undefined/);
    assert.equal(pairingMessage(homey, 'text'), text);
  });
});

describe('FR-01 AC1 / FR-51 AC2 / FR-110: a device as the pairing builds it starts without a migration', () => {
  const MIGRATION_CALLS = ['addCapability', 'removeCapability', 'setStoreValue'];

  test('left unticked it holds the core capabilities, makes no migration step and never asks for /water.html', async () => {
    await withScenario(undefined, async (scenario) => {
      const { world, clock, toon } = scenario;
      const session = await world.startPairing('open-toon');
      const device = await session.createDevice(buildNewDevice(entered(), { options }));
      await clock.tick(10 * 60e3);

      assert.deepEqual(device.getCapabilities(), CORE);
      assert.deepEqual(MIGRATION_CALLS.flatMap((method) => world.callsOf(method)), [], 'nothing was added, removed or written to the store');
      assert.deepEqual(device.getStore(), { migrationVersion: 1, toonwaterDecidedBy: 'user' });
      assert.equal(device.getSetting('toonwater_enabled'), false);
      assert.equal(toon().requestsTo('/water.html').length, 0, 'FR-51 AC2');
      assert.ok(toon().requestsTo('/happ_thermstat').length >= 19, 'the device polls');
      assert.equal(device.getCapabilityValue('measure_temperature'), 20.3);
      assert.deepEqual(scenario.deviceLog('error'), []);
      assert.equal(device.fake.warning, null, 'FR-51 AC3');
    });
  });

  test('ticked it holds the water items with their titles, makes no migration step and reads the page', async () => {
    await withScenario(undefined, async (scenario) => {
      const { world, clock, toon } = scenario;
      const session = await world.startPairing('open-toon');
      const device = await session.createDevice(buildNewDevice(entered({ features: { toonwater: true } }), { options }));
      await clock.tick(10e3);

      assert.deepEqual(device.getCapabilities(), [...CORE, ...WATER]);
      assert.deepEqual(MIGRATION_CALLS.flatMap((method) => world.callsOf(method)), []);
      assert.deepEqual(device.getCapabilityOptions('meter_water.today').title, { en: 'Water today', nl: 'Water vandaag' });
      assert.equal(world.callsOf('setCapabilityOptions').length, 0, 'the options were already right');
      assert.equal(device.getSetting('toonwater_enabled'), true);
      assert.ok(toon().requestsTo('/water.html').length >= 1);
      assert.equal(device.getCapabilityValue('meter_water.total'), 7350.214);
    });
  });
});
