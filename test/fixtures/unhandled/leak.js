'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

test('leaks one unhandled rejection that nobody announced', async () => {
  const leaked = Promise.reject(new Error('leaked'));
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  assert.ok(leaked instanceof Promise);
});
