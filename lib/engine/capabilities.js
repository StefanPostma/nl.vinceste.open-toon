'use strict';

/*
 * Capability and settings planning (docs/sdlc/05-architecture.md section 9, ADR-0010) and the code that applies a plan
 * to a device. The planners are pure: no Homey, no I/O. reconcile and migrate take the device as a parameter and
 * call Homey only through it. The engine knows features only through their shape (lib/features/index.js) and takes
 * the registry as a parameter, so a new feature needs no edit here.
 */

const { isDeepStrictEqual } = require('util');
const {
  FEATURES, featureState, capabilitiesFor, legacyDefaults, decisionKeys,
} = require('../features');
const { normalizeAddress } = require('../toon/address');
const { isRecord } = require('../toon/parse');
const { intervalMs, isIntervalValid } = require('./schedule');

/** Written to the store when a device was migrated; a device without it is a legacy device. */
const MIGRATION_VERSION = 1;

const isMigrated = (store) => isRecord(store) && typeof store.migrationVersion === 'number' && store.migrationVersion >= MIGRATION_VERSION;
const read = (settings, key) => (isRecord(settings) && Object.hasOwn(settings, key) ? settings[key] : undefined);

/**
 * M-1 and M-2: is this the first start of the device with this app version, and which switches does it get?
 * A device that carries the marker has nothing to decide (the user's choices stand).
 * @param {{store: object, capabilities: string[], features?: object[]}} device
 * @returns {{legacy: boolean, settings: Object<string, boolean>}} `settings` is what to persist when legacy
 */
function planMigration({ store, capabilities, features = FEATURES }) {
  const legacy = !isMigrated(store);
  return { legacy, settings: legacy ? legacyDefaults(capabilities, features) : {} };
}

/**
 * M-3 to M-5 and the toggles: the difference between the capabilities a device has and the ones its features ask
 * for. `desired` is built from the active features, never from everything the manifest lists. The plan only adds,
 * except for the features named in `switchedOff` (the user turned them off): their capabilities go, unless an
 * active feature claims them too. Everything else the device holds (an old plain meter_power, the capability of a
 * fork build) is left alone.
 * @param {{current: string[], state: Object<string, boolean>, switchedOff?: string[], features?: object[]}} device
 * @returns {{desired: string[], add: string[], remove: string[]}}
 */
function planCapabilities({
  current, state, switchedOff = [], features = FEATURES,
}) {
  const held = new Set(Array.isArray(current) ? current : []);
  const desired = capabilitiesFor(state, features);
  const wanted = new Set(desired);
  const remove = features
    .filter((feature) => switchedOff.includes(feature.id))
    .flatMap((feature) => feature.capabilities)
    .filter((id) => held.has(id) && !wanted.has(id));
  return {
    desired,
    add: desired.filter((id) => !held.has(id)),
    remove: [...new Set(remove)],
  };
}

/**
 * What saving the device settings means (FR-82, FR-83). Only the keys in `changedKeys` are looked at, and values are
 * compared as they are used (an address with spaces, an interval saved as text) so that a save that changes nothing
 * changes nothing. The switches of the optional features are the exception when the running `state` is given: they
 * are compared with what is running, not with the old settings, so that saves that overtake each other (the old
 * settings are only stored when a save has finished) still end in the state of the last one.
 * @param {{oldSettings: object, newSettings: object, changedKeys: string[], state?: Object<string, boolean>,
 *   features?: object[]}} event
 * @returns {{errors: {key: string, reason: string}[], address: string | null, startPoller: boolean, interval: boolean,
 *   toggles: {id: string, setting: string, on: boolean}[]}} `address` is the new host when it differs from the old one;
 *   `startPoller` says the old address was unusable, so there is no poller yet
 */
