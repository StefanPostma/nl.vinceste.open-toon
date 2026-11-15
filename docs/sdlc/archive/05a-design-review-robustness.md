# 05a - Independent design review: robustness, security, testability

| | |
|---|---|
| Role | Independent design reviewer (lens: robustness, security, testability) |
| Date | 2026-11-12 |
| Reviewed | `docs/sdlc/05-architecture.md`, `docs/adr/0001..0016`, against `docs/sdlc/00..04` and the baseline code at `5cc3b90` |
| Not reviewed | Product scope, naming, UX wording, licensing (other lenses) |
| Verdict | **No blocker.** The design is sound in its skeleton (single writer, generation guards, marker-gated migration, offline test tiers). Eight majors are real defects or unmet requirements that the implementation slice must settle before coding the poller/lane; sixteen minors are specification gaps that will otherwise be decided ad hoc by whoever writes the code. |

**What I verified myself (not taken from 00-04).** (a) Baseline code claims that findings below rest on: `device.js:243` (optimistic `setCapabilityValue` before the HTTP call), `device.js:381,395` (`.hasOwnProperty` on a payload node), `device.js:488-491` (`super.onDeleted()`), `device.js:573-586` (global `setTimeout` in `debounce`). (b) On the dev machine (Node **25.9**, not 22; CI must repeat): `fetch(url, {redirect:'manual'})` returns the 302 itself with `type: 'basic'`; a dependent signal from `AbortSignal.any([...])` aborts an in-flight `fetch` and the abort reason is the rejection; `JSON.parse(await res.text())` works for `Content-Type: text/javascript`. (c) `eslint-config-athom@4.0.2` declares `typescript ^6.0.3` as a regular dependency (npm registry, 2026-11-12), so ADR-0012's `tsconfig.eslint.json` approach does not need `devDependencies.typescript` and the type-aware rules will run. (d) The back-off arithmetic of ADR-0005 (finding R-07) by hand. Nothing was verified on a Toon or a Homey; items that only hardware can settle are listed in section 4.

Severity: **blocker** = design cannot work or breaks existing users; **major** = likely defect or a MUST/contract requirement unmet; **minor** = specification gap or hygiene item with a cheap fix.

---

## 1. Majors

### R-01 (major) Write-preempts-poll aborts only the client side; the Toon still runs the aborted GET, so "never two concurrent requests to one Toon" is unmet and unobservable

*Where:* `05-architecture.md` §5 "Lane" and "Cycle" (claims NFR-03 AC1 "strictly sequential ... never two concurrent requests to one Toon" in the same section that aborts an in-flight poll GET to run a write); ADR-0005 "Lane"; `01-requirements.md` NFR-03 AC1.

*Problem.* `AbortController.abort()` closes the Homey-side socket. The Toon's `lighttpd` -> `happ_*` daemon has already received the request and keeps executing it (the Toon is the slow party in the scenarios where preemption matters, 03 T6, HW-10). The write is then sent immediately, so the Toon has two requests in progress. NFR-03 AC1 is therefore not met by the mechanism that §5 says meets it. Worse for testability: the proposed in-process `fetchAdapter` drops the handler on abort, so the L2 "request log" would show one request at a time and the test passes vacuously.

*Fix (pick one and record it in ADR-0005).* **(a)** Do not abort: a write waits for the in-flight GET (bounded by the 5 s client timeout), the cycle skips its remaining groups, the write runs. Worst case for NFR-08 AC2 becomes 5 s wait + 5 s write; either lower the poll GET timeout to 3 s or amend NFR-08 AC2 to "<= 10 s under a pending poll timeout". **(b)** Keep client-side abort but amend NFR-03 AC1 to "the app waits on at most one request; at most one abandoned request may still be completing on the Toon", and make the mock Toon count *server-side* concurrent handlers (the handler keeps running after a client disconnect and records its end time) so the exception is measured, not assumed. I recommend (b), plus a rule that a request is pre-emptable only while it is younger than 1 s (after that the Toon is probably already working on it and the saving is nil). *Test:* L2 scenario "slow poll in flight + write" asserts the server-side concurrency counter and the write latency; L1 real-socket variant confirms the abandoned connection is closed on the Homey side. *HW:* HW-10 should include "write during slow `getDevices.json`" and record Toon UI responsiveness.

