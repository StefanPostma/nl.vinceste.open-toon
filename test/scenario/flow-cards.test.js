'use strict';

/*
 * CT-04 and CT-08 (docs/sdlc/04-compat-contract.md): the actions and conditions of the app, run the way a Flow of any
 * age runs them, against a Toon that is up, a Toon that is down, and a Toon without the ToonWater page. The real app
 * files under the fake Homey, the mock Toon and a fake clock. Each "[fixes BD-n]" title replaces the characterisation
 * of a defect of the baseline. What the real Homey hands over as arguments is HW-10; the shapes tried here are the ones
 * that the contract lists.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { createScenario } = require('../helpers/scenario');
const { settle } = require('../helpers/fake-clock');
const { jsonFixture } = require('../helpers/fixtures');

const baseline = jsonFixture('baseline-app.json');
const manifest = jsonFixture('../../app.json');
const en = jsonFixture('../../locales/en.json');
const nl = jsonFixture('../../locales/nl.json');

const THERMOSTAT = '/happ_thermstat';
const POWER = '/happ_pwrusage';
const METERS = '/hdrv_zwave';
const WATER = '/water.html';
const TIMEOUT_TEXT = /did not answer in time/;
const changes = (toon) => toon.requests().filter((entry) => entry.query.action === 'setSetpoint' || entry.query.action === 'changeSchemeState').map((entry) => entry.query);
const paths = (toon) => toon.requests().map((entry) => entry.path);

async function withScenario(options, body) {
  const scenario = createScenario(options);
  await scenario.start();
  try {
    return await body(scenario);
  } finally {
    scenario.stop();
  }
}

const card = (scenario, kind, id) => scenario.world.homey.flow.card(kind, id);
const act = (scenario, id, args) => card(scenario, 'action', id).run(args);
/** What an old Flow may hand over, which the dropdown check of the fake would refuse: the listener runs as Homey would run it. */
const raw = (scenario, kind, id, args) => card(scenario, kind, id).runListener(args, {});

/** A paired device with its first values in place and an empty request log. */
async function running(scenario, spec) {
  const device = await scenario.addPaired(spec);
  await scenario.clock.tick(5000);
  scenario.toon().recorder.reset();
  return device;
}

