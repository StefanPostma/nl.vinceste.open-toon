'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parsePower, parseMeters, parseThermostat,
} = require('../../lib/toon/parse');
const { toonPayload, toonFixtureNames } = require('../helpers/fixtures');

const usage = (value) => ({ result: 'ok', powerUsage: { value, avgValue: 432.22 } });

/** The same meters under the node keys of another Toon generation (key map: dev_2 key -> new key). */
function relocate(payload, keyMap) {
  return Object.fromEntries(Object.entries(payload).map(([key, node]) => [keyMap[key] ?? key, node]));
}
const DEV3_KEYS = {
  'dev_2.1': 'dev_3.1', 'dev_2.2': 'dev_3.2', 'dev_2.4': 'dev_3.3', 'dev_2.5': 'dev_3.4', 'dev_2.6': 'dev_3.5', 'dev_2.7': 'dev_3.6', dev_2: 'dev_3',
};
const DEV4_KEYS = Object.fromEntries(Object.entries(DEV3_KEYS).map(([from, to]) => [from, to.replace('dev_3', 'dev_4')]));

describe('FR-20 AC1: measure_power is the current import in watts', () => {
  test('460 stays 460, and the average next to it is ignored', () => {
    assert.deepEqual(parsePower(usage(460)), { values: { measure_power: 460 }, notes: [] });
  });

  test('the fixture answer', () => {
    assert.deepEqual(parsePower(toonPayload('power')).values, { measure_power: 324, 'measure_power.export': 0 });
  });
});

describe('FR-20 AC2: numeric strings count, anything else leaves the capability alone', () => {
  test('"460" and " 460.5 " are numbers', () => {
    assert.equal(parsePower(usage('460')).values.measure_power, 460);
    assert.equal(parsePower(usage(' 460.5 ')).values.measure_power, 460.5);
  });

  [undefined, '', 'abc', 'NaN', '1e3', null, {}, [], true, -5, '-5'].forEach((raw) => {
    test(`powerUsage.value ${JSON.stringify(raw) ?? 'missing'} produces no value`, () => {
      assert.deepEqual(parsePower(usage(raw)).values, {});
    });
  });

  test('FR-27 AC1: measure_power is never negative, a feed-in does not turn it into one', () => {
    assert.equal(Object.hasOwn(parsePower(usage(-1250)).values, 'measure_power'), false);
    assert.equal(parsePower(usage(0)).values.measure_power, 0);
  });
});

describe('FR-20 AC3: the answer has no day counters, so no plain meter_power is ever produced', () => {
  test('dayUsage and dayLowUsage are ignored', () => {
    const payload = { powerUsage: { value: 460, dayUsage: 5000, dayLowUsage: 3000 }, dayUsage: 1, dayLowUsage: 1 };
    const { values } = parsePower(payload);

    assert.deepEqual(Object.keys(values), ['measure_power']);
  });

  test('no parser emits the plain meter_power for any fixture', () => {
    toonFixtureNames().forEach((name) => {
      const payload = toonPayload(name);
      [parsePower, parseMeters, parseThermostat].forEach((parse) => {
        assert.equal(Object.hasOwn(parse(payload).values, 'meter_power'), false, `${parse.name} ${name}`);
      });
    });
  });
});

describe('powerProduction becomes measure_power.export from the same answer', () => {
  test('1250 W of feed-in is exported, import stays what it was', () => {
    const { values } = parsePower(toonPayload('power-feed-in'));

    assert.equal(values['measure_power.export'], 1250);
    assert.equal(values.measure_power, 324);
  });

  test('an answer without powerProduction leaves the export untouched', () => {
    assert.deepEqual(parsePower(toonPayload('power-no-production')).values, { measure_power: 324 });
  });

  test('a zero is a real reading, a string is read, garbage and negatives are not', () => {
    const production = (value) => parsePower({ powerUsage: { value: 1 }, powerProduction: { value } }).values['measure_power.export'];

    assert.equal(production(0), 0);
    assert.equal(production('1200'), 1200);
    [null, 'abc', 'NaN', -3, {}, []].forEach((raw) => assert.equal(production(raw), undefined, String(raw)));
    assert.equal(parsePower({ powerProduction: 'x' }).values['measure_power.export'], undefined);
  });
});

