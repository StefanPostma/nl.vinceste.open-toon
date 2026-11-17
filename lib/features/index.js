'use strict';

/*
 * The feature registry (ADR-0001). A feature is a plain object:
 *
 *   id            unique name
 *   always        true for the part every device has (core); such a feature cannot be switched off
 *   optional      true for an add-on the user switches on per device
 *   setting       optional features only: the boolean device setting that switches it
 *   capabilities  the capability ids it adds to a device
 *   legacyIf      optional features only: (capabilities) => boolean, whether a device that predates the
 *                 setting should start with the feature on (decided once, from the capability list)
 *   pollGroups    [{id, critical, endpoint: {path, query?}, parse: (json) => {values, notes, unusable?}}]; a group may
 *                 also say `report: true` (the device is told every result), `every: n` (every n-th cycle) and how it
 *                 sits out after a failure: `absentOn404: {backoffMs}`, `failBackoffMs`, `failEscalateAfter`,
 *                 `escalatedBackoffMs`
 *   refreshOnEnable  the group ids to read at once when the user switches the feature on
 *   decidedByKey  the store key in which the device records who decided the switch, 'migration' or 'user'
 *   cards         the Flow cards the feature claims, by kind: `actions`, `conditions`, `triggers`; every card of the manifest is
 *                 claimed by exactly one feature. `guarded` lists actions that are claimed too and run only while the
 *                 feature is on; `onDisabled` ('reject' or 'noop') says what they do otherwise (lib/flow/cards.js)
 *   rules         [{caps, card, tokens(value), state?(value), source?}]: a change of one of `caps` fires the trigger `card`
 *                 with those tokens; `source: 'homey'` means that Homey fires it itself and the app does not
 *
 * An optional feature that shows its state on the device adds a status setting, a probe, classify and the texts for
 * them (lib/engine/optional.js reads them); the feature files say which ones they use.
 *
 * Every function here is pure and takes the feature list as its last parameter (default: the registry), so
 * nothing in lib/engine names a feature and a test can hand in an extra one.
 */

const core = require('./core');
const toonwater = require('./toonwater');
const exportFeature = require('./export');
const { isRecord } = require('../toon/parse');

/** The features of the app, in the order their poll groups run. */
const FEATURES = Object.freeze([core, toonwater, exportFeature]);
/** The capabilities every device has. */
const CORE = core.capabilities;

function isActive(feature, state) {
  return feature.always === true || (isRecord(state) && state[feature.id] === true);
}

function isOn(feature, settings) {
  if (feature.always === true) return true;
  return typeof feature.setting === 'string' && isRecord(settings) && Object.hasOwn(settings, feature.setting) && settings[feature.setting] === true;
}

/**
 * Which features are on for a device.
 * @param {unknown} settings the device settings; anything that is not exactly `true` counts as off
 * @param {object[]} [features]
 * @returns {Object<string, boolean>} feature id -> on
 */
function featureState(settings, features = FEATURES) {
  return Object.fromEntries(features.map((feature) => [feature.id, isOn(feature, settings)]));
}

/** The poll groups of the features that are on, in registry order. */
function activeGroups(state, features = FEATURES) {
  return features.filter((feature) => isActive(feature, state)).flatMap((feature) => feature.pollGroups || []);
}

/** The capabilities of the features that are on, without duplicates, in registry order. */
function capabilitiesFor(state, features = FEATURES) {
  return [...new Set(features.filter((feature) => isActive(feature, state)).flatMap((feature) => feature.capabilities))];
}

/**
 * The switches a device without the marker of the migration starts with, decided from the capabilities it has.
 * @param {string[]} capabilities
 * @param {object[]} [features]
 * @returns {Object<string, boolean>} setting key -> on, for every optional feature
 */
function legacyDefaults(capabilities, features = FEATURES) {
  const held = Array.isArray(capabilities) ? capabilities : [];
  return Object.fromEntries(features
    .filter((feature) => feature.optional === true && typeof feature.setting === 'string')
    .map((feature) => [feature.setting, typeof feature.legacyIf === 'function' && feature.legacyIf(held) === true]));
}

/** The store keys in which the optional features record who decided their switch for a device. */
function decisionKeys(features = FEATURES) {
  return features.filter((feature) => feature.optional === true && typeof feature.decidedByKey === 'string').map((feature) => feature.decidedByKey);
}

module.exports = {
  FEATURES, CORE, featureState, activeGroups, capabilitiesFor, legacyDefaults, decisionKeys,
};
