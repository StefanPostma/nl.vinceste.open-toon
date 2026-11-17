'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  ENDPOINTS, RESUME, WRITABLE_STATES, setpoint, scheme, programOn, programOff,
} = require('../../lib/toon/commands');
const { ToonClient } = require('../../lib/toon/client');
const { ToonError } = require('../../lib/toon/errors');
const { createClock } = require('../helpers/fake-clock');
const { createMockToon } = require('../helpers/mock-toon');

/** What the mock saw, as "path?query" strings in order. */
const seen = (toon) => toon.requests().map((entry) => `${entry.path}?${new URLSearchParams(entry.query)}`);

/** A client wired to the mock Toon in-process, and the helper that sends a request list like the device will. */
function boot(options) {
  const clock = createClock();
  const toon = createMockToon(options);
  const client = new ToonClient({ host: '192.168.1.50', fetch: toon.fetchWith(clock), timers: clock.timers });
  const send = (requests) => requests.reduce((previous, request) => previous.then(() => client.get(request)), Promise.resolve());
  return {
    toon, client, send,
  };
}

const rejectsConfig = (action) => assert.throws(action, (error) => error instanceof ToonError && error.kind === 'config');

describe('FR-11 AC1: the setpoint is sent as a whole number of centi-degrees', () => {
  test('20.5 -> Setpoint=2050 (an integer)', () => {
    const [request, ...rest] = setpoint(20.5);

    assert.equal(rest.length, 0);
    assert.deepEqual(request, { path: '/happ_thermstat', query: { action: 'setSetpoint', Setpoint: 2050 } });
    assert.ok(Number.isInteger(request.query.Setpoint));
  });

  test('values that are binary fractions in disguise never leave floating-point dust', () => {
    const sent = (degrees) => setpoint(degrees)[0].query.Setpoint;

    [6, 6.5, 18.5, 19, 19.5, 20, 21.5, 22.5, 29.5, 30].forEach((degrees) => {
      assert.equal(sent(degrees), degrees * 100, String(degrees));
      assert.ok(Number.isInteger(sent(degrees)));
    });
    assert.equal(sent(20.1 + 0.4), 2050, '20.5 as the sum of two floats');
  });

  test('ADR-0005: a value off the 0.5 step is rounded to it before it is sent (19.1 -> 1900)', () => {
    assert.equal(setpoint(19.1)[0].query.Setpoint, 1900);
    assert.equal(setpoint(19.3)[0].query.Setpoint, 1950);
    assert.equal(setpoint(29.9)[0].query.Setpoint, 3000);
    assert.equal(setpoint(6.2)[0].query.Setpoint, 600);
  });

  test('the mock Toon takes the request and reports the setpoint back', async () => {
    const { toon, send } = boot();
    await send(setpoint(21.5));

    assert.deepEqual(seen(toon), ['/happ_thermstat?action=setSetpoint&Setpoint=2150']);
    assert.equal(toon.state.thermostat.currentSetpoint, '2150');
  });
});

describe('FR-11 AC2 / NFR-04 AC4: a setpoint that is not a number in range builds no request', () => {
  [5.9, 30.1, 5, 31, 0, -1, NaN, Infinity, -Infinity, '20', ' 20 ', '', null, undefined, {}, [20], true, 21n].forEach((value) => {
    test(`${typeof value === 'string' ? JSON.stringify(value) : String(value)} is rejected`, () => {
      rejectsConfig(() => setpoint(value));
    });
  });

  test('the limits themselves are fine', () => {
    assert.equal(setpoint(6)[0].query.Setpoint, 600);
    assert.equal(setpoint(30)[0].query.Setpoint, 3000);
  });
});

