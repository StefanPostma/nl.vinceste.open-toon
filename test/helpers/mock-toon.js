'use strict';

/*
 * Mock Toon (ADR-0013). One stateful handler `(req) -> {status, headers, body, delayMs}` that answers the
 * endpoints of docs/sdlc/00-architect-audit.md section 5, plus two transports for it:
 *  - fetchAdapter(handler, {timers, now}): in-process replacement of globalThis.fetch whose delays run on the
 *    injected (fake) timers and whose server side keeps running after the client aborted;
 *  - startHttpServer(handler): a real node:http server on 127.0.0.1 for the L1 client tests.
 * Both feed one recorder, so a test reads request log, maxConcurrent() and openHandlers() the same way.
 */

const http = require('http');
const { setTimeout: realSleep } = require('timers/promises');
const { toonPayload } = require('./fixtures');

const NEVER_MS = 600000;
const OVERSIZE_CHUNK = 'x'.repeat(65536);
const FAULT_KINDS = ['500', 'timeout', 'refused', 'redirect', 'oversize', 'result-error', 'idle-close'];
const UNPROCESSED_FAULTS = ['500', 'refused', 'redirect', 'result-error'];
const WATER_MODES = ['present', '404', 'html-200', '403', '500', 'old-shape', 'flat-ESP', 'junk', 'slow'];
const PRESET_SETPOINTS = {
  0: '2000', 1: '1850', 2: '1650', 3: '1500',
};
const JSON_HEADERS = { 'content-type': 'text/javascript' };

function createRecorder() {
  const log = [];
  let open = 0;
  let peak = 0;
  return {
    log,
    begin(req, now) {
      const entry = {
        id: log.length + 1,
        method: req.method,
        path: req.path,
        query: Object.fromEntries(req.query),
        headers: { ...req.headers },
        start: now,
        end: null,
        abortedByClient: false,
        status: null,
      };
      log.push(entry);
      open++;
      peak = Math.max(peak, open);
      return entry;
    },
    finish(entry, now, status) {
      entry.end = now;
      entry.status = status;
      open--;
    },
    /** Highest number of handlers that were open at the same time (server-side overlap). */
    maxConcurrent: () => peak,
    /** Handlers that have not finished yet, whether or not their client is still there. */
    openHandlers: () => open,
    reset() {
      log.length = 0;
      open = 0;
      peak = 0;
    },
  };
}

function requestFrom(method, url, headers) {
  return {
    method,
    url,
    path: url.pathname,
    query: url.searchParams,
    headers,
  };
}

function normalizeHeaders(headers) {
  const result = {};
  if (!headers) return result;
  const entries = headers instanceof Headers || Array.isArray(headers) ? [...headers] : Object.entries(headers);
  entries.forEach(([name, value]) => {
    result[String(name).toLowerCase()] = String(value);
  });
  return result;
}

function bodyChunks(description) {
  if (Array.isArray(description.chunks)) return description.chunks;
  const body = description.body === undefined ? '' : description.body;
  return body === '' ? [] : [body];
}

function connectionFailure() {
  const error = new TypeError('fetch failed');
  error.cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1'), { code: 'ECONNREFUSED' });
  return error;
}

/**
 * In-process `fetch` (ADR-0013 contract): real Response objects, delays on the injected timers, honours
 * `signal`, request headers pass through, and the handler keeps running after a client abort.
 * @param {(req: object) => object | Promise<object>} handler
 * @param {{timers: {setTimeout: Function}, now?: () => number, recorder?: object}} options
 */
