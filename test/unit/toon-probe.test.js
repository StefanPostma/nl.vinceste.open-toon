'use strict';

/*
 * scripts/toon-probe.js, the read-only helper of the hardware test plan (docs/sdlc/10-hardware-test-plan.md): what it
 * asks, that it cannot ask anything else, what it leaves out of the file, the watch mode and the file itself. It runs
 * against the in-repo mock Toon over a real HTTP server on 127.0.0.1, so the real `fetch` of Node is what is tested.
 * Every payload is a fixture "derived, not captured" (HW-02): the shape of a real answer is what the hardware test settles.
 */

const {
  describe, test,
} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const probe = require('../../scripts/toon-probe');
const { findViolations } = require('../../scripts/check-pack');
const { createMockToon } = require('../helpers/mock-toon');
const { toonPayload } = require('../helpers/fixtures');
const { ROOT, read } = require('../helpers/paths');
const core = require('../../lib/features/core');
const toonwater = require('../../lib/features/toonwater');
const { METER_RULES } = require('../../lib/toon/parse');

const NOW = Date.UTC(2026, 10, 14, 10, 15, 0);
const WRITE_FAILED = Object.freeze({ code: 'EEXIST' });

function capture(extra = {}) {
  const out = [];
  const err = [];
  const files = [];
  return {
    out,
    err,
    files,
    io: {
      write: (text) => out.push(text),
      warn: (text) => err.push(text),
      writeFile: (file, text) => files.push({ file, text }),
      now: () => NOW,
      cwd: path.join(ROOT, 'probe-output'),
      ...extra,
    },
  };
}

/** Starts a mock Toon on a real port, runs `fn`, and always shuts the server down. */
async function withToon(options, fn) {
  const toon = createMockToon(options);
  const server = await toon.listen();
  try {
    return await fn(toon, `${server.host}:${server.port}`, server);
  } finally {
    await server.close();
  }
}

async function probeToon(options, args, extra) {
  return withToon(options, async (toon, address) => {
    const seen = capture(extra);
    const result = await probe.run([address, ...args], seen.io);
    return {
      toon, address, seen, result, dump: result.dump,
    };
  });
}

const entryOf = (dump, id) => dump.endpoints.find((entry) => entry.id === id);
/** The masked bodies have no prototype (a parsed "__proto__" key must stay an ordinary key); a comparison wants plain objects. */
const plain = (value) => JSON.parse(JSON.stringify(value));