### R-02 (major) A cycle keeps calling the power and meters endpoints after the thermostat group failed with a transport error

*Where:* `05-architecture.md` §5 "Cycle" ("Each group has its own try/catch; one failure never skips the others (FR-80 AC4)"); ADR-0005.

*Problem.* FR-80 AC4 is about one *endpoint* failing (HTTP 500, bad body). When the critical group fails with `timeout`/`network` (unroutable address, Toon rebooting), the host is down; continuing costs 3 x 5 s = 15 s (20 s with water) per cycle, during which the lane is held, Toon-side timeouts triple, every `update_*` card and every `onSettings` probe queued behind the cycle waits up to 20 s + its own 5 s (NFR-08 AC2 says 6 s), and the "request rate decreases" claim of NFR-03 AC2 is weakened (3-4 requests per back-off step instead of 1).

*Fix.* In the cycle: if the critical group fails with kind `timeout | network` (not `http`, `bad_body`, `toon_error`, `redirect`, `too_large`), end the cycle after that group. Keep per-group isolation for the other kinds. State this in ADR-0005 under "Cycle". *Test:* fake-clock scenario "Toon unreachable for 10 min" asserts exactly one request per cycle, back-off applied, availability after the 3rd cycle; "meters endpoint returns 500" still asserts thermostat and power applied (FR-80 AC4).

### R-03 (major) The `onSettings` probe runs inside the lane with no stated priority, so a settings save can block for the length of a cycle

*Where:* `05-architecture.md` §6.5 "Off -> On" step 3 ("probe(client) ... <= 5 s, inside the lane"); "Toggle during an address change"; ADR-0006 item 5.

*Problem.* The lane serves `poll`, `refresh`, `write`. A probe of kind `refresh` (or unspecified) queues behind the in-flight cycle. With a slow Toon 1 or an unreachable one (R-02) that is 15-20 s, plus the probe's own 5 s: the save dialog spins for ~25 s, exactly in the FR-52 AC3 case ("device is currently unavailable when the user ticks the box"). Whether Homey's settings UI times out the `onSettings` promise is unknown.

*Fix.* Run the enable/address-change probe with `kind: 'write'` (pre-empting under whatever rule R-01 settles) and a 5 s budget so `onSettings` settles within ~6 s regardless of lane state; if the probe is aborted by a later task, classify as `unreachable` rather than waiting. Record an `onSettings` total budget (<= 6 s) in ADR-0006. *Test:* L2 "slow poll in flight + save with toggle" asserts `onSettings` resolves within 6 s of fake time and the status/message are the FR-59 texts. *HW:* HW-13 records whether the Homey UI shows a spinner/timeout for long saves.

### R-04 (major) The optimistic `setCapabilityValue('target_temperature')` inside the capability listener contradicts the single-writer rule and fights Homey's own listener semantics

*Where:* `05-architecture.md` §5 "Writes" ("optimistic `setCapabilityValue` (B-5)"); §8 ("`applyValues` ... the single setCapabilityValue writer"); `04-compat-contract.md` B-5 (derived from `device.js:243`); NFR-01 AC2.

*Problem.* (1) It is a second `setCapabilityValue` door, so NFR-01 AC2 ("every `setCapabilityValue` goes through one helper") is violated by design. (2) In SDK v3 the capability value is set by Homey when the listener's promise resolves and left unchanged when it rejects; an explicit optimistic write stores the unconfirmed value *before* the result is known, so a failed write against an unreachable Toon leaves the wrong setpoint on the tile until the Toon returns (the "immediate thermostat refresh" of §5 also fails then). (3) The optimistic value produces a `Change`, so Homey's system `target_temperature_changed` fires on the unconfirmed value and again on the correction (contradicts FR-70 "fire on real changes"). B-5 documents what the baseline did, not what users depend on; nobody can observe "optimistic" except as a flicker.

