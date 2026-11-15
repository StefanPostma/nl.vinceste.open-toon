'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: realSleep } = require('timers/promises');
const { createClock } = require('../helpers/fake-clock');
const { fetchAdapter, startHttpServer, createRecorder } = require('../helpers/mock-toon');

const DELAY = 150;
const CHUNK_DELAY = 50;

/** One handler, served by both transports. */
function handler(req) {
  switch (req.path) {
    case '/wait': return { status: 200, body: 'late', delayMs: DELAY };
    case '/stream': return { status: 200, chunks: ['one', 'two', 'three'], chunkDelayMs: CHUNK_DELAY };
    case '/echo': return { status: 201, headers: { 'x-seen': req.headers.connection || '' }, body: JSON.stringify(req.headers) };
    default: return { status: 404, body: 'Not Found' };
  }
}

/** Environment 1: the adapter under the fake clock. */
function adapterEnvironment() {
  const clock = createClock();
  const recorder = createRecorder();
  return {
    name: 'fetchAdapter',
    fetch: fetchAdapter(handler, { timers: clock.timers, now: clock.now, recorder }),
    url: (path) => `http://mock.toon${path}`,
    wait: (ms) => clock.tick(ms),
    recorder,
    close: async () => {},
  };
}

/** Environment 2: node:http server and the real fetch, on real timers. */
async function httpEnvironment() {
  const server = await startHttpServer(handler);
  return {
    name: 'node:http + fetch',
    fetch: (url, init) => fetch(url, init),
    url: (path) => `${server.url}${path}`,
    wait: (ms) => realSleep(ms),
    recorder: server.recorder,
    close: () => server.close(),
  };
}

async function inBothEnvironments(scenario) {
  const observations = [];
  for (const create of [adapterEnvironment, httpEnvironment]) {
    const environment = await create();
    try {
      observations.push(await scenario(environment));
    } finally {
      await environment.close();
    }
  }
  assert.deepEqual(observations[0], observations[1], 'fetchAdapter and node:http + fetch must show the same observable behaviour');
  return observations[0];
}

describe('NFR-06 AC1: fetchAdapter is equivalent to node:http + real fetch (ADR-0013)', () => {
  test('adapter equivalence: abort-while-waiting', async () => {
    const observed = await inBothEnvironments(async (env) => {
      const controller = new AbortController();
      const outcome = env.fetch(env.url('/wait'), { signal: controller.signal }).then(() => 'resolved', (error) => error.name);
      await env.wait(20);
      controller.abort();
      const name = await outcome;
      await env.wait(10);
      const [entry] = env.recorder.log;
      const openRightAfterAbort = env.recorder.openHandlers();
      await env.wait(DELAY + 100);
      return {
        name, abortedByClient: entry.abortedByClient, openRightAfterAbort, openAtEnd: env.recorder.openHandlers(), ranFullDelay: entry.end - entry.start >= DELAY,
      };
    });

    assert.deepEqual(observed, {
      name: 'AbortError', abortedByClient: true, openRightAfterAbort: 1, openAtEnd: 0, ranFullDelay: true,
    });
  });

  test('adapter equivalence: abort-while-streaming', async () => {
    const observed = await inBothEnvironments(async (env) => {
      const controller = new AbortController();
      const response = await env.fetch(env.url('/stream'), { signal: controller.signal });
      const reader = response.body.getReader();
      const firstRead = reader.read();
      await env.wait(CHUNK_DELAY + 20);
      const first = new TextDecoder().decode((await firstRead).value);
      const nextRead = reader.read().then(() => 'chunk', (error) => error.name);
      controller.abort();
      const readOutcome = await nextRead;
      await env.wait(10);
      const [entry] = env.recorder.log;
      const openRightAfterAbort = env.recorder.openHandlers();
      await env.wait(3 * CHUNK_DELAY + 100);
      return {
        status: response.status, first, readOutcome, abortedByClient: entry.abortedByClient, openRightAfterAbort, openAtEnd: env.recorder.openHandlers(),
      };
    });

    assert.deepEqual(observed, {
      status: 200, first: 'one', readOutcome: 'AbortError', abortedByClient: true, openRightAfterAbort: 1, openAtEnd: 0,
    });
  });

  test('adapter equivalence: completion-after-abort', async () => {
    const observed = await inBothEnvironments(async (env) => {
      const controller = new AbortController();
      const aborted = env.fetch(env.url('/wait'), { signal: controller.signal }).catch((error) => error.name);
      await env.wait(20);
      controller.abort();
      await aborted;
      const second = env.fetch(env.url('/wait')).then((response) => response.text());
      await env.wait(DELAY + 100);
      const body = await second;
      const [first, again] = env.recorder.log;
      return {
        body,
        maxConcurrent: env.recorder.maxConcurrent(),
        openAtEnd: env.recorder.openHandlers(),
        firstEndedAfterItsDelay: first.end - first.start >= DELAY,
        firstAborted: first.abortedByClient,
        secondAborted: again.abortedByClient,
      };
    });

    assert.deepEqual(observed, {
      body: 'late', maxConcurrent: 2, openAtEnd: 0, firstEndedAfterItsDelay: true, firstAborted: true, secondAborted: false,
    });
  });
});

