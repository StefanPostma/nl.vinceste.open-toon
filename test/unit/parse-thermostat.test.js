'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseThermostat, parseProgram, TEMPERATURE_STATES, BURNER_STATES,
} = require('../../lib/toon/parse');
const { toonPayload, toonFixtureNames } = require('../helpers/fixtures');

const base = () => toonPayload('thermostat');
const withFields = (fields) => ({ ...base(), ...fields });
const parse = (fields) => parseThermostat(withFields(fields));

/** Every value a parser emits must be something a capability can hold. */
function assertCapabilityValues(values) {
  Object.entries(values).forEach(([id, value]) => {
    assert.notEqual(value, undefined, `${id} is undefined`);
    assert.ok(typeof value === 'boolean' || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)), `${id}: ${String(value)}`);
  });
}

describe('FR-10 AC1: temperatures come from centi-degree strings', () => {
  test('"2075" and "1950" give 20.8 and 19.5', () => {
    const { values } = parse({ currentTemp: '2075', currentSetpoint: '1950' });

    assert.equal(values.measure_temperature, 20.8);
    assert.equal(values.target_temperature, 19.5);
  });

  test('the whole fixture answer becomes the five thermostat values', () => {
    assert.deepEqual(parseThermostat(base()), {
      values: {
        measure_temperature: 20.3,
        target_temperature: 18.5,
        temperature_state: 'home',
        burner_state: 'off',
        'alarm_water.hotwater': false,
      },
      notes: [],
    });
  });

  test('numbers work as well as strings', () => {
    const { values } = parseThermostat(toonPayload('thermostat-states')['numeric-home']);

    assert.equal(values.measure_temperature, 20.3);
    assert.equal(values.target_temperature, 18.5);
    assert.equal(values.temperature_state, 'home');
  });

  test('FR-10 AC1 / ADR-0014: a setpoint another client left off the 0.5 step is rounded to it ("1975" -> 20.0)', () => {
    assert.equal(parseThermostat(toonPayload('thermostat-setpoint-1975')).values.target_temperature, 20);
    const expected = {
      1974: 19.5, 1975: 20, 1999: 20, 2024: 20, 2025: 20.5, 2026: 20.5, 600: 6, 624: 6, 625: 6.5, 3000: 30, 2999: 30,
    };
    Object.entries(expected).forEach(([centi, degrees]) => {
      assert.equal(parse({ currentSetpoint: centi }).values.target_temperature, degrees, centi);
    });
  });

  test('FR-10 AC1: the measured temperature is rounded to 0.1', () => {
    const expected = {
      2034: 20.3, 2035: 20.4, 2049: 20.5, 1999: 20, 0: 0, '-150': -1.5,
    };
    Object.entries(expected).forEach(([centi, degrees]) => {
      assert.equal(parse({ currentTemp: centi }).values.measure_temperature, degrees, centi);
    });
  });

  test('a setpoint outside the 6..30 range of the capability is dropped with a note', () => {
    ['0', '599', '3001', '65535', '-100'].forEach((centi) => {
      const { values, notes } = parse({ currentSetpoint: centi });

      assert.equal(Object.hasOwn(values, 'target_temperature'), false, centi);
      assert.equal(notes.length, 1, centi);
      assert.match(notes[0], /currentSetpoint is out of range/);
    });
  });
});

describe('FR-10 AC2: missing, empty or non-numeric values leave the capabilities alone', () => {
  const unusable = [undefined, '', ' ', 'abc', 'NaN', 'Infinity', '1e3', '0x10', '12abc', '1,5', null, {}, [], [2034], true, false];

  unusable.forEach((raw) => {
    test(`currentTemp and currentSetpoint ${JSON.stringify(raw) ?? 'missing'}`, () => {
      const { values } = parse({ currentTemp: raw, currentSetpoint: raw });

      assert.equal(Object.hasOwn(values, 'measure_temperature'), false);
      assert.equal(Object.hasOwn(values, 'target_temperature'), false);
      assertCapabilityValues(values);
    });
  });

  test('the other fields still come through when one is garbled', () => {
    const { values } = parse({ currentTemp: 'abc' });

    assert.equal(values.target_temperature, 18.5);
    assert.equal(values.temperature_state, 'home');
  });
});