describe('toon-probe: the command line', () => {
  test('addresses: a host or host:port is accepted in the forms a person types, everything else is refused', () => {
    const good = {
      '192.168.1.50': ['192.168.1.50', null],
      ' http://192.168.1.50/ ': ['192.168.1.50', null],
      '192.168.1.50:8080': ['192.168.1.50', 8080],
      'Toon.Local': ['toon.local', null],
      'toon-1': ['toon-1', null],
    };
    Object.entries(good).forEach(([input, [host, port]]) => assert.deepEqual(probe.normalizeAddress(input), { ok: true, host, port }, input));

    ['', '   ', '0.0.0.0', '192.168.1.256', '192.168.1', '192.168.1.50/path', '192.168.1.50?x=1', 'user@192.168.1.50', 'a b', '192.168.1.50:0',
      '192.168.1.50:99999', 'https://192.168.1.50', 'ftp://192.168.1.50', '[::1]', 'fe80::1', '-toon', 'toon..local', '12', null, 5, {}].forEach((input) => {
      assert.equal(probe.normalizeAddress(input).ok, false, String(input));
    });
  });

  test('options: values, defaults and limits', () => {
    const { options } = probe.parseArgs(['192.168.1.50']);

    assert.deepEqual({ ...options, address: undefined }, {
      address: undefined, out: null, stdout: false, label: null, water: true, timeoutMs: 5000, samples: 1, everySeconds: 30,
    });
    const set = probe.parseArgs(['--samples=12', '--every', '10', '--timeout', '1500', '--no-water', '--stdout', '--label', ' heating on ', '--out', 'results/', '192.168.1.50']).options;
    assert.deepEqual([set.samples, set.everySeconds, set.timeoutMs, set.water, set.stdout, set.label, set.out], [12, 10, 1500, false, true, 'heating on', 'results/']);

    [
      [[], /Give the address/],
      [['192.168.1.50', '192.168.1.51'], /exactly one address/],
      [['192.168.1.50', '--samples', '0'], /--samples must be/],
      [['192.168.1.50', '--samples', '5001'], /--samples must be/],
      [['192.168.1.50', '--every', '9'], /--every must be/],
      [['192.168.1.50', '--timeout', '499'], /--timeout must be/],
      [['192.168.1.50', '--timeout', 'fast'], /--timeout must be/],
      [['192.168.1.50', '--label', 'x'.repeat(81)], /--label is at most/],
      [['192.168.1.50', '--out'], /needs a value/],
      [['192.168.1.50', '--post'], /Unknown option --post/],
      [['192.168.1.50', '--method=POST'], /Unknown option --method/],
      [['0.0.0.0'], /not a valid address/],
    ].forEach(([argv, message]) => assert.match(probe.parseArgs(argv).error, message, argv.join(' ')));
  });

  test('--help prints the usage and exits 0; a wrong command line prints it with the reason, exits 2 and sends no request', async () => {
    const fetchCalls = [];
    const seen = capture({ fetch: (...call) => fetchCalls.push(call) });

    assert.equal((await probe.run(['--help'], seen.io)).exitCode, 0);
    assert.match(seen.out.join(''), /Usage: node scripts\/toon-probe\.js/);
    assert.equal((await probe.run(['not an address'], seen.io)).exitCode, 2);
    assert.match(seen.err.join(''), /not a valid address[\s\S]*Usage:/);
    assert.deepEqual(fetchCalls, []);
    assert.deepEqual(seen.files, []);
  });
});

describe('toon-probe: it asks what the app asks, and nothing else', () => {
  test('the four requests are the ones of lib/ (same path, same query), in the order of a poll cycle', () => {
    const appEndpoints = [...core.pollGroups, ...toonwater.pollGroups].map((group) => group.endpoint);

    assert.deepEqual(probe.ENDPOINTS.map((endpoint) => endpoint.id), ['thermostat', 'power', 'meters', 'water']);
    assert.deepEqual(
      probe.ENDPOINTS.map((endpoint) => ({ path: endpoint.path, query: { ...endpoint.query } })),
      appEndpoints.map((endpoint) => ({ path: endpoint.path, query: { ...(endpoint.query || {}) } })),
    );
    assert.deepEqual(probe.LEGACY_METER_KEYS, ['gas', 'peak', 'offPeak', 'single'].map((role) => METER_RULES[role].legacyKey));
  });

  test('a run sends exactly four GETs, one at a time, with the headers of the app, and never a write', async () => {
    const { toon, result } = await probeToon({}, []);
    const requests = toon.requests();

    assert.equal(result.exitCode, 0);
    assert.deepEqual(requests.map((entry) => `${entry.method} ${entry.path}?${new URLSearchParams(entry.query)}`), [
      'GET /happ_thermstat?action=getThermostatInfo',
      'GET /happ_pwrusage?action=GetCurrentUsage',
      'GET /hdrv_zwave?action=getDevices.json',
      'GET /water.html?',
    ]);
    assert.equal(toon.maxConcurrent(), 1);
    requests.forEach((entry) => {
      assert.equal(entry.headers.connection, 'close');
      assert.equal(entry.headers['accept-encoding'], 'identity');
      assert.equal(Object.hasOwn(entry.headers, 'cookie') || Object.hasOwn(entry.headers, 'authorization'), false);
    });
  });

  test('the source holds no write: no method but GET, no command of the Toon that changes anything', () => {
    const source = read('scripts/toon-probe.js');

    assert.deepEqual([...source.matchAll(/method:\s*'([A-Z]+)'/g)].map((match) => match[1]), ['GET', 'GET']);
    ['setSetpoint', 'changeSchemeState', 'POST', 'PUT', 'DELETE', 'PATCH', 'body:'].forEach((word) => assert.equal(source.includes(word), false, word));
  });

  test('--no-water does not ask for the ToonWater page at all', async () => {
    const { toon, dump } = await probeToon({}, ['--no-water']);

    assert.equal(toon.requestsTo('/water.html').length, 0);
    assert.deepEqual(dump.endpoints.map((entry) => entry.id), ['thermostat', 'power', 'meters']);
    assert.equal(dump.summary.toonWater, 'not asked');
  });

  test('the answers of a healthy Toon are in the file, with the status, the content type and the time', async () => {
    const { dump } = await probeToon({}, []);
    const thermostat = entryOf(dump, 'thermostat');

    assert.equal(dump.schema, 'open-toon-probe/1');
    assert.equal(dump.readOnly, true);
    assert.deepEqual(dump.summary.outcomes, {
      thermostat: 'ok', power: 'ok', meters: 'ok', water: 'ok',
    });
    assert.equal(dump.summary.toonWater, 'detected');
    assert.equal(thermostat.status, 200);
    assert.equal(thermostat.contentType, 'text/javascript');
    assert.equal(typeof thermostat.ms, 'number');
    assert.equal(thermostat.body.activeState, '1');
    assert.equal(thermostat.body.burnerInfo, '0');
    assert.deepEqual(plain(entryOf(dump, 'water').body), toonPayload('water-ok'));
  });
});

