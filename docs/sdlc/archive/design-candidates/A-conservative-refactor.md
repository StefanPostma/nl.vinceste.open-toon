# Design candidate A - conservative refactor (in place, smallest sufficient diff)

Role: software architect, candidate A. Date 2026-11-12. Base `5cc3b90`, branch `redesign/sdk3`. Inputs: docs `00`-`04`, the code (`device.js`, `driver.js`, `pair/start.html`, `app.json`).
Notation: FR/NFR ids = `01-requirements.md`; `U*`, `HW-*`, `R-*`, `CD-*` = `04-compat-contract.md`; `HS-*` = `02-homey-standards.md`. "Unverified" = needs a Homey or a Toon.

**Stance.** Keep `app.js`, `driver.js`, `device.js`, `pair/start.html` and a flat hand-maintained `app.json`; rewrite their insides; add four small pure modules under `lib/`. No runtime dependency. Every existing id (capabilities, cards, args, driver, `data.id`, `address`) is untouched; additions are additive; some cards get `deprecated: true`.

## 1. Layout

```
app.js                      ~10 lines: class ToonApp extends Homey.App { onInit(){ this.log('started') } }  (homey-log removed)
app.json                    flat, hand-edited (no .homeycompose)
lib/toon-client.js          ToonClient (transport + endpoint methods) + ToonError. The ONLY file containing '/water.html'
lib/parse.js                pure: parseThermostat, parseUsage, parseMeters, parseWater -> { values:{capId:number|string|bool}, diag }
lib/address.js              pure: normaliseAddress(str) -> { ok:true, host } | { ok:false, reason }
lib/caps.js                 pure: ALWAYS[], WATER[], STATE_IDS, BURNER_IDS, planCapabilities(), legacyToonwater(), schemeRequests(), nextDelayMs(), waterRetryMs()
drivers/open-toon/driver.js onInit (cards, trigger cards), onPair(session), fireTrigger()
drivers/open-toon/device.js extends Homey.Device: lifecycle, poll loop, writes, ToonWater toggle
drivers/open-toon/pair/start.html  vanilla JS + Homey Style Library
locales/{en,nl}.json        cleaned; new keys error.*, toonwater.*, pair.*, settings.*
test/                       mock-toon.js, fake-homey/, fixtures/, *.test.js   (excluded by .homeyignore)
```
Deleted: `homey-wifidriver`/`homey-log`/`request-promise-native` use, `mapDeviceClass` (driver.js:69-71), `debounce` (device.js:569-586), `webAPI*` handlers (device.js:526-554), committed `node_modules` (untracked; NFR-13).

## 2. Device lifecycle

1. **`onInit`** (never awaits the network; NFR-08): set `_s = {stopped:false, gen:0, failures:0, waterEpoch:0, writeSeq:0, waterNextAt:0}` -> `await this._serial(() => this._migrate())` -> register the two capability listeners (kept, C-CAP-5) -> `unsetWarning().catch()` (warnings persist across restarts) -> validate address (`0.0.0.0`/invalid: `setUnavailable(__('error.address_not_set'))`, no polling, FR-03 AC3) -> `_schedule(1000)` -> return.
2. **`_migrate()`** (offline, idempotent, serialised through one promise chain `_serial` that also guards `onSettings`, FR-52 AC4):
   `legacy = getStoreValue('migrationVersion') == null`; if legacy, `setSettings({toonwater_enabled: legacyToonwater(getCapabilities())})` (any of the 3 water caps present -> true, none -> false; never from the setting default: R-05; `setSettings` does not call `onSettings`). Then `{add} = planCapabilities({existing, toonwater: getSetting('toonwater_enabled') === true})` = `ALWAYS (+WATER if enabled)` minus existing; `addCapability` each, then `setCapabilityOptions(id, CAP_OPTIONS[id])` (U2, C-CAP-4). **Never removes** (M-5; era-0 `meter_power` stays). Write `migrationVersion = 2` last; on error log + continue + no marker (retry next start); the device never goes unavailable because of migration (M-6). Steady state calls no `addCapability` (FR-111 AC2). New pairs arrive with the marker from the pair view.