describe('FR-21 AC1/AC3: electricity totals in kWh with three decimals', () => {
  test('"1030645.00" Wh is 1030.645 kWh on the peak total', () => {
    const payload = { 'dev_2.4': { CurrentElectricityQuantity: '1030645.00' } };

    assert.deepEqual(parseMeters(payload).values, { 'meter_power.peak': 1030.645 });
  });

  test('a two-tariff meter updates both totals', () => {
    const { values } = parseMeters(toonPayload('getdevices-dev2-two-tariff'));

    assert.equal(values['meter_power.peak'], 3718.492);
    assert.equal(values['meter_power.offPeak'], 4120.771);
  });

  test('values with and without decimals, as strings and as numbers', () => {
    const peak = (raw) => parseMeters({ 'dev_2.4': { CurrentElectricityQuantity: raw } }).values['meter_power.peak'];

    assert.equal(peak('1'), 0.001);
    assert.equal(peak(1500), 1.5);
    assert.equal(peak('1234567.6'), 1234.568);
    assert.equal(peak(' 42 '), 0.042);
  });
});

describe('FR-21 AC2: a single-tariff meter reports "NaN" on the peak node', () => {
  test('the peak total comes from the single-tariff node and the off-peak total is left alone', () => {
    const { values } = parseMeters(toonPayload('getdevices-dev2-single-tariff'));

    assert.equal(values['meter_power.peak'], 7839.263);
    assert.equal(Object.hasOwn(values, 'meter_power.offPeak'), false);
  });

  test('the single-tariff node is not used when the peak node has a reading', () => {
    const payload = toonPayload('getdevices-dev2-two-tariff');
    payload['dev_2.2'].CurrentElectricityQuantity = '999999';

    assert.equal(parseMeters(payload).values['meter_power.peak'], 3718.492);
  });

  test('a peak node with garbage (not "NaN") is not replaced by the single-tariff node', () => {
    const payload = toonPayload('getdevices-dev2-single-tariff');
    payload['dev_2.4'].CurrentElectricityQuantity = 'abc';

    assert.equal(Object.hasOwn(parseMeters(payload).values, 'meter_power.peak'), false);
  });
});

describe('FR-21 AC1 / FR-28: counters that are not readings are never emitted', () => {
  const bad = ['NaN', 'nan', null, '', ' ', 'abc', '-5', -5, '0', 0, '0.4', 0.4, '1e6', {}, [], true, 'Infinity'];

  bad.forEach((raw) => {
    test(`CurrentElectricityQuantity and CurrentGasQuantity ${JSON.stringify(raw)}`, () => {
      const payload = {
        'dev_2.1': { CurrentGasQuantity: raw },
        'dev_2.4': { CurrentElectricityQuantity: raw },
        'dev_2.6': { CurrentElectricityQuantity: raw },
        'dev_2.2': { CurrentElectricityQuantity: raw },
      };

      assert.deepEqual(parseMeters(payload).values, {});
    });
  });
});

describe('FR-28: the gas total in cubic metres with three decimals', () => {
  test('AC1: "1234567" litres is 1234.567', () => {
    assert.deepEqual(parseMeters({ 'dev_2.1': { CurrentGasQuantity: '1234567' } }).values, { meter_gas: 1234.567 });
  });

  test('AC2: a Toon without a gas node leaves meter_gas untouched and notes nothing', () => {
    const payload = toonPayload('getdevices-dev2-two-tariff');
    delete payload['dev_2.1'];
    const { values, notes } = parseMeters(payload);

    assert.equal(Object.hasOwn(values, 'meter_gas'), false);
    assert.deepEqual(notes, []);
  });

  test('the fixture answer', () => {
    assert.equal(parseMeters(toonPayload('getdevices-dev2-two-tariff')).values.meter_gas, 5242.11);
  });
});