*Fix.* Drop the optimistic write (amend B-5 by ADR; the baseline wrote it because `request-promise-native` had no timeout, `device.js:243`). If a visual response before the Toon answers is wanted, route it through `applyValues` with `{silent: true}` (no `Change`), and restore `prev` in the rejection path. *Test:* L2 "write fails" asserts the stored value equals the Toon's value after the refresh and that no `target_temperature` change was emitted for the failed write. *HW:* HW-03/HW-13 confirm Homey's revert-on-reject on the tile (the fake models the documented reading).

### R-05 (major) The monotonic meter guard stalls a capability forever after a legitimate counter decrease

*Where:* `05-architecture.md` §14 ("a drop to 0 or a decrease from a failed/partial payload is ignored, B-8"); ADR-0014 "Precision"; `04` B-8.

*Problem.* B-8 asks that a *failed or partial payload* never decreases a counter. The design generalises this to "any decrease is ignored". Real decreases happen: smart-meter replacement (new meter starts near 0), P1/M-Bus adapter re-pair on the Toon, a user who presets the ToonWater total (`/setnew`, 03 §5.5), a Toon factory reset. After any of these, `meter_power.*`/`meter_gas`/`meter_water.total` never update again, with no warning, no log line, and Homey Energy silently flat-lines.

*Fix.* Reject `0`, non-finite and `"NaN"` unconditionally (that is the B-8 case). Hold back a decrease until the same lower-or-equal reading is confirmed by N = 3 consecutive cycles, then accept it and log one info line ("meter counter decreased; accepting new baseline"). Document in the README that Homey Energy will show one odd interval. *Test:* L0 table with sequences `[100, 99]` (held), `[100, 99, 99, 99]` (accepted), `[100, "NaN", 100]` (ignored), `[100, 0, 0, 0]` (ignored). *HW:* none needed.

### R-06 (major) Teardown "drops the lane" and does not define what happens to queued work, aborted writes or in-progress `onSettings`

*Where:* `05-architecture.md` §5 "Cleanup" ("drop the lane"), "Guards" (`aborted` "is never logged, counted or shown"); §6.5; ADR-0005 "Cleanup".

*Problem.* (1) Tasks waiting in the lane or the serial queue when the device is deleted (a Flow action, an `update_*` card, an `onSettings`) are never settled: a Flow hangs until Homey's own timeout, if any. (2) A write aborted by `gen++` (address change or teardown) rejects with `aborted`, which "is never shown": the Flow or tile call gets no defined outcome. (3) The toggle sequence in the serial queue does not re-check `_stopped` between `addCapability`/`removeCapability`/`setSettings` steps; on a deleted device these throw.

*Fix.* `_teardown()` rejects every queued lane/serial task with `ToonError('aborted')`; `toUserMessage` maps `aborted` to a localized "The request was cancelled because the device was removed or its address changed" (so NFR-16 holds; "never shown" applies to poll results only). Every multi-step serial task checks `_stopped` before each Homey call. *Test:* L2 "delete while a card is queued" asserts the card promise settles (rejected, localized) in the same tick as `onDeleted` and the harness counts zero unhandled rejections; "address change mid-write" asserts the write rejects with the `aborted` text and the next cycle uses the new host.

### R-07 (minor) Back-off shortens the interval for `poll_interval` > 300 s

*Where:* `05-architecture.md` §5 "Interval and back-off"; ADR-0005 "Back-off": `min(interval * 2^(n-2), 300 s)`.

*Problem.* For `interval = 3600 s` and `n >= 3` the delay becomes 300 s: the request rate *increases* 12x while the Toon is down, violating NFR-03 AC2 ("never increases").

*Fix.* `delay = min(interval * 2^(n-2), max(300e3, interval))`. *Test:* L0 `backoffMs` table including `interval = 3600`.

### R-08 (major) The in-process `fetchAdapter` is under-specified; as described, the abort, timeout, preemption and teardown scenarios pass vacuously or need real time

*Where:* `05-architecture.md` §13 L2 doubles ("`fetchAdapter(handler)` returns real `Response` objects in-process"; handler `(req) -> {status, headers, body, delayMs}`); ADR-0013.

