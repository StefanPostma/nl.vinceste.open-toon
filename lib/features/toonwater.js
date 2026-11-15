'use strict';

/*
 * ToonWater: the community add-on that runs on the Toon itself and writes the page /water.html with the readings of
 * a water-pulse sensor. This is the only file that names that page (FR-60 AC3, NFR-10). The feature is optional
 * and off by default (ADR-0006): the page is asked for only while the user has switched it on for the device.
 *
 * Provenance (NFR-11, ADR-0006 item 1): written from the interface description of docs/sdlc/03-reuse-inventory.md
 * section 5.3 (the URL, the JSON members, their units) and from the water code of this repository, which is
 * GPL-3.0 (PR #21, commit f705a70, device.js lines 410-424 at 5cc3b90: litres divided by 1000, the flow as it is
 * delivered). No source file of the unlicensed oepi-loepi/* repositories was copied into this file or paraphrased
 * here, and the numbers of the sample below are invented, not those of any sample comment of the add-on; the add-on's
 * name is used because that is what users call it.
 */

const { ToonError, isNotFound } = require('../toon/errors');
const { toNumber, isRecord, field } = require('../toon/parse');

const ENDPOINT = Object.freeze({ path: '/water.html' });
const CAPABILITIES = Object.freeze(['measure_water', 'meter_water.today', 'meter_water.total']);
/** The members of the page that the sensor module itself serves: the address of the module was entered, not the Toon's. */
const SENSOR_MODULE_MEMBERS = Object.freeze(['waterflow', 'waterquantity']);
const MINUTE_MS = 60e3;
const HOUR_MS = 60 * MINUTE_MS;

const nonNegative = (raw) => {
  const number = toNumber(raw);
  return number !== undefined && number >= 0 ? number : undefined;
};

/**
 * What the answer of /water.html says. The add-on writes `{"result":"ok","water":{"flow":4,"total":7350214,
 * "value":137,"avgValue":200}}`: `flow` in litres per minute, `value` (today) and `total` in litres, which become
 * m3 with three decimals. Each member counts on its own (add-ons older than 1.1.16 have no `total`); a member
 * that is missing, negative, null or not a number is left out; `avgValue` is not used (FR-58).
 * @param {unknown} payload
 * @returns {{values: object, notes: string[], unusable?: string}} `unusable`: why the answer is not a ToonWater answer
 */
function parseWater(payload) {
  if (isRecord(payload) && SENSOR_MODULE_MEMBERS.some((name) => Object.hasOwn(payload, name))) {
    return { values: {}, notes: ['the answer is that of the ToonWater sensor module, not of the Toon'], unusable: 'sensor_module' };
  }
  const water = field(payload, 'water');
  if (field(payload, 'result') !== 'ok' || !isRecord(water)) return { values: {}, notes: ['the answer is not a ToonWater answer'], unusable: 'unexpected' };

  const values = {};
  const flow = nonNegative(field(water, 'flow'));
  if (flow !== undefined) values.measure_water = flow;
  const today = nonNegative(field(water, 'value'));
  if (today !== undefined) values['meter_water.today'] = Math.round(today) / 1000;
  const total = nonNegative(field(water, 'total'));
  if (total !== undefined) values['meter_water.total'] = Math.round(total) / 1000;
  return { values, notes: [] };
}

/**
 * What an answer, or the failure to get one, means for the add-on.
 * @param {ToonError | null} error null: a usable answer
 * @param {string} [reason] `unusable` of the parser
 * @returns {{outcome: 'detected' | 'not_found' | 'unreachable' | 'unexpected', hint?: 'sensor_module'}}
 */
function classify(error, reason) {
  if (error === null) return { outcome: 'detected' };
  if (isNotFound(error)) return { outcome: 'not_found' };
  if (['timeout', 'network', 'aborted'].includes(error.kind)) return { outcome: 'unreachable' };
  return reason === 'sensor_module' ? { outcome: 'unexpected', hint: 'sensor_module' } : { outcome: 'unexpected' };
}

/**
 * Asks the Toon once whether the add-on page is there: at pairing, when the user switches the feature on and when
 * the address changes. Never throws. A probe that was cancelled (device removed, address changed) or ran out of
 * time says "unreachable", which tells nothing about the add-on.
 * @param {{get: Function}} client
 * @param {{signal: AbortSignal}} options
 */
async function probe(client, { signal }) {
  try {
    const parsed = parseWater(await client.get(ENDPOINT, { signal }));
    return classify(parsed.unusable ? new ToonError('bad_body') : null, parsed.unusable);
  } catch (error) {
    return classify(error instanceof ToonError ? error : new ToonError('bad_body', { cause: error }));
  }
}

module.exports = Object.freeze({
  id: 'toonwater',
  optional: true,
  setting: 'toonwater_enabled',
  statusSetting: 'toonwater_status',
  capabilities: CAPABILITIES,
  /** A device that already carries any of the three items keeps the feature on (FR-56); the hot-water flag is not one of them. */
  legacyIf: (capabilities) => capabilities.some((id) => CAPABILITIES.includes(id)),
  pollGroups: Object.freeze([Object.freeze({
    id: 'water',
    critical: false,
    report: true, // the device keeps the status and the warning of the add-on up to date from every answer
    endpoint: ENDPOINT,
    parse: parseWater,
    absentOn404: Object.freeze({ backoffMs: 15 * MINUTE_MS }), // a missing page is no error: ask again every 15 minutes (FR-57)
    failBackoffMs: 5 * MINUTE_MS, // any other failure: every 5 minutes, ...
    failEscalateAfter: 3, // ... and every 15 minutes from the fourth in a row on
    escalatedBackoffMs: 15 * MINUTE_MS,
  })]),
  probe,
  probeBudgetMs: 3000,
  classify,
  refreshOnEnable: Object.freeze(['water']),
  /** Who decided the switch of this device, 'migration' or 'user' (ADR-0018). A device without the key counts as 'user'. */
  decidedByKey: 'toonwaterDecidedBy',
  firstNotFoundKey: 'waterFirst404At',
  hintSentKey: 'waterHintSent',
  hintAfter404Ms: 24 * HOUR_MS, // FR-62: one timeline hint for a device that the migration switched on and that never found the add-on
  warnWhenMigrationDecided: false, // ADR-0018 item 3: no tile warning for such a device while it never held a water value
  cards: Object.freeze({ guarded: Object.freeze(['update_water']), triggers: Object.freeze(['measure_water_changed']), onDisabled: 'reject' }),
  rules: Object.freeze([Object.freeze({
    caps: Object.freeze(['measure_water']),
    card: 'measure_water_changed',
    tokens: (value) => ({ measure_water: value('measure_water') }),
  })]),
  texts: Object.freeze({
    status: Object.freeze({
      off: 'toonwater.status_off',
      detected: 'toonwater.status_detected',
      not_found: 'toonwater.status_not_found',
      unreachable: 'toonwater.status_unreachable',
      unexpected: 'toonwater.status_unexpected',
      sensor_module: 'toonwater.status_sensor_module',
    }),
    saved: Object.freeze({
      off: 'toonwater.saved_off',
      detected: 'toonwater.saved_detected',
      not_found: 'toonwater.saved_not_found',
      unreachable: 'toonwater.saved_unreachable',
      unexpected: 'toonwater.saved_unexpected',
      sensor_module: 'toonwater.saved_sensor_module',
    }),
    warning: 'toonwater.warning_not_found',
    hint: 'toonwater.hint_not_found',
    notEnabled: 'toonwater.not_enabled',
  }),
});