describe('FR-13 / FR-73 AC1: set_temperature_state with every argument shape of an old Flow', () => {
  const yes = [{ action: 'changeSchemeState', state: '2', temperatureState: '2' }];
  const no = [{ action: 'changeSchemeState', state: '0', temperatureState: '2' }];

  test('[fixes BD-7] FR-13 AC1/AC2 [HW-04]: "no" sends a different request than "yes", and never the fixed state=2 of the baseline', async () => {
    await withScenario({}, async (scenario) => {
      const { toon } = scenario;
      const device = await running(scenario);

      await act(scenario, 'set_temperature_state', { device, state: 'sleep', resume_program: 'yes' });
      assert.deepEqual(changes(toon()), yes);
      toon().recorder.reset();
      await act(scenario, 'set_temperature_state', { device, state: 'sleep', resume_program: 'no' });
      assert.deepEqual(changes(toon()), no);
      assert.notDeepEqual(no, yes);
      assert.ok(changes(toon()).every((query) => query.state !== '2'), 'not the baseline request');
    });
  });

  test('FR-13 [HW-10]: the state as a string or as {id}, the program as yes, no, {id}, unset or the old boolean', async () => {
    await withScenario({}, async (scenario) => {
      const { toon } = scenario;
      const device = await running(scenario);
      const cases = [
        [{ state: 'sleep', resume_program: 'yes' }, yes],
        [{ state: { id: 'sleep' }, resume_program: 'yes' }, yes],
        [{ state: 'sleep', resume_program: { id: 'no' } }, no],
        [{ state: { id: 'sleep' }, resume_program: 'no' }, no],
        [{ state: 'sleep' }, yes],
        [{ state: 'sleep', resume_program: undefined }, yes],
        [{ state: 'sleep', resume_program: true }, yes],
        [{ state: 'sleep', resume_program: false }, no],
      ];

      for (const [args, expected] of cases) {
        toon().recorder.reset();
        await raw(scenario, 'action', 'set_temperature_state', { device, ...args });
        assert.deepEqual(changes(toon()), expected, JSON.stringify(args));
      }
    });
  });

  test('FR-13 AC1: the action resolves when the Toon answered, and the state follows from the next read', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, toon } = scenario;
      const device = await running(scenario);
      toon().latencyMs = 2000;

      const pending = act(scenario, 'set_temperature_state', { device, state: 'sleep', resume_program: 'yes' });
      await clock.tick(1999);
      assert.equal(changes(toon()).length, 1, 'sent');
      assert.equal(device.getCapabilityValue('temperature_state'), 'home', 'the tile waits for the Toon');
      const outcome = await settle(clock, pending);
      assert.equal(outcome.error, undefined);
      assert.ok(outcome.tookMs <= 100, 'resolved when the answer came (the clock moves by 100 ms)');
      await clock.tick(6000);

      assert.equal(device.getCapabilityValue('temperature_state'), 'sleep');
      assert.equal(device.getCapabilityValue('target_temperature'), 16.5);
    });
  });

  test('FR-12 / ADR-0014: the dropdown of the action has no vacation, and one that comes anyway is refused before a request exists', async () => {
    await withScenario({}, async (scenario) => {
      const { toon, world } = scenario;
      const device = await running(scenario);
      const dropdown = card(scenario, 'action', 'set_temperature_state').manifest.args.find((arg) => arg.name === 'state');

      assert.deepEqual(dropdown.values.map((value) => value.id), ['comfort', 'home', 'sleep', 'away']);
      await assert.rejects(raw(scenario, 'action', 'set_temperature_state', { device, state: 'vacation' }), { message: en.error.vacation_readonly });
      await assert.rejects(raw(scenario, 'action', 'set_temperature_state', { device, state: { id: 'vacation' } }), { message: en.error.vacation_readonly });
      assert.deepEqual(toon().requests(), []);
      assert.deepEqual(world.logs.filter((entry) => entry.level === 'error'), []);
    });
  });

  test('FR-73 AC2: a state or a program that does not exist is refused with a sentence and no request, never a TypeError', async () => {
    await withScenario({}, async (scenario) => {
      const { toon } = scenario;
      const device = await running(scenario);
      const invalid = [{ state: 'party' }, { state: undefined }, { state: 42 }, { state: 'sleep', resume_program: 'maybe' }, { state: 'sleep', resume_program: 7 }];

      for (const args of invalid) {
        await assert.rejects(raw(scenario, 'action', 'set_temperature_state', { device, ...args }), (error) => {
          assert.equal(error instanceof TypeError, false);
          assert.equal(error.message, en.error.invalid_value, JSON.stringify(args));
          return true;
        });
      }
      assert.deepEqual(toon().requests(), []);
    });
  });
});

describe('FR-14 / FR-73: enable_program and disable_program', () => {
  test('FR-14 AC1: exactly one request each, and the action resolves after the Toon answered', async () => {
    await withScenario({}, async (scenario) => {
      const { toon } = scenario;
      const device = await running(scenario);

      await act(scenario, 'enable_program', { device });
      await act(scenario, 'disable_program', { device });

      assert.deepEqual(changes(toon()), [
        { action: 'changeSchemeState', state: '1' },
        { action: 'changeSchemeState', state: '0' },
      ]);
      assert.equal(toon().state.thermostat.programState, '0');
    });
  });

  test('FR-73 AC2: a Toon that refuses, or one that answers an error, fails the action with a sentence', async () => {
    await withScenario({}, async (scenario) => {
      const { toon } = scenario;
      const device = await running(scenario);

      toon().fault('result-error', { path: THERMOSTAT, times: 1 });
      await assert.rejects(act(scenario, 'enable_program', { device }), { message: en.error.toon_error });
      toon().fault('500', { path: THERMOSTAT, times: 1 });
      await assert.rejects(act(scenario, 'disable_program', { device }), { message: en.error.http.replace('__status__', '500') });
    });
  });
});

