'use strict';

/*
 * Pairing end to end (ADR-0008): the real driver and device files under the fake Homey, a fake PairSession that
 * plays the part of the pair view (`call` = Homey.emit, `createDevice` = Homey.createDevice), the mock Toon behind the
 * global fetch and a fake clock. A second group runs the real pair view (drivers/open-toon/pair/start.html) against
 * the same session in a minimal DOM. What this cannot show is how Homey's own pairing screen (web and mobile app,
 * light and dark mode, the real text of a rejected createDevice) behaves: those tests carry [HW-01].
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { createScenario, withScenario } = require('../helpers/scenario');
const { settle } = require('../helpers/fake-clock');
const { fetchAdapter } = require('../helpers/mock-toon');
const { loadPairView } = require('../helpers/pair-view');

const HOST = '192.168.1.50';
const WATER = ['measure_water', 'meter_water.today', 'meter_water.total'];
const MINUTE = 60e3;
const say = (scenario, key, tokens) => scenario.world.homey.__(key, tokens);
const INTERNALS = /fetch|undici|ECONN|ToonError|PairingProblem|TypeError|stack|undefined|\bkind\b|measure_|meter_|\{|\}|__/i;

/** A pair session of the driver; `call` is Homey.emit of the view and lets the fake clock run until the handler has answered. */
async function open(scenario) {
  const session = await scenario.world.startPairing('open-toon');
  return { session, call: (event, data) => settle(scenario.clock, session.call(event, data)) };
}

/** Another web server at `host` (a router, a printer): every request is answered by `handler`. */
function serveOther(scenario, host, handler) {
  const toons = globalThis.fetch;
  const other = fetchAdapter(handler, { timers: scenario.clock, now: scenario.clock.now });
  globalThis.fetch = (input, init) => (new URL(typeof input === 'string' ? input : input.url).host === host ? other(input, init) : toons(input, init));
  return other.recorder;
}

/** Tests the address and adds the device as the view does, one step after the other. */
async function pair(scenario, entered = {}) {
  const { session, call } = await open(scenario);
  const tested = await call('testConnection', { address: entered.address || HOST });
  assert.equal(tested.error, undefined, tested.error && tested.error.message);
  const built = await call('buildDevice', {
    name: 'Living room', id: 'ENECO-001-12391', address: tested.value.host, features: {}, ...entered,
  });
  assert.equal(built.error, undefined, built.error && built.error.message);
  return { tested: tested.value, device: await session.createDevice(built.value), session };
}

describe('FR-01 AC1 / FR-02 AC1: a Toon that answers is tested and added', () => {
  test('the test returns what the Toon reported, Connect creates the device once with the id, the name and the address, and no water item', async () => {
    await withScenario(undefined, async (scenario) => {
      const { world, clock, toon } = scenario;
      const { session, call } = await open(scenario);
      const created = [];
      const createDevice = session.createDevice.bind(session);
      session.createDevice = (data) => {
        created.push(data);
        return createDevice(data);
      };

      const tested = await call('testConnection', { address: ` http://${HOST}/ ` });
      assert.deepEqual(tested.value, {
        host: HOST,
        readings: {
          currentTemp: 20.3, currentSetpoint: 18.5, programState: 'on', activeState: 'home',
        },
        features: { toonwater: 'detected' },
      });
      assert.equal(world.devices().length, 0, 'testing adds nothing');

      const built = await call('buildDevice', {
        name: 'Living room', id: ' ENECO-001-12391 ', address: tested.value.host, features: {},
      });
      const device = await session.createDevice(built.value);
      await clock.tick(5 * MINUTE);

      assert.equal(created.length, 1);
      assert.equal(world.devices().length, 1);
      assert.equal(device.getName(), 'Living room');
      assert.deepEqual(device.getData(), { id: 'ENECO-001-12391' }, 'FR-04 AC1: trimmed');
      assert.equal(device.getSetting('address'), HOST, 'FR-03 AC1: the normalised address');
      assert.equal(device.getSetting('poll_interval'), 30);
      assert.equal(WATER.some((id) => device.hasCapability(id)), false, 'FR-51 AC1');
      assert.equal(device.hasCapability('alarm_water.hotwater'), true);
      assert.equal(toon().requestsTo('/water.html').length, 1, 'only the probe of the test asked for the page, and the device never does (FR-51 AC2)');
      assert.equal(device.getCapabilityValue('measure_temperature'), 20.3, 'the device works at once');
      assert.deepEqual(scenario.deviceLog('error'), []);
    });
  });

  test('the name defaults to the id, and a blank name does too', async () => {
    await withScenario(undefined, async (scenario) => {
      const { device } = await pair(scenario, { name: '   ', id: 'ENECO-007' });

      assert.equal(device.getName(), 'ENECO-007');
    });
  });

  test('NFR-04: the only host that was contacted is the one that was typed', async () => {
    await withScenario(undefined, async (scenario) => {
      await pair(scenario);
      await scenario.clock.tick(MINUTE);

      assert.deepEqual(scenario.hostsContacted(), [HOST]);
    });
  });
});