describe('toon-probe: what a Toon without ToonWater, a broken Toon and a slow Toon look like', () => {
  test('HTTP 404 on the water page is "not_found" and is not a failure of the probe', async () => {
    const { dump, result, toon } = await probeToon({ water: '404' }, []);

    assert.equal(result.exitCode, 0);
    assert.equal(entryOf(dump, 'water').outcome, 'http');
    assert.equal(entryOf(dump, 'water').status, 404);
    assert.match(entryOf(dump, 'water').snippet, /404/);
    assert.equal(dump.summary.toonWater, 'not_found');
    assert.equal(toon.requestsTo('/water.html').length, 1);
  });

  test('answers that are not ToonWater: an HTML page, a text, the flat page of the sensor module, a refusal', async () => {
    const cases = {
      'html-200': ['bad_body', 'html', 'unexpected'],
      junk: ['bad_body', 'text', 'unexpected'],
      'flat-ESP': ['ok', 'json', 'unexpected'],
      403: ['http', null, 'unexpected'],
      500: ['http', null, 'unexpected'],
    };

    for (const [mode, [outcome, kind, verdict]] of Object.entries(cases)) {
      const { dump } = await probeToon({ water: mode }, []);

      assert.equal(entryOf(dump, 'water').outcome, outcome, mode);
      assert.equal(entryOf(dump, 'water').bodyKind, kind, mode);
      assert.equal(dump.summary.toonWater, verdict, mode);
      assert.equal(Object.hasOwn(entryOf(dump, 'water'), 'body') && kind !== 'json', false, `${mode}: no text of a page that is not JSON`);
    }
  });

  test('a Toon that does not answer in time: the request is abandoned after --timeout, the rest of the file is still written', async () => {
    const { result } = await withToon({}, async (toon, address) => {
      toon.fault('timeout', { path: '/happ_pwrusage' });
      return { result: await probe.run([address, '--timeout', '500'], capture().io) };
    });

    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.dump.endpoints.map((entry) => entry.outcome), ['ok', 'timeout', 'ok', 'ok']);
    assert.ok(result.dump.endpoints[1].ms >= 450 && result.dump.endpoints[1].ms < 3000, String(result.dump.endpoints[1].ms));
  });

  test('a thermostat that cannot be reached: exit 1, the other questions are not asked, a file is still written', async () => {
    const { toon, result, seen } = await withToon({}, async (mock, address) => {
      mock.fault('refused');
      const captured = capture();
      return { toon: mock, result: await probe.run([address], captured.io), seen: captured };
    });

    assert.equal(result.exitCode, 1);
    assert.equal(toon.requests().length, 1);
    assert.deepEqual(result.dump.endpoints.map((entry) => entry.outcome), ['network', 'skipped', 'skipped', 'skipped']);
    assert.equal(seen.files.length, 1);
  });

  test('a thermostat that answers HTTP 500 is a failure (exit 1) but the others are still asked', async () => {
    const { toon, result } = await withToon({}, async (mock, address) => {
      mock.fault('500', { path: '/happ_thermstat' });
      return { toon: mock, result: await probe.run([address], capture().io) };
    });

    assert.equal(result.exitCode, 1);
    assert.equal(toon.requests().length, 4);
    assert.equal(entryOf(result.dump, 'thermostat').status, 500);
  });

  test('a redirect is reported and not followed; an answer that is too large is dropped; {"result":"error"} is a toon_error', async () => {
    const results = await withToon({}, async (mock, address) => {
      mock.fault('redirect', { path: '/happ_pwrusage' });
      mock.fault('oversize', { path: '/hdrv_zwave' });
      mock.fault('result-error', { path: '/happ_thermstat' });
      return { run: await probe.run([address], capture().io), requests: mock.requests() };
    });

    assert.deepEqual(results.run.dump.endpoints.map((entry) => entry.outcome), ['toon_error', 'redirect', 'too_large', 'ok']);
    assert.equal(results.requests.filter((entry) => entry.path === '/happ_pwrusage').length, 1);
    assert.equal(Object.hasOwn(entryOf(results.run.dump, 'meters'), 'body'), false);
    assert.ok(JSON.stringify(results.run.dump).length < 20000);
  });
});

