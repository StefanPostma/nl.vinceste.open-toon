'use strict';

/*
 * The probe of ToonWater (ADR-0006 item 6): one GET of /water.html, classified as detected, not_found, unexpected or
 * unreachable. It is used at pairing, when the user switches the feature on and when the address changes; it never
 * throws. The Toon is the mock behind the in-process fetch and the fake clock, so the timeouts are real client
 * timeouts that cost no time. HW-07 (what a Toon without the add-on really answers) can change the wording of a
 * status, not these classes.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const toonwater = require('../../lib/features/toonwater');
const { ToonClient } = require('../../lib/toon/client');
const { ToonError } = require('../../lib/toon/errors');
const { createClock } = require('../helpers/fake-clock');
const { createMockToon } = require('../helpers/mock-toon');

/** A client for a mock Toon in the given water mode; `settle` moves the clock until the probe is done. */
function boot(mode, { fault } = {}) {
  const clock = createClock();
  const toon = createMockToon({ water: mode });
  if (fault) toon.fault(fault, { path: '/water.html' });
  const client = new ToonClient({ host: '192.168.1.50', fetch: toon.fetchWith(clock), timers: clock.timers });
  const controller = new AbortController();
  const run = async () => {
    let result;
    const pending = toonwater.probe(client, { signal: controller.signal }).then((found) => {
      result = found;
    });
    for (let step = 0; result === undefined && step < 40; step++) await clock.tick(500);
    await pending;
    return result;
  };
  return {
    clock, toon, client, controller, run,
  };
}

describe('ADR-0006 item 6: the probe tells the four situations apart', () => {
  const table = [
    ['200 and ok with a water object', 'present', { outcome: 'detected' }],
    ['200 and ok, an add-on before 1.1.16 (no total)', 'old-shape', { outcome: 'detected' }],
    ['404 [HW-07]', '404', { outcome: 'not_found' }],
    ['200 with HTML (html-200) [HW-07]', 'html-200', { outcome: 'unexpected' }],
    ['403', '403', { outcome: 'unexpected' }],
    ['500', '500', { outcome: 'unexpected' }],
    ['200 with something that is not JSON', 'junk', { outcome: 'unexpected' }],
    ['200 with the flat answer of the sensor module', 'flat-ESP', { outcome: 'unexpected', hint: 'sensor_module' }],
  ];

  table.forEach(([name, mode, expected]) => {
    test(`${name} is ${expected.outcome}${expected.hint ? ` with the hint ${expected.hint}` : ''}`, async () => {
      const { run, toon } = boot(mode);

      assert.deepEqual(await run(), expected);
      assert.equal(toon.requestsTo('/water.html').length, 1, 'one request, and nothing else');
      assert.equal(toon.requests().length, 1);
    });
  });

  test('a Toon that refuses the connection is unreachable: it says nothing about the add-on', async () => {
    const { run } = boot('present', { fault: 'refused' });

    assert.deepEqual(await run(), { outcome: 'unreachable' });
  });

  test('a Toon that does not answer within the 5 s of the client is unreachable', async () => {
    const { run } = boot('present', { fault: 'timeout' });

    assert.deepEqual(await run(), { outcome: 'unreachable' });
  });

  test('a page that arrives later than the client waits (the slow mode) is unreachable too', async () => {
    const { run } = boot('slow');

    assert.deepEqual(await run(), { outcome: 'unreachable' });
  });

  test('{"result":"error"}, a redirect and a huge answer are unexpected, as the Toon did answer', async () => {
    for (const fault of ['result-error', 'redirect', 'oversize', '500']) {
      const { run } = boot('present', { fault });

      assert.deepEqual(await run(), { outcome: 'unexpected' }, fault);
    }
  });
});

describe('ADR-0006 item 5: a probe that is cancelled is unreachable', () => {
  test('cancelled by the teardown of the device or an address change before it starts: unreachable, and no request is made', async () => {
    const { run, controller, toon } = boot('present');
    controller.abort();

    assert.deepEqual(await run(), { outcome: 'unreachable' });
    assert.equal(toon.requests().length, 0);
  });

  test('cancelled while the answer is on its way: unreachable, not an exception', async () => {
    const {
      clock, toon, client, controller,
    } = boot('present');
    toon.latencyMs = 2000;
    const probing = toonwater.probe(client, { signal: controller.signal });
    await clock.tick(1000);
    controller.abort();
    await clock.tick(5000);

    assert.deepEqual(await probing, { outcome: 'unreachable' });
  });

  test('whatever the client throws, the probe answers: a client that throws something that is not a ToonError is unexpected', async () => {
    const throwing = (error) => ({ get: () => Promise.reject(error) });
    const { signal } = new AbortController();

    assert.deepEqual(await toonwater.probe(throwing(new ToonError('timeout')), { signal }), { outcome: 'unreachable' });
    assert.deepEqual(await toonwater.probe(throwing(new ToonError('http', { status: 404 })), { signal }), { outcome: 'not_found' });
    assert.deepEqual(await toonwater.probe(throwing(new ToonError('http', { status: 503 })), { signal }), { outcome: 'unexpected' });
    assert.deepEqual(await toonwater.probe(throwing(new TypeError('boom')), { signal }), { outcome: 'unexpected' });
  });
});

describe('classify: what a poll result means for the status (the same table as the probe)', () => {
  test('no error is detected, 404 is not found, the transport kinds are unreachable, everything else is unexpected', () => {
    const { classify } = toonwater;

    assert.deepEqual(classify(null), { outcome: 'detected' });
    assert.deepEqual(classify(new ToonError('http', { status: 404 })), { outcome: 'not_found' });
    ['timeout', 'network', 'aborted'].forEach((kind) => assert.deepEqual(classify(new ToonError(kind)), { outcome: 'unreachable' }, kind));
    ['redirect', 'too_large', 'bad_body', 'toon_error', 'config'].forEach((kind) => assert.deepEqual(classify(new ToonError(kind)), { outcome: 'unexpected' }, kind));
    [403, 500, 503].forEach((status) => assert.deepEqual(classify(new ToonError('http', { status })), { outcome: 'unexpected' }, String(status)));
    assert.deepEqual(classify(new ToonError('bad_body'), 'sensor_module'), { outcome: 'unexpected', hint: 'sensor_module' });
    assert.deepEqual(classify(new ToonError('bad_body'), 'unexpected'), { outcome: 'unexpected' });
  });
});