describe('NFR-06 AC1: fetchAdapter contract (ADR-0013)', () => {
  test('returns real Response objects with status, headers and body', async () => {
    const env = adapterEnvironment();
    const response = await env.fetch(env.url('/echo'));

    assert.ok(response instanceof Response);
    assert.equal(response.status, 201);
    assert.equal(typeof (await response.json()), 'object');
  });

  test('delays run on the injected timers, never on real ones', async () => {
    const clock = createClock();
    const adapter = fetchAdapter(handler, { timers: clock.timers, now: clock.now });
    let settled = false;
    const pending = adapter('http://mock.toon/wait').then(() => {
      settled = true;
    });

    await realSleep(DELAY + 100);
    assert.equal(settled, false, 'real time passing must not release the response');
    assert.equal(clock.armed(), 1);
    await clock.tick(DELAY);
    await pending;
    assert.equal(settled, true);
  });

  test('request headers pass through to the handler and the request log', async () => {
    const env = adapterEnvironment();
    await env.fetch(env.url('/echo?probe=1'), { headers: { Connection: 'close', 'Accept-Encoding': 'identity' } });

    const [entry] = env.recorder.log;
    assert.equal(entry.headers.connection, 'close');
    assert.equal(entry.headers['accept-encoding'], 'identity');
    assert.deepEqual(entry.query, { probe: '1' });
  });

  test('a signal that is already aborted rejects with its own reason and sends nothing', async () => {
    const env = adapterEnvironment();
    const reason = new Error('device removed');
    await assert.rejects(env.fetch(env.url('/wait'), { signal: AbortSignal.abort(reason) }), (error) => error === reason);
    assert.equal(env.recorder.log.length, 0);
  });

  test('an abort with a custom reason rejects the pending fetch with that reason', async () => {
    const env = adapterEnvironment();
    const controller = new AbortController();
    const pending = env.fetch(env.url('/wait'), { signal: controller.signal });
    const reason = new Error('timed out');
    controller.abort(reason);

    await assert.rejects(pending, (error) => error === reason);
  });

  test('cancelling the body marks the request as aborted by the client', async () => {
    const env = adapterEnvironment();
    const response = await env.fetch(env.url('/stream'));
    await response.body.cancel();
    await env.wait(3 * CHUNK_DELAY);

    assert.equal(env.recorder.log[0].abortedByClient, true);
    assert.equal(env.recorder.openHandlers(), 0);
  });

  test('a refused connection fails like fetch does: TypeError fetch failed with a cause code', async () => {
    const clock = createClock();
    const adapter = fetchAdapter(() => ({ refuse: true }), { timers: clock.timers });

    await assert.rejects(adapter('http://mock.toon/'), (error) => error instanceof TypeError && error.message === 'fetch failed' && error.cause.code === 'ECONNREFUSED');
  });
});
