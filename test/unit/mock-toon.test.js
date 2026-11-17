'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { setTimeout: realSleep } = require('timers/promises');
const { createClock } = require('../helpers/fake-clock');
const { createMockToon, FAULT_KINDS, WATER_MODES } = require('../helpers/mock-toon');
const { toonPayload } = require('../helpers/fixtures');

const THERMOSTAT = '/happ_thermstat';

function bootToon(options) {
  const clock = createClock();
  const toon = createMockToon(options);
  const fetchToon = toon.fetchWith(clock);
  const get = async (path) => {
    const response = await fetchToon(`http://toon${path}`);
    const text = await response.text();
    return { response, text, json: () => JSON.parse(text) };
  };
  return {
    clock, toon, fetchToon, get,
  };
}

describe('NFR-06 AC1: mock Toon answers from the labelled fixtures', () => {
  test('the four read endpoints return the fixture payloads as text/javascript', async () => {
    const { get } = bootToon();
    const thermostat = await get(`${THERMOSTAT}?action=getThermostatInfo`);
    const power = await get('/happ_pwrusage?action=GetCurrentUsage');
    const devices = await get('/hdrv_zwave?action=getDevices.json');
    const water = await get('/water.html');

    assert.equal(thermostat.response.headers.get('content-type'), 'text/javascript');
    assert.deepEqual(thermostat.json(), toonPayload('thermostat'));
    assert.deepEqual(power.json(), toonPayload('power'));
    assert.deepEqual(devices.json(), toonPayload('getdevices-dev2-two-tariff'));
    assert.deepEqual(water.json(), toonPayload('water-ok'));
  });

  test('layout and tariff select the meter fixtures', async () => {
    const dev3 = bootToon({ layout: 'dev_3' });
    const single = bootToon({ tariff: 'single' });

    assert.deepEqual((await dev3.get('/hdrv_zwave?action=getDevices.json')).json(), toonPayload('getdevices-dev3'));
    assert.deepEqual((await single.get('/hdrv_zwave?action=getDevices.json')).json(), toonPayload('getdevices-dev2-single-tariff'));
  });

  test('vacation mode answers activeState 4, also when switched on later', async () => {
    const { get, toon } = bootToon({ vacation: true });
    assert.equal((await get(`${THERMOSTAT}?action=getThermostatInfo`)).json().activeState, '4');

    toon.configure({ vacation: false });
    assert.equal((await get(`${THERMOSTAT}?action=getThermostatInfo`)).json().activeState, '1');
  });

  test('unknown paths and actions answer 404', async () => {
    const { get } = bootToon();

    assert.equal((await get('/nothing')).response.status, 404);
    assert.equal((await get(`${THERMOSTAT}?action=explode`)).response.status, 404);
    assert.equal((await get('/hdrv_zwave?action=other')).response.status, 404);
  });
});

describe('NFR-06 AC1: mock Toon is stateful for writes', () => {
  test('setSetpoint takes an integer in centi-degrees, goes manual and leaves the program', async () => {
    const { get, toon } = bootToon();
    const answer = await get(`${THERMOSTAT}?action=setSetpoint&Setpoint=1975`);

    assert.deepEqual(answer.json(), { result: 'ok' });
    assert.equal(toon.state.thermostat.currentSetpoint, '1975');
    assert.equal(toon.state.thermostat.activeState, '-1');
    assert.equal(toon.state.thermostat.programState, '2');
    assert.deepEqual((await get(`${THERMOSTAT}?action=setSetpoint&Setpoint=abc`)).json(), { result: 'error' });
  });

  test('changeSchemeState switches a preset, the program and vacation', async () => {
    const { get, toon } = bootToon();

    await get(`${THERMOSTAT}?action=changeSchemeState&state=2&temperatureState=3`);
    assert.equal(toon.state.thermostat.activeState, '3');
    assert.equal(toon.state.thermostat.currentSetpoint, '1500');

    await get(`${THERMOSTAT}?action=changeSchemeState&state=0`);
    assert.equal(toon.state.thermostat.programState, '0');
    await get(`${THERMOSTAT}?action=changeSchemeState&state=1`);
    assert.equal(toon.state.thermostat.programState, '1');

    await get(`${THERMOSTAT}?action=changeSchemeState&state=8&temperatureState=4`);
    assert.equal(toon.state.thermostat.activeState, '4');
    assert.equal((await get(`${THERMOSTAT}?action=getThermostatInfo`)).json().activeState, '4');
    assert.deepEqual((await get(`${THERMOSTAT}?action=changeSchemeState&state=9&temperatureState=1`)).json(), { result: 'error' });
  });
});

