'use strict';

/*
 * Runs every mutant of test/helpers/mutants.cjs against the QA acceptance suite and against the whole suite, and
 * prints a Markdown table: a mutant is "killed" when at least one test fails. The report quotes this table.
 *
 * Usage: node scripts/qa-mutation.js [mutant-name ...]
 *   exits 1 when a mutant survives the whole suite
 */

const { spawnSync } = require('child_process');
const path = require('path');
const { MUTANTS } = require('../test/helpers/mutants.cjs');

const ROOT = path.join(__dirname, '..');
const PRELOAD = ['--require', './test/helpers/register.cjs', '--require', './test/helpers/mutants.cjs'];
const TEST_TIMEOUT = '--test-timeout=15000'; // a test that waits for ever fails after 15 s, as the run of a user would hang
const TIMEOUT_MS = 60e3; // the whole suite takes about 10 s; a run that takes six times longer has hung
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'); // the colours of the test reporter
const SUITES = [
  ['QA acceptance', ['test/scenario/qa-acceptance.test.js']],
  ['whole suite', ['test/**/*.test.js']],
];

/** @returns {{killed: boolean, failed: number}} */
function run(mutant, files) {
  const result = spawnSync(process.execPath, [...PRELOAD, '--test', TEST_TIMEOUT, ...files], {
    cwd: ROOT, env: { ...process.env, QA_MUTANT: mutant, NO_COLOR: '1' }, encoding: 'utf8', timeout: TIMEOUT_MS,
  });
  const failed = Number((/^(?:ℹ|#) fail (\d+)/m.exec(result.stdout.replace(ANSI, '')) || [])[1] || 0);
  return { killed: result.status !== 0, failed, hung: result.error !== undefined && result.error.code === 'ETIMEDOUT' };
}

const selected = process.argv.slice(2);
const names = selected.length > 0 ? selected : Object.keys(MUTANTS);
const rows = ['| Mutant | What it breaks | QA acceptance | Whole suite |', '|---|---|---|---|'];
let survivors = 0;
names.forEach((name) => {
  if (!Object.hasOwn(MUTANTS, name)) throw new Error(`Unknown mutant ${name}`);
  const cells = SUITES.map(([, files]) => run(name, files))
    .map(({ killed, failed, hung }) => (hung ? 'killed (the run hung and was stopped)' : killed ? `killed (${failed} failing)` : '**SURVIVED**')); // eslint-disable-line no-nested-ternary
  if (cells[1].startsWith('**')) survivors += 1;
  rows.push(`| \`${name}\` | ${MUTANTS[name].breaks} | ${cells[0]} | ${cells[1]} |`);
});
process.stdout.write(`${rows.join('\n')}\n\n${names.length} mutants, ${survivors} survived the whole suite\n`);
process.exitCode = survivors > 0 ? 1 : 0;