describe('toon-probe: what is left out of the file', () => {
  const UUID = '3f2a9c1e-7b41-4d0a-9c55-0e1f2a3b4c5d';
  const OTHER_UUID = '9a8b7c6d-1e2f-4a3b-8c4d-5e6f7a8b9c0d';
  const CANARIES = [
    'Jan Jansen', 'Kamer van Sanne', UUID, OTHER_UUID, 'aa:bb:cc:dd:ee:ff', '192.168.1.77', 'jan.jansen@example.com', 'MijnWifi-5G',
    'Wachtwoord123', 'Hoofdstraat 12', 'toon-4711.local', '1234567890123', 'Wasmachine',
  ];

  function personalDevices() {
    return {
      dev_2: {
        type: 'HAE_METER_v2', IsConnected: '1', Name: 'Jan Jansen', DevUUID: UUID, MacAddress: 'aa:bb:cc:dd:ee:ff',
      },
      'dev_2.1': {
        type: 'gas', CurrentGasFlow: '0', CurrentGasQuantity: '5242110', name: 'Kamer van Sanne',
      },
      'dev_2.2': { type: 'elec', CurrentElectricityFlow: '324', CurrentElectricityQuantity: 'NaN' },
      'dev_2.4': { type: 'elec_delivered_nt', CurrentElectricityFlow: '324', CurrentElectricityQuantity: '3718492' },
      [`dev_${UUID}`]: {
        type: 'plug', label: 'Wasmachine van Jan Jansen', SerialNumber: 1234567890123, ip: '192.168.1.77',
      },
      [`dev_${OTHER_UUID}`]: { type: 'plug', state: 'on' },
      wifi: { ssid: 'MijnWifi-5G', password: 'Wachtwoord123', host: 'toon-4711.local' },
      owner: { address: 'Hoofdstraat 12', email: 'jan.jansen@example.com' },
      note: 'Hoofdstraat 12',
    };
  }

  test('names, ids, addresses and every other text leave the file; the structure, the numbers and "NaN" stay', async () => {
    const { dump } = await withToon({}, async (toon, address) => {
      toon.state.devices = personalDevices();
      toon.state.thermostat.deviceName = 'Jan Jansen';
      toon.state.thermostat.lastSeenFrom = '192.168.1.77';
      return { dump: (await probe.run([address, '--label', 'kitchen Toon at 192.168.1.77'], capture().io)).dump };
    });
    const text = JSON.stringify(dump);
    const devices = entryOf(dump, 'meters').body;

    CANARIES.forEach((canary) => assert.equal(text.includes(canary), false, canary));
    assert.equal(text.includes('127.0.0.1'), false, 'the address of the Toon');
    assert.equal(dump.target.host, '<redacted>');
    assert.equal(dump.label, 'kitchen Toon at <ip>');

    assert.equal(devices['dev_2.1'].type, 'gas');
    assert.equal(devices['dev_2.1'].CurrentGasQuantity, '5242110');
    assert.equal(devices['dev_2.1'].name, probe.REDACTED);
    assert.equal(devices['dev_2.2'].CurrentElectricityQuantity, 'NaN');
    assert.equal(devices['dev_2.4'].CurrentElectricityQuantity, '3718492');
    assert.equal(devices.dev_2.Name, probe.REDACTED);
    assert.equal(devices.dev_2.IsConnected, '1');
    assert.equal(devices.wifi.ssid, probe.REDACTED);
    assert.equal(devices.owner, probe.REDACTED);
    assert.equal(devices.note, probe.REDACTED);
    assert.equal(entryOf(dump, 'thermostat').body.deviceName, probe.REDACTED);
    assert.equal(entryOf(dump, 'thermostat').body.currentTemp, '2034');
    assert.ok(dump.redaction.counts.textsMasked > 5);
  });

  test('field names that contain an id are changed and two such names do not overwrite each other', async () => {
    const { dump } = await withToon({}, async (toon, address) => {
      toon.state.devices = personalDevices();
      return { dump: (await probe.run([address], capture().io)).dump };
    });
    const keys = Object.keys(entryOf(dump, 'meters').body);

    assert.ok(keys.includes('dev_<uuid>'));
    assert.ok(keys.includes('dev_<uuid>#2'));
    assert.equal(dump.redaction.counts.fieldNamesChanged, 2);
  });

  test('the redactor: what is kept and what is replaced, field by field', () => {
    const redactor = probe.createRedactor({ host: '192.168.1.50', port: null });
    const mask = (value, name = 'field') => redactor.json({ [name]: value })[name];

    ['12', '-1.5', '0', 'NaN', 'nan', 'true', 'false'].forEach((text) => assert.equal(mask(text), text, text));
    [0, 12, -3.5, 1250.25, null, true, false].forEach((value) => assert.equal(mask(value), value, String(value)));
    assert.equal(mask('gas', 'type'), 'gas');
    assert.equal(mask('elec_delivered_nt', 'Type'), 'elec_delivered_nt');
    assert.equal(mask('ok', 'result'), 'ok');

    [
      ['Jan', 'name'], ['Jan', 'userName'], ['x', 'DevUUID'], ['x', 'serial_number'], ['x', 'SerialNumber'], ['x', 'macAddress'], ['x', 'IPAddress'],
      ['x', 'wifiPassword'], ['x', 'apiKey'], ['x', 'hostName'], ['x', 'e_mail'], ['x', 'streetAddress'],
      [123456, 'SerialNumber'], [123456, 'phone'], ['Connected', 'status'], ['hello world', 'type'], ['aa:bb:cc:dd:ee:ff', 'type'],
      ['192.168.1.5', 'note'], ['1.2.3.4', 'type'], ['toon.local', 'type'], ['a@b.nl', 'type'], ['x'.repeat(60), 'type'],
    ].forEach(([value, name]) => assert.equal(mask(value, name), probe.REDACTED, `${name}=${value}`));
    assert.equal(mask({ anything: 1 }, 'owner'), probe.REDACTED);
    assert.equal(mask([1, 2], 'password'), probe.REDACTED);
    assert.deepEqual(plain(mask([1, 'x', { type: 'gas' }], 'list')), [1, probe.REDACTED, { type: 'gas' }]);
  });

  test('the address of the Toon is masked wherever it is, also inside a text that is otherwise kept', () => {
    const redactor = probe.createRedactor({ host: 'toon-woonkamer', port: 8080 });

    assert.equal(redactor.scrub('see toon-woonkamer:8080 and TOON-WOONKAMER').text, 'see <toon> and <toon>');
    assert.equal(redactor.json({ type: 'toon-woonkamer' }).type, probe.REDACTED);
    assert.equal(redactor.snippet('<h1>404</h1> /x on toon-woonkamer'), '<h1>404</h1> /x on <toon>');
  });

  test('the address of the Toon is not looked for inside longer numbers or names', () => {
    const redactor = probe.createRedactor({ host: '10.0.0.1', port: null });

    assert.equal(redactor.scrub('110.0.0.15 and 10.0.0.1, then http://10.0.0.1/x and dev_10.0.0.1').text, '<ip> and <toon>, then http://<toon>/x and dev_<toon>');
  });

  test('hostile JSON: an own "__proto__" key is an ordinary key, nothing is polluted, depth and size are bounded', () => {
    const redactor = probe.createRedactor({ host: '192.168.1.50', port: null });
    const hostile = JSON.parse('{"__proto__": {"polluted": "yes"}, "constructor": {"prototype": {"polluted": "yes"}}, "a": 1}');
    const masked = redactor.json(hostile);

    assert.equal({}.polluted, undefined);
    assert.equal(Object.getPrototypeOf(masked), null);
    assert.deepEqual(JSON.parse(JSON.stringify(masked)).a, 1);
    assert.ok(JSON.stringify(masked).includes('"__proto__"'));

    let deep = { value: 1 };
    for (let level = 0; level < 40; level++) deep = { next: deep };
    assert.match(JSON.stringify(redactor.json(deep)), /<truncated>/);
    assert.equal(redactor.json(Array.from({ length: 1000 }, (_, index) => index)).length, probe.LIMITS.maxArray);
    assert.equal(redactor.counts.truncated, true);
    assert.equal(redactor.json(undefined), probe.REDACTED);
    assert.equal(redactor.json(() => 1), probe.REDACTED);
  });

  test('an error page: one scrubbed line, never a binary body', () => {
    const redactor = probe.createRedactor({ host: '192.168.1.50', port: null });

    assert.equal(redactor.snippet('<html>\n  <body>404 Not Found 192.168.1.50 </body>\n</html>'), '<html> <body>404 Not Found <toon> </body> </html>');
    assert.equal(redactor.snippet('\u0000\u0001\u0002 binary'), '<not text>');
    assert.ok(redactor.snippet('x'.repeat(1000)).length <= probe.LIMITS.maxSnippet);
  });
});

