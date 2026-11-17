'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { getEventListeners } = require('node:events');
const nodeTimers = require('node:timers');
const { setTimeout: realSleep } = require('node:timers/promises');
const { ToonClient } = require('../../lib/toon/client');
const { ToonError, isNotFound, isAborted } = require('../../lib/toon/errors');
const { ENDPOINTS } = require('../../lib/toon/commands');
const { createClock } = require('../helpers/fake-clock');
const { createMockToon, fetchAdapter } = require('../helpers/mock-toon');
const { toonPayload } = require('../helpers/fixtures');

const MIB = 1024 * 1024;
const realTimers = { setTimeout: nodeTimers.setTimeout, clearTimeout: nodeTimers.clearTimeout };
const kindOf = (kind, status) => (error) => error instanceof ToonError && error.kind === kind && error.status === status;

/** Resolves when `check()` holds, polling in real time (the sockets of L1 run in real time). */
async function eventually(check, deadline = Date.now() + 3000) {
  if (await check()) return;
  if (Date.now() > deadline) throw new Error('eventually: the condition never held');
  await realSleep(10);
  await eventually(check, deadline);
}

/** Runs `run(index)` for 0..count-1, one after the other (the poller never has two requests in flight). */
const inSequence = (count, run) => Array.from({ length: count }).reduce(async (previous, unused, index) => [...await previous, await run(index)], Promise.resolve([]));

const connectionCount = (server) => new Promise((resolve, reject) => {
  server.getConnections((error, count) => (error ? reject(error) : resolve(count)));
});

const resourceTally = () => process.getActiveResourcesInfo().reduce((tally, name) => ({ ...tally, [name]: (tally[name] ?? 0) + 1 }), {});

/** L1: a client for the mock Toon behind a real node:http server on 127.0.0.1, driven by a fake clock. */
async function bootLive(options = {}) {
  const clock = createClock();
  const toon = createMockToon(options.mock);
  const live = await toon.listen();
  const client = new ToonClient({
    host: `${live.host}:${live.port}`, fetch: options.fetch ?? globalThis.fetch, timers: options.timers ?? clock.timers, ...options.client,
  });
  return {
    clock, toon, live, client,
  };
}

/** L2: a client for any handler over the in-process fetch adapter and a fake clock. */
function bootAdapter(handler, clientOptions = {}) {
  const clock = createClock();
  const adapted = fetchAdapter(handler, { timers: clock.timers, now: clock.now });
  const client = new ToonClient({
    host: '192.168.1.50', fetch: adapted, timers: clock.timers, ...clientOptions,
  });
  return {
    clock, client, recorder: adapted.recorder, fetch: adapted,
  };
}

/** A fetch that answers every request with `make()` and remembers what it was asked and whether the body was released. */
function scriptedFetch(make) {
  const script = { calls: [], cancelled: 0 };
  script.fetch = async (url, init) => {
    script.calls.push({ url, init });
    return make(script);
  };
  return script;
}

function bodyThatCounts(script, chunks, init) {
  let index = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(new TextEncoder().encode(chunks[index++]));
      else controller.close();
    },
    cancel() {
      script.cancelled++;
    },
  });
  return new Response(stream, init);
}

const clientFor = (script, options = {}) => {
  const clock = createClock();
  return {
    clock,
    client: new ToonClient({
      host: '192.168.1.50', fetch: script.fetch, timers: clock.timers, ...options,
    }),
  };
};

describe('NFR-04 AC1 [L1]: one request shape on a real socket', () => {
  test('the server sees Connection: close and Accept-Encoding: identity, a GET to the right path and nothing else', async () => {
    const { toon, live, client } = await bootLive();
    try {
      const answer = await client.get(ENDPOINTS.thermostat);
      const [seen, ...rest] = toon.requests();

      assert.deepEqual(answer, toonPayload('thermostat'));
      assert.equal(rest.length, 0);
      assert.equal(seen.method, 'GET');
      assert.equal(seen.path, '/happ_thermstat');
      assert.deepEqual(seen.query, { action: 'getThermostatInfo' });
      assert.equal(seen.headers.connection, 'close');
      assert.equal(seen.headers['accept-encoding'], 'identity');
      assert.equal(seen.headers.host, `${live.host}:${live.port}`);
    } finally {
      await live.close();
    }
  });

  test('the Toon answers text/javascript and the body still parses', async () => {
    const { live, client } = await bootLive();
    try {
      const raw = await globalThis.fetch(`${live.url}/happ_pwrusage?action=GetCurrentUsage`);

      assert.equal(raw.headers.get('content-type'), 'text/javascript');
      assert.deepEqual(await client.get(ENDPOINTS.power), toonPayload('power'));
    } finally {
      await live.close();
    }
  });
});

