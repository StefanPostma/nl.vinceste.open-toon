'use strict';

/*
 * NFR-06 AC2: every MUST/SHOULD requirement that mocks can verify is named by at least one test title, and no
 * title names an unknown id. `--matrix` prints which test proves which requirement (the input of the test report).
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  parseRequirements, requiredIds, idsIn, evaluate, sortIds, currentState, matrix, renderMatrix,
} = require('../../scripts/check-requirements');
const { ROOT, read } = require('../helpers/paths');

const table = parseRequirements(read('docs/sdlc/01-requirements.md'));

describe('NFR-06 AC2: requirement-id coverage', () => {
  test('the MoSCoW table of 01-requirements.md has 65 FR and 16 NFR rows and 73 mock-verifiable MUST/SHOULD ids', () => {
    const count = (moscow) => table.filter((row) => row.moscow === moscow).length;

    assert.equal(table.filter((row) => row.id.startsWith('FR-')).length, 65);
    assert.equal(table.filter((row) => row.id.startsWith('NFR-')).length, 16);
    assert.deepEqual([count('MUST'), count('SHOULD'), count('COULD'), count('WONT')], [51, 23, 5, 2]);
    assert.equal(requiredIds(table).length, 73);
  });

  test('COULD, WONT and hardware-only rows are not required', () => {
    const required = requiredIds(table);

    assert.equal(required.includes('FR-05'), false, 'hardware only');
    assert.equal(required.includes('FR-15'), false, 'COULD');
    assert.equal(required.includes('FR-27'), false, 'WONT');
    assert.equal(required.includes('FR-52'), true);
  });

  test('ids are read from titles; a title naming an unknown id is reported, a covered id leaves the pending list', () => {
    assert.deepEqual(idsIn('FR-52 AC1 and NFR-03: both'), ['FR-52', 'NFR-03']);
    assert.deepEqual(idsIn('nothing here, BD-1 is not a requirement'), []);

    const outcome = evaluate(table, [{ title: 'FR-52 AC1: adds the capabilities' }, { title: 'FR-999 does not exist' }]);
    assert.deepEqual(outcome.unknown, ['FR-999']);
    assert.equal(outcome.pending.includes('FR-52'), false);
    assert.equal(outcome.pending.includes('FR-53'), true);
  });

  test('ids sort numerically within FR and NFR', () => {
    assert.deepEqual(sortIds(['NFR-02', 'FR-100', 'FR-12', 'NFR-1', 'FR-9']), ['FR-9', 'FR-12', 'FR-100', 'NFR-1', 'NFR-02']);
  });

  test('no test title names an unknown requirement id', () => {
    assert.deepEqual(currentState().unknown, []);
  });

  test('every mock-verifiable MUST and SHOULD requirement has a test', () => {
    assert.deepEqual(currentState().pending, []);
  });

  test('the requirements of the release hygiene, the last to land, are named by tests: FR-101, FR-121, FR-122, NFR-05', () => {
    const { pending } = currentState();

    ['FR-101', 'FR-121', 'FR-122', 'NFR-05'].forEach((id) => assert.equal(pending.includes(id), false, id));
  });
});

describe('NFR-06 AC2: the requirement-to-test matrix and the check', () => {
  const state = currentState();
  const entries = matrix(state.rows, state.titles);

  test('the matrix has one entry per MUST and SHOULD requirement, in table order, and every mock-verifiable one has a test', () => {
    assert.equal(entries.length, 74);
    assert.deepEqual(entries.map((entry) => entry.id), table.filter((row) => row.moscow === 'MUST' || row.moscow === 'SHOULD').map((row) => row.id));
    assert.deepEqual(entries.filter((entry) => entry.verify.includes('M') && entry.tests.length === 0).map((entry) => entry.id), []);
  });

  test('a test is listed under every id its title names, with its file; a requirement for hardware only needs none', () => {
    const rows = [
      {
        id: 'FR-01', title: 'Pair', moscow: 'MUST', verify: 'M',
      },
      {
        id: 'FR-05', title: 'UI', moscow: 'SHOULD', verify: 'HW',
      },
      {
        id: 'FR-15', title: 'Could', moscow: 'COULD', verify: 'M',
      },
    ];
    const titles = [{ file: 'test/a.test.js', title: 'FR-01 AC1 and FR-15: pairs' }, { file: 'test/b.test.js', title: 'nothing' }];
    const result = matrix(rows, titles);

    assert.deepEqual(result.map((entry) => entry.id), ['FR-01', 'FR-05']);
    assert.deepEqual(result[0].tests, [titles[0]]);
    assert.deepEqual(result[1].tests, []);
  });

  test('the table names the file and the title of each test, marks a missing test and a hardware-only row, and escapes a pipe', () => {
    const output = renderMatrix([
      {
        id: 'FR-01', title: 'Pair | pair', moscow: 'MUST', verify: 'M', tests: [{ file: 'test/a.test.js', title: 'FR-01: a | b' }, { file: 'test/b.test.js', title: 'FR-01 AC2: c' }],
      },
      {
        id: 'FR-02', title: 'Test', moscow: 'MUST', verify: 'M', tests: [],
      },
      {
        id: 'FR-05', title: 'UI', moscow: 'SHOULD', verify: 'HW', tests: [],
      },
    ]).split('\n');

    assert.equal(output[0], '| Id | Prio | Verify | Requirement | Tests (file: title) |');
    assert.equal(output[2], '| FR-01 | MUST | M | Pair \\| pair | test/a.test.js: FR-01: a \\| b<br>test/b.test.js: FR-01 AC2: c |');
    assert.equal(output[3], '| FR-02 | MUST | M | Test | **none** |');
    assert.equal(output[4], '| FR-05 | SHOULD | HW | UI | hardware only |');
  });

  test('--matrix prints every id of the table and exits 0; the check itself exits 0 now that every id has a test', () => {
    const script = path.join(ROOT, 'scripts', 'check-requirements.js');
    const printed = spawnSync(process.execPath, [script, '--matrix'], { encoding: 'utf8' });
    const check = spawnSync(process.execPath, [script], { encoding: 'utf8' });

    assert.equal(printed.status, 0, printed.stderr);
    entries.forEach((entry) => assert.ok(printed.stdout.includes(`| ${entry.id} | ${entry.moscow} |`), entry.id));
    assert.equal(printed.stdout.includes('**none**'), false);
    assert.equal(check.status, 0, check.stderr);
  });
});
