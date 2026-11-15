'use strict';

/*
 * Repository facts of S1: package metadata and licence (FR-120 AC3, NFR-11), the tooling that is a devDependency
 * (ADR-0011), the manifest's own metadata (FR-120 AC1, NFR-11 AC3). What the npm scripts and the ignore files hold is
 * not pinned here: the checks run in CI and `npm run pack:check` guards the bundle.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { exists, read, readJson } = require('../helpers/paths');

describe('FR-120 AC3: package.json identifies this project', () => {
  const pkg = readJson('package.json');

  test('name, repository, bugs and homepage point at StefanPostma/nl.vinceste.open-toon, not at athombv', () => {
    assert.equal(pkg.name, 'nl.vinceste.open-toon');
    assert.match(pkg.repository.url, /StefanPostma\/nl\.vinceste\.open-toon/);
    assert.match(pkg.bugs.url, /StefanPostma\/nl\.vinceste\.open-toon\/issues/);
    assert.match(pkg.homepage, /StefanPostma\/nl\.vinceste\.open-toon/);
    assert.equal(JSON.stringify(pkg).includes('athombv'), false);
    assert.equal(pkg.main, 'app.js');
  });

  test('NFR-11 AC2: the licence is GPL-3.0 and matches the LICENSE file', () => {
    assert.equal(pkg.license, 'GPL-3.0');
    assert.match(read('LICENSE'), /GNU GENERAL PUBLIC LICENSE\s+Version 3/);
  });
});

describe('ADR-0011: dependencies', () => {
  const pkg = readJson('package.json');

  test('the tooling is a devDependency: the Homey CLI, ESLint with the Athom config, the SDK types; never typescript', () => {
    ['homey', 'eslint', 'eslint-config-athom', '@types/homey', '@types/node'].forEach((name) => assert.ok(pkg.devDependencies[name], name));
    assert.match(pkg.devDependencies['@types/homey'], /^npm:homey-apps-sdk-v3-types@/);
    assert.equal(Object.hasOwn(pkg.devDependencies, 'typescript'), false);
  });

  test('the lockfile is version 3', () => {
    assert.equal(readJson('package-lock.json').lockfileVersion, 3);
  });
});

describe('ADR-0002: Homey Compose', () => {
  test('never gets a locales directory: it would turn the locale files into generated files', () => {
    assert.equal(exists('.homeycompose/locales'), false);
  });
});

describe('FR-120 AC1 / NFR-11 AC3: manifest metadata', () => {
  const manifest = readJson('app.json');

  test('the version is plain semver and the app id and SDK are unchanged', () => {
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
    assert.equal(manifest.id, 'nl.vinceste.open-toon');
    assert.equal(manifest.sdk, 3);
  });

  test('earlier contributors stay credited', () => {
    const names = manifest.contributors.developers.map((developer) => developer.name);

    ['oepi-loepi', 'Paul Heeringa'].forEach((name) => assert.ok(names.includes(name), name));
  });
});