describe('NFR-04 AC2 [L1]: a redirect is not followed', () => {
  test('a 302 is a redirect error after exactly one request', async () => {
    const { toon, live, client } = await bootLive();
    try {
      toon.fault('redirect');

      await assert.rejects(client.get(ENDPOINTS.thermostat), kindOf('redirect', 302));
      assert.equal(toon.requests().length, 1, 'the Location header is not followed');
    } finally {
      await live.close();
    }
  });
});

describe('NFR-04 AC3 [L1]: an answer over the cap is abandoned', () => {
  test('2.5 MiB from the oversize fault is too_large after exactly one request', async () => {
    const { toon, live, client } = await bootLive();
    try {
      toon.fault('oversize');

      await assert.rejects(client.get(ENDPOINTS.meters), kindOf('too_large', undefined));
      // When the socket closes after a half-read answer is up to the platform: Node 22's fetch can keep it open
      // while the server still has unsent data. That the stream is cancelled is asserted below (L2).
      assert.equal(toon.requests().length, 1, 'no retry');
    } finally {
      await live.close();
    }
  });
});

describe('FR-24 AC1 [L1]: faults on a real socket become ToonErrors of the right kind', () => {
  test('500 -> http 500, 404 -> http 404 (isNotFound), result:error -> toon_error', async () => {
    const { toon, live, client } = await bootLive();
    try {
      toon.fault('500', { times: 1 });
      await assert.rejects(client.get(ENDPOINTS.thermostat), kindOf('http', 500));

      await assert.rejects(client.get({ path: '/nothing' }), (error) => kindOf('http', 404)(error) && isNotFound(error));

      toon.fault('result-error', { times: 1 });
      await assert.rejects(client.get(ENDPOINTS.power), kindOf('toon_error', undefined));
    } finally {
      await live.close();
    }
  });

  test('a refused or reset connection is a network error that keeps its cause for the log', async () => {
    const { toon, live, client } = await bootLive();
    try {
      toon.fault('refused', { times: 1 });
      await assert.rejects(client.get(ENDPOINTS.thermostat), (error) => kindOf('network', undefined)(error) && error.cause !== undefined);
    } finally {
      await live.close();
    }
    await assert.rejects(client.get(ENDPOINTS.thermostat), kindOf('network', undefined), 'nothing listens any more');
  });

  test('answers that are not a JSON object are bad_body, whatever the status line says', async () => {
    const { toon, live, client } = await bootLive();
    try {
      toon.configure({ water: 'junk' });
      await assert.rejects(client.get({ path: '/water.html' }), kindOf('bad_body', undefined));
      toon.configure({ water: 'html-200' });
      await assert.rejects(client.get({ path: '/water.html' }), kindOf('bad_body', undefined));
    } finally {
      await live.close();
    }
  });
});

describe('NFR-04 [L1]: nothing is left behind by failures', () => {
  test('after 50 error responses at most one connection is open and the process holds the same resources as before', async () => {
    const { toon, live, client } = await bootLive({ timers: realTimers });
    try {
      await client.get(ENDPOINTS.thermostat); // warm-up: lazily created resources exist before the snapshot
      await realSleep(50);
      const before = resourceTally();

      toon.fault('500');
      const outcomes = await inSequence(50, () => client.get(ENDPOINTS.meters).then(() => 'resolved', (error) => `${error.kind} ${error.status}`));

      assert.deepEqual([...new Set(outcomes)], ['http 500']);
      assert.ok(await connectionCount(live.server) <= 1, 'connections right after the 50th error');
      await eventually(() => JSON.stringify(resourceTally()) === JSON.stringify(before));
      assert.deepEqual(resourceTally(), before);
      assert.equal(await connectionCount(live.server), 0);
    } finally {
      await live.close();
    }
  });
});