describe('FR-12 AC1: activeState becomes temperature_state', () => {
  const states = toonPayload('thermostat-states');

  test('the fixture answers map as documented, strings and numbers alike', () => {
    ['comfort', 'home', 'sleep', 'away', 'vacation'].forEach((name) => {
      assert.equal(parseThermostat(states[name]).values.temperature_state, name);
    });
    assert.equal(parseThermostat(states.manual).values.temperature_state, 'none');
    assert.equal(parseThermostat(states['numeric-home']).values.temperature_state, 'home');
    assert.equal(parseThermostat(states['numeric-vacation']).values.temperature_state, 'vacation');
    assert.equal(parseThermostat(states['numeric-manual']).values.temperature_state, 'none');
  });

  test('"4" and 4 are vacation, "-1" and -1 are none', () => {
    [['4', 'vacation'], [4, 'vacation'], ['-1', 'none'], [-1, 'none'], ['0', 'comfort'], [0, 'comfort'], [' 3 ', 'away']].forEach(([raw, name]) => {
      assert.equal(parse({ activeState: raw }).values.temperature_state, name, String(raw));
    });
  });

  test('the table is the one the app writes with', () => {
    assert.deepEqual(TEMPERATURE_STATES, {
      comfort: 0, home: 1, sleep: 2, away: 3, vacation: 4, none: -1,
    });
  });
});

describe('FR-12 AC2: an unknown activeState keeps the previous value, once noted, and is never undefined', () => {
  ['7', 7, '5', '-2', '4.5', 'NaN', 'abc', '', null, {}, [], true].forEach((raw) => {
    test(`activeState ${JSON.stringify(raw)}`, () => {
      const { values, notes } = parse({ activeState: raw });

      assert.equal(Object.hasOwn(values, 'temperature_state'), false);
      assertCapabilityValues(values);
      assert.equal(notes.length, 1);
      assert.match(notes[0], /^activeState is not known/);
    });
  });

  test('a missing activeState is not worth a note', () => {
    const payload = base();
    delete payload.activeState;

    assert.deepEqual(parseThermostat(payload).notes, []);
  });

  test('the note is bounded and never carries a long answer', () => {
    const { notes } = parse({ activeState: 'x'.repeat(5000) });

    assert.ok(notes[0].length < 80, notes[0]);
  });
});

describe('FR-30 AC1: burnerInfo becomes burner_state, and the boiler hot-water flag is true for 2 only', () => {
  // The flag alarm_water.hotwater is requirement FR-31; it shares the burnerInfo field with burner_state.
  const expected = [
    [0, 'off', false], [1, 'heating', false], [2, 'hot_water', true], [3, 'preheating', false],
  ];

  expected.forEach(([code, state, flag]) => {
    test(`burnerInfo ${code} (number and string) -> ${state}, hot water ${flag}`, () => {
      [code, String(code)].forEach((raw) => {
        const { values } = parse({ burnerInfo: raw });

        assert.equal(values.burner_state, state);
        assert.equal(values['alarm_water.hotwater'], flag);
      });
    });
  });

  test('the fixture answers agree', () => {
    const fixtures = toonPayload('thermostat-burner');

    assert.equal(parseThermostat(fixtures.off).values.burner_state, 'off');
    assert.equal(parseThermostat(fixtures.heating).values.burner_state, 'heating');
    assert.equal(parseThermostat(fixtures.hot_water).values['alarm_water.hotwater'], true);
    assert.equal(parseThermostat(fixtures.preheating).values.burner_state, 'preheating');
    assert.equal(parseThermostat(fixtures['numeric-hot-water']).values.burner_state, 'hot_water');
  });

  test('the table lists the four values of burner_state in burnerInfo order', () => {
    assert.deepEqual(BURNER_STATES, ['off', 'heating', 'hot_water', 'preheating']);
  });
});

