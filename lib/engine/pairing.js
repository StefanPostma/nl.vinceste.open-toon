'use strict';

/*
 * Pairing (ADR-0008, docs/sdlc/05-architecture.md section 7), without Homey: what the two handlers of the pair view
 * decide. testConnection asks the Toon for its thermostat, which must look like the answer of a Toon, and then asks
 * every optional feature that can be probed whether it is there; buildNewDevice turns what the user entered and chose
 * into the device that Homey.createDevice receives. The view is a web page and can send anything, so every field is
 * checked before it is used. What the user has to read comes as a ToonError (from the client) or a PairingProblem
 * (from here); pairingMessage turns both into a sentence in the language of the user.
 */

const {
  FEATURES, featureState, capabilitiesFor, decisionKeys,
} = require('../features');
const { ENDPOINTS } = require('../toon/commands');
const { normalizeAddress } = require('../toon/address');
const { ToonError, ADDRESS_KEYS, toUserMessage } = require('../toon/errors');
const {
  parseThermostat, parseProgram, isRecord, field,
} = require('../toon/parse');
const { MIGRATION_VERSION } = require('./capabilities');
const { INTERVAL, runProbe } = require('./schedule');

/** An answer of this kind says that whatever sits at the address is not a Toon (FR-02 AC3). */
const NOT_A_TOON = Object.freeze(['redirect', 'too_large', 'bad_body']);
/** What a probe may tell the view; anything else it says (an unexpected answer, no answer) is "unknown". */
const PROBE_OUTCOMES = Object.freeze(['detected', 'not_found']);

/** A problem with what the user entered, or with what answered, that the pair view shows as a sentence. */
class PairingProblem extends Error {
  /** @param {string} key the locale key of the sentence */
  constructor(key) {
    super(key);
    this.name = 'PairingProblem';
    this.key = key;
  }
}

/**
 * @param {{__: (key: string) => string}} homey the Homey instance of the driver
 * @param {unknown} error whatever a handler caught
 * @returns {string} localized text; an error that is neither a PairingProblem nor a ToonError gets the general sentence
 */
function pairingMessage(homey, error) {
  return error instanceof PairingProblem ? homey.__(error.key) : toUserMessage(homey, error);
}

/**
 * The host of an address the user entered (FR-03, NFR-04 AC1). Nothing was sent anywhere when this throws.
 * @param {unknown} input
 * @returns {string} "host" or "host:port"
 * @throws {PairingProblem}
 */
function checkAddress(input) {
  if (typeof input !== 'string') throw new PairingProblem('pair.invalid_input');
  if (input.trim() === '') throw new PairingProblem('pair.address_required');
  const address = normalizeAddress(input);
  if (!address.ok) throw new PairingProblem(ADDRESS_KEYS[address.reason]);
  return address.host;
}

/** The address of a `testConnection` request of the view, checked. @throws {PairingProblem} */
function readAddress(request) {
  return checkAddress(field(request, 'address'));
}

async function askThermostat(client) {
  try {
    return await client.get(ENDPOINTS.thermostat);
  } catch (error) {
    if (error instanceof ToonError && NOT_A_TOON.includes(error.kind)) throw new PairingProblem('error.not_toon');
    throw error;
  }
}