describe('FR-13 AC1 / AC2: resume_program changes what is sent [HW-04]', () => {
  test('yes is the temporary override of the baseline: state=2 and the preset', () => {
    assert.deepEqual(RESUME.yes(2), [{ path: '/happ_thermstat', query: { action: 'changeSchemeState', state: 2, temperatureState: 2 } }]);
  });

  test('no is a different request list (state=0 and the preset)', () => {
    assert.deepEqual(RESUME.no(2), [{ path: '/happ_thermstat', query: { action: 'changeSchemeState', state: 0, temperatureState: 2 } }]);
    assert.notDeepEqual(RESUME.no(2), RESUME.yes(2));
  });

  test('the mock records two different sequences for yes and no', async () => {
    const resumed = boot();
    const disabled = boot();
    await resumed.send(scheme('sleep', 'yes'));
    await disabled.send(scheme('sleep', 'no'));

    assert.deepEqual(seen(resumed.toon), ['/happ_thermstat?action=changeSchemeState&state=2&temperatureState=2']);
    assert.deepEqual(seen(disabled.toon), ['/happ_thermstat?action=changeSchemeState&state=0&temperatureState=2']);
    assert.equal(resumed.toon.state.thermostat.activeState, '2', 'the preset is active after yes');
  });

  test('an unset resume_program means yes (flows made since 2023 have none)', () => {
    assert.deepEqual(scheme('away', undefined), RESUME.yes(3));
    assert.deepEqual(scheme('away', null), RESUME.yes(3));
    assert.deepEqual(scheme('away'), RESUME.yes(3));
  });

  test('FR-13 AC3: the capability picker uses the same path as the action with the default', () => {
    assert.deepEqual(scheme('home'), scheme('home', 'yes'));
  });

  test('every writable state maps to its Toon id', () => {
    assert.deepEqual(WRITABLE_STATES.map((state) => scheme(state)[0].query.temperatureState), [0, 1, 2, 3]);
  });
});

describe('NFR-04 AC4 / ADR-0015: enum arguments are checked before a request exists', () => {
  ['vacation', 'none', 'frost', '', 'Comfort', 'home ', 4, -1, 0, 2, null, undefined, {}, ['home'], '__proto__', 'constructor'].forEach((state) => {
    test(`state ${typeof state === 'string' ? JSON.stringify(state) : String(state)} is rejected`, () => {
      rejectsConfig(() => scheme(state, 'yes'));
    });
  });

  ['maybe', '', 'YES', 'Yes', 0, 1, true, {}, { id: 'yes' }, ['yes'], '__proto__', 'constructor', 'toString'].forEach((resume) => {
    test(`resume_program ${typeof resume === 'string' ? JSON.stringify(resume) : String(resume)} is rejected`, () => {
      rejectsConfig(() => scheme('home', resume));
    });
  });
});

describe('FR-14 AC1: program on and off are single requests', () => {
  test('enable_program is state=1, disable_program is state=0', () => {
    assert.deepEqual(programOn(), [{ path: '/happ_thermstat', query: { action: 'changeSchemeState', state: 1 } }]);
    assert.deepEqual(programOff(), [{ path: '/happ_thermstat', query: { action: 'changeSchemeState', state: 0 } }]);
  });

  test('the mock Toon follows', async () => {
    const { toon, send } = boot();
    await send(programOff());
    assert.equal(toon.state.thermostat.programState, '0');
    await send(programOn());
    assert.equal(toon.state.thermostat.programState, '1');
    assert.deepEqual(seen(toon), [
      '/happ_thermstat?action=changeSchemeState&state=0',
      '/happ_thermstat?action=changeSchemeState&state=1',
    ]);
  });
});

describe('the read endpoints are plain, frozen objects', () => {
  test('the three reads of the app, as the Toon names them', () => {
    assert.deepEqual(ENDPOINTS.thermostat, { path: '/happ_thermstat', query: { action: 'getThermostatInfo' } });
    assert.deepEqual(ENDPOINTS.power, { path: '/happ_pwrusage', query: { action: 'GetCurrentUsage' } });
    assert.deepEqual(ENDPOINTS.meters, { path: '/hdrv_zwave', query: { action: 'getDevices.json' } });
  });

  test('they cannot be altered by a caller', () => {
    assert.throws(() => {
      ENDPOINTS.power.path = '/elsewhere';
    }, TypeError);
    assert.throws(() => {
      ENDPOINTS.power.query.action = 'x';
    }, TypeError);
    assert.throws(() => {
      RESUME.yes = () => [];
    }, TypeError);
  });

  test('every read answers on the mock Toon', async () => {
    const { client } = boot();

    assert.equal((await client.get(ENDPOINTS.thermostat)).result, 'ok');
    assert.equal((await client.get(ENDPOINTS.power)).result, 'ok');
    assert.equal(typeof await client.get(ENDPOINTS.meters), 'object');
  });
});
