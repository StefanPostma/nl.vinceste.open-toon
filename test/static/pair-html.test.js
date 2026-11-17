'use strict';

/*
 * FR-05 AC1: the pair view uses only the documented front-end API of Homey (emit, createDevice, __, done, setTitle),
 * no jQuery, no hard-coded user-visible text and the classes of the Homey Style Library (HS-50, HS-51, ADR-0008).
 * The behaviour of the view is in test/scenario/pairing.test.js; what Homey's own pairing screen does around it
 * (web, mobile, light and dark mode) is [HW-01].
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ROOT, read } = require('../helpers/paths');

const VIEW = 'drivers/open-toon/pair/start.html';
const DRIVER = 'drivers/open-toon/driver.js';

// The acceptance grep of the slice: the API of the old views (jQuery, Homey.addDevice, socket.on, __() without Homey) and markup injection.
const FORBIDDEN = /\$\(|jQuery|Homey\.addDevice|innerHTML|socket\.on|[^.]__\(/;
const DOCUMENTED_API = ['emit', 'createDevice', '__', 'done', 'setTitle'];
const STYLE_LIBRARY = new RegExp(`^homey-(?:${[
  'header', 'title', 'subtitle', 'form', 'form-(?:fieldset|legend|group|label|input|select|textarea)', 'form-checkbox(?:-input|-checkmark|-text)?',
  'button-(?:primary|primary-full|primary-shadow|primary-shadow-full|secondary-shadow|danger-shadow|transparent|small)',
].join('|')})$`);
const STATES = ['is-disabled', 'is-loading'];

const view = read(VIEW);
const script = (/<script[^>]*>([\s\S]*?)<\/script>/.exec(view) || [])[1] || '';
const style = (/<style[^>]*>([\s\S]*?)<\/style>/.exec(view) || [])[1] || '';
const markup = view.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
const lines = (text, pattern) => text.split('\n').filter((line) => pattern.test(line));
const dataKeys = [...markup.matchAll(/data-i18n="([^"]+)"/g)].map((match) => match[1]);
const scriptKeys = [...script.matchAll(/'((?:pair|error)\.[a-z_]+)'/g)].map((match) => match[1]);
const flatten = (node, prefix = '') => Object.entries(node).flatMap(([key, value]) => (typeof value === 'object' ? flatten(value, `${prefix}${key}.`) : [`${prefix}${key}`]));

describe('FR-05 AC1: the pair view is plain JavaScript on the documented API', () => {
  test('the view is the one that the driver manifest lists, and the driver has no hand-written view of the old API', () => {
    const manifest = JSON.parse(read('app.json'));

    assert.deepEqual(manifest.drivers[0].pair, [{ id: 'start' }]);
    assert.ok(fs.existsSync(path.join(ROOT, VIEW)));
  });

  test('no jQuery, no Homey.addDevice, no markup injection, no socket.on and no Homey.__ without Homey in the view or the driver', () => {
    [VIEW, DRIVER].forEach((file) => {
      assert.deepEqual(lines(read(file), FORBIDDEN), [], file);
    });
  });

  test('the forbidden patterns do catch what they are meant to catch', () => {
    ['$(function () {})', 'jQuery(x)', 'Homey.addDevice(d)', 'el.innerHTML = x', "socket.on('a', b)", " __('pair.title')"].forEach((sample) => {
      assert.ok(FORBIDDEN.test(sample), sample);
    });
    ["Homey.__('pair.title')", 'el.textContent = x', 'await Homey.emit(a, b)'].forEach((sample) => {
      assert.equal(FORBIDDEN.test(sample), false, sample);
    });
  });

  test('it calls Homey.emit, Homey.createDevice and Homey.__ (on at least three lines), and nothing else of Homey but the documented API', () => {
    assert.ok(lines(view, /Homey\.createDevice|Homey\.emit|Homey\.__/).length >= 3);
    ['Homey.emit(', 'Homey.createDevice(', 'Homey.done(', 'Homey.setTitle('].forEach((call) => assert.ok(script.includes(call), call));
    const used = [...script.matchAll(/\bHomey\.(\w+)/g)].map((match) => match[1]);

    assert.deepEqual(used.filter((name) => !DOCUMENTED_API.includes(name)), []);
    assert.equal(/Homey\.(?:emit|createDevice)\([^)]*,\s*(?:function|\(?\w*\)?\s*=>)/.test(script), false, 'the promise forms, no callbacks');
  });

  test('one inline script that compiles, that loads nothing, and that has no timer, no eval and no write to the document', () => {
    assert.equal((view.match(/<script/g) || []).length, 1);
    assert.doesNotMatch(view, /<script[^>]*\ssrc=/);
    assert.doesNotMatch(view, /<link\b|<iframe\b|<form\b|https?:\/\//i);
    assert.doesNotThrow(() => new vm.Script(script));
    [
      /\beval\(/, /new Function\(/, /document\.write/, /outerHTML/, /insertAdjacentHTML/, /\bset(?:Timeout|Interval)\(/, /\bfetch\(/, /XMLHttpRequest/, /localStorage|sessionStorage/,
    ].forEach((pattern) => {
      assert.doesNotMatch(script, pattern, String(pattern));
    });
    assert.match(script, /'use strict'/);
  });

  test('everything of the Toon that is shown is set through textContent', () => {
    assert.ok((script.match(/\.textContent\s*=/g) || []).length >= 5);
    assert.doesNotMatch(script, /\.(?:innerText|outerText)\b/);
  });
});

describe('FR-05 AC1 / FR-100: no hard-coded user-visible text, every key exists in en and nl', () => {
  test('the markup has no text of its own: text nodes are empty and no attribute carries words', () => {
    const text = markup.replace(/<[^>]*>/g, '').trim();
    const attributes = [...markup.matchAll(/\b(?:placeholder|title|aria-label|alt|value)="([^"]*)"/g)].map((match) => match[1]);

    assert.equal(text, '');
    assert.deepEqual(attributes.filter((value) => /[a-z]/i.test(value)), []);
  });

  test('every data-i18n key and every key the script asks for exists in en and nl', () => {
    const languages = ['en', 'nl'].map((language) => new Set(flatten(JSON.parse(read(`locales/${language}.json`)))));
    const asked = [...new Set([...dataKeys, ...scriptKeys, ...[...script.matchAll(/Homey\.__\('([^']+)'/g)].map((match) => match[1])])];

    assert.ok(asked.length >= 20, `${asked.length} keys`);
    asked.forEach((key) => languages.forEach((known, index) => assert.ok(known.has(key), `${key} is missing in ${['en', 'nl'][index]}`)));
  });

  test('the readings that the app can send have a word each, in the script\'s tables', () => {
    ['on', 'off'].forEach((value) => assert.match(script, new RegExp(`\\b${value}: 'pair\\.program_${value}'`)));
    ['comfort', 'home', 'sleep', 'away', 'vacation', 'none'].forEach((value) => assert.match(script, new RegExp(`\\b${value}: 'pair\\.state_${value}'`)));
  });
});

describe('FR-05 AC1 / HS-51: the Homey Style Library, logical CSS, and the state of the controls', () => {
  test('every homey- class that the view uses is a documented one, and the form is built from them', () => {
    const classes = [...markup.matchAll(/\bclass="([^"]+)"/g)].flatMap((match) => match[1].split(/\s+/));
    const homey = classes.filter((name) => name.startsWith('homey-'));

    assert.deepEqual(homey.filter((name) => !STYLE_LIBRARY.test(name)), []);
    ['homey-form', 'homey-form-group', 'homey-form-label', 'homey-form-input', 'homey-button-primary-full', 'homey-form-checkbox'].forEach((name) => {
      assert.ok(homey.includes(name), name);
    });
    assert.deepEqual([...script.matchAll(/'(is-[a-z-]+)'/g)].map((match) => match[1]).filter((name) => !STATES.includes(name)), []);
  });

  test('the CSS is the view\'s own small block: logical properties only (right-to-left safe), hidden elements stay hidden', () => {
    assert.doesNotMatch(style, /(?:margin|padding|border)-(?:left|right)|text-align:\s*(?:left|right)|(?:^|[\s;{])(?:left|right)\s*:/m);
    assert.match(style, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
    assert.doesNotMatch(style, /@import|url\(/);
  });

  test('FR-01 AC2 / FR-61 AC1: Connect starts disabled; the result, the error and the ToonWater offer start hidden; the box is not ticked', () => {
    const tag = (id) => (new RegExp(`<[a-z]+\\s[^>]*\\bid="${id}"[^>]*>`).exec(markup) || [''])[0].replace(/"[^"]*"/g, '""');

    assert.match(tag('connect'), /\bdisabled\b/);
    ['result', 'error', 'toonwater-offer'].forEach((id) => assert.match(tag(id), /\bhidden\b/, id));
    assert.doesNotMatch(tag('toonwater'), /\bchecked\b/);
    assert.match(tag('toonwater'), /type=""/);
  });

  test('the buttons are not submit buttons, and there is no form to submit', () => {
    const buttons = [...markup.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]);

    assert.equal(buttons.length, 2);
    buttons.forEach((button) => assert.match(button, /type="button"/));
    assert.doesNotMatch(markup, /<form\b/);
  });

  test('the error is announced to assistive technology', () => {
    assert.match(markup, /id="error"[^>]*role="alert"|role="alert"[^>]*id="error"/);
  });
});