describe('FR-02 AC2 / AC3 / AC4: what goes wrong is told in a sentence of the language of the user, and no device is made', () => {
  test('FR-02 AC2: an address nobody answers at is a sentence within 6 s', async () => {
    await withScenario(undefined, async (scenario) => {
      const { call } = await open(scenario);
      const { error, tookMs } = await call('testConnection', { address: '192.168.1.99' });

      assert.equal(error.message, say(scenario, 'error.network'));
      assert.ok(tookMs <= 6000, `${tookMs} ms`);
      assert.equal(scenario.world.devices().length, 0);
      assert.deepEqual(scenario.hostsContacted(), ['192.168.1.99']);
    });
  });

  test('FR-02 AC2: a Toon that does not answer is a sentence within 6 s, and the timer of the request is gone', async () => {
    await withScenario(undefined, async (scenario) => {
      scenario.toon().fault('timeout');
      const { call } = await open(scenario);
      const { error, tookMs } = await call('testConnection', { address: HOST });

      assert.equal(error.message, say(scenario, 'error.timeout'));
      assert.ok(tookMs <= 6000, `${tookMs} ms`);
      assert.equal(scenario.toon().requestsTo('/water.html').length, 0);
    });
  });

  test('the same sentence in Dutch for a Dutch Homey', async () => {
    await withScenario({ language: 'nl' }, async (scenario) => {
      const { call } = await open(scenario);
      const { error } = await call('testConnection', { address: '192.168.1.99' });

      assert.match(error.message, /Homey kan de Toon niet bereiken/);
      assert.equal(error.message, say(scenario, 'error.network'));
    });
  });

  test('FR-02 AC4: HTTP 404 and 500 name the status in the sentence', async () => {
    await withScenario({ toons: { [HOST]: {}, '192.168.1.1': {} } }, async (scenario) => {
      scenario.toon().fault('500');
      serveOther(scenario, '192.168.1.1', () => ({ status: 404, headers: {}, body: 'Not Found' }));
      const { call } = await open(scenario);
      const failing = await call('testConnection', { address: HOST });
      const missing = await call('testConnection', { address: '192.168.1.1' });

      assert.equal(failing.error.message, say(scenario, 'error.http', { status: '500' }));
      assert.match(failing.error.message, /code 500/);
      assert.equal(missing.error.message, say(scenario, 'error.http', { status: '404' }));
      assert.match(missing.error.message, /code 404/);
    });
  });

  test('FR-02 AC3: JSON that is not a Toon\'s, a web page and a redirect are "this does not look like an open Toon"', async () => {
    await withScenario({ toons: { [HOST]: {}, '192.168.1.60': {}, '192.168.1.1': {} } }, async (scenario) => {
      scenario.toon('192.168.1.60').state.thermostat = { hello: 'world' };
      scenario.toon().fault('redirect');
      serveOther(scenario, '192.168.1.1', () => ({ status: 200, headers: { 'content-type': 'text/html' }, body: '<html><body>Router</body></html>' }));
      const { call } = await open(scenario);

      for (const address of [HOST, '192.168.1.60', '192.168.1.1']) {
        const { error } = await call('testConnection', { address });

        assert.equal(error.message, say(scenario, 'error.not_toon'), address);
      }
      assert.equal(scenario.world.devices().length, 0);
      assert.equal(scenario.toon('192.168.1.60').requestsTo('/water.html').length, 0, 'the add-on is not asked about at an address that is not a Toon');
    });
  });

  test('NFR-16 AC1: no sentence names an internal, and each says what to do', async () => {
    await withScenario({ toons: { [HOST]: {}, '192.168.1.60': {} } }, async (scenario) => {
      scenario.toon().fault('refused');
      scenario.toon('192.168.1.60').state.thermostat = {};
      const { call } = await open(scenario);
      const asked = [
        await call('testConnection', { address: HOST }),
        await call('testConnection', { address: '192.168.1.60' }),
        await call('testConnection', { address: '' }),
        await call('testConnection', { address: 'https://192.168.1.50' }),
        await call('testConnection', { address: 'fe80::1' }),
        await call('testConnection', { address: 12 }),
        await call('buildDevice', { id: '', address: HOST }),
      ];

      assert.equal(new Set(asked.map(({ error }) => error.message)).size, asked.length, 'every problem has its own sentence');
      asked.forEach(({ error }) => {
        assert.doesNotMatch(error.message, INTERNALS, error.message);
        assert.match(error.message, /\.$/, 'a sentence');
      });
    });
  });

  test('an error that is not ours becomes the general sentence, none of its own words, and is logged', async () => {
    await withScenario(undefined, async (scenario) => {
      scenario.world.driver('open-toon').createClient = () => ({
        host: HOST,
        get: () => {
          throw new TypeError('Cannot read properties of undefined (reading boom)');
        },
      });
      const { call } = await open(scenario);
      const { error } = await call('testConnection', { address: HOST });

      assert.equal(error.message, say(scenario, 'error.unknown'));
      assert.deepEqual(scenario.world.logs.filter((entry) => entry.level === 'error').map((entry) => String(entry.args[0])), ['pairing failed unexpectedly:']);
    });
  });
});