function fetchAdapter(handler, { timers, now = Date.now, recorder = createRecorder() }) {
  const sleep = (ms) => new Promise((resolve) => {
    timers.setTimeout(resolve, ms);
  });

  async function adaptedFetch(input, init = {}) {
    const source = typeof input === 'object' && input !== null && 'url' in input ? input.url : String(input);
    const url = new URL(source);
    const signal = init.signal || (typeof input === 'object' && input !== null ? input.signal : undefined);
    if (signal && signal.aborted) throw signal.reason;

    const method = (init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
    const entry = recorder.begin(requestFrom(method, url, normalizeHeaders(init.headers)), now());

    return new Promise((resolve, reject) => {
      let clientGone = false;
      let streamController = null;
      let delivered = false;

      const leave = (reason) => {
        if (clientGone) return;
        clientGone = true;
        entry.abortedByClient = true;
        if (!delivered) reject(reason);
        else if (streamController) {
          try {
            streamController.error(reason);
          } catch {
            // the stream is already closed or errored
          }
        }
      };
      if (signal) signal.addEventListener('abort', () => leave(signal.reason), { once: true });

      (async () => {
        const description = await handler(requestFrom(method, url, entry.headers));
        if (description.refuse) {
          recorder.finish(entry, now(), null);
          reject(connectionFailure());
          return;
        }

        const status = description.status === undefined ? 200 : description.status;
        const stream = new ReadableStream({
          start(controller) {
            streamController = controller;
          },
          cancel() {
            clientGone = true;
            entry.abortedByClient = true;
          },
        });

        if (description.delayMs > 0) await sleep(description.delayMs);
        if (!clientGone) {
          delivered = true;
          resolve(new Response(stream, { status, headers: description.headers || {} }));
        }
        const chunks = bodyChunks(description);
        for (let index = 0; index < chunks.length; index++) {
          if (description.chunkDelayMs > 0) await sleep(description.chunkDelayMs);
          if (!clientGone) streamController.enqueue(Buffer.from(chunks[index]));
        }
        if (!clientGone) streamController.close();
        recorder.finish(entry, now(), status);
      })().catch((error) => {
        if (entry.end === null) recorder.finish(entry, now(), null);
        reject(error);
      });
    });
  }

  adaptedFetch.recorder = recorder;
  return adaptedFetch;
}

/**
 * Real HTTP server on 127.0.0.1 (port chosen by the OS) for the same handler.
 * @returns {Promise<{server, port, host, url: string, recorder, close: () => Promise<void>}>}
 */
async function startHttpServer(handler, { recorder = createRecorder() } = {}) {
  const shutdown = new AbortController();
  const sleep = (ms) => realSleep(ms, undefined, { signal: shutdown.signal });

  const busySockets = new WeakSet();
  const closeWhenIdle = (socket, ms) => {
    sleep(ms).then(() => {
      if (!busySockets.has(socket)) socket.destroy();
    }, () => {
      // the server was closed first
    });
  };

  async function serve(nodeReq, res) {
    const url = new URL(nodeReq.url, `http://${nodeReq.headers.host}`);
    const entry = recorder.begin(requestFrom(nodeReq.method, url, { ...nodeReq.headers }), Date.now());
    let clientGone = false;
    let idleCloseMs = 0;
    busySockets.add(nodeReq.socket);
    res.on('close', () => {
      busySockets.delete(nodeReq.socket);
      if (!res.writableFinished) {
        clientGone = true;
        entry.abortedByClient = true;
      }
      if (idleCloseMs > 0) closeWhenIdle(nodeReq.socket, idleCloseMs);
    });

    try {
      const description = await handler(requestFrom(nodeReq.method, url, entry.headers));
      if (description.refuse) {
        recorder.finish(entry, Date.now(), null);
        nodeReq.socket.destroy();
        return;
      }
      const status = description.status === undefined ? 200 : description.status;
      if (description.delayMs > 0) await sleep(description.delayMs);
      if (!clientGone) {
        res.writeHead(status, description.headers || {});
        res.flushHeaders();
      }
      const chunks = bodyChunks(description);
      for (let index = 0; index < chunks.length; index++) {
        if (description.chunkDelayMs > 0) await sleep(description.chunkDelayMs);
        if (!clientGone) res.write(chunks[index]);
      }
      idleCloseMs = description.idleCloseMs || 0;
      if (!clientGone) res.end();
      recorder.finish(entry, Date.now(), status);
    } catch {
      // the server was closed while this handler was still waiting
      if (entry.end === null) recorder.finish(entry, Date.now(), null);
    }
  }

  const server = http.createServer((nodeReq, res) => {
    serve(nodeReq, res).catch(() => nodeReq.socket.destroy());
  });

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();

  return {
    server,
    port,
    host: '127.0.0.1',
    url: `http://127.0.0.1:${port}`,
    recorder,
    async close() {
      shutdown.abort();
      server.closeAllConnections();
      await new Promise((resolve) => {
        server.close(resolve);
      });
    },
  };
}

function buildDevices(layout, tariff) {
  if (layout === 'dev_3') return toonPayload('getdevices-dev3');
  return toonPayload(tariff === 'single' ? 'getdevices-dev2-single-tariff' : 'getdevices-dev2-two-tariff');
}

function json(payload, extra = {}) {
  return {
    status: 200, headers: JSON_HEADERS, body: JSON.stringify(payload), ...extra,
  };
}

function waterResponse(mode, page) {
  switch (mode) {
    case 'present': return json(page);
    case '404': return { status: 404, headers: { 'content-type': 'text/html' }, body: '<html><body>404 Not Found</body></html>' };
    case 'html-200': return { status: 200, headers: { 'content-type': 'text/html' }, body: toonPayload('water-html') };
    case '403': return { status: 403, headers: { 'content-type': 'text/html' }, body: '<html><body>403 Forbidden</body></html>' };
    case '500': return { status: 500, headers: { 'content-type': 'text/html' }, body: 'Internal Server Error' };
    case 'old-shape': return json(toonPayload('water-no-total'));
    case 'flat-ESP': return json(toonPayload('water-esp-flat'));
    case 'junk': return { status: 200, headers: JSON_HEADERS, body: 'not json {{' };
    default: return json(toonPayload('water-ok'), { delayMs: 7000 }); // 'slow': valid but later than the 5 s client timeout
  }
}

/**
 * @param {{layout?: 'dev_2'|'dev_3', tariff?: 'two'|'single', water?: string, vacation?: boolean}} [options]
 */
function createMockToon(options = {}) {
  const recorder = createRecorder();
  const faults = [];
  const toon = {
    recorder,
    state: null,
    mode: {
      layout: options.layout || 'dev_2',
      tariff: options.tariff || 'two',
      water: options.water || 'present',
      vacation: Boolean(options.vacation),
    },
  };

  function rebuild() {
    if (!WATER_MODES.includes(toon.mode.water)) throw new Error(`mock Toon: unknown water mode ${toon.mode.water}`);
    toon.state = {
      thermostat: toon.mode.vacation ? toonPayload('thermostat-states').vacation : toonPayload('thermostat'),
      power: toonPayload('power'),
      devices: buildDevices(toon.mode.layout, toon.mode.tariff),
      waterPage: toonPayload('water-ok'), // what /water.html says in the mode 'present'; a test may change it
    };
  }

  function reset() {
    rebuild();
    faults.length = 0;
    recorder.reset();
  }

  function thermostatAction(query) {
    const { thermostat } = toon.state;
    switch (query.get('action')) {
      case 'getThermostatInfo':
        return json(thermostat);
      case 'setSetpoint': {
        const setpoint = query.get('Setpoint');
        if (!/^\d+$/.test(setpoint)) return json({ result: 'error' });
        thermostat.currentSetpoint = setpoint;
        thermostat.activeState = '-1';
        if (thermostat.programState === '1') thermostat.programState = '2';
        return json({ result: 'ok' });
      }
      case 'changeSchemeState': {
        const state = query.get('state');
        const preset = query.get('temperatureState');
        // UNVERIFIED, and disputed: a Home Assistant integration enters vacation like this (docs/sdlc/03 I4), while the Toon
        // community web app calls programState 8 "locked base" (docs/sdlc/12 section B). The app never sends it; Q-03 settles it.
        if (state === '8' && preset === '4') {
          Object.assign(thermostat, { activeState: '4', programState: '4' });
        } else if (state === '2' && Object.hasOwn(PRESET_SETPOINTS, preset)) {
          Object.assign(thermostat, { activeState: preset, currentSetpoint: PRESET_SETPOINTS[preset] });
          if (thermostat.programState === '1') thermostat.programState = '2';
        } else if (state === '1' || state === '0') {
          thermostat.programState = state;
        } else {
          return json({ result: 'error' });
        }
        return json({ result: 'ok' });
      }
      default:
        return { status: 404, headers: {}, body: 'Not Found' };
    }
  }

  function route(req) {
    const action = req.query.get('action');
    if (req.path === '/happ_thermstat') return thermostatAction(req.query);
    if (req.path === '/happ_pwrusage' && action === 'GetCurrentUsage') return json(toon.state.power);
    if (req.path === '/hdrv_zwave' && action === 'getDevices.json') return json(toon.state.devices);
    if (req.path === '/water.html') return waterResponse(toon.mode.water, toon.state.waterPage);
    return { status: 404, headers: {}, body: 'Not Found' };
  }

  function applyFault(kind, response) {
    switch (kind) {
      case '500': return { status: 500, headers: {}, body: 'Internal Server Error' };
      case 'timeout': return { ...response, delayMs: NEVER_MS };
      case 'refused': return { refuse: true };
      case 'redirect': return { status: 302, headers: { location: 'http://example.invalid/elsewhere' }, body: '' };
      case 'oversize': return {
        status: 200, headers: JSON_HEADERS, chunks: Array(40).fill(OVERSIZE_CHUNK),
      };
      case 'result-error': return json({ result: 'error' });
      case 'idle-close': return { ...response, idleCloseMs: 1000 };
      default: throw new Error(`mock Toon: unknown fault ${kind}`);
    }
  }

  /**
   * The handler both transports call. `toon.latencyMs` is the time every answer takes (a fault keeps its own).
   * A request that fails before the Toon looks at it (500, refused, redirect, result-error) changes nothing in the
   * Toon; a timeout or a huge answer is a Toon that did the work and could not tell.
   */
  toon.latencyMs = 0;
  toon.handler = (req) => {
    const index = faults.findIndex((fault) => fault.matches(req) && fault.remaining > 0);
    const fault = index === -1 ? null : faults[index];
    if (fault) fault.remaining--;
    if (fault && UNPROCESSED_FAULTS.includes(fault.kind)) return applyFault(fault.kind);
    const routed = route(req);
    const response = toon.latencyMs > 0 && routed.delayMs === undefined ? { ...routed, delayMs: toon.latencyMs } : routed;
    return fault ? applyFault(fault.kind, response) : response;
  };

  /**
   * Makes matching requests fail.
   * @param {string} kind one of FAULT_KINDS
   * @param {{path?: string, times?: number}} [filter] restrict to a path; limit the number of requests
   */
  toon.fault = (kind, { path, times = Infinity } = {}) => {
    if (!FAULT_KINDS.includes(kind)) throw new Error(`mock Toon: unknown fault ${kind}`);
    faults.push({ kind, remaining: times, matches: (req) => path === undefined || req.path === path });
  };
  toon.clearFaults = () => {
    faults.length = 0;
  };

  /** Rebuilds the state for another layout, tariff or water mode; faults and the request log are kept. */
  toon.configure = (changes) => {
    Object.assign(toon.mode, changes);
    rebuild();
  };
  /** Back to the initial state with no faults and an empty request log. */
  toon.reset = reset;

  toon.requests = () => recorder.log;
  toon.requestsTo = (path) => recorder.log.filter((entry) => entry.path === path);
  toon.maxConcurrent = recorder.maxConcurrent;
  toon.openHandlers = recorder.openHandlers;

  /** `fetch` for the device or the client, driven by `clock` (a fake clock). */
  toon.fetchWith = (clock) => fetchAdapter(toon.handler, { timers: clock, now: clock.now, recorder });
  toon.listen = () => startHttpServer(toon.handler, { recorder });

  reset();
  return toon;
}

module.exports = {
  createMockToon, fetchAdapter, startHttpServer, createRecorder, FAULT_KINDS, WATER_MODES,
};
