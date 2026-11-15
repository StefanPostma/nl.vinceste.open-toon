'use strict';

/*
 * The Homey CLI of the devDependencies (no global install) and its build directory, for the scripts that run it
 * (validate.js, check-pack.js).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BUILD_DIR = path.join(ROOT, '.homeybuild');

function homeyCliDir() {
  return path.dirname(require.resolve('homey/package.json', { paths: [ROOT] }));
}

/** The executable of the CLI: the `bin` entry of its package.json. */
function homeyCli() {
  const pkg = JSON.parse(fs.readFileSync(path.join(homeyCliDir(), 'package.json'), 'utf8'));
  return path.join(homeyCliDir(), typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.homey);
}

/** Runs `homey app <args>` in the repository, with its output on the terminal. @returns the result of spawnSync */
function runHomey(args) {
  return spawnSync(process.execPath, [homeyCli(), 'app', ...args], { cwd: ROOT, stdio: 'inherit' });
}

function removeBuildDir() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
}

module.exports = {
  ROOT, BUILD_DIR, homeyCliDir, homeyCli, runHomey, removeBuildDir,
};