describe('FR-73 AC2 / FR-74 AC2 [fixes BD-8]: with the Toon down every card that asks the Toon fails within 6 s with a sentence', () => {
  const CARDS_THAT_ASK = [
    ['set_temperature_state', { state: 'comfort', resume_program: 'yes' }],
    ['enable_program', {}],
    ['disable_program', {}],
    ['update_status', {}],
    ['update_powerusage', {}],
    ['update_metertotals', {}],
    ['update_water', {}],
  ];

  CARDS_THAT_ASK.forEach(([id, args]) => {
    test(`${id}: a Toon that does not answer fails it after the 5 s of the request`, async () => {
      await withScenario({}, async (scenario) => {
        const { clock, toon } = scenario;
        const device = await running(scenario, { toonwater: true });
        toon().fault('timeout');

        const outcome = await settle(clock, act(scenario, id, { device, ...args }));

        assert.match(outcome.error.message, TIMEOUT_TEXT, 'a localized sentence');
        assert.ok(outcome.tookMs <= 6000, `${outcome.tookMs} ms`);
      });
    });

    test(`${id}: a Toon that is not there fails it at once`, async () => {
      await withScenario({}, async (scenario) => {
        const { clock, toon } = scenario;
        const device = await running(scenario, { toonwater: true });
        toon().fault('refused');

        const outcome = await settle(clock, act(scenario, id, { device, ...args }));

        assert.equal(outcome.error.message, en.error.network);
        assert.ok(outcome.tookMs <= 100, `${outcome.tookMs} ms`);
      });
    });
  });

  test('the sentence comes in the language of the Homey', async () => {
    await withScenario({ language: 'nl' }, async (scenario) => {
      const { clock, toon } = scenario;
      const device = await running(scenario);
      toon().fault('timeout');

      const outcome = await settle(clock, act(scenario, 'update_status', { device }));

      assert.equal(outcome.error.message, nl.error.timeout);
    });
  });

  test('a card of a device that has no address yet tells so, and a device that was removed tells that the request was cancelled', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, world } = scenario;
      const unset = await scenario.addDevice({ settings: { address: '0.0.0.0' } });
      await assert.rejects(act(scenario, 'update_status', { device: unset }), { message: en.address_missing });

      const device = await running(scenario);
      scenario.toon().fault('timeout');
      const pending = act(scenario, 'update_powerusage', { device });
      await clock.tick(100);
      await world.deleteDevice(device);

      await assert.rejects(pending, { message: en.error.aborted });
    });
  });
});