describe('FR-22 AC1: the same totals come out of dev_2.x, dev_3.x and dev_4.x keys [HW-02]', () => {
  const dev2 = toonPayload('getdevices-dev2-two-tariff');
  const expected = {
    meter_gas: 5242.11, 'meter_power.peak': 3718.492, 'meter_power.offPeak': 4120.771,
  };

  test('dev_2.x (the legacy keys)', () => {
    assert.deepEqual(parseMeters(dev2), { values: expected, notes: [] });
  });

  test('dev_3.x, found through the type strings of METER_RULES', () => {
    assert.deepEqual(parseMeters(relocate(dev2, DEV3_KEYS)), { values: expected, notes: [] });
  });

  test('dev_4.x, found through the type strings of METER_RULES', () => {
    assert.deepEqual(parseMeters(relocate(dev2, DEV4_KEYS)), { values: expected, notes: [] });
  });

  test('the dev_3 fixture is read as it is', () => {
    assert.deepEqual(parseMeters(toonPayload('getdevices-dev3')).values, {
      meter_gas: 3012.45, 'meter_power.peak': 2210.334, 'meter_power.offPeak': 3340.877,
    });
  });

  test('a single-tariff dev_3.x meter falls back to its elec node as well', () => {
    const payload = toonPayload('getdevices-dev3');
    payload['dev_3.3'].CurrentElectricityQuantity = 'NaN';
    payload['dev_3.5'].CurrentElectricityQuantity = 'NaN';
    payload['dev_3.2'].CurrentElectricityQuantity = '6000000';

    assert.deepEqual(parseMeters(payload).values, { meter_gas: 3012.45, 'meter_power.peak': 6000 });
  });
});

describe('FR-22 AC2: when the rule cannot decide nothing is guessed, and one note names the candidates', () => {
  test('two gas nodes: no gas value, the other totals still come through', () => {
    const payload = toonPayload('getdevices-dev3');
    payload['dev_5.1'] = { type: 'gas', CurrentGasQuantity: '1' };
    const { values, notes } = parseMeters(payload);

    assert.equal(Object.hasOwn(values, 'meter_gas'), false);
    assert.equal(values['meter_power.peak'], 2210.334);
    assert.equal(notes.length, 1);
    assert.match(notes[0], /gas: dev_3\.1, dev_5\.1/);
  });

  test('one note per answer, however many roles are ambiguous', () => {
    const payload = {
      'dev_3.1': { type: 'gas', CurrentGasQuantity: '1000' },
      'dev_5.1': { type: 'gas', CurrentGasQuantity: '2000' },
      'dev_3.3': { type: 'elec_delivered_nt', CurrentElectricityQuantity: '3000' },
      'dev_5.3': { type: 'elec_delivered_nt', CurrentElectricityQuantity: '4000' },
    };
    const { values, notes } = parseMeters(payload);

    assert.deepEqual(values, {});
    assert.equal(notes.length, 1);
    assert.match(notes[0], /gas: dev_3\.1, dev_5\.1; peak: dev_3\.3, dev_5\.3/);
  });
});

describe('FR-24 AC1: the five hostile shapes of ADR-0003 (R-12)', () => {
  const hostile = ['hostile-null-node', 'hostile-own-property', 'hostile-proto', 'hostile-water-array', 'hostile-string-powerusage'];

  hostile.forEach((name) => {
    test(`${name}: no parser throws, none emits a value, and Object.prototype stays clean`, () => {
      [parseThermostat, parsePower, parseMeters].forEach((parse) => {
        const result = parse(toonPayload(name));

        assert.deepEqual(result.values, {}, `${parse.name} ${name}`);
        assert.ok(Array.isArray(result.notes));
      });
      assert.equal(({}).polluted, undefined);
      assert.equal(Object.prototype.polluted, undefined);
    });
  });

  test('a payload whose own __proto__ key carries meter-like data is not followed', () => {
    const payload = JSON.parse('{"__proto__": {"CurrentGasQuantity": "1000", "type": "gas"}, "dev_2.1": 5}');

    assert.deepEqual(parseMeters(payload).values, {});
  });

  test('FR-24 AC1: every junk shape parses to nothing and does not throw (also the 20 MB text)', () => {
    const shapes = ['junk-empty-object', 'junk-result-error', 'junk-html', 'junk-truncated', 'junk-empty-body', 'junk-wrong-types', 'getdevices-empty', 'water-esp-flat']
      .map((name) => toonPayload(name))
      .concat([null, undefined, 42, [], 'x'.repeat(20 * 1024 * 1024)]);

    shapes.forEach((shape) => {
      assert.deepEqual(parsePower(shape).values, {});
      assert.deepEqual(parseMeters(shape).values, {});
    });
  });

  test('FR-24 AC1: a missing node is only a missing value', () => {
    const { values } = parseMeters(toonPayload('getdevices-missing-node'));

    assert.deepEqual(values, { meter_gas: 5242.11, 'meter_power.offPeak': 4120.771 });
  });
});