describe('FR-30 AC2: an unknown burnerInfo leaves burner_state and the hot-water flag untouched', () => {
  ['7', 7, '-1', '1.5', '4', 'abc', 'NaN', '', null, {}, true].forEach((raw) => {
    test(`burnerInfo ${JSON.stringify(raw)}`, () => {
      const { values, notes } = parse({ burnerInfo: raw });

      assert.equal(Object.hasOwn(values, 'burner_state'), false);
      assert.equal(Object.hasOwn(values, 'alarm_water.hotwater'), false);
      assert.equal(notes.length, 1);
      assert.match(notes[0], /^burnerInfo is not known/);
    });
  });
});

describe('FR-24 AC1 / AC2: partial and garbled answers', () => {
  test('a payload with only the thermostat fields updates the thermostat normally', () => {
    const { values } = parseThermostat({ currentTemp: '2100', currentSetpoint: '2000' });

    assert.deepEqual(values, { measure_temperature: 21, target_temperature: 20 });
  });

  test('every shape of FR-24 AC1 parses without throwing and emits only usable values', () => {
    const shapes = [
      {}, { result: 'error' }, { result: 'ok' }, '<html>502</html>', '{"result":"ok","currentTemp":"20', '', 'NaN', null, undefined, 'abc', 42, [], [1, 2], true,
      'x'.repeat(20 * 1024 * 1024), ...toonFixtureNames().map((name) => toonPayload(name)),
    ];

    shapes.forEach((shape) => {
      const { values, notes } = parseThermostat(shape);

      assertCapabilityValues(values);
      assert.ok(Array.isArray(notes));
    });
  });

  test('FR-24 AC1: junk answers emit nothing at all', () => {
    ['junk-empty-object', 'junk-result-error', 'junk-html', 'junk-truncated', 'junk-empty-body', 'junk-wrong-types'].forEach((name) => {
      assert.deepEqual(parseThermostat(toonPayload(name)).values, {}, name);
    });
  });

  test('the parser never changes the answer it was given', () => {
    const payload = toonPayload('thermostat-states').vacation;
    const copy = JSON.parse(JSON.stringify(payload));
    parseThermostat(payload);

    assert.deepEqual(payload, copy);
  });
});

describe('FR-02 AC1: the program of the Toon, as the pairing screen shows it', () => {
  test('0 is off, 1 and 2 (a temporary override that follows the program) are on, strings and numbers alike [HW-02]', () => {
    assert.equal(parseProgram({ programState: '0' }), 'off');
    assert.equal(parseProgram({ programState: 0 }), 'off');
    assert.equal(parseProgram({ programState: '1' }), 'on');
    assert.equal(parseProgram({ programState: 2 }), 'on');
    assert.equal(parseProgram(base()), 'on');
  });

  test('3 (program override) and 8 (locked base) are on as well: the Toon community web app counts them as program [12 section A]', () => {
    assert.equal(parseProgram({ programState: '3' }), 'on');
    assert.equal(parseProgram({ programState: 8 }), 'on');
    assert.equal(parseProgram(withFields({ programState: '8' })), 'on');
  });

  test('a value that is not known, a missing field and a payload that is not an object give no answer, never an exception', () => {
    const unknownCodes = ['4', '5', '6', '7', '9', '-1', 'on', null, ''].map((programState) => ({ programState }));
    [...unknownCodes, {}, null, 'text', [], 7].forEach((payload) => {
      assert.equal(parseProgram(payload), undefined, JSON.stringify(payload));
    });
    assert.equal(parseProgram(Object.create({ programState: '1' })), undefined, 'only an own property counts');
  });
});
