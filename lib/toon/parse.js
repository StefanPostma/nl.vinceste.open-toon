'use strict';

/*
 * Pure parsers: the answer of a Toon endpoint in, capability values out (FR-10..12, FR-20, FR-21, FR-24,
 * FR-28, FR-30). Every parser returns {values, notes} and never throws, whatever the input looks like.
 * `values` holds only finite numbers, strings of a known table and booleans, keyed by capability id: a field
 * that is missing or unusable simply produces no entry, so the capability keeps its value. `notes` are short
 * lines for the debug log. Payload objects are only read through Object.hasOwn: no method of a payload is
 * called and nothing of it is copied into other objects (a parsed "__proto__" key is an own property). The meter
 * discovery that parseMeters rests on is in this file as well.
 */

/** activeState of the Toon <-> value of the temperature_state capability. */
const TEMPERATURE_STATES = Object.freeze({
  comfort: 0, home: 1, sleep: 2, away: 3, vacation: 4, none: -1,
});
/** burnerInfo of the Toon is the index; the values of the burner_state capability. */
const BURNER_STATES = Object.freeze(['off', 'heating', 'hot_water', 'preheating']);
const HOT_WATER = BURNER_STATES.indexOf('hot_water');

const STATE_NAMES = new Map(Object.entries(TEMPERATURE_STATES).map(([name, id]) => [id, name]));
const DECIMAL = /^[+-]?\d+(?:\.\d+)?$/;
/** The setpoint of the capability, in degrees; the Toon reports it in centi-degrees (x100). */
const SETPOINT_RANGE = Object.freeze({ min: 6, max: 30 });

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const field = (record, name) => (isRecord(record) && Object.hasOwn(record, name) ? record[name] : undefined);

/*
 * Meter discovery (FR-22, ADR-0014): finds the gas and electricity nodes in the answer of
 * /hdrv_zwave?action=getDevices.json, a flat map "dev_<node>[.<n>]" -> {type, ...} whose node numbers differ per
 * Toon generation. For every role the legacy dev_2.x key wins (continuity for the Toons the app has always read),
 * then the node's `type` string fills the gap. Two candidates for one role are not guessed: the role gets no node and
 * one note names the candidates. METER_RULES is the single table to edit once real getDevices dumps exist [HW-02];
 * its type strings are seeded from docs/sdlc/03-reuse-inventory.md section 4.4 (medium confidence). The HAE_METER
 * strings of the electricity roles are left out on purpose: the same string stands for two roles in that table.
 */
const METER_RULES = Object.freeze({
  gas: Object.freeze({
    legacyKey: 'dev_2.1',
    field: 'CurrentGasQuantity',
    types: Object.freeze(['gas', 'HAE_METER_v2_1', 'HAE_METER_v3_1', 'HAE_METER_v4_1']),
  }),
  peak: Object.freeze({
    legacyKey: 'dev_2.4',
    field: 'CurrentElectricityQuantity',
    types: Object.freeze(['elec_delivered_nt']),
  }),
  offPeak: Object.freeze({
    legacyKey: 'dev_2.6',
    field: 'CurrentElectricityQuantity',
    types: Object.freeze(['elec_delivered_lt']),
  }),
  single: Object.freeze({
    legacyKey: 'dev_2.2',
    field: 'CurrentElectricityQuantity',
    types: Object.freeze(['elec']),
  }),
});

const NODE_KEY = /^dev_[\w.]{1,16}$/;

/**
 * @param {unknown} payload the parsed answer of getDevices.json
 * @returns {{nodes: Record<string, {key: string, node: object} | null>, notes: string[]}}
 *   `nodes` has one entry per role of METER_RULES; `notes` is empty or one line for the log.
 */
function discoverMeters(payload) {
  const nodes = Object.fromEntries(Object.keys(METER_RULES).map((role) => [role, null]));
  if (!isRecord(payload)) return { nodes, notes: [] };

  const candidates = Object.entries(payload).filter(([key, node]) => NODE_KEY.test(key) && isRecord(node));
  const ambiguous = [];

  Object.entries(METER_RULES).forEach(([role, rule]) => {
    const legacy = candidates.find(([key]) => key === rule.legacyKey);
    if (legacy) {
      nodes[role] = { key: legacy[0], node: legacy[1] };
      return;
    }
    const typed = candidates.filter(([, node]) => Object.hasOwn(node, 'type') && rule.types.includes(node.type));
    if (typed.length === 1) nodes[role] = { key: typed[0][0], node: typed[0][1] };
    else if (typed.length > 1) ambiguous.push(`${role}: ${typed.map(([key]) => key).join(', ')}`);
  });

  return { nodes, notes: ambiguous.length === 0 ? [] : [`meter nodes are ambiguous, nothing is read for them (${ambiguous.join('; ')})`] };
}

/** A finite number from a number or a plain decimal string (the Toon sends most numbers as strings). */
function toNumber(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw === 'string' && DECIMAL.test(raw.trim())) {
    const number = Number(raw);
    return Number.isFinite(number) ? number : undefined;
  }
  return undefined;
}

