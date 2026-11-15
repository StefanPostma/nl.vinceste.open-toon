'use strict';

/*
 * The Flow cards of the app (ADR-0007, ADR-0009, ADR-0018): what an action, a condition or a trigger does when a Flow
 * runs it, and when a change of a capability fires a trigger.
 *
 * Cards keep the ids, arguments and tokens of the versions before 2.0: a dropdown arrives as 'id' or as {id}, an
 * unset `resume_program` means "resume", and the old boolean still works (CT-04). Actions wait for the Toon and reject
 * with a sentence in the language of the user; an "Update" card fails only when the part it is about failed (BD-8).
 * A card that a feature claims as `guarded` runs only while the feature is on for the device.
 *
 * Triggers: the rules of the features (`rules`) say which change fires which card. A trigger fires only for a change,
 * never for the first value a capability ever got (FR-70), and a trigger that fails is logged, never thrown. The card
 * objects are fetched from Homey once and used for both the listeners and the firing (HS-41).
 */

const { FEATURES } = require('../features');
const { isNotFound, toUserMessage } = require('../toon/errors');

/** A dropdown argument arrives as 'comfort' or as {id: 'comfort', ...}, depending on how old the Flow is (HW-10). */
const normalizeDropdown = (arg) => (typeof arg === 'object' && arg !== null ? arg.id : arg);

/** `resume_program`: unset (Flows made while the title lacked it) is "yes"; the boolean of the oldest Flows is read as it was meant. */
function normalizeResume(arg) {
  const value = normalizeDropdown(arg);
  if (value === true || value === 'true') return 'yes';
  if (value === false || value === 'false') return 'no';
  return value;
}

/** Whether `capability` of the device holds `wanted`: false for anything else, a capability the device lacks and a value that is not set yet. */
const holds = (device, capability, wanted) => device.hasCapability(capability) && typeof wanted === 'string' && device.getCapabilityValue(capability) === wanted;

/**
 * An "Update" card: reads fresh data and resolves when it is in. It rejects only when `own`, the part it is about,
 * failed; a part that was not asked for never fails it, and a page that is absent by nature (ToonWater, 404) is no failure.
 * @param {string} own poll group id
 * @param {string[]} [groups] default: every group that is on
 */
const update = (own, groups) => async ({ device }, { homey, group }) => {
  const error = (await device.refresh(groups))[own];
  if (error && !(group(own).absentOn404 && isNotFound(error))) throw new Error(toUserMessage(homey, error));
};

/**
 * Every card of the manifest. `run(args, context, state)`: `args.device` is the device; `context.homey` the Homey instance;
 * `context.group(id)` the poll group of that id; `state` is what a trigger was fired with.
 */
const CARDS = Object.freeze([
  {
    kind: 'action',
    id: 'set_temperature_state',
    run: ({ device, state, resume_program: resume }) => device.setTemperatureState(normalizeDropdown(state), normalizeResume(resume)),
  },
  { kind: 'action', id: 'enable_program', run: ({ device }) => device.programOn() },
  { kind: 'action', id: 'disable_program', run: ({ device }) => device.programOff() },
  { kind: 'action', id: 'update_status', run: update('thermostat') },
  { kind: 'action', id: 'update_powerusage', run: update('power', ['power']) },
  { kind: 'action', id: 'update_metertotals', run: update('meters', ['meters']) },
  { kind: 'action', id: 'update_water', run: update('water', ['water']) },
  { kind: 'condition', id: 'temperature_state_is', run: ({ device, state }) => holds(device, 'temperature_state', normalizeDropdown(state)) },
  { kind: 'condition', id: 'hotwater_dispensing', run: ({ device }) => device.hasCapability('alarm_water.hotwater') && device.getCapabilityValue('alarm_water.hotwater') === true },
  { kind: 'condition', id: 'burner_state_is', run: ({ device, state }) => holds(device, 'burner_state', normalizeDropdown(state)) },
  {
    // the trigger is fired for every change; the Flow runs when it listens for that state or for any
    kind: 'trigger',
    id: 'burner_state_changed_to',
    run: ({ state }, context, fired) => {
      const wanted = normalizeDropdown(state);
      return wanted === 'any' || (typeof wanted === 'string' && Boolean(fired) && wanted === fired.state);
    },
  },
]);