describe('toon-probe: the meter nodes, laid out for the question "dev_2.x or something else"', () => {
  test('on a Toon with the dev_2 layout all four legacy keys exist and a single-tariff node says NaN', async () => {
    const { dump } = await probeToon({ tariff: 'two' }, []);
    const analysis = dump.metersAnalysis;

    assert.deepEqual(analysis.legacyKeysPresent, {
      'dev_2.1': true, 'dev_2.4': true, 'dev_2.6': true, 'dev_2.2': true,
    });
    assert.equal(analysis.nodeCount, 7);
    assert.deepEqual(analysis.nodes.find((node) => node.key === 'dev_2.1'), {
      key: 'dev_2.1', type: 'gas', fields: ['CurrentGasFlow', 'CurrentGasQuantity', 'type'], quantities: { CurrentGasQuantity: 'number' },
    });
    assert.deepEqual(analysis.nodes.find((node) => node.key === 'dev_2.2').quantities, { CurrentElectricityQuantity: 'nan' });
  });

  test('on a Toon whose meters sit under dev_3 no legacy key exists, and the nodes still say what they are', async () => {
    const { dump } = await probeToon({ layout: 'dev_3' }, []);
    const analysis = dump.metersAnalysis;

    assert.deepEqual(Object.values(analysis.legacyKeysPresent), [false, false, false, false]);
    assert.deepEqual(analysis.nodes.map((node) => node.type), ['HAE_METER_v2', 'gas', 'elec', 'elec_delivered_nt', 'elec_received_nt', 'elec_delivered_lt', 'elec_received_lt']);
  });

  test('nothing to describe when the answer is not an object', () => {
    assert.equal(probe.describeMeters(null), null);
    assert.equal(probe.describeMeters([]), null);
    assert.deepEqual(probe.describeMeters({}), {
      nodeCount: 0,
      legacyKeysPresent: {
        'dev_2.1': false, 'dev_2.4': false, 'dev_2.6': false, 'dev_2.2': false,
      },
      nodes: [],
    });
  });
});

