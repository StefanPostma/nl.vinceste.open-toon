'use strict';

/*
 * NFR-10 AC2, NFR-02 AC1, ADR-0012: GitHub Actions replace the disabled CodeQL workflow. The checks themselves are
 * the npm scripts, and they run in CI; this test only guards what a slip in the workflow file would lose silently:
 * which checks run on which Node version, a clean install, and actions that are pinned. The workflow is read as
 * text: there is no YAML parser in the repository (no dependencies).
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT, exists, read } = require('../helpers/paths');

const yaml = read('.github/workflows/ci.yml');
/** The text of one job: from its name at two spaces of indentation to the next job. */
const job = (name) => yaml.split(/^ {2}(?=[\w-]+:\s*$)/m).find((block) => block.startsWith(`${name}:`)) || '';
const runs = (block) => [...block.matchAll(/^\s*- run: (.+?)\s*$/gm)].map((match) => match[1]);
const nodeVersion = (block) => (block.match(/node-version: (\d+)/) || [])[1];

/** GitHub's own actions are pinned to a major version tag, every other action to the full commit SHA of a release. */
const unpinned = (text) => [...text.matchAll(/^\s*- uses: (\S+)/gm)].map((match) => match[1]).filter((action) => {
  const [name, ref] = action.split('@');
  return name.startsWith('actions/') ? !/^v\d+$/.test(ref) : !/^[0-9a-f]{40}$/.test(ref || '');
});

describe('NFR-10 AC2: .github/workflows/ci.yml', () => {
  test('CI is the only workflow: the CodeQL workflow that was disabled is gone', () => {
    assert.equal(exists('.github/workflows/codeql-analysis.yml'), false);
    assert.deepEqual(fs.readdirSync(path.join(ROOT, '.github', 'workflows')), ['ci.yml']);
  });

  test('NFR-02 AC1 and NFR-06 AC3 and AC2: lint, tests, the coverage gate and the requirement check run on Node 22', () => {
    assert.equal(nodeVersion(job('test')), '22');
    ['npm run lint', 'npm test', 'npm run test:coverage', 'npm run check:requirements'].forEach((command) => assert.ok(runs(job('test')).includes(command), command));
    assert.equal(read('.nvmrc').trim(), nodeVersion(job('test')), '.nvmrc names the Node version of the test job');
  });

  test('ADR-0012: the Homey CLI needs Node 24: validate, the check that the composed files are committed and the pack check run there', () => {
    const commands = runs(job('validate'));

    assert.equal(nodeVersion(job('validate')), '24');
    ['npm run validate', 'git diff --exit-code app.json locales/', 'npm run pack:check'].forEach((command) => assert.ok(commands.includes(command), command));
    assert.ok(commands.indexOf('npm run validate') < commands.indexOf('git diff --exit-code app.json locales/'));
  });

  test('every job installs with `npm ci --ignore-scripts` first, never `npm install`, never globally', () => {
    ['test', 'validate'].forEach((name) => assert.equal(runs(job(name))[0], 'npm ci --ignore-scripts', name));
    assert.equal(/npm (?:install|i)\b|\bsudo\b|npm\s+\S*\s*-g\b|--global/.test(yaml), false);
  });

  test('every action is pinned, and the only third-party code that runs is the locked Homey CLI (SEC-02)', () => {
    assert.deepEqual(unpinned(yaml), []);
    const sample = '- uses: actions/checkout@master\n- uses: someone/else@v1\n- uses: x/y\n- uses: x/y@0123456789abcdef0123456789abcdef01234567';
    assert.deepEqual(unpinned(sample), ['actions/checkout@master', 'someone/else@v1', 'x/y']);
    assert.equal(/uses: (?!actions\/)/.test(yaml), false, 'no action of a third party');
  });

  test('the workflow asks for read access to the repository only, and the checkout does not leave the token in .git/config', () => {
    assert.match(yaml, /^permissions:\n {2}contents: read\n/m);
    assert.equal(/\bwrite\b/.test(yaml), false);
    assert.equal((yaml.match(/actions\/checkout@v\d+\n\s+with:\n\s+persist-credentials: false/g) || []).length, (yaml.match(/actions\/checkout@/g) || []).length);
  });
});

describe('NFR-10 AC2 and ADR-0011: .github/dependabot.yml', () => {
  test('it updates npm and github-actions, weekly', () => {
    const dependabot = read('.github/dependabot.yml');

    ['npm', 'github-actions'].forEach((ecosystem) => assert.match(dependabot, new RegExp(`package-ecosystem: "${ecosystem}"`)));
    assert.equal((dependabot.match(/interval: "weekly"/g) || []).length, 2);
  });

  test('it ignores new major versions of eslint and @types/node: neither can follow yet (ADR-0011)', () => {
    const dependabot = read('.github/dependabot.yml');

    ['eslint', '@types/node'].forEach((name) => assert.match(dependabot, new RegExp(`dependency-name: "${name}"\\n\\s+update-types: \\["version-update:semver-major"\\]`)));
  });
});