3. **Poll loop**: self-rescheduling `this.homey.setTimeout` chain, one in-flight cycle (`_s.inflight` promise; "Update" cards join it, FR-74 AC3). A cycle is **strictly sequential**, one request at a time (NFR-03): `thermostat` (core) -> `usage` -> `meters` -> `water` (only if `_waterOn()` and `now >= waterNextAt`). Each part has its own try/catch; a part's failure never skips the others (FR-80 AC4). Parsed `values` go through one `_applyValues(values, gen, epochs)`.
   - Interval = `clamp(Number(getSetting('poll_interval')) || 30, 10, 3600)` s (FR-83/112). After a failed core call: `nextDelayMs(interval, failures)` = interval, then doubling to a 300 s cap; reset on success.
   - **Availability** (FR-81): core = thermostat only. `failures >= 3` -> `setUnavailable(__('offline'))`; first success -> `setAvailable()`; polling continues while unavailable; values never cleared (AC4). Usage/meters/water failures only log once per transition (NFR-09).
   - Stale-response guards: `gen` (bumped on address change/teardown), `waterEpoch` (bumped on every ToonWater toggle), `writeSeq` (a thermostat response requested before a write is dropped, FR-16 AC3). A response whose guard changed is discarded silently (FR-53 AC3, FR-82 AC2, FR-84 AC2).
4. **`_setCap(id, v)`** is the only writer: skip if `!hasCapability(id)`, `v` undefined/non-finite, or equal; counters (`meter_gas`, `meter_power.*`, `meter_water.total`) ignore a drop to 0 (B-8); `await setCapabilityValue(...).catch(this.error)` (NFR-01 AC2); returns whether it changed and the old value, which feeds trigger firing (section 6).
5. **`onSettings({newSettings, changedKeys})`**: validate first, throw a localized `Error` to reject (address via `normaliseAddress`, `poll_interval` 10..3600; HW-13 confirms the save is rejected). Then inside `_serial`: address -> `gen++`, abort in-flight, new client, `failures=0`, `waterNextAt=0`, `_schedule(1000)`; interval -> reschedule; `toonwater_enabled` -> section 4. Return the localized result string (shown to the user).
6. **`onUninit` / `onDeleted`** both call idempotent `_teardown()`: `stopped=true`, `clearTimeout`, abort the controller; `onDeleted` also `unsetWarning().catch()`. No `super.onDeleted()` dependence (baseline throws, device.js:488-491).
7. **Writes**: `target_temperature` listener: round to 0.5, range 6..30, optimistic `setCapabilityValue` (B-5), **latest-wins slot** (at most one request in flight, one pending: a slider drag sends <= 2 requests, FR-16 AC1); value sent as `Math.round(t*100)` (integer, FR-11 AC1). After any successful write `writeSeq++` and `_schedule(1500)` (FR-16 AC2). Failure rejects with a localized message and schedules an immediate refresh (FR-11 AC3).
8. **`setTemperatureState(id, resume)`**: `schemeRequests(stateId, resume)` is the single table that hardware will settle (HW-04): `resume` -> `[changeSchemeState state=2&temperatureState=id]` (= baseline, device.js:209); `no` -> `[state=0&temperatureState=id]` (form used by a long-running third-party integration for "program off + preset", 03 section 4.3 I4: M confidence). `undefined` = `yes` (R-18). `vacation` is read-only (rejects). Enum is validated before any request (NFR-04 AC4).

## 3. HTTP client and error model

