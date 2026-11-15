'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const { ROOT } = require('../helpers/paths');

/** Runs one fixture file in a test runner of its own. */
function runFile(name) {
  // NODE_TEST_CONTEXT would make the nested runner behave as a child of this one
  const { NODE_TEST_CONTEXT: inherited, ...env } = process.env;
  return spawnSync(process.execPath, ['--require', './test/helpers/register.cjs', '--test', `test/fixtures/unhandled/${name}.js`], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
  });
}

describe('NFR-01 AC1: unhandled rejections fail the test file', () => {
  test('an unannounced unhandled rejection makes the file fail', () => {
    const result = runFile('leak');

    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /unexpected unhandledRejection: Error: leaked/);
  });

  test('an announced unhandled rejection is recorded and the file passes', () => {
    const result = runFile('announced');

    assert.equal(result.status, 0, result.stdout + result.stderr);
  });

  test('an announced rejection that never happens makes the file fail', () => {
    const result = runFile('missing');

    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /never happened/);
  });
});
