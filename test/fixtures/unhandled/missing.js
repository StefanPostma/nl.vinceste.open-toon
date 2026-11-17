'use strict';

const { test } = require('node:test');
const { expectUnhandled } = require('../../helpers/unhandled');

test('announces an unhandled rejection that never happens', () => {
  expectUnhandled(1);
});
