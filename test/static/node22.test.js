'use strict';

/*
 * NFR-02: Node.js 22 and CommonJS. The dev machine runs a newer Node than every Homey, so APIs that do not
 * exist in Node 22 must not slip into the code or the tests. The lint (node/no-unsupported-features, which reads
 * `engines.node`) knows the builtins up to the ES2024 era but not the newest ones, hence the denylist below.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  ROOT, read, readJson, walk,
} = require('../helpers/paths');

// APIs that arrived after Node 22 (V8 12.4). Strings, because this file is exempt from its own scan.
const NEWER_THAN_22 = ['Promise.try', 'RegExp.escape', 'Error.isError', 'Float16Array', 'Math.f16round', 'Uint8Array.fromBase64', 'Atomics.pause', 'node:sqlite'];
const escapeForRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NEWER_PATTERN = new RegExp(NEWER_THAN_22.map(escapeForRegExp).join('|'), 'g');
const EXEMPT = ['test/static/node22.test.js', 'test/fixtures/lint/'];

function javascriptFiles() {
  return [...(fs.existsSync(path.join(ROOT, 'app.js')) ? ['app.js'] : []), ...walk('drivers'), ...walk('lib'), ...walk('scripts'), ...walk('test')]
    .filter((file) => /\.(js|cjs)$/.test(file) && !EXEMPT.some((prefix) => file.startsWith(prefix)));
}

describe('NFR-02 AC2: no API newer than Node 22', () => {
  test('app code, scripts and tests use none of them', () => {
    const offenders = javascriptFiles().flatMap((file) => (read(file).match(NEWER_PATTERN) || []).map((api) => `${file}: ${api}`));

    assert.deepEqual(offenders, []);
  });
});

describe('NFR-02 AC1: Node.js 22 and CommonJS', () => {
  test('package.json requires Node >= 22, which is what the lint measures the code against', () => {
    assert.equal(readJson('package.json').engines.node, '>=22');
  });

  test('every JavaScript file is a strict CommonJS script: no import/export statements, no top-level await', () => {
    const modules = javascriptFiles().filter((file) => /^\s*(?:import\s[^\n]*\sfrom\s|import\s*['"(]|export\s)/m.test(read(file)));
    const sloppy = javascriptFiles().filter((file) => !/^(?:#!.*\n)?(?:\s*\/\/[^\n]*\n|\s*\/\*[\s\S]*?\*\/)*\s*['"]use strict['"]/.test(read(file)));

    assert.deepEqual(modules, []);
    assert.deepEqual(sloppy, []);
  });

  test('the tree has no ESM marker: no "type": "module" and no .mjs file', () => {
    assert.equal(Object.hasOwn(readJson('package.json'), 'type'), false);
    assert.deepEqual([...walk('drivers'), ...walk('lib'), ...walk('scripts'), ...walk('test')].filter((file) => file.endsWith('.mjs')), []);
  });
});
