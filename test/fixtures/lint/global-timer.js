'use strict';

/*
 * Lint canary fixture (ADR-0012): homey-app/global-timers reports a bare setTimeout() call but not the
 * member form. test/static/layering.test.js must catch both; test/static/lint-canary.test.js lints this file
 * with allowInlineConfig:false and expects the bare call to be the only ESLint report.
 */

/* eslint-disable homey-app/global-timers */

function schedule(callback) {
  setTimeout(callback, 10);
  global.setTimeout(callback, 20);
}

module.exports = schedule;