/** One probe within its own budget; a probe that fails or runs out of time says "unknown" and never fails the test (FR-61 AC3). */
async function detect(feature, client, timers) {
  try {
    const { outcome } = await runProbe(feature, client, timers);
    return PROBE_OUTCOMES.includes(outcome) ? outcome : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * The connection test of the pair view (FR-02, FR-61): the thermostat first (the client's 5 s), then the probes, one
 * after the other, as the Toon should never have two requests at once (NFR-03).
 * @param {{host: string, get: Function}} client a ToonClient for the address that was entered
 * @param {{registry?: object[], timers: {setTimeout: Function, clearTimeout: Function}}} options `timers` run the budget of a probe
 * @returns {Promise<{host: string, readings: {currentTemp: number, currentSetpoint: number, programState: 'on' | 'off' | null,
 *   activeState: string | null}, features: Object<string, 'detected' | 'not_found' | 'unknown'>}>} temperatures in degrees,
 *   `features` has an entry for every optional feature that has a probe
 * @throws {ToonError | PairingProblem}
 */
async function testConnection(client, { registry = FEATURES, timers }) {
  const answer = await askThermostat(client);
  const { values } = parseThermostat(answer);
  if (values.measure_temperature === undefined || values.target_temperature === undefined) throw new PairingProblem('error.not_toon');

  const found = {};
  for (const feature of registry.filter((entry) => entry.optional === true && typeof entry.probe === 'function')) {
    found[feature.id] = await detect(feature, client, timers);
  }
  return {
    host: client.host,
    readings: {
      currentTemp: values.measure_temperature,
      currentSetpoint: values.target_temperature,
      programState: parseProgram(answer) ?? null,
      activeState: values.temperature_state ?? null,
    },
    features: found,
  };
}

/**
 * The device for Homey.createDevice (FR-01, FR-04, FR-51): what the user entered and ticked, with the settings, the
 * store and the capabilities of the features that are on. The id is the one the user typed, trimmed (C-ID-3); the name
 * defaults to it. Optional features start off unless the user ticked them. The store carries the marker of the
 * migration, so that the first start of the device has nothing to decide, and says that the user decided the switches
 * (ADR-0018). The options of every capability that the device holds are passed, the core ones and those of a ticked
 * feature: the documentation of the pairing says that these properties overwrite the defaults of the driver manifest, so
 * a list with only the ticked feature could cost the device the step and the range of the setpoint and the titles of
 * the meters (HW-03), and a list with everything cannot (ADR-0008).
 * @param {unknown} input `{name, id, address, features}` as the view sent it; `features` maps a feature id to a boolean
 * @param {{registry?: object[], options?: Object<string, object>, taken?: string[]}} [context] `options`: the manifest's
 *   capabilitiesOptions; `taken`: the ids of the devices that exist
 * @returns {{name: string, data: {id: string}, settings: object, store: object, capabilities: string[], capabilitiesOptions: object}}
 * @throws {PairingProblem}
 */
function buildNewDevice(input, { registry = FEATURES, options = {}, taken = [] } = {}) {
  const [id, name, address, chosen] = ['id', 'name', 'address', 'features'].map((key) => field(input, key));
  if (typeof id !== 'string' || typeof address !== 'string') throw new PairingProblem('pair.invalid_input');
  if ((name !== undefined && typeof name !== 'string') || (chosen !== undefined && !isRecord(chosen))) throw new PairingProblem('pair.invalid_input');

  const host = checkAddress(address);
  const toonId = id.trim();
  if (toonId === '') throw new PairingProblem('pair.id_required');
  if (taken.includes(toonId)) throw new PairingProblem('pair.id_taken');

  const optional = registry.filter((feature) => feature.optional === true && typeof feature.setting === 'string');
  const settings = {
    address: host,
    poll_interval: INTERVAL.default, // the default of the setting
    ...Object.fromEntries(optional.map((feature) => [feature.setting, field(chosen, feature.id) === true])),
  };
  const state = featureState(settings, registry);
  const held = capabilitiesFor(state, registry);

  return {
    name: (name ?? '').trim() || toonId,
    data: { id: toonId },
    settings,
    store: { migrationVersion: MIGRATION_VERSION, ...Object.fromEntries(decisionKeys(registry).map((key) => [key, 'user'])) },
    capabilities: held,
    capabilitiesOptions: Object.fromEntries(held.filter((capability) => Object.hasOwn(options, capability)).map((capability) => [capability, structuredClone(options[capability])])),
  };
}

module.exports = {
  PairingProblem, pairingMessage, readAddress, testConnection, buildNewDevice,
};