*Problem.* Nothing says that the adapter (a) honours `signal` (rejects with an `AbortError` while waiting for `delayMs` and while the body is being streamed), (b) schedules `delayMs` on the *injected fake clock* rather than a real timer, or (c) keeps the handler "running" after a client abort so server-side overlap can be counted (R-01). Without (a) the `aborted` paths of the lane, the `gen`/`featureGen` drop logic and FR-84 AC2 are never exercised; without (b) "slow"/"timeout" scenarios either take real seconds (candidate C's "150 ms real timeouts" compromise) or cannot run under the fake clock; without (c) NFR-03 AC1 is untestable.

*Fix.* Specify the adapter contract in ADR-0013: `fetchAdapter(handler, {timers})`; delay via `timers.setTimeout`; `signal.addEventListener('abort')` rejects the pending promise and cancels the `ReadableStream` of a partially delivered body; the mock records `{start, end, abortedByClient}` per request and exposes `maxConcurrent()`. Add an L1 real-socket test for the same three behaviours so the adapter is proven equivalent to `node:http` on them. *Test:* adapter self-test file.

### R-15 (major) Lane fairness and refresh coalescing are not specified; B-3 (coalesce concurrent fetches per endpoint) is unmet as written

*Where:* `05-architecture.md` §5 "Lane" ("Refresh requests ... queue behind the in-flight cycle and run a targeted cycle for their groups"); `04` B-3; NFR-03 AC1/AC3; FR-74 AC3.

*Problem.* (1) Users were told to build timer Flows around `update_*` (#5, #25) and those Flows still exist after the upgrade; N cards firing together (several Flows, or the same card for several devices on one Toon) each queue a full targeted cycle, so the Toon receives N x requests per burst on top of the native poller: the contract item B-3 exists precisely for this. (2) With preemption, a steady stream of writes (a Flow that sets `temperature_state` every few seconds, two slider drags) aborts every poll before it completes; `refreshSoon(['thermostat'])` keeps the thermostat fresh but power/meters never complete and the availability state machine is starved. The text does not say whether an aborted cycle resets or leaves the consecutive-failure counter.

*Fix.* (1) The lane keeps at most one *pending* refresh per group; a new refresh request joins the pending one and resolves with its result (fresh fetch preserved, B-1). (2) A cycle that has already been pre-empted once in the same interval runs to completion (non-pre-emptable), or use the "pre-emptable only while younger than 1 s" rule of R-01. State explicitly: an aborted cycle neither increments nor resets the failure counter. *Test:* L2 "10 Flows fire `update_status` at once" asserts 1 targeted cycle; "a write every 2 s for 5 min" asserts power/meters still refresh at least once per 2 intervals and that availability still flips when the Toon goes down during the write storm.

---

## 2. Minors

### R-09 (minor) Timer-callback and background-promise hygiene is not spelled out; `no-floating-promises` does not cover it

*Where:* `05-architecture.md` §5 "Scheduler", §6.3 (status written "after `onSettings` has returned"), §6.6 (`createNotification`), §12 lint.

*Problem.* `homey.setTimeout(() => this._cycle(), ms)` is an arrow *returning* a promise, which the lint rule does not flag; a rejecting `_cycle` becomes an unhandled rejection. Same for the deferred status `setSettings`, `createNotification`, `setWarning`/`unsetWarning`, `setAvailable`/`setUnavailable`.

*Fix.* Rule in ADR-0005/0013: every entry point invoked by a timer or by Homey (`_cycle`, `refreshSoon`, deferred status write, notification, warning updates) is `async`, has a top-level `try/catch` that logs, and never rejects. Add a static grep (L3) that every `homey.setTimeout(` callback calls a method whose name is on an allow-list of "never-rejects" functions. The harness counters (NFR-01 AC1) remain the executable proof.

### R-10 (minor) Client resource hygiene: response bodies on error paths, the timeout timer, and `AbortSignal.any` with a long-lived epoch signal

*Where:* `05-architecture.md` §4; ADR-0003.

*Problem.* (1) On 3xx, non-2xx, `too_large` and `bad_body` paths the `Response` body must be cancelled or drained, or `undici` keeps the socket reserved; a Toon that answers HTTP 500 on `getDevices.json` for hours (plausible without a P1 adapter) would leak one socket per cycle. (2) The timeout timer must be cleared in `finally` (with real timers it keeps the event loop alive; with Homey-bound timers it accumulates handles). (3) `AbortSignal.any([epoch.signal, timeoutCtrl.signal])` registers a dependent signal on the long-lived epoch signal for every request; whether Node 22 releases it promptly is version-dependent and **not verified here**.

*Fix.* Specify in ADR-0003: `await res.body?.cancel()` on every non-success path; `clearTimeout` in `finally`; prefer a per-request `AbortController` that the lane aborts explicitly on epoch change (listener added and removed around the request) over `AbortSignal.any` with the epoch signal, or prove the latter in the NFR-12 scenario. *Test:* L1 real-socket test asserts `server.getConnections()` returns to <= 1 after 50 error responses and that `process.getActiveResourcesInfo()` is stable; L2 1,000-cycle scenario asserts the epoch signal's listener count does not grow (`getEventListeners(signal, 'abort')`).

### R-11 (minor) Address and pairing-handler input validation: `normalizeAddress` must never throw; non-string inputs; IPv6; `https://`

*Where:* `05-architecture.md` §4 (URL builder), §7 (handlers), `lib/toon/address.js`; FR-03.

*Problem.* `new URL('http://192.168.1.50:99999')` and `new URL('http://fe80::1')` throw; the pair view can send `address`, `id`, `name` as non-strings (`id.trim()` throws on a number). FR-03 lists neither IPv6 literals nor `https://`. The readings panel must not use `innerHTML` for Toon-supplied strings.

*Fix.* `normalizeAddress(input)` coerces non-strings to `{ok:false, reason:'invalid'}`, wraps `new URL` in `try/catch`, then requires `username === ''`, `pathname === '/'`, `search === ''`, `hash === ''`, protocol `http:`; accept bracketed IPv6 (`[fe80::1]`) or reject it explicitly with its own message; `https://` -> reject with "the Toon speaks plain http". Handlers validate `typeof` of every field before use. Pair view writes readings with `textContent`. *Test:* L0 table adds `[fe80::1]`, `fe80::1`, `https://1.2.3.4`, `12`, `null`, `{}`; L2 pairing sends a numeric `id`.

### R-12 (minor) Payload hygiene: never call methods on payload objects; add hostile-shape fixtures

*Where:* `05-architecture.md` §13 L0 edge set; `lib/toon/parse.js`, `meters.js`; FR-24 AC1.

*Problem.* The baseline's `payload['dev_2.4'].hasOwnProperty(...)` (`device.js:381,395`) throws on `null` and on `{"hasOwnProperty": 1}`; `JSON.parse` happily yields a `__proto__` own property that `Object.assign` would merge into app objects.

*Fix.* Parsers use `Object.hasOwn`, `typeof x === 'object' && x !== null`, and never `Object.assign`/spread a payload into a long-lived object. Add to the FR-24 matrix: `{"dev_2.4": null}`, `{"dev_2.4": {"hasOwnProperty": 1}}`, `{"__proto__": {"polluted": 1}}`, `{"water": []}`, `{"powerUsage": "460"}`.

### R-13 (minor) Status/label writes race with the user's save and are persistent DB writes

*Where:* `05-architecture.md` §6.3 (status "on transition only, after `onSettings` has returned"), FR-85 (`last_update` every <= 5 min).

*Problem.* (1) A poll cycle finishing while a save is in progress calls `setSettings({toonwater_status})`; Homey then persists the user's `newSettings` snapshot, which still holds the old status: whether Homey merges or overwrites is unknown. (2) The "after `onSettings` has returned" write needs a deferred timer and a `_stopped` guard (the device may be deleted in between). (3) Every `setSettings` is a database write; `last_update` every 5 min x devices is ~300 writes/day/device on Homey Pro 2016-2019 (SD card).

*Fix.* Re-assert the computed status once via `this.homey.setTimeout(0)` after `onSettings` resolves, guarded by `_stopped`; write `last_update` at most every 15 min and `last_problem` only on transition; tag the merge/overwrite question HW-13. *Test:* L2 "status transition during save" with the fake modelling "Homey persists `newSettings` after resolve".

### R-14 (minor) The FR-62 24 h window is not persisted, so restarts reset it

*Where:* `05-architecture.md` §6.6 "FR-62 hint" (`store.waterHintSent` only).

*Fix.* Persist `store.waterFirst404At` on the first 404 of a migration-enabled device; clear it on any valid payload; the hint fires when `now - waterFirst404At >= 24 h` across restarts. *Test:* L2 fake clock with a restart (new device instance over the same fake store) at 12 h.

### R-16 (minor) Missing-address handling uses two mechanisms and does not say that a later valid address starts the poller

*Where:* `05-architecture.md` §6.3 (`computeWarning` ranks `address_missing`) vs §9 (`0.0.0.0` -> `setUnavailable(__('address_missing'))`, no poller); §6.5 "Toggle during an address change" (`gen++`, new client) says nothing about starting a poller that was never started.

*Fix.* One mechanism: `setUnavailable(address_missing)` and no warning (unavailable already blocks the tile). `planSettingsChange` returns `startPoller: true` when the old address was invalid and the new one is valid; the poller's first success calls `setAvailable()`. *Test:* L2 "legacy `0.0.0.0` device, then save a valid address" asserts requests start within one interval and the device becomes available.

### R-17 (minor) The availability threshold is a cycle count, so it depends on `poll_interval`

*Where:* `05-architecture.md` §5 "Availability" (3rd consecutive failed cycle).

*Problem.* At 10 s a 30 s hiccup marks the device unavailable (Flows on "device unavailable" fire); at 3600 s the device stays "available" for three hours while down.

*Fix.* Unavailable when `failures >= 3 && now - firstFailureAt >= 90 s`; one constant each, tuned in HW-10. *Test:* L0 availability step table over intervals 10/30/3600.

### R-18 (minor) `target_temperature` rounded to 0.1 may be off the capability's 0.5 step

*Where:* `05-architecture.md` §15 FR-10 ("`parseThermostat` /100, round 0.1"); `driver.compose.json` `target_temperature` step 0.5 (baseline `app.json:111-115`).

*Problem.* A Toon accepts setpoints such as 1975 from other clients (03 I3 live read-back). Whether `setCapabilityValue` rejects a value off the declared `step` is not documented; a rejection would be swallowed by the single writer and the setpoint would never update.

*Fix.* Round `target_temperature` to the capability step (0.5) in `parseThermostat`, keep `measure_temperature` at 0.1; the strict fake rejects off-step values so the test fails if the rounding is dropped. Tag HW-03. *Test:* L0 `currentSetpoint "1975"` -> 20.0 (or 19.5 by a documented rule).

### R-19 (minor) Two devices on one Toon give two concurrent requests at the Toon; the hardware plan recommends exactly that setup

*Where:* `05-architecture.md` §5 (rejects B's `ClientPool`: "two devices on one Toon is a test-only pattern"); `04-compat-contract.md` §10.2 ("pair extra devices ... same Toon IP"); NFR-03 AC3.

*Fix.* Accept and document: NFR-03 AC3 holds per device; the README warns against two devices on one Toon; the hardware plan measures HW-10 with the fixture-device pattern and notes the doubled load. No code change proposed.

### R-20 (minor) The NFR-12 "memory does not grow" assertion is flaky in CI as a heap-byte check

*Where:* `05-architecture.md` §13 L2 ("1,000 cycles with random faults", NFR-12).

*Fix.* Assert counts instead of bytes: exactly one armed timer per device (fake clock queue length), epoch signal listeners <= 1, lane queue length 0, mock open handlers 0, `process.getActiveResourcesInfo()` unchanged; run a heap check only under `--expose-gc` as a non-blocking job.

### R-21 (minor) The layering/network-spy grep covers `globalThis.fetch` only

*Where:* `05-architecture.md` §2 rules and §13 L3 ("only `driver.js` touches `globalThis.fetch`").

*Fix.* The L3 grep also forbids `require(` of `http`, `https`, `net`, `dns`, `undici`, `child_process`, `dgram`, `tls` (and their `node:` forms) anywhere under `lib/**` and `drivers/**`, so NFR-15 is enforced for every outbound path, not just `fetch`.

### R-22 (minor) `createNotification` permission and failure handling are not stated

*Where:* `05-architecture.md` §6.6 (`this.homey.notifications.createNotification`), §3 (`permissions: []`).

*Fix.* Confirm in the validator run (L4) that notifications need no manifest permission in SDK v3 (02 HS-19 does not cover it); if one is needed, add it by ADR; in all cases `.catch(this.error)` and do not set `store.waterHintSent` when the call fails (so the hint is retried next day). *Test:* L2 with a fake that rejects `createNotification` once.

### R-23 (minor) A Toon whose web server answers 200 + HTML for unknown paths would misclassify a missing add-on

*Where:* `05-architecture.md` §6.6 (404 = `not_found`, other 200 = `unexpected`); 03 T8 (M confidence).

*Fix.* Add mock water mode `html-200` so the classification, the 5 min back-off and the "Unexpected response" text are pinned; HW-07 records the real status; if hardware shows 200+HTML, treat `unexpected` with `text/html` as `not_found` by a one-line change in `probe`. *Test:* L2 water mode `html-200`.

### R-24 (minor) `onSettings` ordering: `oldSettings` is not needed, but `changedKeys` should gate the work

*Where:* `05-architecture.md` §6.5 (`planSettingsChange(oldSettings, newSettings)`).

*Problem.* Comparing full objects re-runs the address path when Homey reports an unchanged `address` with different whitespace or type (number vs string for `poll_interval`), and the status `label` keys appear in `newSettings`.

*Fix.* `planSettingsChange(newSettings, changedKeys)`: act only on keys in `changedKeys`, normalise before comparing. *Test:* L0 table: `changedKeys: ['poll_interval']` with an unchanged address does not bump `gen`.

---

## 3. Items checked and found sound (no action)

* Marker-gated migration (ADR-0010) is idempotent under a crash between M-2 and M-6 and self-consistent with a user toggle performed before the marker is written (re-deriving `legacyIf` from the capability list gives the same answer).
* Pairing with Homey ignoring the `capabilities`/`store` overrides (U) degrades safely: `reconcile` adds the trio when the setting says so, and a device without the marker falls back to `legacyIf`, which agrees with the ticked box.
* `featureGen++` *before* `removeCapability` (§6.5 On -> Off) plus the strict fake rejecting writes to a removed capability makes FR-53 AC3 a real test.
* `newSettings`-only `onSettings`, `setSettings` not calling `onSettings`, validation thrown before any side effect, serial queue for toggles: correct ordering.
* `JSON.parse(text)` instead of `res.json()`, `redirect: 'manual'`, URL built with `new URL` + `searchParams`, 2 MiB cap, no retries in the client: correct for the LAN threat model (NFR-04 AC1-3). The remaining LAN risk (unauthenticated Toon, any LAN host can command it) is inherent and is already slated for the README.
* `eslint-config-athom@4.0.2` brings `typescript` itself, so ADR-0012 does not have to add `devDependencies.typescript` and does not trip the CLI's TypeScript-mode detection.

---

## 4. What cannot be verified against mocks (feeds the hardware test plan)

| Item | Why a mock cannot settle it | HW id |
|---|---|---|
| Homey's behaviour when a capability listener rejects (does the tile revert?) - R-04 | The fake implements the documented reading | HW-03 / HW-13 |
| Whether the settings UI times out a long `onSettings` - R-03 | UI behaviour | HW-13 |
| `setSettings` from the poller during a user save: merge or overwrite - R-13 | Undocumented | HW-13 |
| Whether the Toon suffers from an aborted GET overlapping a write - R-01 | Only the Toon shows its own responsiveness | HW-10 (add "write during slow `getDevices.json`") |
| HTTP status for a missing `/water.html` (404 vs 200+HTML) - R-23 | Server configuration of the real Toon | HW-07 |
| Off-step `target_temperature` values accepted by `setCapabilityValue` - R-18 | Undocumented | HW-03 |
| `createNotification` permission - R-22 | Validator run (L4) settles the manifest part; runtime part needs a Homey | L4 + HW-13 |
| `AbortSignal.any` dependent-signal release on Node 22 - R-10 | Node-version behaviour; dev machine is Node 25 | CI on Node 22 (NFR-12 scenario), not hardware |
| Everything already tagged **[HW]** in `05-architecture.md` §17 | - | as listed there |

Everything else in this review is testable with the L0-L3 layers of ADR-0013 once R-08 is applied; each finding above names the test that proves the fix.
