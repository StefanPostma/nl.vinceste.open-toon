'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { expectUnhandled, unhandledEvents } = require('../../helpers/unhandled');

test('an announced unhandled rejection is recorded without failing the file', async () => {
  expectUnhandled(1);
  const leaked = Promise.reject(new Error('announced'));
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  assert.ok(leaked instanceof Promise);
  assert.equal(unhandledEvents().length, 1);
});