describe('FR-74 AC1: a Toon that is up: the card resolves after fresh data, for its own part only', () => {
  test('update_status reads every group that is on, and the values are in when it resolves', async () => {
    await withScenario({}, async (scenario) => {
      const { toon } = scenario;
      const device = await running(scenario, { toonwater: true });
      Object.assign(toon().state.thermostat, { currentTemp: '2150' });
      toon().state.power.powerUsage.value = 640;
      toon().state.devices['dev_2.1'].CurrentGasQuantity = '5300000';
      toon().state.waterPage.water.flow = 6;

      await act(scenario, 'update_status', { device });

      assert.deepEqual(paths(toon()), [THERMOSTAT, POWER, METERS, WATER]);
      assert.equal(device.getCapabilityValue('measure_temperature'), 21.5);
      assert.equal(device.getCapabilityValue('measure_power'), 640);
      assert.equal(device.getCapabilityValue('meter_gas'), 5300);
      assert.equal(device.getCapabilityValue('measure_water'), 6);
    });
  });

  [
    ['update_powerusage', POWER, () => ({ powerUsage: 777 }), (device) => device.getCapabilityValue('measure_power'), 777],
    ['update_metertotals', METERS, () => ({ gas: '5310000' }), (device) => device.getCapabilityValue('meter_gas'), 5310],
    ['update_water', WATER, () => ({ flow: 9 }), (device) => device.getCapabilityValue('measure_water'), 9],
  ].forEach(([id, path, change, read, expected]) => {
    test(`${id}: one request, to its own endpoint, and the value is in when it resolves`, async () => {
      await withScenario({}, async (scenario) => {
        const { toon } = scenario;
        const device = await running(scenario, { toonwater: true });
        const next = change();
        if (next.powerUsage) toon().state.power.powerUsage.value = next.powerUsage;
        if (next.gas) toon().state.devices['dev_2.1'].CurrentGasQuantity = next.gas;
        if (next.flow) toon().state.waterPage.water.flow = next.flow;

        await act(scenario, id, { device });

        assert.deepEqual(paths(toon()), [path]);
        assert.equal(read(device), expected);
      });
    });
  });

  test('FR-74 AC3 / CT-08: ten cards of one kind at once are one request each, ten update_status are one cycle of the groups that are on', async () => {
    await withScenario({}, async (scenario) => {
      const { toon } = scenario;
      const device = await running(scenario, { toonwater: true });

      await Promise.all(Array.from({ length: 10 }, () => act(scenario, 'update_status', { device })));
      assert.deepEqual(paths(toon()), [THERMOSTAT, POWER, METERS, WATER]);

      toon().recorder.reset();
      await Promise.all(Array.from({ length: 10 }, (unused, index) => act(scenario, ['update_powerusage', 'update_metertotals'][index % 2], { device })));
      assert.deepEqual(paths(toon()), [POWER, METERS]);
      assert.equal(toon().maxConcurrent(), 1);
    });
  });

  test('FR-74 AC3 / BD-8: with the Toon down, ten update_status at once fail together after one request of the thermostat, and nothing else is asked', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, toon } = scenario;
      const device = await running(scenario);
      toon().fault('timeout');

      const outcomes = await settle(clock, Promise.allSettled(Array.from({ length: 10 }, () => act(scenario, 'update_status', { device }))));

      assert.ok(outcomes.tookMs <= 6000);
      assert.equal(outcomes.value.filter((outcome) => outcome.status === 'rejected' && TIMEOUT_TEXT.test(outcome.reason.message)).length, 10);
      assert.deepEqual(paths(toon()), [THERMOSTAT], 'the other parts are not asked of a Toon that does not answer');
    });
  });

  test('FR-74 AC3: a card that runs while the scheduled poll is in flight joins it: one request per part, never two at once', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, toon } = scenario;
      toon().latencyMs = 1500;
      const device = await scenario.addPaired();
      await clock.tick(2500); // the first cycle started at 2 s and waits for the thermostat
      assert.deepEqual(paths(toon()), [THERMOSTAT]);

      const outcome = await settle(clock, act(scenario, 'update_status', { device }));

      assert.equal(outcome.error, undefined);
      assert.deepEqual(paths(toon()), [THERMOSTAT, POWER, METERS], 'the poll and the card share every request');
      assert.equal(toon().maxConcurrent(), 1);
      assert.equal(device.getCapabilityValue('measure_temperature'), 20.3);
    });
  });
});

