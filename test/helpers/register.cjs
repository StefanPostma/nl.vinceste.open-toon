'use strict';

/*
 * Loaded with `node --require ./test/helpers/register.cjs` (see the `test` script).
 * 1. `require('homey')` resolves to the strict fake in test/helpers/fake-homey, never to the CLI
 *    package of the same name in node_modules (ADR-0013).
 * 2. Unhandled rejections and uncaught exceptions are counted and fail the test file.
 */

const Module = require('module');
const path = require('path');
const unhandled = require('./unhandled');

const FAKE_HOMEY = path.join(__dirname, 'fake-homey', 'index.js');
const originalResolve = Module._resolveFilename;

Module._resolveFilename = function resolveFilename(request, ...rest) {
  if (request === 'homey') return FAKE_HOMEY;
  return originalResolve.call(this, request, ...rest);
};

unhandled.install();

module.exports = unhandled;
