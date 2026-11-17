'use strict';

/*
 * The Flow cards of the manifest (app.json, composed from driver.flow.compose.json), the cards table of lib/flow/cards.js
 * and the cards and rules that the features claim describe the same cards three times. This test keeps them in step
 * (FR-77, NFR-14 AC1, docs/sdlc/05-architecture.md section 13, L3). `checkCards` takes everything as parameters, so the
 * negative cases run through the same code that checks the real tree.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { createWorld } = require('../helpers/fake-homey/world');
const { FEATURES } = require('../../lib/features');
const { CARDS } = require('../../lib/flow/cards');
const { readJson } = require('../helpers/paths');

const KINDS = { action: 'actions', condition: 'conditions', trigger: 'triggers' };
const claimed = (feature) => [...new Set(Object.values(feature.cards || {}).filter(Array.isArray).flat())];
const manifestCards = (app) => Object.entries(KINDS).flatMap(([kind, section]) => (app.flow[section] || []).map((card) => ({ kind, ...card })));
const hasOwnArgument = (card) => (card.args || []).some((arg) => arg.type !== 'device');

/**
 * @param {object} input
 * @param {object} input.app the composed manifest
 * @param {{kind: string, id: string}[]} input.cards the table of lib/flow/cards.js
 * @param {object[]} input.features
 * @param {Set<string>} input.listened `kind:id` of every card that has a run listener once the driver started
 * @returns {string[]} one message per place where they disagree
 */
function checkCards({
  app, cards, features, listened,
}) {
  const problems = [];
  const declared = manifestCards(app);
  const has = (kind, id) => declared.some((card) => card.kind === kind && card.id === id);

  declared.forEach((card) => {
    const owners = features.filter((feature) => claimed(feature).includes(card.id)).map((feature) => feature.id);
    if (owners.length !== 1) problems.push(`${card.kind} ${card.id} is claimed by ${owners.length === 0 ? 'no feature' : owners.join(' and ')}`);
    const needsListener = card.kind !== 'trigger' || hasOwnArgument(card);
    if (needsListener && !listened.has(`${card.kind}:${card.id}`)) problems.push(`${card.kind} ${card.id} has no run listener`);
    if (!needsListener && listened.has(`${card.kind}:${card.id}`)) problems.push(`${card.kind} ${card.id} has a run listener but takes no argument`);
  });

  const seen = new Set();
  cards.forEach(({ kind, id }) => {
    if (!has(kind, id)) problems.push(`the cards table names ${kind} ${id}, which the manifest does not declare`);
    if (seen.has(`${kind}:${id}`)) problems.push(`the cards table names ${kind} ${id} twice`);
    seen.add(`${kind}:${id}`);
  });

  features.forEach((feature) => {
    ((feature.cards && feature.cards.guarded) || []).forEach((id) => {
      if (!cards.some((card) => card.kind === 'action' && card.id === id)) problems.push(`${feature.id}: guarded card ${id} is not an action of the cards table`);
    });
    (feature.rules || []).forEach((rule) => {
      const card = declared.find((entry) => entry.kind === 'trigger' && entry.id === rule.card);
      if (!card) {
        problems.push(`${feature.id}: rule for ${rule.card}, which is not a trigger of the manifest`);
        return;
      }
      if (!claimed(feature).includes(rule.card)) problems.push(`${feature.id}: rule for ${rule.card}, which another feature claims`);
      if (![undefined, 'app', 'homey'].includes(rule.source)) problems.push(`${feature.id}: rule for ${rule.card} has source ${String(rule.source)}`);
      if (!rule.caps.every((id) => feature.capabilities.includes(id))) problems.push(`${feature.id}: rule for ${rule.card} reads a capability that the feature does not have`);
      const names = Object.keys(rule.tokens(() => 1));
      const unknown = names.filter((name) => !(card.tokens || []).some((token) => token.name === name));
      if (unknown.length > 0) problems.push(`${feature.id}: rule for ${rule.card} sets the tokens ${unknown.join(', ')}, which the card does not declare`);
      const missing = (card.tokens || []).filter((token) => !names.includes(token.name));
      if (missing.length > 0) problems.push(`${feature.id}: rule for ${rule.card} leaves out the tokens ${missing.map((token) => token.name).join(', ')}`);
    });
  });
  return problems;
}

/** The listeners that the driver registers: the real app files under the fake Homey. */
async function startedListeners() {
  const world = createWorld();
  world.useAppFiles();
  await world.start();
  return new Set([...world.homey.flow.cards.values()].filter((card) => card.runListener).map((card) => `${card.kind}:${card.id}`));
}

