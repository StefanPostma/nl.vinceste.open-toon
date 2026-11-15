'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { findViolations, cliShim } = require('../../scripts/check-pack');

describe('NFR-13 / ADR-0012: the pack check allows only the files of the app', () => {
  const allowed = [
    'app.js', 'app.json', 'package.json', 'package-lock.json', 'LICENSE', 'README.txt', 'README.nl.txt',
    'assets/icon.svg', 'assets/images/large.png', 'drivers/open-toon/device.js', 'drivers/open-toon/pair/start.html', 'lib/toon/client.js', 'locales/en.json',
  ];

  test('the files of an app bundle pass', () => {
    assert.deepEqual(findViolations(allowed), []);
  });

  test('anything outside the allow-list is reported', () => {
    const files = [
      ...allowed, 'docs/adr/0001.md', 'test/helpers/register.cjs', 'scripts/validate.js', 'tsconfig.eslint.json', '.eslintrc.json',
      'README.md', 'CONTRIBUTING.md', '.github/workflows/ci.yml',
    ];

    assert.deepEqual(findViolations(files), [
      'not allowed in the app bundle: docs/adr/0001.md',
      'not allowed in the app bundle: test/helpers/register.cjs',
      'not allowed in the app bundle: scripts/validate.js',
      'not allowed in the app bundle: tsconfig.eslint.json',
      'not allowed in the app bundle: .eslintrc.json',
      'not allowed in the app bundle: README.md',
      'not allowed in the app bundle: CONTRIBUTING.md',
      'not allowed in the app bundle: .github/workflows/ci.yml',
    ]);
  });

  test('development files hidden inside allowed directories are reported', () => {
    assert.deepEqual(findViolations(['lib/toon/client.test.js', 'drivers/open-toon/driver.compose.json', 'lib/notes.md', 'drivers/open-toon/.hidden']), [
      'development file inside the app bundle: lib/toon/client.test.js',
      'development file inside the app bundle: drivers/open-toon/driver.compose.json',
      'development file inside the app bundle: lib/notes.md',
      'development file inside the app bundle: drivers/open-toon/.hidden',
    ]);
  });

  test('NFR-05 AC1: node_modules is never part of the bundle: the app has no runtime dependencies', () => {
    const files = ['app.js', 'node_modules/some-package/index.js', 'node_modules/some-package/package.json'];

    assert.deepEqual(findViolations(files), [
      'not allowed in the app bundle: node_modules/some-package/index.js',
      'not allowed in the app bundle: node_modules/some-package/package.json',
    ]);
  });

  test('the one exception: the two files of the shim that the Homey CLI writes to node_modules/homey, and nothing else of that directory', () => {
    const shim = cliShim(path.dirname(require.resolve('homey/package.json')));
    const files = ['app.js', ...shim, 'node_modules/homey/other.js', 'node_modules/homey/index.json'];

    assert.deepEqual([...shim].sort(), ['node_modules/homey/index.js', 'node_modules/homey/package.json']);
    assert.deepEqual(findViolations(files, shim), [
      'not allowed in the app bundle: node_modules/homey/other.js',
      'not allowed in the app bundle: node_modules/homey/index.json',
    ]);
    assert.equal(findViolations(shim).length, 2, 'without the shim list they are reported as well');
  });
});