describe('NFR-04 AC2 / ADR-0003 [L1]: timeout and abort on the injected timers', () => {
  test('a Toon that never answers is a timeout after exactly timeoutMs of fake time, and the timer is gone afterwards', async () => {
    const {
      toon, live, client, clock,
    } = await bootLive();
    try {
      toon.fault('timeout');
      let settled = false;
      const outcome = client.get(ENDPOINTS.thermostat).then(() => 'resolved', (error) => error).finally(() => {
        settled = true;
      });
      await eventually(() => toon.requests().length === 1);
      assert.equal(clock.armed(), 1, 'only the request timer is armed');

      await clock.tick(4999);
      assert.equal(settled, false);
      await clock.tick(1);
      const error = await outcome;

      assert.ok(kindOf('timeout', undefined)(error), String(error));
      assert.equal(clock.armed(), 0);
    } finally {
      await live.close();
    }
  });

  test('the caller signal cancels the request: aborted, and no listener stays on the epoch signal', async () => {
    const {
      toon, live, client, clock,
    } = await bootLive();
    try {
      toon.fault('timeout');
      const epoch = new AbortController();
      const outcome = client.get(ENDPOINTS.thermostat, { signal: epoch.signal }).then(() => 'resolved', (error) => error);
      await eventually(() => toon.requests().length === 1);
      assert.equal(getEventListeners(epoch.signal, 'abort').length, 1);

      epoch.abort();
      const error = await outcome;

      assert.ok(isAborted(error), String(error));
      assert.equal(getEventListeners(epoch.signal, 'abort').length, 0);
      assert.equal(clock.armed(), 0);
    } finally {
      await live.close();
    }
  });

  test('50 requests with the same epoch signal never put more than one listener on it', async () => {
    const epoch = new AbortController();
    let most = 0;
    const counting = (url, init) => {
      most = Math.max(most, getEventListeners(epoch.signal, 'abort').length);
      return globalThis.fetch(url, init);
    };
    const { toon, live, client } = await bootLive({ fetch: counting });
    try {
      toon.fault('500', { times: 25 });
      const outcomes = await inSequence(50, () => client.get(ENDPOINTS.thermostat, { signal: epoch.signal }).then(() => 'ok', () => 'failed'));

      assert.equal(outcomes.filter((outcome) => outcome === 'ok').length, 25);
      assert.equal(most, 1);
      assert.equal(getEventListeners(epoch.signal, 'abort').length, 0);
    } finally {
      await live.close();
    }
  });
});

describe('NFR-04 AC1: the URL is built, never concatenated', () => {
  test('query values are encoded as values and the path cannot grow a query or a fragment', async () => {
    const { client, recorder } = bootAdapter(() => ({ status: 200, body: '{"result":"ok"}' }));

    await client.get({ path: '/happ_thermstat', query: { action: 'a&b=c#d', Setpoint: 2050, x: ' y' } });
    await client.get({ path: '/a?b=1#frag' });
    const [encoded, pathOnly] = recorder.log;

    assert.deepEqual(encoded.query, { action: 'a&b=c#d', Setpoint: '2050', x: ' y' });
    assert.equal(encoded.path, '/happ_thermstat');
    assert.equal(pathOnly.path, '/a%3Fb=1%23frag');
    assert.deepEqual(pathOnly.query, {});
  });

  test('the request goes to the normalized host with the fixed options', async () => {
    const script = scriptedFetch(() => new Response('{"result":"ok"}'));
    const { client } = clientFor(script, { host: ' HTTP://Toon.Local:8080/ ' });

    await client.get({ path: '/happ_pwrusage', query: { action: 'GetCurrentUsage' } });
    const [{ url, init }] = script.calls;

    assert.equal(url, 'http://toon.local:8080/happ_pwrusage?action=GetCurrentUsage');
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'manual');
    assert.deepEqual({ ...init.headers }, { 'Accept-Encoding': 'identity', Connection: 'close' });
    assert.ok(init.signal instanceof AbortSignal);
  });

  test('a host that is not a valid address, or an endpoint that is not an endpoint, is a config error before any request', async () => {
    const script = scriptedFetch(() => new Response('{}'));
    const hosts = ['0.0.0.0', 'https://1.2.3.4', 'fe80::1', '192.168.1.50/x', '', null, 12, {}];
    const endpoints = [undefined, null, {}, { path: 'happ_thermstat' }, { path: 12 }, { path: '/x', query: { a: {} } }, { path: '/x', query: { a: NaN } }, { path: '/x', query: { a: null } }];

    await Promise.all(hosts.map((host) => assert.rejects(clientFor(script, { host }).client.get(ENDPOINTS.thermostat), kindOf('config', undefined), String(host))));
    await Promise.all(endpoints.map((endpoint) => assert.rejects(clientFor(script).client.get(endpoint), kindOf('config', undefined), JSON.stringify(endpoint))));
    assert.equal(script.calls.length, 0, 'nothing was sent');
  });
});