`new ToonClient({ host, fetch = globalThis.fetch, timeoutMs = 5000, maxBytes = 2 MiB })`. URL built with `new URL('http://'+host)` + `url.pathname` + `URLSearchParams`, never string concatenation (NFR-04 AC1). One request path `_get(path, query, {signal})`:
`fetch(url, {redirect:'manual', headers:{'Accept-Encoding':'identity'}, signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ownerSignal])})`; status 3xx -> `REDIRECT`; stream the body with a byte counter (abort > cap -> `TOO_LARGE`); decode text; `JSON.parse` (the Toon serves `text/javascript`, so never trust `res.json()`'s content-type handling); must be a plain object; `result === 'error'` -> `TOON_ERROR`. Verified now on Node 25.9 (not on 22): `redirect:'manual'` returns the 302 itself, `AbortSignal.any`, `Accept-Encoding: identity`, and a streamed cap all work.

`ToonError extends Error {code, status}`, `code` in `TIMEOUT | NETWORK | HTTP | REDIRECT | TOO_LARGE | BAD_BODY | TOON_ERROR | ABORTED`. The client **throws** for every failure except one expected state: `getWater()` resolves `{present:false}` on HTTP 404 and `{present:true, json}` otherwise. `ABORTED` is swallowed by the device (teardown/address change). Mapping to text is the device/driver's job (`_localize(err)` -> `error.timeout|network|http|bad_body|toon_error`, never stack traces, NFR-04 AC5/NFR-16). No retries inside the client; retry policy lives in `lib/caps.js` (`nextDelayMs`, `waterRetryMs`).

## 4. ToonWater opt-in, end to end

| Aspect | Mechanism |
|---|---|
| Switch | per-device checkbox `toonwater_enabled` (manifest default `false`) in settings group "ToonWater (optional add-on)", plus read-only `label` settings `toonwater_status`, `last_update`, `last_problem` (texts: FR-59 table, en+nl) |
| Capabilities | **not** in the driver `capabilities` list (FR-51 AC1); present on a device only through `_applyToonwater(true)`: `addCapability` x3 + `setCapabilityOptions` (titles from `CAP_OPTIONS`, same ids/titles as `app.json:128-139`) |
| Poll group | `water` is the last step of a cycle, behind `_waterOn() = hasCapability('meter_water.total') && getSetting('toonwater_enabled') === true`; disabled = no request at all (FR-51 AC2, FR-60 AC2/3) |
| Enable | in `onSettings` (serialised): `waterEpoch++`, add caps, **immediate probe** (<= 5 s), return found / not-found / unreachable message; capabilities are added even on 404 (D-4) |
| Statuses | `detected` (200 + valid) / `not_found` (404) / `unreachable` (timeout, refused) / `unexpected` (200 + junk) / `off`. Written to `toonwater_status` only on change, **after** `onSettings` returns (next tick; interplay of `setSettings` inside `onSettings` unverified, HW-13) |
| 404 handling | status `not_found`, `setWarning(__('toonwater.warning_not_found'))` once, one info log, retry after 15 min (`waterRetryMs`), `unsetWarning()` on first valid payload, on disable, on delete and at every init. Never `setUnavailable`, never error-level, never removes caps (D-3). Unreachable/junk: retry in 5 min, not counted for availability (FR-57) |
| Disable | `waterEpoch++` (in-flight reply discarded), `removeCapability` x3, `unsetWarning`, status `off`, return the "Flows that used them need to be updated" message. Only the 3 caps are touched; `alarm_water.hotwater`, burner, power, gas stay (FR-60 AC1) |
| Existing devices | `_migrate` decision above: 3 caps (era 2/3) -> `true`, no change, last values and Insights untouched; some -> `true` + missing added; none (era 0/1) -> `false`, zero `/water.html` requests (FR-56). A migrated-enabled device that only ever saw 404 for 24 h gets **one** timeline notification (`store.waterHintSent`), nothing for user-enabled devices (FR-62) |
| Flow cards | **Option C of 04 section 7.3, chosen outright:** `update_water` and the app trigger `measure_water_changed` become `deprecated: true` (hidden for new Flows, still run). The editor therefore never lists an app water card; the capability-generated system card `measure_water_changed`, the tags and the 3 capabilities appear/disappear with the capability by Homey's own mechanism. "Refresh now" is `update_status`, which also refreshes water when enabled. **No `capabilities=` filter** is added (it is documented as not following add/removeCapability, 02 finding 3; the old `driver_id=open-toon` filter stays byte-identical). `update_water` on a device with water off rejects with `toonwater.not_enabled`; with water on it is a normal refresh. The hot-water items are not ToonWater and are never filtered or guarded (R-36) |
| Provenance | parser written from the interface description (03 section 5.3: `water.flow` L/min, `value`/`total` litres, `/1000` to m3), semantics equal to this repo's GPL-3.0 PR #21 code (`device.js:410-424`); no `oepi-loepi` source read or copied (NFR-11) |

## 5. Pairing

`driver.onPair(session)`; `session.setHandler('testConnection', async ({address}) => ...)`: `normaliseAddress` (else localized error) -> `client.getThermostatInfo()` (5 s) requiring `currentTemp`+`currentSetpoint` (else "does not look like an open Toon"; HTTP status shown for 404/500) -> best-effort `getWater()` probe -> returns `{host, readings:{currentTemp, currentSetpoint, programState}, toonwater:'detected'|'not_found'|'unknown'}`; throws localized `Error` on failure. `start.html` (vanilla JS, `Homey.emit`/`Homey.createDevice`/`Homey.__`, `homey-form-*` classes): address, "Toon hostname" (= `data.id`, trimmed, scheme unchanged), name (default = id), **Test** button; Connect disabled until a test succeeded and re-disabled when the address changes (FR-02 AC5). Readings panel; if `detected`, an **unticked** checkbox "Enable ToonWater" (answers OQ-03; a 404 shows nothing, FR-61 AC2). Connect -> `Homey.createDevice({name, data:{id}, settings:{address:host, toonwater_enabled:box}, store:{migrationVersion:2}})` then `Homey.done()`; no capability override needed because `_migrate` adds the 3 caps on first init if ticked. Error from `createDevice` (duplicate id) shown inline. The IP-entry-vs-discovery store rule (02 finding 1) is not addressed (advisory while sideloaded; needs hardware).

## 6. Flow cards

All 14 ids, arg names, token names/types and dropdown ids unchanged (FR-76). Fixes in `app.json`: `[[resume_program]]` in `set_temperature_state.titleFormatted` en+nl (`app.json:388-391`, validator blocker), NL `!{{is|is niet}}` (`:314`), token title "kWh" (`:212`), arg `title`s, dropdown values carry **both** `label` and `title` (R-17, CD-6), `vacation` added to the enum and to the `temperature_state_is` dropdown only.

| Card | Behaviour |
|---|---|
| Triggers | fired from `_applyValues` via `driver.fireTrigger(device, id, tokens)` (`getDeviceTriggerCard(id).trigger(device, tokens).catch(this.error)`), **only when `old !== null` and value changed** (FR-70 AC2/4). `meter_gas_changed {meter_gas}`, `alarm_water_changed {'alarm_water.hotwater'}`, `measure_water_changed {measure_water}` (water on only); `meter_power_changed {meter_power}` = peak+offPeak in kWh, fired once per cycle when the sum changes |
| `temperature_state_changed` | **not fired by the app** by default (`MANUAL_TRIGGERS` constant in `caps.js`): Homey auto-runs `<id>_changed` for custom enum capabilities (02 HS-42, R-12); flip the constant to true if HW-06 shows it does not. This amends FR-70 AC1 for this one card |
| Conditions | `temperature_state_is`: accepts `args.state` as string or `{id}`; `hotwater_dispensing`; both return strict booleans (null -> false, FR-72) |
| Actions | `await` the Toon response; failure rejects with localized text (FR-73). `set_temperature_state`: `resume = args.resume_program !== 'no'`. `update_status` ("Update now/Update nu") = refresh all enabled parts; `update_powerusage`/`update_metertotals` refresh only their part; only the requested part may fail the card (B-2, CD-2: reject accepted, changelog line) |
| Deprecated | `meter_gas_changed`, `measure_water_changed`, `update_powerusage`, `update_metertotals`, `update_water` (FR-71/75); listeners stay registered |
| New (additive, SHOULD) | capability `burner_state` (custom enum `off|heating|hot_water|preheating`, one table in `parse.js`, from the existing `burnerInfo`, no extra request) + trigger `burner_state_changed_to` (device + `state` dropdown, run listener compares) + condition `burner_state_is`. The trigger id deliberately avoids `burner_state_changed`, which Homey would auto-run for the custom enum (FR-32 id amended, OQ-11) |

## 7. Homey Compose and manifest

**Compose is not adopted** in this candidate: the CLI composes only if the app has Homey Compose (`buildIfUsed` returns early otherwise, so a hand-written `app.json` is left untouched; read in `athombv/node-homey` `lib/HomeyCompose.js`, `hasHomeyCompose` body not seen, so "directory check" is an inference). Cost: `app.json` grows from 542 to ~850 lines by hand, and this deviates from HS-10/11 (the standard, optional layout). Containment: tests read `app.json` directly (FR-76 contract snapshot from `git show 5cc3b90:app.json`, FR-77 text checks, FR-100 en/nl completeness, unique card ids), CI runs `homey app validate --level publish`. Adopting Compose later is one mechanical `homey app compose` plus the CT-01 check on the built manifest (04 R-33); nothing in the code depends on the choice.
Manifest changes: `version 2.0.0`, `compatibility >=12.9.0` (ADR-A1), `platforms:["local"]`, driver `connectivity:["lan"]`, `brandColor`, `permissions:[]`, `support/source/bugs`, driver `capabilities` = ALWAYS + `burner_state`, settings (`address` + hint/pattern, `poll_interval` number 10-3600 default 30, ToonWater group), `energy` block **unchanged** (R-23, C-EN-1).

## 8. Test seams (everything below runs offline on Node 22 with `node --test`)

- **Pure, table-driven**: `parse.*` (fixtures: `"NaN"`, missing nodes, `activeState` `"4"`/`-1`, water without `total`, junk, 20 MB), `address`, `caps` (`planCapabilities`, `legacyToonwater` over eras L2018/L2019/L2021/L2023, `schemeRequests`, `nextDelayMs`, `waterRetryMs`).
- **Injected**: `ToonClient({host, fetch})` (`fetch` defaults to the global; tests pass the in-process mock or a real `node:http` mock server for timeout/redirect/oversize/404/refused). Device builds its client through `this._createClient(host)` (overridable). Time is `this.homey.setTimeout` only, so the fake Homey's virtual clock drives cycles; `Date.now` is read through one `this._now()`.
- **Fake Homey** (`test/fake-homey/`, installed into `require('homey')` via a `Module._load` hook): strict `Device` (throws `Invalid Capability`, duplicate `addCapability`, `setUnavailable` with a callback), `setSettings` without `onSettings`, store, `homey.__` over the real locale files (throws on a missing key), flow-card recorder that auto-runs `<custom>_changed` per docs, and an `unhandledRejection` counter asserted `0` per scenario (NFR-01).
- **Mock Toon**: stateful `node:http` server, layouts `dev_2`/`dev_3`, single/two tariff, water modes (ok/404/old shape/junk/slow), faults, request log (path, query, time) for NFR-03/FR-60/FR-16 assertions; fixtures are synthetic (03 section 4.5) and labelled as such (NFR-06 AC4).
- Hardware-only: see section 12.

## 9. Dependency policy

`dependencies: {}` (NFR-05); remove `homey-log`, `homey-wifidriver`; `engines.node >=22`; `license GPL-3.0`. devDependencies only: `eslint@~8.57` + `eslint-config-athom@~4` (HS-06; do not list `typescript`, 02 finding 7), `homey` CLI (4.4.0 if run on Node 22, else Node >=24 for tooling only; 03 section 8). Tests use `node:test`/`node:assert`/`node:http` only. All installs `--ignore-scripts`.

## 10. MUST coverage

| FR / NFR | Satisfied by |
|---|---|
| FR-01..03 | section 5; `address.js`; `0.0.0.0` guard at init |
| FR-10..14 | `parse.thermostat`; write path section 2.7/2.8; `vacation` mapped; fixtures include `activeState` 4 |
| FR-20,21,24,28 | `parse.usage/meters`: only finite values emitted, 3 decimals, single-tariff fallback; no write to undeclared `meter_power` |
| FR-22 | `parseMeters`: legacy `dev_2.x` keys first, then exact `type` table fills gaps, ambiguity -> no write + one info line listing candidates; **table needs real dumps (HW-02, M confidence)** |
| FR-31, 72 | `alarm_water.hotwater` from `burnerInfo === 2`, independent of ToonWater; strict-boolean conditions |
| FR-50..60 | section 4 (FR-54 AC1 amended: deprecated, not filtered) |
| FR-70,73,74,76 | section 6; contract test |
| FR-80..82,84 | section 2.3, 2.5, 2.6 |
| FR-100,110..113 | locale/manifest tests; `_migrate`; legacy x mock matrix test |
| FR-120 | validate at `publish` in CI |
| NFR-01,02,03,04,06,08,11,14,15 | lint rules + harness counter; CommonJS Node 22; sequential 4 req/cycle, backoff; URL builder, enum/range checks, redirect refused; section 8; `onInit` returns without I/O; section 4 provenance; contract+matrix tests; only the configured host is ever contacted (network spy) |
| NFR-05, 07 | section 9; `platforms`/`connectivity`/`compatibility` |

Included SHOULDs: FR-16, 30, 32, 61, 62, 71, 75, 77, 83, 85, 101, 114, 121, 122. **Deferred** (not needed for a minimal sufficient release): FR-25/26 export (would reuse the ToonWater group machinery, `FEATURE_GROUPS` table in `caps.js` has one entry today), FR-90 imported total (gated by HW-11/R-23), FR-15, 23, 29, 63 (plain `meter_water` conflicts with C-CAP-3), WONT FR-27/33.

## 11. Decisions that need the owner or other roles

ADR-A1 compatibility `>=12.9.0` and global `fetch` (R-26: older firmware stays on the old build). ADR-A2 water cards: deprecation plus system cards, no filter (CD-1). ADR-A3 Compose deferred. ADR-A4 `temperature_state_changed` not fired manually until HW-06. ADR-A5 new card ids `burner_state_changed_to`, `burner_state_is`; `none` still sent as `-1` from the tile as in the baseline (device.js:209), validated against the enum. ADR-A6 `resume=no` request form (section 2.8). Changelog items: `update_*` reject when the Toon is down (R-09), dormant triggers start firing (R-11/13), gas/kWh precision (R-20), `vacation`.

## 12. Main risks and hardware-only items

1. **Homey behaviour not documented (U1-U3, U5)**: whether new-setting defaults reach paired devices (handled: defaults read defensively, legacy decision never from the setting), whether `addCapability` copies options (handled: explicit `setCapabilityOptions`), whether the validator accepts `capabilitiesOptions` for capabilities not in `capabilities` (**unverified**; fallback: options live only in `CAP_OPTIONS`), whether Insights history survives remove/add (HW-08; warned in the settings message).
2. **Owner's wish "water cards appear when on"** is met only by Homey's system card plus tags, not by an app card; if the owner wants an app card too, a non-deprecated filtered card is a 10-line addition but depends on HW-09.
3. **Flat `app.json` drift** and deviation from the Compose standard (section 7); `compatibility >=12.9.0` strands older firmware.
4. **Meter discovery and `resume_program=no` and burner values are guesses** from third-party MIT sources (03 I2, I4, I7); each is a one-table change after capture (HW-02, HW-04, HW-08).
5. **Behaviour changes for existing Flows** (rejecting updates, newly firing triggers, double-firing if HW-06 disagrees).
6. **Load on the Toon**: 3 requests per 30 s (4 with water) is a proposal (NFR-03, HW-10); `getDevices.json` cost unknown, the meters step can move to every Nth cycle via one constant.
7. Status labels written with `setSettings` (label-type settings, calls around `onSettings`) unverified (HW-13).

Hardware-only: HW-01..15 of doc 01 section 11 unchanged; the ones this design leans on hardest are HW-02 (real payloads), HW-04 (scheme/`programState`/`activeState`), HW-05/06/08 (card visibility, trigger double-fire, `removeCapability` effects), HW-07 (real `/water.html` 404 and units), HW-10 (Toon load), HW-12 (upgrade over a patched baseline), HW-13 (settings UX).