describe('FR-77 / NFR-14 AC1: every card of the manifest has one owner and, when it runs, one listener', () => {
  test('after the driver started, every action and condition has a run listener, deprecated cards included; every card is claimed by exactly one feature', async () => {
    const app = readJson('app.json');
    const listened = await startedListeners();

    assert.deepEqual(checkCards({
      app, cards: CARDS, features: FEATURES, listened,
    }), []);
    manifestCards(app).filter((card) => card.kind !== 'trigger').forEach((card) => assert.ok(listened.has(`${card.kind}:${card.id}`), `${card.kind} ${card.id}`));
    manifestCards(app).filter((card) => card.deprecated).forEach((card) => assert.ok(card.kind === 'trigger' || listened.has(`${card.kind}:${card.id}`), `deprecated ${card.id} still runs`));
  });

  test('the five deprecated cards of ADR-0009 are listed, and each of them still has what it needs to run', async () => {
    const app = readJson('app.json');
    const listened = await startedListeners();
    const deprecated = manifestCards(app).filter((card) => card.deprecated).map((card) => card.id).sort();

    assert.deepEqual(deprecated, ['measure_water_changed', 'meter_gas_changed', 'update_metertotals', 'update_powerusage', 'update_water']);
    assert.ok(['update_metertotals', 'update_powerusage', 'update_water'].every((id) => listened.has(`action:${id}`)));
    const rules = FEATURES.flatMap((feature) => feature.rules || []);
    assert.ok(['measure_water_changed', 'meter_gas_changed'].every((id) => rules.some((rule) => rule.card === id)), 'and the two triggers fire');
  });

  test('FR-70: every trigger of the manifest that no rule fires is one that Homey fires itself, and only temperature_state_changed is', () => {
    const app = readJson('app.json');
    const fired = FEATURES.flatMap((feature) => feature.rules || []).filter((rule) => rule.source !== 'homey').map((rule) => rule.card);
    const byHomey = manifestCards(app).filter((card) => card.kind === 'trigger' && !fired.includes(card.id)).map((card) => card.id);

    assert.deepEqual(byHomey, ['temperature_state_changed']);
    assert.equal(FEATURES.flatMap((feature) => feature.rules || []).find((rule) => rule.card === 'temperature_state_changed').source, 'homey');
  });
});

describe('FR-77: checkCards reports every kind of disagreement (negative cases)', () => {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const everyListener = () => new Set(manifestCards(readJson('app.json')).filter((card) => card.kind !== 'trigger' || hasOwnArgument(card)).map((card) => `${card.kind}:${card.id}`));
  const check = (changes = {}) => checkCards({
    app: readJson('app.json'), cards: CARDS, features: FEATURES, listened: everyListener(), ...changes,
  });
  const withCards = (cards) => FEATURES.map((feature) => (feature.id === 'core' ? { ...feature, cards } : feature));

  test('the real tree is clean with the listeners that the manifest calls for', () => {
    assert.deepEqual(check(), []);
  });

  test('an action without a listener, and a trigger that has one although it takes no argument', () => {
    const listened = everyListener();
    listened.delete('action:update_status');
    listened.add('trigger:meter_gas_changed');

    assert.deepEqual(check({ listened }), [
      'action update_status has no run listener',
      'trigger meter_gas_changed has a run listener but takes no argument',
    ]);
  });

  test('a trigger with an argument and no listener cannot filter, so it is reported', () => {
    const listened = everyListener();
    listened.delete('trigger:burner_state_changed_to');

    assert.deepEqual(check({ listened }), ['trigger burner_state_changed_to has no run listener']);
  });

  test('a card that no feature claims, and a card that two features claim', () => {
    const core = FEATURES[0];
    const unclaimed = withCards({ ...core.cards, actions: core.cards.actions.filter((id) => id !== 'enable_program') });
    const twin = {
      ...FEATURES[1], id: 'twin', cards: { guarded: ['update_water'], triggers: [] }, rules: [],
    };
    const twice = [...FEATURES, twin];

    assert.deepEqual(check({ features: unclaimed }), ['action enable_program is claimed by no feature']);
    assert.deepEqual(check({ features: twice }), ['action update_water is claimed by toonwater and twin']);
  });

  test('an entry of the cards table that the manifest does not declare, or that is there twice', () => {
    const cards = [...CARDS, { kind: 'action', id: 'update_nothing', run: () => {} }, CARDS[0]];

    assert.deepEqual(check({ cards }), [
      'the cards table names action update_nothing, which the manifest does not declare',
      'the cards table names action set_temperature_state twice',
    ]);
  });

  test('a guarded card that is not an action of the table', () => {
    const features = FEATURES.map((feature) => (feature.id === 'toonwater' ? { ...feature, cards: { ...feature.cards, guarded: ['update_water', 'measure_water_changed'] } } : feature));

    assert.deepEqual(check({ features }), ['toonwater: guarded card measure_water_changed is not an action of the cards table']);
  });

  test('a rule for a card the manifest does not have, for a card of another feature, with a wrong source, a foreign capability or the wrong tokens', () => {
    const rule = (extra) => ({
      caps: ['meter_gas'], card: 'meter_gas_changed', tokens: () => ({ meter_gas: 1 }), ...extra,
    });
    const features = (rules) => FEATURES.map((feature) => (feature.id === 'core' ? { ...feature, rules } : feature));

    assert.deepEqual(check({ features: features([rule({ card: 'gas_changed' })]) }), ['core: rule for gas_changed, which is not a trigger of the manifest']);
    assert.deepEqual(check({ features: features([rule({ card: 'measure_water_changed', caps: ['meter_gas'], tokens: () => ({ measure_water: 1 }) })]) }), [
      'core: rule for measure_water_changed, which another feature claims',
    ]);
    assert.deepEqual(check({ features: features([rule({ source: 'cloud' })]) }), ['core: rule for meter_gas_changed has source cloud']);
    assert.deepEqual(check({ features: features([rule({ caps: ['measure_water'] })]) }), ['core: rule for meter_gas_changed reads a capability that the feature does not have']);
    assert.deepEqual(check({ features: features([rule({ tokens: () => ({ gas: 1 }) })]) }), [
      'core: rule for meter_gas_changed sets the tokens gas, which the card does not declare',
      'core: rule for meter_gas_changed leaves out the tokens meter_gas',
    ]);
  });

  test('a card that is missing from the manifest the features claim', () => {
    const app = clone(readJson('app.json'));
    app.flow.conditions = app.flow.conditions.filter((card) => card.id !== 'hotwater_dispensing');

    assert.deepEqual(check({ app }), ['the cards table names condition hotwater_dispensing, which the manifest does not declare']);
  });
});