describe('toon-probe: the watch mode (--samples)', () => {
  test('latencies, the fields that change and the changes of outcome are summarised, the pause is --every', async () => {
    const pauses = [];
    const { dump, toon } = await withToon({}, async (mock, address) => {
      const script = [
        () => {},
        () => {
          mock.state.thermostat.burnerInfo = '1'; mock.state.thermostat.programState = '2'; mock.state.power.powerProduction.value = 1250;
        },
        () => {
          mock.state.thermostat.burnerInfo = '2'; mock.mode.water = '404';
        },
        () => {
          mock.state.thermostat.burnerInfo = '0';
        },
      ];
      const seen = capture({
        sleep: async (ms) => {
          pauses.push(ms);
          script[pauses.length]();
        },
      });
      return { toon: mock, dump: (await probe.run([address, '--samples', '4', '--every', '10'], seen.io)).dump };
    });
    const { watch } = dump;

    assert.equal(toon.requests().length, 16);
    assert.equal(pauses.length, 3);
    pauses.forEach((ms) => assert.ok(ms > 8000 && ms <= 10000, String(ms)));
    assert.equal(watch.samplesTaken, 4);
    assert.equal(watch.interrupted, false);
    assert.equal(dump.settings.everySeconds, 10);
    assert.deepEqual(watch.fieldChanges['thermostat.burnerInfo'].seen, { 0: 2, 1: 1, 2: 1 });
    assert.deepEqual(watch.fieldChanges['thermostat.burnerInfo'].changes.map((change) => change.value), ['0', '1', '2', '0']);
    assert.deepEqual(watch.fieldChanges['thermostat.programState'].changes.map((change) => change.value), ['1', '2']);
    assert.deepEqual(watch.fieldChanges['thermostat.activeState'].seen, { 1: 4 });
    assert.equal(watch.latency.thermostat.answered, 4);
    assert.deepEqual(watch.latency.thermostat.outcomes, { ok: 4 });
    assert.deepEqual(watch.latency.water.outcomes, { ok: 2, 'http 404': 2 });
    assert.ok(watch.latency.meters.minMs <= watch.latency.meters.medianMs && watch.latency.meters.medianMs <= watch.latency.meters.p95Ms && watch.latency.meters.p95Ms <= watch.latency.meters.maxMs);
    assert.deepEqual(watch.outcomeChanges.map((change) => [change.endpoint, change.from, change.to]), [['water', 'ok', 'http 404']]);
    assert.deepEqual(watch.ranges['power.powerProduction.value'], { min: 0, max: 1250, nonZeroSamples: 3 });
    assert.equal(entryOf({ endpoints: watch.last }, 'thermostat').body.burnerInfo, '0');
    assert.equal(entryOf(dump, 'thermostat').body.burnerInfo, '0', 'the first sample is the full one');
  });

  test('Ctrl+C: the samples taken so far are written, marked as interrupted', async () => {
    const stop = new AbortController();
    const seen = capture({ signal: stop.signal, sleep: async () => stop.abort() });
    const result = await withToon({}, (toon, address) => probe.run([address, '--samples', '5', '--every', '10'], seen.io));

    assert.equal(result.exitCode, 0);
    assert.equal(result.dump.watch.samplesTaken, 1);
    assert.equal(result.dump.watch.interrupted, true);
    assert.equal(seen.files.length, 1);
    assert.match(seen.out.join(''), /Stopped after 1 of 5 samples/);
  });

  test('a single sample has no watch section; a Toon that is down for a while shows up as changes of outcome', async () => {
    const single = await probeToon({}, []);
    assert.equal(single.dump.watch, null);

    const down = await withToon({}, async (toon, address) => {
      let round = 0;
      const seen = capture({
        sleep: async () => {
          round++;
          if (round === 1) toon.fault('refused');
          if (round === 2) toon.clearFaults();
        },
      });
      return (await probe.run([address, '--samples', '3', '--every', '10', '--no-water'], seen.io)).dump;
    });

    assert.deepEqual(down.watch.outcomeChanges.filter((change) => change.endpoint === 'thermostat').map((change) => `${change.from}>${change.to}`), ['ok>network', 'network>ok']);
    assert.deepEqual(down.watch.latency.thermostat.outcomes, { ok: 2, network: 1 });
    assert.equal(down.watch.latency.power.outcomes.skipped, 1);
  });
});