describe('NFR-06 AC1: mock Toon water modes', () => {
  const expected = {
    present: { status: 200, check: (text) => assert.deepEqual(JSON.parse(text), toonPayload('water-ok')) },
    404: { status: 404, check: (text) => assert.match(text, /404/) },
    'html-200': { status: 200, check: (text) => assert.match(text, /^<html>/) },
    403: { status: 403, check: (text) => assert.match(text, /403/) },
    500: { status: 500, check: (text) => assert.match(text, /Internal Server Error/) },
    'old-shape': { status: 200, check: (text) => assert.equal(Object.hasOwn(JSON.parse(text).water, 'total'), false) },
    'flat-ESP': { status: 200, check: (text) => assert.ok(Object.hasOwn(JSON.parse(text), 'waterquantity')) },
    junk: { status: 200, check: (text) => assert.throws(() => JSON.parse(text)) },
  };

  WATER_MODES.filter((mode) => mode !== 'slow').forEach((mode) => {
    test(`water mode ${mode}`, async () => {
      const { get } = bootToon({ water: mode });
      const answer = await get('/water.html');

      assert.equal(answer.response.status, expected[mode].status);
      expected[mode].check(answer.text);
    });
  });

  test('water mode slow answers after 7 s on the injected clock', async () => {
    const { toon, clock, fetchToon } = bootToon({ water: 'slow' });
    let answered = false;
    const pending = fetchToon('http://toon/water.html').then((response) => response.text()).then(() => {
      answered = true;
    });

    await clock.tick(6999);
    assert.equal(answered, false);
    await clock.tick(1);
    await pending;
    assert.equal(answered, true);
    assert.equal(toon.requestsTo('/water.html')[0].end - toon.requestsTo('/water.html')[0].start, 7000);
  });

  test('the page that the mode present serves can be changed, and reset brings the fixture back', async () => {
    const { toon, get } = bootToon();
    toon.state.waterPage.water.flow = 7;

    assert.equal((await get('/water.html')).json().water.flow, 7);
    toon.reset();
    assert.deepEqual((await get('/water.html')).json(), toonPayload('water-ok'));
  });

  test('the water mode can change while the Toon runs, and an unknown mode is refused', async () => {
    const { toon, get } = bootToon({ water: '404' });
    assert.equal((await get('/water.html')).response.status, 404);

    toon.configure({ water: 'present' });
    assert.equal((await get('/water.html')).response.status, 200);
    assert.equal(toon.requests().length, 2, 'configure keeps the request log');
    assert.throws(() => toon.configure({ water: 'nonsense' }), /unknown water mode/);
  });
});

describe('NFR-06 AC1: mock Toon latency', () => {
  test('latencyMs delays every answer on the injected clock; a fault keeps its own delay; zero restores instant answers', async () => {
    const { toon, clock, fetchToon } = bootToon();
    toon.latencyMs = 800;
    let answered = false;
    fetchToon(`http://toon${THERMOSTAT}?action=getThermostatInfo`).then(() => {
      answered = true;
    });
    await clock.tick(799);
    assert.equal(answered, false);
    await clock.tick(1);
    assert.equal(answered, true);

    toon.fault('timeout');
    let stuck = false;
    fetchToon('http://toon/water.html').then(() => {
      stuck = true;
    });
    await clock.tick(60000);
    assert.equal(stuck, false, 'the fault is not shortened by the latency');

    toon.clearFaults();
    toon.latencyMs = 0;
    const instant = await fetchToon(`http://toon${THERMOSTAT}?action=getThermostatInfo`);
    assert.equal(instant.status, 200);
  });
});