describe('FR-01 AC3 / FR-03 / NFR-04: an address that is not valid sends nothing', () => {
  [
    ['', 'pair.address_required'],
    ['   ', 'pair.address_required'],
    ['https://192.168.1.50', 'error.address_https'],
    ['fe80::1', 'error.address_ipv6'],
    ['[fe80::1]:80', 'error.address_ipv6'],
    ['0.0.0.0', 'error.address_invalid'],
    ['192.168.1.50/foo', 'error.address_invalid'],
    ['192.168.1.50?x=1', 'error.address_invalid'],
    ['user@192.168.1.50', 'error.address_invalid'],
    ['a b', 'error.address_invalid'],
    ['192.168.1.50:99999', 'error.address_invalid'],
  ].forEach(([address, key]) => {
    test(`${JSON.stringify(address)} gives its sentence (${key}), no request and no device`, async () => {
      await withScenario(undefined, async (scenario) => {
        const { call } = await open(scenario);
        const { error, tookMs } = await call('testConnection', { address });

        assert.equal(error.message, say(scenario, key));
        assert.equal(tookMs, 0);
        assert.equal(scenario.requestCount(), 0);
        assert.equal(scenario.world.devices().length, 0);
      });
    });
  });

  test('https:// and IPv6 are not the same sentence as an address that is merely wrong', () => {
    const keys = ['error.address_https', 'error.address_ipv6', 'error.address_invalid'];
    const { world } = createScenario();

    assert.equal(new Set(keys.map((key) => world.homey.__(key))).size, 3);
  });
});

describe('R-11: nothing the view sends can make the app throw', () => {
  const garbage = [null, undefined, 5, 'text', [], true];

  test('a numeric id or address gives a localized sentence, no throw, no request, no device, no error line', async () => {
    await withScenario(undefined, async (scenario) => {
      const { call } = await open(scenario);
      const sentence = say(scenario, 'pair.invalid_input');
      const asked = [
        await call('buildDevice', {
          name: 'x', id: 12, address: HOST, features: {},
        }),
        await call('buildDevice', {
          name: 'x', id: 'ENECO', address: 12, features: {},
        }),
        await call('buildDevice', {
          name: 12, id: 'ENECO', address: HOST, features: {},
        }),
        await call('buildDevice', {
          name: 'x', id: 'ENECO', address: HOST, features: 'toonwater',
        }),
        await call('testConnection', { address: 12 }),
        await call('testConnection', { address: null }),
        await call('testConnection', {}),
      ];

      asked.forEach(({ error, value }) => {
        assert.equal(value, undefined);
        assert.equal(error.message, sentence);
      });
      assert.equal(scenario.requestCount(), 0);
      assert.equal(scenario.world.devices().length, 0);
      assert.deepEqual(scenario.world.logs.filter((entry) => entry.level === 'error'), []);
    });
  });

  test('a request that is not an object at all is refused the same way, by both handlers', async () => {
    await withScenario(undefined, async (scenario) => {
      const { call } = await open(scenario);

      for (const data of garbage) {
        for (const event of ['testConnection', 'buildDevice']) {
          const { error } = await call(event, data);

          assert.equal(error.message, say(scenario, 'pair.invalid_input'), `${event} ${JSON.stringify(data)}`);
        }
      }
      assert.equal(scenario.requestCount(), 0);
    });
  });

  test('FR-04 AC1: an empty id is refused, also when it is only spaces', async () => {
    await withScenario(undefined, async (scenario) => {
      const { call } = await open(scenario);

      for (const id of ['', '   ', '\t']) {
        const { error } = await call('buildDevice', { name: 'x', id, address: HOST });

        assert.equal(error.message, say(scenario, 'pair.id_required'));
      }
      assert.equal(scenario.world.devices().length, 0);
    });
  });
});