/** A short, bounded description of an unusable raw value for a note. */
function preview(raw) {
  return typeof raw === 'string' || typeof raw === 'number' ? JSON.stringify(String(raw).slice(0, 20)) : typeof raw;
}

/** Counters only count up from a positive reading: 0, negatives and "NaN" are "not available". */
function cumulative(raw) {
  const number = toNumber(raw);
  if (number === undefined) return undefined;
  const scaled = Math.round(number) / 1000;
  return scaled > 0 ? scaled : undefined;
}

/** The Toon marks a meter that does not exist as the string "NaN" (or leaves the field out). */
function isUnset(raw) {
  return raw === undefined || (typeof raw === 'string' && raw.trim().toUpperCase() === 'NAN');
}

/**
 * @param {unknown} payload answer of /happ_thermstat?action=getThermostatInfo
 * @returns {{values: object, notes: string[]}}
 */
function parseThermostat(payload) {
  const values = {};
  const notes = [];
  if (!isRecord(payload)) return { values, notes: ['thermostat answer is not an object'] };

  const temperature = toNumber(field(payload, 'currentTemp'));
  if (temperature !== undefined) values.measure_temperature = Math.round(temperature / 10) / 10;

  const setpoint = toNumber(field(payload, 'currentSetpoint'));
  if (setpoint !== undefined && setpoint >= SETPOINT_RANGE.min * 100 && setpoint <= SETPOINT_RANGE.max * 100) {
    values.target_temperature = Math.round(setpoint / 50) / 2; // the capability steps by 0.5: 1975 -> 20.0
  } else if (setpoint !== undefined) {
    notes.push(`currentSetpoint is out of range: ${preview(field(payload, 'currentSetpoint'))}`);
  }

  const rawState = field(payload, 'activeState');
  const state = STATE_NAMES.get(toNumber(rawState));
  if (state !== undefined) values.temperature_state = state;
  else if (rawState !== undefined) notes.push(`activeState is not known: ${preview(rawState)}`);

  const rawBurner = field(payload, 'burnerInfo');
  const burner = toNumber(rawBurner);
  if (Number.isInteger(burner) && burner >= 0 && burner < BURNER_STATES.length) {
    values.burner_state = BURNER_STATES[burner];
    values['alarm_water.hotwater'] = burner === HOT_WATER;
  } else if (rawBurner !== undefined) {
    notes.push(`burnerInfo is not known: ${preview(rawBurner)}`);
  }

  return { values, notes };
}

/**
 * Whether the weekly program of the Toon is running, for the pairing screen. programState 0 is manual (the program is
 * off), 1 the program runs and 2 it runs after a temporary override [03 I2]; any other value (4, holiday, is only
 * M-confidence) is not reported.
 * @param {unknown} payload answer of /happ_thermstat?action=getThermostatInfo
 * @returns {'on' | 'off' | undefined}
 */
function parseProgram(payload) {
  const state = toNumber(field(payload, 'programState'));
  if (state === 0) return 'off';
  return state === 1 || state === 2 ? 'on' : undefined;
}

/**
 * Current power, import and export, from the answer of /happ_pwrusage?action=GetCurrentUsage.
 * The answer has no usable dayUsage/dayLowUsage, so nothing is derived from them (ADR-0014).
 * @param {unknown} payload
 * @returns {{values: object, notes: string[]}}
 */
function parsePower(payload) {
  const values = {};
  const usage = toNumber(field(field(payload, 'powerUsage'), 'value'));
  if (usage !== undefined && usage >= 0) values.measure_power = usage;
  const production = toNumber(field(field(payload, 'powerProduction'), 'value'));
  if (production !== undefined && production >= 0) values['measure_power.export'] = production;
  return { values, notes: [] };
}

/**
 * Gas (m3) and electricity totals (kWh), three decimals, from the answer of getDevices.json.
 * A single-tariff meter reports "NaN" on the peak node: its total then comes from the single-tariff node and
 * the off-peak total stays untouched.
 * @param {unknown} payload
 * @returns {{values: object, notes: string[]}}
 */
function parseMeters(payload) {
  const { nodes, notes } = discoverMeters(payload);
  const read = (role) => field(nodes[role] && nodes[role].node, METER_RULES[role].field);
  const values = {};

  const gas = cumulative(read('gas'));
  if (gas !== undefined) values.meter_gas = gas;

  const peakRaw = read('peak');
  const peak = cumulative(peakRaw) ?? (isUnset(peakRaw) ? cumulative(read('single')) : undefined);
  if (peak !== undefined) values['meter_power.peak'] = peak;

  const offPeak = cumulative(read('offPeak'));
  if (offPeak !== undefined) values['meter_power.offPeak'] = offPeak;

  return { values, notes };
}

module.exports = {
  TEMPERATURE_STATES, BURNER_STATES, METER_RULES, SETPOINT_RANGE, isRecord, field, toNumber, discoverMeters, parseThermostat, parseProgram, parsePower, parseMeters,
};