describe('toon-probe: the file', () => {
  test('the name carries the UTC time; the content is the dump; nothing is printed twice', async () => {
    const { seen, result } = await probeToon({}, []);

    assert.equal(seen.files.length, 1);
    assert.equal(seen.files[0].file, path.join(ROOT, 'probe-output', 'toon-probe-20261114T101500Z.json'));
    assert.deepEqual(JSON.parse(seen.files[0].text), JSON.parse(JSON.stringify(result.dump)));
    assert.equal(result.dump.createdAt, '2026-11-14T10:15:00.000Z');
    assert.match(seen.out.join(''), /Written: .*toon-probe-20261114T101500Z\.json/);
    assert.match(seen.out.join(''), /Nothing was changed on the Toon/);
  });

  test('--out names a folder (trailing slash) or a file; --stdout writes no file at all', async () => {
    const folder = await probeToon({}, ['--out', 'results/']);
    const file = await probeToon({}, ['--out', 'my-toon.json']);
    const screen = await probeToon({}, ['--stdout']);

    assert.equal(folder.seen.files[0].file, path.join(ROOT, 'probe-output', 'results', 'toon-probe-20261114T101500Z.json'));
    assert.equal(file.seen.files[0].file, path.join(ROOT, 'probe-output', 'my-toon.json'));
    assert.deepEqual(screen.seen.files, []);
    assert.equal(JSON.parse(screen.seen.out.join('')).schema, 'open-toon-probe/1');
  });

  test('a file that cannot be written gives exit 2 and a sentence, never a stack trace', async () => {
    const exists = await probeToon({}, [], {
      writeFile: () => {
        throw Object.assign(new Error('boom'), WRITE_FAILED);
      },
    });
    const other = await probeToon({}, [], {
      writeFile: () => {
        throw new Error('disk full');
      },
    });

    assert.equal(exists.result.exitCode, 2);
    assert.match(exists.seen.err.join(''), /already exists/);
    assert.equal(other.result.exitCode, 2);
    assert.match(other.seen.err.join(''), /cannot be written/);
    assert.equal(other.seen.err.join('').includes('disk full'), false);
  });

  test('on the real file system: the file is private to the user and an existing file is never overwritten', { skip: process.platform === 'win32' && 'POSIX modes' }, async () => {
    const folder = fs.mkdtempSync(path.join(ROOT, '.probe-test-'));
    try {
      const first = await withToon({}, (toon, address) => probe.run([address, '--out', `${folder}${path.sep}new${path.sep}deeper${path.sep}`], { ...capture().io, writeFile: undefined }));
      const second = await withToon({}, (toon, address) => probe.run([address, '--out', `${folder}${path.sep}new${path.sep}deeper${path.sep}`], { ...capture().io, writeFile: undefined }));

      assert.equal(first.exitCode, 0);
      assert.equal(path.basename(first.file), 'toon-probe-20261114T101500Z.json');
      assert.equal(fs.statSync(first.file).mode & 0o777, 0o600);
      assert.equal(JSON.parse(fs.readFileSync(first.file, 'utf8')).schema, 'open-toon-probe/1');
      assert.equal(second.exitCode, 2);
      assert.equal(fs.readdirSync(path.dirname(first.file)).length, 1);
      assert.equal(path.dirname(first.file), path.join(folder, 'new', 'deeper'));
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe('toon-probe: a tool for the test bench, not part of the app', () => {
  test('.homeyignore leaves scripts/ out of the package, and the pack check would flag the file if it were in it', () => {
    assert.ok(read('.homeyignore').split('\n').map((line) => line.trim()).includes('scripts/'));
    assert.deepEqual(findViolations(['scripts/toon-probe.js']), ['not allowed in the app bundle: scripts/toon-probe.js']);
  });

  test('zero dependencies: it requires only modules of Node itself', () => {
    const required = [...read('scripts/toon-probe.js').matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1]);

    assert.deepEqual(required.sort(), ['fs', 'path', 'timers/promises']);
  });
});