describe('FR-04: the id of a device is its identity', () => {
  test('FR-04 AC2: a second Toon with an id that exists is refused in a sentence, and no second device is made', async () => {
    await withScenario(undefined, async (scenario) => {
      await pair(scenario, { id: 'ENECO-001' });
      const { call } = await open(scenario);
      const again = await call('buildDevice', {
        name: 'Other', id: ' ENECO-001 ', address: HOST, features: {},
      });
      const other = await call('buildDevice', {
        name: 'Other', id: 'ENECO-002', address: HOST, features: {},
      });

      assert.equal(again.error.message, say(scenario, 'pair.id_taken'));
      assert.equal(other.error, undefined);
      assert.equal(scenario.world.devices().length, 1);
    });
  });

  test('FR-04 AC2 [HW-01]: when two screens race, Homey\'s own refusal of a second createDevice is what the view gets', async () => {
    await withScenario(undefined, async (scenario) => {
      const first = await open(scenario);
      const second = await open(scenario);
      const entered = {
        name: 'x', id: 'ENECO-001', address: HOST, features: {},
      };
      const built = (await first.call('buildDevice', entered)).value;
      assert.deepEqual((await second.call('buildDevice', entered)).value, built, 'neither screen knew about the other');

      await first.session.createDevice(built);
      await assert.rejects(second.session.createDevice(built), /already exists/);
      assert.equal(scenario.world.devices().length, 1);
    });
  });

  test('FR-04 AC3: two Toons with different ids and addresses run independently: one that fails never changes the other', async () => {
    await withScenario({ toons: { [HOST]: {}, '192.168.1.51': {} } }, async (scenario) => {
      const { clock } = scenario;
      const first = await pair(scenario, { id: 'ENECO-001', address: HOST });
      const second = await pair(scenario, { id: 'ENECO-002', address: '192.168.1.51' });
      await clock.tick(2 * MINUTE);
      scenario.toon('192.168.1.51').fault('refused');
      scenario.toon().state.thermostat.currentTemp = '2150';
      await clock.tick(10 * MINUTE);

      assert.equal(first.device.getAvailable(), true);
      assert.equal(first.device.getCapabilityValue('measure_temperature'), 21.5);
      assert.equal(second.device.getAvailable(), false);
      assert.equal(second.device.getCapabilityValue('measure_temperature'), 20.3, 'its values stay');
      assert.deepEqual(first.device.getData(), { id: 'ENECO-001' });
      assert.deepEqual(second.device.getData(), { id: 'ENECO-002' });
    });
  });
});

