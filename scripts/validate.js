'use strict';

/*
 * Runs `homey app validate` from the devDependency CLI (no global install) and fails when the
 * CLI rewrote app.json or locales/*.json, i.e. when the committed files differ from what the
 * CLI composed. A second run after such a rewrite is green.
 *
 * Usage: node scripts/validate.js [--level debug|publish|verified]   (default: publish)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  ROOT, BUILD_DIR, runHomey, removeBuildDir,
} = require('./homey-cli');

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

const LEVELS = ['debug', 'publish', 'verified'];

function parseLevel(argv) {
  const index = argv.indexOf('--level');
  return index === -1 ? 'publish' : argv[index + 1];
}

/** Files whose hash differs between two snapshots. */
function driftedFiles(before, after) {
  return Object.keys(before).filter((file) => before[file] !== after[file]);
}

function watchedFiles() {
  const locales = fs.readdirSync(path.join(ROOT, 'locales'))
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join('locales', name));
  return ['app.json', ...locales];
}

function snapshot(files) {
  const result = {};
  files.forEach((file) => {
    result[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex');
  });
  return result;
}

function main() {
  const level = parseLevel(process.argv.slice(2));
  if (!LEVELS.includes(level)) {
    fail(`Unknown validation level: ${level}`);
    return;
  }
  const files = watchedFiles();
  const before = snapshot(files);
  const buildDirExisted = fs.existsSync(BUILD_DIR);

  const run = runHomey(['validate', '--level', level]);

  if (!buildDirExisted) removeBuildDir();
  if (run.error) {
    fail(`Could not start the Homey CLI: ${run.error.message}`);
    return;
  }
  if (run.status !== 0) {
    fail(`homey app validate --level ${level} failed (exit ${run.status})`);
    return;
  }

  const after = snapshot(files);
  const drifted = driftedFiles(before, after);
  if (drifted.length > 0) {
    fail(`The Homey CLI rewrote ${drifted.join(', ')}: the committed files differ from the composed output. Review the change and run again.`);
    return;
  }
  process.stdout.write(`Validated at level ${level}; app.json and locales are in sync.\n`);
}

if (require.main === module) {
  main();
}

module.exports = { parseLevel, driftedFiles, LEVELS };
