'use strict';

/*
 * The test double that runs the pair view (test/helpers/pair-view.js) behaves like the part of a browser that the
 * view relies on: elements by id with their initial state from the markup, events, a click that a disabled button
 * does not receive, text that stays text.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { loadPairView } = require('../helpers/pair-view');

const homey = (calls = []) => ({
  __: (key) => `<${key}>`,
  emit: async (event, data) => {
    calls.push(['emit', event, data]);
    throw new Error('<img src=x onerror=boom()>');
  },
  createDevice: async () => undefined,
  done: () => calls.push(['done']),
  setTitle: (title) => calls.push(['setTitle', title]),
});

describe('NFR-06 AC1: the pair view double', () => {
  test('elements start as the markup says: hidden, disabled, empty, and the script has run', () => {
    const calls = [];
    const view = loadPairView(homey(calls));

    assert.equal(view.shown('result'), false);
    assert.equal(view.shown('address'), true);
    assert.equal(view.element('connect').disabled, true);
    assert.equal(view.element('test').disabled, false);
    assert.equal(view.element('toonwater').checked, false);
    assert.deepEqual(calls, [['setTitle', '<pair.title>']]);
  });

  test('a click reaches the listeners of an enabled button only, and the double waits for async listeners', async () => {
    const calls = [];
    const view = loadPairView(homey(calls));
    view.element('address').value = '192.168.1.50';

    await view.click('connect');
    assert.deepEqual(calls.filter(([kind]) => kind === 'emit'), [], 'a disabled button receives no click');

    await view.click('test');
    assert.equal(JSON.stringify(calls.filter(([kind]) => kind === 'emit')), '[["emit","testConnection",{"address":"192.168.1.50"}]]', 'what the view sends, as the app receives it');
  });

  test('a message is text: it is shown as it is, and nothing is parsed', async () => {
    const view = loadPairView(homey());
    await view.click('test');

    assert.equal(view.text('error'), '<img src=x onerror=boom()>');
    assert.equal(view.shown('error'), true);
  });
});
