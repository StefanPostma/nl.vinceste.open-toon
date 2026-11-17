'use strict';

/*
 * Counts unhandled rejections and uncaught exceptions for the current test file (NFR-01 AC1).
 *
 * install() wraps process.emit so every event is recorded before any other listener (including the
 * node:test runner) sees it. A recorded event that nobody announced with expectUnhandled() makes the
 * file fail at exit. Only test/baseline/** announces events: it characterises defects of the old code.
 */

const state = {
  events: [],
  budget: 0,
  unexpected: [],
  installed: false,
};

function describeReason(reason) {
  return reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
}

function install() {
  if (state.installed) return;
  state.installed = true;

  const originalEmit = process.emit;
  process.emit = function emit(event, ...args) {
    if (event === 'unhandledRejection' || event === 'uncaughtException') {
      state.events.push({ event, reason: args[0] });
      if (state.budget > 0) {
        state.budget--;
        return true;
      }
      state.unexpected.push({ event, reason: args[0] });
    }
    return originalEmit.call(this, event, ...args);
  };

  process.on('exit', () => {
    const problems = state.unexpected.map((entry) => `unexpected ${entry.event}: ${describeReason(entry.reason)}`);
    if (state.budget > 0) problems.push(`${state.budget} announced unhandled event(s) never happened`);
    if (problems.length > 0) {
      process.stderr.write(`${problems.join('\n')}\n`);
      process.exitCode = 1;
    }
  });
}

/** Announces that `count` more unhandled events will happen; they are recorded but do not fail the file. */
function expectUnhandled(count) {
  state.budget += count;
}

/** Every recorded event of this file so far, announced or not. */
function unhandledEvents() {
  return state.events.slice();
}

/** Unannounced events recorded so far. */
function unexpectedEvents() {
  return state.unexpected.slice();
}

/** Lets pending promise rejections surface: Node reports them after the microtask queue has drained. */
function settleRejections() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

module.exports = {
  install, expectUnhandled, unhandledEvents, unexpectedEvents, settleRejections,
};