describe('FR-61 / FR-51: ToonWater at pairing', () => {
  test('FR-61 AC1: a Toon with the add-on is reported as detected, and a device that is added without ticking has it off', async () => {
    await withScenario(undefined, async (scenario) => {
      const { clock, toon } = scenario;
      const { tested, device } = await pair(scenario);
      await clock.tick(30 * MINUTE);

      assert.equal(tested.features.toonwater, 'detected');
      assert.equal(device.getSetting('toonwater_enabled'), false, 'still off by default');
      assert.equal(WATER.some((id) => device.hasCapability(id)), false);
      assert.equal(toon().requestsTo('/water.html').length, 1, 'only the probe of the test asked: zero requests from the device (FR-51 AC2)');
      assert.equal(device.fake.warning, null);
      assert.equal(scenario.deviceLog().some((line) => /water/i.test(line)), false, 'FR-51 AC3: no line about it');
    });
  });

  test('FR-61 AC1: a ticked ToonWater gives the device the three items and their values within 10 s', async () => {
    await withScenario(undefined, async (scenario) => {
      const { session, call } = await open(scenario);
      const tested = await call('testConnection', { address: HOST });
      const built = await call('buildDevice', {
        name: 'x', id: 'ENECO-001', address: tested.value.host, features: { toonwater: true },
      });
      const device = await session.createDevice(built.value);
      await scenario.clock.tick(10e3);

      assert.equal(device.getSetting('toonwater_enabled'), true);
      assert.deepEqual(WATER.filter((id) => device.hasCapability(id)), WATER);
      assert.equal(device.getCapabilityValue('meter_water.total'), 7350.214);
      assert.equal(device.getCapabilityOptions('meter_water.total').title.en, 'Water meter total');
      assert.equal(device.getSetting('toonwater_status'), 'Detected');
      assert.equal(scenario.world.callsOf('addCapability').length, 0, 'the device was created with them: nothing to add');
    });
  });

  test('FR-61 AC2 [HW-07]: a Toon without the add-on (404) is reported as not found, with no error, and pairing goes on', async () => {
    await withScenario({ toons: { [HOST]: { water: '404' } } }, async (scenario) => {
      const { tested, device } = await pair(scenario);
      await scenario.clock.tick(30 * MINUTE);

      assert.equal(tested.features.toonwater, 'not_found');
      assert.equal(device.getAvailable(), true);
      assert.equal(device.fake.warning, null);
      assert.equal(scenario.toon().requestsTo('/water.html').length, 1);
      assert.deepEqual(scenario.deviceLog('error'), []);
    });
  });

  test('FR-61 AC3: a page that answers wrongly, is refused or never comes never fails the test', async () => {
    const cases = [
      [{ water: 'html-200' }], [{ water: 'junk' }], [{ water: '403' }], [{ water: '500' }], [{ water: 'flat-ESP' }],
      [{}, 'refused'], [{}, 'timeout'], [{}, 'redirect'], [{}, 'oversize'], [{}, 'result-error'],
    ];
    for (const [options, fault] of cases) {
      await withScenario({ toons: { [HOST]: options } }, async (scenario) => {
        if (fault) scenario.toon().fault(fault, { path: '/water.html' });
        const { call } = await open(scenario);
        const { value, error } = await call('testConnection', { address: HOST });

        assert.equal(error, undefined, `${JSON.stringify(options)} ${fault}`);
        assert.equal(value.features.toonwater, 'unknown', `${JSON.stringify(options)} ${fault}`);
        assert.equal(value.readings.currentTemp, 20.3);
      });
    }
  });

  test('FR-61 AC3: a probe that would take longer is cut off after 3 s, and the test is still a success', async () => {
    await withScenario({ toons: { [HOST]: { water: 'slow' } } }, async (scenario) => {
      const { call } = await open(scenario);
      const { value, error, tookMs } = await call('testConnection', { address: HOST });

      assert.equal(error, undefined);
      assert.equal(value.features.toonwater, 'unknown');
      assert.ok(tookMs <= 3000, `${tookMs} ms for the whole test with the probe`);
    });
  });

  test('FR-61: the test never has two requests to the Toon at once (NFR-03)', async () => {
    await withScenario(undefined, async (scenario) => {
      const { call } = await open(scenario);
      await call('testConnection', { address: HOST });

      assert.equal(scenario.toon().maxConcurrent(), 1);
    });
  });
});

/** The pair view in a minimal DOM, connected to a pair session of the driver. */
async function mount(scenario) {
  const { session, call } = await open(scenario);
  const seen = {
    emitted: [], created: [], done: 0, titles: [],
  };
  const view = loadPairView({
    __: (key, tokens) => say(scenario, key, tokens),
    emit: (event, data) => {
      seen.emitted.push(event);
      return session.call(event, data);
    },
    createDevice: (device) => {
      seen.created.push(device);
      return session.createDevice(device);
    },
    done: () => {
      seen.done += 1;
    },
    setTitle: (title) => seen.titles.push(title),
  });
  const press = (id) => settle(scenario.clock, view.click(id));
  return {
    view, seen, session, call, press,
  };
}