function planSettingsChange({
  oldSettings, newSettings, changedKeys, state, features = FEATURES,
}) {
  const changed = Array.isArray(changedKeys) ? changedKeys : [];
  const errors = [];
  let address = null;
  let startPoller = false;
  let interval = false;

  if (changed.includes('address')) {
    const next = normalizeAddress(read(newSettings, 'address'));
    const before = normalizeAddress(read(oldSettings, 'address'));
    if (!next.ok) errors.push({ key: 'address', reason: next.reason });
    else if (!before.ok || before.host !== next.host) address = next.host;
    startPoller = next.ok && !before.ok;
  }
  if (changed.includes('poll_interval')) {
    if (!isIntervalValid(read(newSettings, 'poll_interval'))) errors.push({ key: 'poll_interval', reason: 'range' });
    else interval = intervalMs(read(oldSettings, 'poll_interval')) !== intervalMs(read(newSettings, 'poll_interval'));
  }
  const named = (feature) => (state ? typeof read(newSettings, feature.setting) === 'boolean' : changed.includes(feature.setting));
  const toggles = features
    .filter((feature) => feature.optional === true && typeof feature.setting === 'string' && named(feature))
    .map((feature) => ({ id: feature.id, setting: feature.setting, on: read(newSettings, feature.setting) === true }))
    .filter((toggle) => toggle.on !== (state ? state[toggle.id] === true : read(oldSettings, toggle.setting) === true));

  return {
    errors, address, startPoller, interval, toggles,
  };
}

/** Sets the options of the capabilities the device holds to the ones the manifest names, where they differ. */
async function reconcileOptions(device, options, { isStopped, log }) {
  for (const [id, wanted] of Object.entries(options)) {
    if (isStopped()) return;
    try {
      if (device.hasCapability(id) && !isDeepStrictEqual(device.getCapabilityOptions(id), wanted)) await device.setCapabilityOptions(id, wanted);
    } catch (error) {
      log(`options of ${id} could not be set: ${error.message}`);
    }
  }
}

/**
 * Applies a plan to a device: adds what is missing, removes what the plan names, then the options. Every Homey call
 * is guarded by what the device holds and by `isStopped` (a deleted device throws on every call). When an add
 * fails, the capabilities added by this call are removed again and the error is rethrown, so a half-done plan
 * leaves nothing behind.
 * @param {object} device
 * @param {{add?: string[], remove?: string[]}} plan
 * @param {{options?: Object<string, object>, isStopped: () => boolean, log: (line: string) => void}} context
 *   `options`: the manifest's options per capability id; left out when they need no checking
 */
async function reconcile(device, { add = [], remove = [] }, { options, isStopped, log }) {
  const added = [];
  try {
    for (const id of add) {
      if (isStopped()) return;
      if (!device.hasCapability(id)) {
        await device.addCapability(id);
        added.push(id);
      }
    }
  } catch (error) {
    for (const id of added) {
      if (!isStopped() && device.hasCapability(id)) await device.removeCapability(id).catch((cause) => log(`could not undo adding ${id}: ${cause.message}`));
    }
    throw error;
  }
  for (const id of remove) {
    if (isStopped()) return;
    if (device.hasCapability(id)) await device.removeCapability(id);
  }
  if (options) await reconcileOptions(device, options, { isStopped, log });
}

/**
 * M-1 to M-7: brings a device of any era up to what this version expects, offline and additive. Settings the device
 * lacks get their legacy default (and the store records that the migration decided them), missing capabilities are
 * added, options are reconciled, and only then the marker is written, so that a failure anywhere leaves the device
 * to try again at the next start. Nothing is ever removed.
 * @returns {Promise<boolean>} whether the migration ran (false: the marker was there, or the device was stopped)
 */
async function migrate(device, {
  features = FEATURES, options, isStopped, log,
}) {
  const { legacy, settings } = planMigration({ store: device.getStore(), capabilities: device.getCapabilities(), features });
  if (!legacy || isStopped()) return false;
  if (Object.keys(settings).length > 0) await device.setSettings(settings);
  for (const key of decisionKeys(features)) await device.setStoreValue(key, 'migration');
  const state = featureState({ ...device.getSettings(), ...settings }, features);
  await reconcile(device, planCapabilities({ current: device.getCapabilities(), state, features }), { options, isStopped, log });
  if (isStopped()) return false;
  await device.setStoreValue('migrationVersion', MIGRATION_VERSION);
  return true;
}

module.exports = {
  MIGRATION_VERSION, planMigration, planCapabilities, planSettingsChange, reconcile, migrate,
};