describe('NFR-04 AC2/AC3: bodies are released on every path that does not read them', () => {
  test('3xx, 4xx and 5xx answers cancel the body and report the status', async () => {
    const cases = [[302, 'redirect'], [301, 'redirect'], [399, 'redirect'], [404, 'http'], [500, 'http'], [503, 'http'], [400, 'http']];

    await Promise.all(cases.map(async ([status, kind]) => {
      const script = scriptedFetch((current) => bodyThatCounts(current, ['<html>x</html>'], { status, headers: { location: 'http://elsewhere.invalid/' } }));
      const { client } = clientFor(script);

      await assert.rejects(client.get(ENDPOINTS.thermostat), kindOf(kind, status), String(status));
      assert.equal(script.cancelled, 1, `body of ${status}`);
      assert.equal(script.calls.length, 1, 'no retry and no redirect follow-up');
    }));
  });

  test('a body that cannot be cancelled does not hide the real error', async () => {
    const broken = new ReadableStream({
      cancel() {
        throw new Error('the stream is broken');
      },
    });
    const script = scriptedFetch(() => new Response(broken, { status: 500 }));
    const { client } = clientFor(script);

    await assert.rejects(client.get(ENDPOINTS.thermostat), kindOf('http', 500));
  });

  test('an answer that grows past the cap is too_large and its stream is cancelled', async () => {
    const script = scriptedFetch((current) => bodyThatCounts(current, Array.from({ length: 40 }, () => 'x'.repeat(65536)), { status: 200 }));
    const { client } = clientFor(script);

    await assert.rejects(client.get(ENDPOINTS.meters), kindOf('too_large', undefined));
    assert.equal(script.cancelled, 1);
  });

  test('an announced length over the cap is refused without reading, and the body is cancelled', async () => {
    const script = scriptedFetch((current) => bodyThatCounts(current, ['{}'], { status: 200, headers: { 'content-length': String(2 * MIB + 1) } }));
    const { client } = clientFor(script);

    await assert.rejects(client.get(ENDPOINTS.meters), kindOf('too_large', undefined));
    assert.equal(script.cancelled, 1);
  });

  test('20 MB over the in-process adapter: too_large after the cap, the server side sees the client leave', async () => {
    const { client, recorder } = bootAdapter(() => ({ status: 200, chunks: Array.from({ length: 320 }, () => 'x'.repeat(65536)) }));

    await assert.rejects(client.get(ENDPOINTS.meters), kindOf('too_large', undefined));
    assert.equal(recorder.log[0].abortedByClient, true);
  });

  test('exactly the cap is accepted, one byte more is not (maxBytes is configurable)', async () => {
    const padding = (length) => `{"result":"ok","pad":"${'p'.repeat(length - 24)}"}`;
    const exact = bootAdapter(() => ({ status: 200, body: padding(1000) }), { maxBytes: 1000 });
    const over = bootAdapter(() => ({ status: 200, body: padding(1001) }), { maxBytes: 1000 });

    assert.equal((await exact.client.get(ENDPOINTS.power)).result, 'ok');
    await assert.rejects(over.client.get(ENDPOINTS.power), kindOf('too_large', undefined));
  });

  test('a body that was read completely has nothing left to cancel', async () => {
    const script = scriptedFetch((current) => bodyThatCounts(current, ['{"result":', '"ok"}'], { status: 200 }));
    const { client } = clientFor(script);

    assert.deepEqual(await client.get(ENDPOINTS.power), { result: 'ok' });
    assert.equal(script.cancelled, 0);
  });
});