describe('NFR-06 AC1: mock Toon fault modes', () => {
  test('the fault list is the one of ADR-0013', () => {
    assert.deepEqual(FAULT_KINDS, ['500', 'timeout', 'refused', 'redirect', 'oversize', 'result-error', 'idle-close']);
    assert.throws(() => createMockToon().fault('on-fire'), /unknown fault/);
  });

  test('500, redirect and result-error answer as described', async () => {
    const { toon, get } = bootToon();
    toon.fault('500', { path: '/hdrv_zwave', times: 1 });
    toon.fault('redirect', { path: '/water.html' });
    toon.fault('result-error', { path: '/happ_pwrusage' });

    const meters = await get('/hdrv_zwave?action=getDevices.json');
    assert.equal(meters.response.status, 500);
    assert.equal((await get('/hdrv_zwave?action=getDevices.json')).response.status, 200, 'times: 1 limits the fault');
    const water = await get('/water.html');
    assert.equal(water.response.status, 302);
    assert.match(water.response.headers.get('location'), /example\.invalid/);
    assert.deepEqual((await get('/happ_pwrusage?action=GetCurrentUsage')).json(), { result: 'error' });
    assert.equal((await get(`${THERMOSTAT}?action=getThermostatInfo`)).response.status, 200, 'a path-scoped fault leaves other paths alone');
  });

  test('a write that fails before the Toon looks at it changes nothing; a timeout is a Toon that did the work and could not tell', async () => {
    const { toon, get, clock } = bootToon();
    const setpoint = `${THERMOSTAT}?action=setSetpoint&Setpoint=2300`;
    for (const kind of ['500', 'refused', 'redirect', 'result-error']) {
      toon.fault(kind, { times: 1 });
      await get(setpoint).catch(() => {});
      assert.equal(toon.state.thermostat.currentSetpoint, '1850', kind);
    }
    toon.fault('timeout', { times: 1 });
    get(setpoint).catch(() => {});
    await clock.tick(0);
    assert.equal(toon.state.thermostat.currentSetpoint, '2300');
  });

  test('timeout delays the answer far beyond the client timeout', async () => {
    const { toon, clock, fetchToon } = bootToon();
    toon.fault('timeout');
    let answered = false;
    fetchToon('http://toon/water.html').then(() => {
      answered = true;
    });

    await clock.tick(60000);
    assert.equal(answered, false);
    assert.equal(toon.openHandlers(), 1);
  });

  test('refused fails the connection and is logged', async () => {
    const { toon, fetchToon } = bootToon();
    toon.fault('refused');

    await assert.rejects(fetchToon('http://toon/water.html'), TypeError);
    assert.equal(toon.openHandlers(), 0);
    assert.equal(toon.requests().length, 1);
  });

  test('oversize streams more than 2 MiB', async () => {
    const { toon, get } = bootToon();
    toon.fault('oversize');
    const answer = await get('/hdrv_zwave?action=getDevices.json');

    assert.ok(answer.text.length > 2 * 1024 * 1024);
  });

  test('clearFaults and reset restore normal service', async () => {
    const { toon, get } = bootToon();
    toon.fault('500');
    toon.clearFaults();
    assert.equal((await get('/water.html')).response.status, 200);

    toon.fault('500');
    toon.reset();
    assert.equal(toon.requests().length, 0);
    assert.equal((await get('/water.html')).response.status, 200);
  });

  test('idle-close over node:http closes the idle keep-alive socket after about one second', async () => {
    const toon = createMockToon();
    toon.fault('idle-close');
    const server = await toon.listen();
    const agent = new http.Agent({ keepAlive: true });
    try {
      await new Promise((resolve, reject) => {
        http.get({
          host: server.host, port: server.port, path: '/water.html', agent,
        }, (response) => {
          response.resume();
          response.on('end', resolve);
        }).on('error', reject);
      });
      assert.equal(await new Promise((resolve) => {
        server.server.getConnections((error, count) => resolve(count));
      }), 1, 'the socket is idle but open');
      await realSleep(1300);
      assert.equal(await new Promise((resolve) => {
        server.server.getConnections((error, count) => resolve(count));
      }), 0, 'the Toon closed it');
    } finally {
      agent.destroy();
      await server.close();
    }
  });
});

describe('NFR-06 AC1: mock Toon request log', () => {
  test('every request is logged with start, end, abortedByClient, query and headers', async () => {
    const { toon, clock, fetchToon } = bootToon({ water: 'slow' });
    const pending = fetchToon('http://toon/water.html?probe=1', { headers: { Connection: 'close' } }).then((response) => response.text());
    await clock.tick(7000);
    await pending;

    const [entry] = toon.requests();
    assert.equal(entry.path, '/water.html');
    assert.deepEqual(entry.query, { probe: '1' });
    assert.equal(entry.headers.connection, 'close');
    assert.equal(entry.abortedByClient, false);
    assert.equal(entry.status, 200);
    assert.equal(entry.end - entry.start, 7000);
  });

  test('maxConcurrent and openHandlers measure the server-side overlap', async () => {
    const { toon, clock, fetchToon } = bootToon({ water: 'slow' });
    const first = fetchToon('http://toon/water.html');
    const second = fetchToon('http://toon/water.html');
    await clock.tick(10);
    assert.equal(toon.openHandlers(), 2);
    await clock.tick(7000);
    await Promise.all([first, second]);

    assert.equal(toon.maxConcurrent(), 2);
    assert.equal(toon.openHandlers(), 0);
  });
});
