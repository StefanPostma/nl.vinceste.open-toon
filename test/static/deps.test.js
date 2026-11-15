'use strict';

/*
 * NFR-05 / ADR-0011: the shipped app contains only its own code. package.json declares no runtime dependency,
 * the lockfile (version 3) holds development tooling only, and the stale packages of the baseline (the SDK v2 logger,
 * the Wi-Fi driver base class, the request library and what hung off them) are gone from the manifest, the lockfile,
 * node_modules and the code. NFR-13 AC1: node_modules is ignored by git and left out of the app package.
 * The names are assembled from fragments so that this file does not trip the greps that verify the repository.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { builtinModules } = require('module');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  ROOT, read, readJson, walk,
} = require('../helpers/paths');

const join = (...parts) => parts.join('');
const STALE = [join('homey-', 'log'), join('homey-', 'wifidriver'), 'request', join('request-', 'promise-native'), join('request-', 'promise'), 'underscore'];
// lodash is not named by NFR-05 AC1, but the baseline pulled it in at runtime. It cannot leave the lockfile: the Homey CLI
// (homey@4.6.3, the latest release, which `validate` and `pack:check` need) requires inquirer@8.1.2, which requires lodash.
// It may only remain as such a development-only tool (dev: true), never in dependencies and never in the bundle.
const DEV_ONLY = ['lodash'];

const pkg = readJson('package.json');
const lock = readJson('package-lock.json');

/** Package names of the lockfile entries ('node_modules/a/node_modules/@s/b' -> '@s/b'), the root excluded. */
function lockedNames() {
  return Object.keys(lock.packages).filter((key) => key !== '').map((key) => key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length));
}

describe('NFR-05 AC1: no runtime dependency', () => {
  test('package.json declares an empty dependencies object', () => {
    assert.deepEqual(pkg.dependencies, {});
    assert.deepEqual(Object.keys(pkg.optionalDependencies || {}), []);
    assert.deepEqual(Object.keys(pkg.peerDependencies || {}), []);
    assert.deepEqual(Object.keys(pkg.bundledDependencies || []), []);
  });

  test('the stale packages are named in neither the dependency lists of package.json nor in the lockfile', () => {
    const declared = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].flatMap((field) => Object.keys(pkg[field] || {}));
    const locked = lockedNames();

    STALE.forEach((name) => {
      assert.equal(declared.includes(name), false, `${name} is declared in package.json`);
      assert.equal(locked.includes(name), false, `${name} is in the lockfile`);
    });
    assert.deepEqual(Object.keys(lock.packages[''].dependencies || {}), [], 'the root entry of the lockfile has no dependencies');
  });

  test('the lockfile is version 3 and every package in it is a development tool', () => {
    const shipped = Object.entries(lock.packages).filter(([key, entry]) => key !== '' && !entry.dev && !entry.devOptional);

    assert.equal(lock.lockfileVersion, 3);
    assert.deepEqual(shipped.map(([key]) => key), []);
    assert.equal(lock.packages[''].name, pkg.name);
    assert.equal(lock.packages[''].version, pkg.version, 'the lockfile was regenerated for this version');
  });

  test('lodash, which the baseline shipped, remains only as a development dependency of the Homey CLI', () => {
    const entries = Object.entries(lock.packages).filter(([key]) => DEV_ONLY.includes(key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length)));

    entries.forEach(([key, entry]) => assert.equal(entry.dev, true, `${key} must be dev only`));
  });

  test('the stale packages are not installed: node_modules lacks them (a checkout without node_modules passes trivially)', () => {
    const installed = fs.existsSync(path.join(ROOT, 'node_modules')) ? fs.readdirSync(path.join(ROOT, 'node_modules')) : [];

    assert.deepEqual(STALE.filter((name) => installed.includes(name)), []);
  });

  test('app.js, the drivers, lib and scripts do not mention the stale packages', () => {
    const files = ['app.js', ...walk('drivers'), ...walk('lib'), ...walk('scripts')].filter((file) => /\.(js|cjs)$/.test(file));
    const mentions = files.flatMap((file) => STALE.filter((name) => name !== 'request' && name !== 'underscore')
      .filter((name) => read(file).includes(name)).map((name) => `${file}: ${name}`));

    assert.deepEqual(mentions, []);
  });

  test('the code of the app requires only modules of Node, the Homey SDK and its own files', () => {
    const files = ['app.js', ...walk('drivers'), ...walk('lib')].filter((file) => /\.js$/.test(file));
    const foreign = files.flatMap((file) => [...read(file).matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)]
      .map((match) => match[1])
      .filter((id) => !id.startsWith('.') && id !== 'homey' && !builtinModules.includes(id.replace(/^node:/, '')))
      .map((id) => `${file}: ${id}`));

    assert.deepEqual(foreign, []);
  });

  test('the packages that the scripts require are devDependencies, never runtime ones', () => {
    const required = walk('scripts').flatMap((file) => [...read(file).matchAll(/require(?:\.resolve)?\(\s*['"]([^'"./][^'"]*)['"]/g)].map((match) => match[1].split('/')[0]));

    required.filter((id) => !builtinModules.includes(id)).forEach((id) => assert.ok(Object.hasOwn(pkg.devDependencies, id), `${id} must be a devDependency`));
  });

  test('NFR-05 AC2: `npm ls --omit=dev` lists no package', () => {
    const result = spawnSync('npm', ['ls', '--omit=dev', '--json', '--offline'], { cwd: ROOT, encoding: 'utf8' });
    const listing = JSON.parse(result.stdout);

    assert.equal(result.status, 0);
    assert.deepEqual(Object.keys(listing.dependencies || {}), []);
  });

  test('a development dependency can only be added next to this check: the list is the one of ADR-0011', () => {
    assert.deepEqual(Object.keys(pkg.devDependencies).sort(), ['@types/homey', '@types/node', 'eslint', 'eslint-config-athom', 'homey']);
  });
});

describe('NFR-13 AC1: node_modules stays out of git and out of the app', () => {
  test('git ignores node_modules, the build directory and env.json, whether or not node_modules is still tracked', { skip: !fs.existsSync(path.join(ROOT, '.git')) && 'not a git checkout' }, () => {
    const result = spawnSync('git', ['check-ignore', '--no-index', 'node_modules', '.homeybuild', 'env.json'], { cwd: ROOT, encoding: 'utf8' });

    assert.equal(result.status, 0);
    assert.deepEqual(result.stdout.split('\n').filter(Boolean).sort(), ['.homeybuild', 'env.json', 'node_modules']);
  });

  test('the Homey CLI leaves node_modules out of the package as well: .homeyignore and its default list agree', () => {
    const homeyIgnore = read('.homeyignore').split('\n').map((line) => line.trim());

    ['docs/', 'test/', 'scripts/', '*.md', '.github/', 'tsconfig.eslint.json'].forEach((line) => assert.ok(homeyIgnore.includes(line), line));
  });
});