describe('FR-24 AC1: what the body may be', () => {
  const answer = (body) => scriptedFetch(() => new Response(body, { status: 200, headers: { 'content-type': 'text/javascript' } }));

  ['', ' ', 'not json', '<html>502</html>', '{"result":"ok","currentTemp":"20', '[]', '[{"result":"ok"}]', '"text"', '5', 'null', 'true'].forEach((body) => {
    test(`${JSON.stringify(body)} is bad_body`, async () => {
      const { client } = clientFor(answer(body));

      await assert.rejects(client.get(ENDPOINTS.thermostat), kindOf('bad_body', undefined));
    });
  });

  test('{"result":"error"} is toon_error, any other result is an answer', async () => {
    await assert.rejects(clientFor(answer('{"result":"error"}')).client.get(ENDPOINTS.thermostat), kindOf('toon_error', undefined));
    assert.deepEqual(await clientFor(answer('{"result":"ok","a":1}')).client.get(ENDPOINTS.thermostat), { result: 'ok', a: 1 });
    assert.deepEqual(await clientFor(answer('{"a":1}')).client.get(ENDPOINTS.thermostat), { a: 1 });
    assert.deepEqual(await clientFor(answer('{"result":"nope"}')).client.get(ENDPOINTS.thermostat), { result: 'nope' });
  });

  test('a multi-byte character split over two chunks survives', async () => {
    const encoded = new TextEncoder().encode('{"name":"Kamer één"}');
    const script = scriptedFetch(() => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoded.slice(0, 16));
        controller.enqueue(encoded.slice(16));
        controller.close();
      },
    })));

    assert.deepEqual(await clientFor(script).client.get(ENDPOINTS.thermostat), { name: 'Kamer één' });
  });

  test('an answer with an own __proto__ key is returned as data and pollutes nothing', async () => {
    const body = await clientFor(answer('{"__proto__":{"polluted":1},"result":"ok"}')).client.get(ENDPOINTS.thermostat);

    assert.equal(Object.hasOwn(body, '__proto__'), true);
    assert.equal(({}).polluted, undefined);
    assert.equal(body.polluted, undefined);
  });

  test('an error never carries the text of the answer (NFR-04 AC5)', async () => {
    const { client } = clientFor(answer('<html>SECRET-TOKEN-12345</html>'));
    const error = await client.get(ENDPOINTS.thermostat).catch((caught) => caught);

    assert.equal(error.kind, 'bad_body');
    assert.equal(error.message, 'bad_body');
    assert.equal(error.cause, undefined);
    assert.equal(JSON.stringify(error, Object.getOwnPropertyNames(error)).includes('SECRET'), false);
  });
});