const claimed = (feature) => [...new Set(Object.values(feature.cards || {}).filter(Array.isArray).flat())];
const ownerOf = (id, features) => features.find((feature) => claimed(feature).includes(id));

/**
 * ADR-0018: a guarded card of a feature that is off does nothing for a device whose state the migration decided (a Flow of
 * 1.x that chained it keeps running), and tells the user otherwise.
 */
function guarded(feature, id, run) {
  return async (args, context, state) => {
    const { device } = args;
    if (device.isFeatureOn(feature.id)) return run(args, context, state);
    const migrated = typeof feature.decidedByKey === 'string' && device.getStoreValue(feature.decidedByKey) === 'migration';
    if (feature.cards.onDisabled === 'noop' || migrated) {
      device.log(`${id} ignored: ${feature.id} is off for this device`);
      return undefined;
    }
    throw new Error(context.homey.__(feature.texts.notEnabled));
  };
}

const isChange = (change) => change !== undefined && change.prev !== null && change.prev !== undefined;

/**
 * The rules that a set of changes fires, from the features that are on: one per card, however many of its capabilities changed.
 * @param {{id: string, prev: *, next: *}[]} changes
 * @param {object[]} features
 * @param {(feature: object) => boolean} isOn
 */
function firing(changes, features, isOn) {
  const byId = new Map(changes.map((change) => [change.id, change]));
  return features
    .filter(isOn)
    .flatMap((feature) => feature.rules || [])
    .filter((rule) => rule.source !== 'homey' && rule.caps.some((id) => isChange(byId.get(id))));
}

/**
 * Gets the cards from Homey, once.
 * @param {object} homey the Homey instance of the driver
 * @param {object[]} [features]
 * @returns {{register: () => void, fire: (device: object, changes: {id: string, prev: *, next: *}[]) => void}}
 *   `register` puts the run listener on every action, condition and trigger that has one (call it once);
 *   `fire` fires the triggers that the changes of a device call for and never throws
 */
function createFlow(homey, features = FEATURES) {
  const groups = new Map(features.flatMap((feature) => feature.pollGroups || []).map((group) => [group.id, group]));
  const context = { homey, group: (id) => groups.get(id) };
  const handles = {
    action: new Map(),
    condition: new Map(),
    trigger: new Map(),
  };
  const getters = { action: 'getActionCard', condition: 'getConditionCard', trigger: 'getDeviceTriggerCard' };
  const card = (kind, id) => {
    if (!handles[kind].has(id)) handles[kind].set(id, homey.flow[getters[kind]](id));
    return handles[kind].get(id);
  };
  const rules = features.flatMap((feature) => feature.rules || []).filter((rule) => rule.source !== 'homey');
  rules.forEach((rule) => card('trigger', rule.card));

  function send(device, rule) {
    const value = (id) => (device.hasCapability(id) ? device.getCapabilityValue(id) : null);
    const failed = (error) => device.error(`${rule.card} could not be fired: ${error.message}`);
    try {
      card('trigger', rule.card).trigger(device, rule.tokens(value), rule.state ? rule.state(value) : {}).catch(failed);
    } catch (error) {
      failed(error);
    }
  }

  return {
    register() {
      CARDS.forEach(({ kind, id, run }) => {
        const owner = ownerOf(id, features);
        const listener = owner && Array.isArray(owner.cards.guarded) && owner.cards.guarded.includes(id) ? guarded(owner, id, run) : run;
        card(kind, id).registerRunListener((args, state) => listener(args, context, state));
      });
    },
    fire(device, changes) {
      firing(changes, features, (feature) => device.isFeatureOn(feature.id)).forEach((rule) => send(device, rule));
    },
  };
}

module.exports = {
  CARDS, normalizeDropdown, normalizeResume, createFlow, firing,
};