describe('FR-05 AC1 / FR-01 AC2 / FR-02 AC1 / AC5 [HW-01]: the pair view', () => {
  test('FR-01 AC2 [HW-01]: it starts with Connect disabled, no readings, no error and no ToonWater offer, and sets its title', async () => {
    await withScenario(undefined, async (scenario) => {
      const { view, seen, press } = await mount(scenario);

      assert.equal(view.element('connect').disabled, true);
      assert.equal(view.element('test').disabled, false);
      ['result', 'error', 'toonwater-offer'].forEach((id) => assert.equal(view.shown(id), false, id));
      assert.equal(view.element('toonwater').checked, false);
      assert.deepEqual(seen.titles, ['Add a Toon']);

      await press('connect');
      assert.deepEqual(seen.emitted, [], 'Connect without a test does nothing');
      assert.equal(seen.created.length, 0);
    });
  });

  test('FR-02 AC1 [HW-01]: a test shows the temperature, the setpoint, the program and the state, as text, and enables Connect', async () => {
    await withScenario(undefined, async (scenario) => {
      const { view, press } = await mount(scenario);
      view.element('address').value = ` http://${HOST}/ `;
      await press('test');

      assert.equal(view.shown('result'), true);
      assert.match(view.text('reading-temperature'), /^20[.,]3 °C$/);
      assert.match(view.text('reading-setpoint'), /^18[.,]5 °C$/);
      assert.equal(view.text('reading-program'), 'On');
      assert.equal(view.text('reading-state'), 'Home');
      assert.equal(view.shown('error'), false);
      assert.equal(view.element('connect').disabled, false);
      assert.equal(view.element('address').value, HOST, 'the field shows the address that will be used');
      assert.equal(view.element('test').disabled, false, 'and the test can be run again');
    });
  });

  test('FR-02 AC5 [HW-01]: editing the address after a test disables Connect again, hides what the test showed and withdraws the ToonWater offer', async () => {
    await withScenario(undefined, async (scenario) => {
      const { view, seen, press } = await mount(scenario);
      view.element('address').value = HOST;
      await press('test');
      await view.tick('toonwater');
      assert.equal(view.element('connect').disabled, false);
      assert.equal(view.shown('toonwater-offer'), true);

      await view.type('address', '192.168.1.51');

      assert.equal(view.element('connect').disabled, true);
      assert.equal(view.shown('result'), false);
      assert.equal(view.shown('toonwater-offer'), false);
      assert.equal(view.element('toonwater').checked, false, 'a tick of the old test does not carry over');
      await press('connect');
      assert.deepEqual(seen.emitted, ['testConnection'], 'no request to build a device');
    });
  });

  test('FR-02 AC5 [HW-01]: an address that is edited while its test runs is not taken over: the answer is dropped and Connect stays off', async () => {
    await withScenario(undefined, async (scenario) => {
      const { view, press } = await mount(scenario);
      view.element('address').value = HOST;
      const running = view.click('test');
      await view.type('address', '192.168.1.99');
      await settle(scenario.clock, running);

      assert.equal(view.element('address').value, '192.168.1.99');
      assert.equal(view.shown('result'), false);
      assert.equal(view.element('connect').disabled, true);
      assert.equal(view.element('test').disabled, false);

      scenario.toon().fault('refused');
      view.element('address').value = HOST;
      const failing = view.click('test');
      await view.type('address', '192.168.1.77');
      await settle(scenario.clock, failing);
      assert.equal(view.shown('error'), false, 'the failure of a test of another address is not shown either');

      view.element('address').value = HOST;
      await press('test');
      assert.equal(view.shown('error'), true, 'a failure of a test of the address that is there is');
    });
  });

  test('FR-02 AC2 [HW-01]: an address that nobody answers at shows the sentence inline, within 6 s, with Connect still disabled', async () => {
    await withScenario(undefined, async (scenario) => {
      const { view, press } = await mount(scenario);
      view.element('address').value = '192.168.1.99';
      const started = scenario.clock.now();
      await press('test');

      assert.equal(view.shown('error'), true);
      assert.equal(view.text('error'), say(scenario, 'error.network'));
      assert.ok(scenario.clock.now() - started <= 6000);
      assert.equal(view.element('connect').disabled, true);
      assert.equal(view.shown('result'), false);
      assert.equal(view.element('test').disabled, false, 'the user can try again');
    });
  });

  test('FR-01 AC3 [HW-01]: an empty address names the field, sends nothing; typing clears the message', async () => {
    await withScenario(undefined, async (scenario) => {
      const { view, press } = await mount(scenario);
      await press('test');

      assert.equal(view.text('error'), say(scenario, 'pair.address_required'));
      assert.equal(scenario.requestCount(), 0);

      await view.type('address', '1');
      assert.equal(view.shown('error'), false);
    });
  });

  test('FR-01 AC3 [HW-01]: Connect with an empty id names the field and creates nothing', async () => {
    await withScenario(undefined, async (scenario) => {
      const { view, seen, press } = await mount(scenario);
      view.element('address').value = HOST;
      await press('test');
      await press('connect');

      assert.equal(view.text('error'), say(scenario, 'pair.id_required'));
      assert.equal(seen.created.length, 0);
      assert.equal(seen.done, 0);
      assert.equal(view.element('connect').disabled, false, 'the user fills in the id and presses it again');
    });
  });

  test('FR-01 AC1 [HW-01]: Connect creates the device once with what was entered, then finishes the pairing', async () => {
    await withScenario(undefined, async (scenario) => {
      const { view, seen, press } = await mount(scenario);
      view.element('address').value = HOST;
      view.element('toon-id').value = ' ENECO-001-12391 ';
      view.element('name').value = 'Living room';
      await press('test');
      await press('connect');

      assert.equal(seen.created.length, 1);
      assert.equal(seen.done, 1);
      assert.equal(scenario.world.devices().length, 1);
      const [device] = scenario.world.devices();
      assert.equal(device.getName(), 'Living room');
      assert.deepEqual(device.getData(), { id: 'ENECO-001-12391' });
      assert.equal(device.getSetting('toonwater_enabled'), false, 'FR-61 AC1: the box was offered and not ticked');
      assert.equal(view.shown('error'), false);
    });
  });

  test('FR-61 AC1 [HW-01]: the ToonWater box is offered when it was detected, is not ticked, and a ticked box adds the water items', async () => {
    await withScenario({ toons: { [HOST]: {} } }, async (scenario) => {
      const { view, press } = await mount(scenario);
      view.element('address').value = HOST;
      view.element('toon-id').value = 'ENECO-001';
      await press('test');

      assert.equal(view.shown('toonwater-offer'), true);
      assert.equal(view.element('toonwater').checked, false, 'unticked by default');

      await view.tick('toonwater');
      await press('connect');
      await scenario.clock.tick(10e3);

      const [device] = scenario.world.devices();
      assert.equal(device.getSetting('toonwater_enabled'), true);
      assert.deepEqual(WATER.filter((id) => device.hasCapability(id)), WATER);
    });
  });

  test('FR-61 AC2 / AC3 [HW-01]: with no add-on (404), or a probe that failed, nothing about ToonWater is offered and the test is a success', async () => {
    for (const toonOptions of [{ water: '404' }, { water: '500' }, { water: 'slow' }]) {
      await withScenario({ toons: { [HOST]: toonOptions } }, async (scenario) => {
        const { view, press } = await mount(scenario);
        view.element('address').value = HOST;
        await press('test');

        assert.equal(view.shown('result'), true, JSON.stringify(toonOptions));
        assert.equal(view.shown('toonwater-offer'), false, JSON.stringify(toonOptions));
        assert.equal(view.shown('error'), false);
        assert.equal(view.element('connect').disabled, false);
      });
    }
  });

  test('FR-04 AC2 [HW-01]: an id that is taken is shown inline, the user can change it and add the Toon after all', async () => {
    await withScenario(undefined, async (scenario) => {
      await pair(scenario, { id: 'ENECO-001' });
      const { view, seen, press } = await mount(scenario);
      view.element('address').value = HOST;
      view.element('toon-id').value = 'ENECO-001';
      await press('test');
      await press('connect');

      assert.equal(view.text('error'), say(scenario, 'pair.id_taken'));
      assert.equal(seen.created.length, 0);
      assert.equal(seen.done, 0);

      await view.type('toon-id', 'ENECO-002');
      assert.equal(view.shown('error'), false);
      await press('connect');

      assert.equal(seen.done, 1);
      assert.equal(scenario.world.devices().length, 2);
    });
  });

  test('FR-04 AC2 [HW-01]: a refusal of createDevice itself (its text is Homey\'s) is shown inline in a sentence of ours', async () => {
    await withScenario(undefined, async (scenario) => {
      const { session, call } = await open(scenario);
      const entered = {
        name: 'x', id: 'ENECO-001', address: HOST, features: {},
      };
      const built = (await call('buildDevice', entered)).value; // checked while no Toon had this id, and created by the screen of someone else first
      await session.createDevice(built);
      const seen = { done: 0 };
      const view = loadPairView({
        __: (key, tokens) => say(scenario, key, tokens),
        emit: (event, data) => (event === 'buildDevice' ? Promise.resolve(built) : session.call(event, data)),
        createDevice: (device) => session.createDevice(device),
        done: () => {
          seen.done += 1;
        },
        setTitle: () => undefined,
      });
      view.element('address').value = HOST;
      view.element('toon-id').value = 'ENECO-001';
      await settle(scenario.clock, view.click('test'));
      await settle(scenario.clock, view.click('connect'));

      assert.equal(view.text('error'), say(scenario, 'pair.create_failed', { error: 'A device with this data already exists' }));
      assert.equal(seen.done, 0);
      assert.equal(scenario.world.devices().length, 1);
      assert.equal(view.element('connect').disabled, false);
    });
  });

  test('FR-01 AC1 [HW-01]: pressing Test twice while it runs sends one request; the buttons are off meanwhile', async () => {
    await withScenario(undefined, async (scenario) => {
      const { view, seen } = await mount(scenario);
      view.element('address').value = HOST;
      const first = view.click('test');
      assert.equal(view.element('test').disabled, true);
      assert.equal(view.element('connect').disabled, true);
      const second = view.click('test');
      await settle(scenario.clock, Promise.all([first, second]));

      assert.deepEqual(seen.emitted, ['testConnection']);
      assert.equal(view.element('test').disabled, false);
      assert.equal(view.element('test').classes.has('is-loading'), false);
    });
  });

  test('R-11 [HW-01]: Toon-supplied or foreign text is written as text and shows nothing it should not', async () => {
    await withScenario(undefined, async (scenario) => {
      const markup = '<img src=x onerror=alert(1)>';
      const hostile = loadPairView({
        __: (key, tokens) => say(scenario, key, tokens),
        emit: async () => ({
          host: HOST,
          readings: {
            currentTemp: markup, currentSetpoint: { toString: () => markup }, programState: markup, activeState: '__proto__',
          },
          features: { toonwater: markup },
        }),
        createDevice: async () => undefined,
        done: () => undefined,
        setTitle: () => undefined,
      });
      await settle(scenario.clock, hostile.click('test'));

      ['reading-temperature', 'reading-setpoint', 'reading-program', 'reading-state'].forEach((id) => assert.equal(hostile.text(id), '-', id));
      assert.equal(hostile.shown('toonwater-offer'), false);

      const failing = loadPairView({
        __: (key, tokens) => say(scenario, key, tokens),
        emit: async () => {
          throw new Error(markup);
        },
        createDevice: async () => undefined,
        done: () => undefined,
        setTitle: () => undefined,
      });
      await settle(scenario.clock, failing.click('test'));
      assert.equal(failing.text('error'), markup, 'a message is text, nothing is parsed');

      const silent = loadPairView({
        __: (key) => say(scenario, key),
        emit: async () => {
          throw new Error('');
        },
        createDevice: async () => undefined,
        done: () => undefined,
        setTitle: () => undefined,
      });
      await settle(scenario.clock, silent.click('test'));
      assert.equal(silent.text('error'), say(scenario, 'error.unknown'), 'a rejection without a message gets the general sentence');
    });
  });

  test('FR-100 [HW-01]: in Dutch the view shows Dutch words for the readings and the sentences', async () => {
    await withScenario({ language: 'nl' }, async (scenario) => {
      const { view, press } = await mount(scenario);
      view.element('address').value = HOST;
      await press('test');

      assert.equal(view.text('reading-program'), 'Aan');
      assert.equal(view.text('reading-state'), 'Thuis');

      await view.type('address', '');
      await press('test');
      assert.equal(view.text('error'), 'Vul het IP-adres van je Toon in.');
    });
  });

  test('FR-02 AC1 [HW-01]: every state and program the Toon can report has a word, and a vacation Toon shows it', async () => {
    await withScenario({ toons: { [HOST]: { vacation: true } } }, async (scenario) => {
      const { view, press } = await mount(scenario);
      view.element('address').value = HOST;
      await press('test');

      assert.equal(view.text('reading-state'), 'Vacation');
      assert.equal(view.text('reading-program'), '-', 'a program state that is not known shows a dash, not a guess');
    });
  });
});