describe('FR-74 / CT-04: a part that was not asked for never fails the card', () => {
  test('update_status fails only when the thermostat failed; power, meters and the page of ToonWater may fail', async () => {
    await withScenario({}, async (scenario) => {
      const { toon } = scenario;
      const device = await running(scenario, { toonwater: true });
      [POWER, METERS, WATER].forEach((path) => toon().fault('500', { path }));

      await act(scenario, 'update_status', { device });
      toon().clearFaults();
      toon().fault('500', { path: THERMOSTAT });
      await assert.rejects(act(scenario, 'update_status', { device }), { message: en.error.http.replace('__status__', '500') });
    });
  });

  test('update_powerusage, update_metertotals and update_water fail only for their own part', async () => {
    await withScenario({}, async (scenario) => {
      const { toon } = scenario;
      const device = await running(scenario, { toonwater: true });
      const cardFor = { [POWER]: 'update_powerusage', [METERS]: 'update_metertotals', [WATER]: 'update_water' };

      for (const [own, id] of Object.entries(cardFor)) {
        toon().clearFaults();
        [THERMOSTAT, POWER, METERS, WATER].filter((path) => path !== own).forEach((path) => toon().fault('500', { path }));
        await act(scenario, id, { device });

        toon().clearFaults();
        toon().fault('500', { path: own });
        await assert.rejects(act(scenario, id, { device }), { message: en.error.http.replace('__status__', '500') }, id);
      }
    });
  });

  test('FR-74 AC4 / FR-54: without the page of ToonWater (404) update_water and update_status resolve, and nothing is logged at error level', async () => {
    await withScenario({ toons: { '192.168.1.50': { water: '404' } } }, async (scenario) => {
      const { toon } = scenario;
      const device = await running(scenario, { toonwater: true });

      await act(scenario, 'update_water', { device });
      await act(scenario, 'update_status', { device });

      assert.equal(toon().requestsTo(WATER).length, 2);
      assert.deepEqual(scenario.deviceLog('error'), []);
      assert.equal(device.getSetting('toonwater_status'), 'Not found on this Toon (HTTP 404)');
    });
  });

  test('a page that answers wrongly or not at all is a failure of the water part, a missing page is not', async () => {
    for (const [mode, text] of [['html-200', en.error.bad_body], ['500', en.error.http.replace('__status__', '500')], ['junk', en.error.bad_body]]) {
      await withScenario({ toons: { '192.168.1.50': { water: mode } } }, async (scenario) => {
        const device = await running(scenario, { toonwater: true });

        await assert.rejects(act(scenario, 'update_water', { device }), { message: text }, mode);
        await act(scenario, 'update_status', { device });
      });
    }
  });
});

describe('FR-72 / FR-12 / FR-31 / FR-32: conditions answer with a boolean, whatever shape the argument has', () => {
  test('temperature_state_is and burner_state_is: a string or {id}, true and false, and null is false', async () => {
    await withScenario({}, async (scenario) => {
      const device = await scenario.addPaired();
      const holds = (id, state) => card(scenario, 'condition', id).run({ device, state });

      for (const [id, state] of [['temperature_state_is', 'home'], ['burner_state_is', 'off']]) {
        assert.equal(await holds(id, state), false, `${id}: no value yet`);
        assert.equal(await holds(id, { id: state }), false);
      }
      await scenario.clock.tick(5000);
      assert.equal(await holds('temperature_state_is', 'home'), true);
      assert.equal(await holds('temperature_state_is', { id: 'home' }), true);
      assert.equal(await holds('temperature_state_is', 'sleep'), false);
      assert.equal(await holds('temperature_state_is', { id: 'none' }), false);
      assert.equal(await holds('burner_state_is', 'off'), true);
      assert.equal(await holds('burner_state_is', { id: 'off' }), true);
      assert.equal(await holds('burner_state_is', 'heating'), false);
      assert.equal(await raw(scenario, 'condition', 'temperature_state_is', { device, state: undefined }), false);
      assert.equal(await raw(scenario, 'condition', 'burner_state_is', { device, state: null }), false);
    });
  });

  test('FR-72 AC3 / FR-12: temperature_state_is offers and accepts vacation', async () => {
    await withScenario({ toons: { '192.168.1.50': { vacation: true } } }, async (scenario) => {
      const device = await running(scenario);
      const dropdown = card(scenario, 'condition', 'temperature_state_is').manifest.args.find((arg) => arg.name === 'state');

      assert.deepEqual(dropdown.values.map((value) => value.id), ['comfort', 'home', 'sleep', 'away', 'none', 'vacation']);
      assert.equal(dropdown.value, 'comfort');
      assert.equal(await card(scenario, 'condition', 'temperature_state_is').run({ device, state: 'vacation' }), true);
      assert.equal(await card(scenario, 'condition', 'temperature_state_is').run({ device, state: { id: 'vacation' } }), true);
      assert.equal(await card(scenario, 'condition', 'temperature_state_is').run({ device, state: 'home' }), false);
    });
  });

  test('FR-72 AC2 / FR-31 AC2: hotwater_dispensing is true, false and false for true, false and no value', async () => {
    await withScenario({}, async (scenario) => {
      const { clock, toon } = scenario;
      const device = await scenario.addPaired();
      const dispensing = () => card(scenario, 'condition', 'hotwater_dispensing').run({ device });

      assert.equal(await dispensing(), false, 'no value yet');
      await clock.tick(5000);
      assert.equal(await dispensing(), false);
      toon().state.thermostat.burnerInfo = '2';
      await clock.tick(30e3);
      assert.equal(await dispensing(), true);
      toon().state.thermostat.burnerInfo = '3';
      await clock.tick(30e3);
      assert.equal(await dispensing(), false);
    });
  });

  test('a device that lacks the capability gives false, not an exception', async () => {
    await withScenario({}, async (scenario) => {
      const device = await running(scenario);
      await device.removeCapability('burner_state');
      await device.removeCapability('alarm_water.hotwater');

      assert.equal(await card(scenario, 'condition', 'burner_state_is').run({ device, state: 'off' }), false);
      assert.equal(await card(scenario, 'condition', 'hotwater_dispensing').run({ device }), false);
    });
  });
});

