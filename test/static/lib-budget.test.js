'use strict';

/*
 * NFR-10 AC1 and ADR-0002 item 5: the size budget of the code. lib/ has at most 16 files and none is longer than 250
 * lines, so the modules (transport, parsing, polling engine, Homey glue) cannot grow back into one 600-line file.
 * No file is exempt from the lint any more: .eslintrc.json has no ignorePatterns (the baseline files that were exempt
 * are gone). The dead code that the audit found (mapDeviceClass, debounce, the web API handlers) is gone as well.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT, read, walk } = require('../helpers/paths');

const MAX_FILES = 16;
const MAX_LINES = 250;
const LAYERS = ['engine', 'features', 'flow', 'toon'];

/** Lines the way `wc -l` counts them: the number of line breaks. */
const lineCount = (source) => source.split('\n').length - 1;

/** @returns {string[]} one message per breach of the budget */
function budgetProblems(files, readFile, { maxFiles = MAX_FILES, maxLines = MAX_LINES } = {}) {
  const problems = [];
  if (files.length > maxFiles) problems.push(`lib/ has ${files.length} files, at most ${maxFiles} are allowed`);
  files.forEach((file) => {
    const lines = lineCount(readFile(file));
    if (lines > maxLines) problems.push(`${file} has ${lines} lines, at most ${maxLines} are allowed`);
  });
  return problems;
}

describe('NFR-10 AC1: the size budget of lib/ (ADR-0002)', () => {
  const files = walk('lib');

  test('the budget check reports too many files and a file that is too long, and nothing else', () => {
    const sources = { 'lib/a.js': 'one\ntwo\n', 'lib/b.js': `${'x\n'.repeat(251)}`, 'lib/c.js': `${'x\n'.repeat(250)}` };

    assert.deepEqual(budgetProblems(Object.keys(sources), (file) => sources[file], { maxFiles: 3 }), ['lib/b.js has 251 lines, at most 250 are allowed']);
    assert.deepEqual(budgetProblems(Object.keys(sources), (file) => sources[file], { maxFiles: 2 }), [
      'lib/ has 3 files, at most 2 are allowed',
      'lib/b.js has 251 lines, at most 250 are allowed',
    ]);
  });

  test('lib/ has at most 16 files and none is longer than 250 lines', () => {
    assert.deepEqual(budgetProblems(files, read), []);
  });

  test('lib/ holds JavaScript only, in the four layers of ADR-0002', () => {
    assert.deepEqual(files.filter((file) => !file.endsWith('.js')), []);
    assert.deepEqual([...new Set(files.map((file) => file.split('/')[1]))].sort(), LAYERS);
  });

  test('every layer exists: transport and parsing, features, polling engine, Flow cards', () => {
    ['lib/toon/client.js', 'lib/toon/parse.js', 'lib/features/index.js', 'lib/engine/poller.js', 'lib/flow/cards.js', 'drivers/open-toon/device.js']
      .forEach((file) => assert.ok(fs.existsSync(path.join(ROOT, file)), file));
  });
});

describe('NFR-10 AC1: no file is exempt from the lint and no dead code of the audit remains', () => {
  test('.eslintrc.json has no ignorePatterns', () => {
    assert.equal(Object.hasOwn(JSON.parse(read('.eslintrc.json')), 'ignorePatterns'), false);
  });

  test('app.js, the drivers and lib/ do not contain the dead code that the audit named', () => {
    const dead = ['mapDeviceClass', 'debounce', 'webAPIResponseHandler', 'webAPIErrorHandler', 'API_BASE_URL', 'WebAPIDevice'];
    const files = ['app.js', ...walk('drivers'), ...walk('lib')].filter((file) => file.endsWith('.js'));
    const hits = files.flatMap((file) => dead.filter((name) => read(file).includes(name)).map((name) => `${file}: ${name}`));

    assert.deepEqual(hits, []);
  });

  test('the Athom lint stack and the Homey rules stay on: no rule is switched off in the main config', () => {
    const config = JSON.parse(read('.eslintrc.json'));

    assert.equal(config.extends, 'athom/homey-app');
    assert.deepEqual(Object.entries(config.rules).filter(([, value]) => value === 'off' || value === 0 || (Array.isArray(value) && (value[0] === 'off' || value[0] === 0))), []);
  });
});
