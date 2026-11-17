'use strict';

/*
 * Builds the app with the devDependency Homey CLI, lists the produced .homeybuild/ tree and fails on
 * any path outside the allow-list of ADR-0012. The app has no runtime dependencies (ADR-0011), so node_modules/
 * is never part of the bundle, with one exception: the CLI itself writes a two-file shim to node_modules/homey of
 * every build, so that `import ... from 'homey'` resolves (it is the CLI's own assets/homey directory, no package
 * of ours). .homeybuild/ is deleted afterwards.
 */

const fs = require('fs');
const path = require('path');
const {
  BUILD_DIR, homeyCliDir, runHomey, removeBuildDir,
} = require('./homey-cli');

const ALLOWED_FILES = ['app.js', 'app.json', 'package.json', 'package-lock.json', 'LICENSE'];
const ALLOWED_DIRS = ['assets', 'drivers', 'lib', 'locales'];
const FORBIDDEN_NESTED = [/\.md$/, /\.test\.js$/, /\.compose\.json$/, /(^|\/)tsconfig[^/]*\.json$/, /(^|\/)\./];

function listFiles(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? listFiles(path.join(dir, entry.name), relative) : [relative];
  });
}

function isAllowedTopLevel(top) {
  return ALLOWED_FILES.includes(top) || ALLOWED_DIRS.includes(top) || /^README[^/]*\.txt$/.test(top);
}

/** The `homey` shim of the CLI: node_modules/homey/<file> for every file of the CLI's assets/homey. */
function cliShim(cliDir) {
  return listFiles(path.join(cliDir, 'assets', 'homey')).map((file) => `node_modules/homey/${file}`);
}

/**
 * @param {string[]} files paths relative to the build root, '/' separated
 * @param {string[]} [shim] the files the CLI writes into node_modules/homey itself; the only node_modules paths that pass
 * @returns {string[]} one message per violating path
 */
function findViolations(files, shim = []) {
  const problems = [];
  files.forEach((file) => {
    const [top] = file.split('/');
    if (shim.includes(file)) return;
    if (!isAllowedTopLevel(top)) {
      problems.push(`not allowed in the app bundle: ${file}`);
    } else if (file.includes('/') && FORBIDDEN_NESTED.some((pattern) => pattern.test(file))) {
      problems.push(`development file inside the app bundle: ${file}`);
    }
  });
  return problems;
}

function main() {
  removeBuildDir();
  try {
    const build = runHomey(['build']);
    if (build.error || build.status !== 0) {
      process.stderr.write('homey app build failed\n');
      process.exitCode = 1;
      return;
    }

    const files = listFiles(BUILD_DIR);
    const problems = findViolations(files, cliShim(homeyCliDir()));
    if (problems.length > 0) {
      process.stderr.write(`${problems.join('\n')}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`Pack check passed: ${files.length} files in the bundle.\n`);
  } finally {
    removeBuildDir();
  }
}

if (require.main === module) {
  main();
}

module.exports = { findViolations, listFiles, cliShim };