describe('NFR-14 / CT-04: the 14 cards of the baseline, run against a Toon that is up, down and without ToonWater', () => {
  const ACTIONS = {
    set_temperature_state: { state: 'comfort', resume_program: 'yes' },
    enable_program: {},
    disable_program: {},
    update_status: {},
    update_powerusage: {},
    update_metertotals: {},
    update_water: {},
  };
  const CONDITIONS = { temperature_state_is: { state: 'home' }, hotwater_dispensing: {} };
  const sentences = [...Object.values(en.error), en.toonwater.not_enabled].map((text) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('__status__', '\\d+')}$`));
  const SITUATIONS = [
    ['up', {}, () => {}],
    ['down', {}, (toon) => toon.fault('timeout')],
    ['without the page of ToonWater', { water: '404' }, () => {}],
  ];

  test('the baseline has 14 cards: five triggers, two conditions, seven actions, and each is still in the manifest', () => {
    const declared = ['triggers', 'conditions', 'actions'].flatMap((section) => baseline.flow[section].map((entry) => entry.id));
    const now = ['triggers', 'conditions', 'actions'].flatMap((section) => manifest.flow[section].map((entry) => entry.id));

    assert.equal(declared.length, 14);
    assert.deepEqual(declared.filter((id) => !now.includes(id)), []);
    assert.deepEqual(declared.filter((id) => Object.hasOwn(ACTIONS, id) || Object.hasOwn(CONDITIONS, id)).sort(), [...Object.keys(ACTIONS), ...Object.keys(CONDITIONS)].sort());
  });

  SITUATIONS.forEach(([name, toonOptions, prepare]) => {
    test(`${name}: every action and condition resolves or fails with one of the sentences of the app, never with a TypeError`, async () => {
      for (const [kind, table] of [['action', ACTIONS], ['condition', CONDITIONS]]) {
        for (const [id, args] of Object.entries(table)) {
          // a fresh device each: a write that fails reads the thermostat again, which holds the queue for the next card
          await withScenario({ toons: { '192.168.1.50': toonOptions } }, async (scenario) => {
            const device = await running(scenario, { toonwater: true });
            prepare(scenario.toon());

            const outcome = await settle(scenario.clock, card(scenario, kind, id).run({ device, ...args }), { limitMs: 20000 });

            if (outcome.error) {
              assert.equal(outcome.error instanceof TypeError, false, `${id}: ${outcome.error.message}`);
              assert.ok(sentences.some((sentence) => sentence.test(outcome.error.message)), `${id}: "${outcome.error.message}" is one of the sentences`);
              assert.ok(name === 'down' && kind === 'action', `${id} fails only when the Toon is down`);
              assert.ok(outcome.tookMs <= 6000, `${id}: ${outcome.tookMs} ms`);
            } else {
              assert.ok(name !== 'down' || kind === 'condition', `${id} must fail when the Toon is down`);
              if (kind === 'condition') assert.equal(typeof outcome.value, 'boolean', id);
            }
          });
        }
      }
    });
  });
});