describe('ADR-0003: timeouts, aborts and failures on the fake clock', () => {
  test('the default budget is 5000 ms for the whole request, body included', async () => {
    const { client, clock } = bootAdapter(() => ({
      status: 200, chunks: ['{"result"', ':"ok"}'], chunkDelayMs: 3000,
    }));
    const outcome = client.get(ENDPOINTS.thermostat).then(() => 'resolved', (error) => error);

    await clock.tick(4999);
    await clock.tick(1);

    assert.ok(kindOf('timeout', undefined)(await outcome));
  });

  test('a slow answer inside the budget is fine and leaves no timer of the client behind', async () => {
    const { client, clock } = bootAdapter(() => ({ status: 200, body: '{"result":"ok"}', delayMs: 4900 }));
    const outcome = client.get(ENDPOINTS.thermostat);

    await clock.tick(4900);
    assert.deepEqual(await outcome, { result: 'ok' });
    await clock.runAll();
    assert.equal(clock.armed(), 0);
  });

  test('timeoutMs is configurable', async () => {
    const { client, clock } = bootAdapter(() => ({ status: 200, body: '{}', delayMs: 1500 }), { timeoutMs: 1000 });
    const outcome = client.get(ENDPOINTS.thermostat).then(() => 'resolved', (error) => error);

    await clock.tick(1000);

    assert.ok(kindOf('timeout', undefined)(await outcome));
  });

  test('an abort while waiting for the headers is aborted, and the cause is kept', async () => {
    const { client, clock, recorder } = bootAdapter(() => ({ status: 200, body: '{}', delayMs: 3000 }));
    const epoch = new AbortController();
    const outcome = client.get(ENDPOINTS.thermostat, { signal: epoch.signal }).then(() => 'resolved', (error) => error);

    await clock.tick(1000);
    epoch.abort();
    const error = await outcome;

    assert.ok(isAborted(error));
    assert.equal(error.cause.name, 'AbortError');
    assert.equal(recorder.log[0].abortedByClient, true);
    assert.equal(getEventListeners(epoch.signal, 'abort').length, 0);
  });

  test('an abort while the body streams is aborted too', async () => {
    const { client, clock } = bootAdapter(() => ({ status: 200, chunks: ['{"a"', ':1}'], chunkDelayMs: 2000 }));
    const epoch = new AbortController();
    const outcome = client.get(ENDPOINTS.thermostat, { signal: epoch.signal }).then(() => 'resolved', (error) => error);

    await clock.tick(2500);
    epoch.abort();

    assert.ok(isAborted(await outcome));
  });

  test('a signal that has already fired sends nothing and arms nothing', async () => {
    const { client, clock, recorder } = bootAdapter(() => ({ status: 200, body: '{}' }));
    const epoch = new AbortController();
    epoch.abort();

    await assert.rejects(client.get(ENDPOINTS.thermostat, { signal: epoch.signal }), kindOf('aborted', undefined));
    assert.equal(recorder.log.length, 0);
    assert.equal(clock.armed(), 0);
  });

  test('an abort that comes after the timeout has fired changes nothing', async () => {
    const { client, clock } = bootAdapter(() => ({ status: 200, body: '{}', delayMs: 60000 }));
    const epoch = new AbortController();
    const outcome = client.get(ENDPOINTS.thermostat, { signal: epoch.signal }).then(() => 'resolved', (error) => error);

    await clock.tick(5000);
    epoch.abort();

    assert.ok(kindOf('timeout', undefined)(await outcome));
  });

  test('a failure of fetch itself is a network error with its cause; a non-error rejection is too', async () => {
    const failing = (reason) => clientFor({
      fetch: async () => {
        throw reason;
      },
    }).client;

    const error = await failing(new TypeError('fetch failed')).get(ENDPOINTS.thermostat).catch((caught) => caught);
    assert.ok(kindOf('network', undefined)(error));
    assert.equal(error.cause.message, 'fetch failed');
    await assert.rejects(failing('plain string').get(ENDPOINTS.thermostat), kindOf('network', undefined));
  });

  test('no retries: a failing Toon sees exactly one request per call', async () => {
    const { client, recorder } = bootAdapter(() => ({ status: 500, body: 'Internal Server Error' }));

    await assert.rejects(client.get(ENDPOINTS.thermostat), kindOf('http', 500));
    assert.equal(recorder.log.length, 1);
  });
});

describe('ToonError and its helpers', () => {
  test('a kind outside the list is a programming error', () => {
    assert.throws(() => new ToonError('boom'), TypeError);
    assert.throws(() => new ToonError(undefined), TypeError);
  });

  test('status and cause are optional and the message holds nothing but kind and status', () => {
    const plain = new ToonError('timeout');
    const withStatus = new ToonError('http', { status: 503, cause: new Error('inner') });

    assert.equal(plain.message, 'timeout');
    assert.equal(plain.status, undefined);
    assert.equal(withStatus.message, 'http 503');
    assert.equal(withStatus.cause.message, 'inner');
    assert.ok(withStatus instanceof Error);
    assert.equal(withStatus.name, 'ToonError');
  });

  test('isNotFound is an HTTP 404 only, isAborted an aborted request only, and neither is fooled by other values', () => {
    assert.equal(isNotFound(new ToonError('http', { status: 404 })), true);
    assert.equal(isNotFound(new ToonError('http', { status: 500 })), false);
    assert.equal(isNotFound(new ToonError('redirect', { status: 404 })), false);
    assert.equal(isNotFound({ kind: 'http', status: 404 }), false);
    assert.equal(isNotFound(null), false);
    assert.equal(isAborted(new ToonError('aborted')), true);
    assert.equal(isAborted(new ToonError('timeout')), false);
    assert.equal(isAborted(new DOMException('x', 'AbortError')), false);
    assert.equal(isAborted(undefined), false);
  });
});
