# Design candidate C - Declarative feature registry

Architect, 2026-11-12, base `5cc3b90`, branch `redesign/sdk3`. A design only; nothing was built or run. Ids: FR/NFR/OQ = `01-requirements.md`; HS = `02`; I/T/section 5 = `03`; R/U/CD/HW/B/M/C- = `04`. Those docs are model-generated; claims used below are restated.
**Verified here:** the validator accepts `capabilitiesOptions` for capabilities that are not in the driver `capabilities` list (`node-homey-lib` `develop`: `assets/app/schema.json` types it as plain `object`; `lib/App/index.js` L406-460 checks option values only; read 2026-11-12, not the 2.53.0 tarball). So the manifest can keep the water titles while water is off. Whether Homey applies them to a later `addCapability` is U2 (hardware).

## 0. Thesis and cost

Every optional thing here has one lifecycle: a setting, capabilities, maybe a poll group, cards, a status line, a legacy default, a pairing probe. ToonWater (FR-50..63) is the first; instantaneous export (FR-25, OQ-06 recommends opt-in) the second; boiler values (FR-33, WONT now, "follow the opt-in pattern") the third. C writes that lifecycle once in a ~250-line engine; each feature is a plain object in `lib/features/`. A test registers a synthetic fourth feature to prove that no engine edit is needed.

Limit, stated up front: Homey cannot add or remove manifest Flow cards at run time. The registry therefore does not add cards; it decides which run listeners are guarded, which triggers fire, and what tests assert.

| Piece | LOC | Replaces | Drop if |
|---|---|---|---|
| `features/*` | 60 + 3x30 | `if (toonwater)` in init, settings, poll plan, cards, pairing, migration | no second optional feature survives (OQ-06 "always on"): collapse to one `toonwater.js` |
| `engine/{capabilities,poller,apply}` | 230 | needed anyway (FR-52/53/80/111, NFR-03) | never |
| `flow/cards.js` | 100 | the 14 listeners, `driver.js:30-59` | never |
| Not built: generator, plugin loader, runtime schema check, event bus, DI container, TypeScript | 0 | Compose is the generator; shapes are checked in tests | - |

## 1. Layout

```
.homeycompose/app.json (v2.0.0, compatibility >=12.9.0, platforms [local], brandColor, permissions [])
.homeycompose/capabilities/{temperature_state,burner_state}.json
drivers/open-toon/{driver.compose.json, driver.settings.compose.json, driver.flow.compose.json, driver.js, device.js, pair/start.html}
lib/features/{index,core,toonwater,export}.js     lib/engine/{capabilities,poller,apply}.js
lib/toon/{client,errors,address,parse,meters,commands}.js     lib/flow/cards.js   lib/messages.js
test/{mock-toon,fake-homey}.js  test/fixtures/  scripts/check-*.js          app.js (log only)
```
Generated `app.json` is committed (HS-11); CI runs `homey app validate --level publish` and fails on a diff of it.

## 2. The registry

```js
// lib/features/toonwater.js  (units/fields: 03 section 5.3 + this repo's PR #21 (GPL-3.0); no code from oepi-loepi/*)
module.exports = { id: 'toonwater', optional: true,
  setting: 'toonwater_enabled', statusSetting: 'toonwater_status',
  capabilities: ['measure_water', 'meter_water.today', 'meter_water.total'],
  legacyIf: (caps) => caps.some((c) => WATER.includes(c)),            // FR-56; never alarm_water.hotwater (R-36)
  pollGroups: [{ id: 'water', endpoint: { path: '/water.html' }, parse: parse.water,
                 critical: false, absentOn404: true, absentBackoffMs: 900000, every: 1 }],
  probe: (client, host, signal) => /* detected | notfound | unreachable | unexpected */,
  cards: { actions: ['update_water'], triggers: ['measure_water_changed'], onDisabled: 'reject' },  // CD-2 fallback 'noop'
  changeRules: [{ caps: ['measure_water'], card: 'measure_water_changed', manual: true, tokens: (v) => ({ measure_water: v('measure_water') }) }] };
```
`core.js`: `always:true`, the 8 baseline capabilities plus `burner_state`, groups `thermostat` (`critical:true`), `power`, `meters`, all non-water cards and rules. `export.js`: `optional`, `export_enabled`, capability `measure_power.export`, **no** poll group: `parse.power` already emits it from `powerProduction.value` (same request as FR-20).

| Engine function | Contract |
|---|---|
| `featureState(settings)` (pure) | `{core:true, toonwater, export}` from a settings object; never `getSetting` (inside `onSettings` stored values are still the old ones) |
| `planCapabilities({have,state})` (pure) | `{add,remove}`; touches only capabilities of `optional` features; never core, never unknown extras (M-5, R-01) |
| `reconcile(device,state)` | per-device promise chain (FR-52 AC4): `addCapability` then `setCapabilityOptions(id, driver.manifest.capabilitiesOptions[id])` (C-CAP-4), or `removeCapability` |
| `applyValues(device,values,rules)` | the one `_setCap`: skip capabilities the device lacks (B-10), `await setCapabilityValue().catch(this.error)`, compare with Homey's stored previous value, evaluate change rules (no fire when previous is `null`, FR-70 AC4) |
| `backoffMs(fails,interval)` (pure) | 1-2 fails: interval; then doubling, cap 300 000 ms (FR-81 AC3) |
| `buildNewDevice(...)` (pure) | `createDevice` object: `data:{id}`, `settings:{address,toonwater_enabled,...}`, `store:{migrationVersion:1}`, `capabilities` = core + ticked features |

## 3. Device lifecycle

`onInit` (returns well under 1 s, no network, NFR-08, CT-07):
1. `_epoch = new AbortController()`; `_cfg = readConfig(settings)`: address normalised on read only (R-30); `poll_interval = Number(x)||30`, clamped 10..3600 (FR-112); features from step 3. The poll path never calls `getSetting`.
2. Register listeners for `temperature_state`, `target_temperature` (C-CAP-5).
3. `_migrate()`: no `store.migrationVersion` = legacy (04 rule 2/8, M-1..M-6): `toonwater = legacyIf(getCapabilities())`, `setSettings({toonwater_enabled})` (does not call `onSettings`, so step 4 reconciles itself), add missing core capabilities and options, keep `meter_power` (era 0) and unknown extras, write the marker last. Errors are logged; the marker is then not written; the device stays available.
4. `reconcile(...)` - a no-op on later starts (FR-111 AC2). With water off it also calls `unsetWarning()` (FR-55 AC2).
5. Invalid or `0.0.0.0` address: `setUnavailable(__('address_missing'))`, no poller (FR-03 AC3). Else `poller.start()` **not awaited**; first cycle after 1-5 s jitter.

**Poll loop.** `homey.setTimeout` chain, in-flight guard (HS-22). All Toon traffic of a device goes through one `Lane` (async mutex): cycle, "Update" card and write never overlap (NFR-03, B-3, FR-74 AC3). A cycle runs each due group of `activeGroups(state)` in order. Only a failing `critical` group fails the cycle; optional groups only update `toonwater_status` (FR-57 AC3, FR-80 AC4). Three failed cycles: `setUnavailable(__('offline'))`; polling continues with `backoffMs`; first success: `setAvailable()`; values are never cleared (FR-81). `absentOn404` sets `absentUntil = now + 15 min` (FR-57 AC1). `every:n` throttles a heavy group (HW-10 may want `meters` at 2): a data edit. Defaults 30 s.

**Cards and writes.** `refresh(groupIds, {explicit})` rejects only if a `critical` group failed, or the card named a group explicitly and the failure was not an `absentOn404` (B-2, R-37). `commands.js` returns step lists (`setSetpoint(deg)` -> `Setpoint: Math.round(deg*100)`, integer, FR-11 AC1). Setpoint writes are latest-wins single-flight (<=2 requests per drag, FR-16 AC1); a write schedules a thermostat refresh after 1.5 s and bumps a `writeEpoch` so an older in-flight poll cannot revert it (FR-16 AC3). `resume_program` lives in one table `RESUME = {yes, no}`: `yes` is today's URL (`device.js:209`, I4); `no` is a **placeholder** (proposal: program off, then preset; unverified, HW-04); `undefined` = `yes` (R-18).

**`onSettings({newSettings})`.** Pure `planSettingsChange` validates `address`, `poll_interval` and throws a localized `Error` (FR-82 AC1, FR-83). Then, serialised: toggles reconcile (section 5); an address change aborts the epoch, clears `absentUntil` and re-probes enabled features (FR-82 AC2); `_cfg` is replaced and the poller re-armed; the localized message is returned. `onDeleted` and `onUninit` call one idempotent `_teardown()` (`_stopped`, abort, `poller.stop()`), never throw (FR-84); every response is checked against `_stopped` and the epoch before `applyValues`.

## 4. HTTP client and errors

`new ToonClient({fetch = globalThis.fetch, timeoutMs = 5000, maxBytes = 2 MiB}).get(host, endpoint, {signal})`: URL via `new URL('http://'+host)` plus `pathname`/`searchParams` (NFR-04 AC1); `redirect:'manual'` (3xx = `redirect`); `Accept-Encoding: identity` (T4); `AbortSignal.any([AbortSignal.timeout(ms), signal])`; capped stream read; `JSON.parse(text)` because the Toon answers `text/javascript` (T3); `result==='error'` = `rejected`. No retries (the poller owns policy). `ToonError {kind, status}`, kinds `timeout|network|http|redirect|toolarge|badbody|rejected|config|aborted`; no user text, no body (NFR-04 AC5). `messages.toUserMessage(homey, err)` maps kind to an en+nl key (NFR-16); logs carry kind and status only. Parsers never throw: `{values, notes}` with finite, in-range values only (FR-24, C-CAP-6).

## 5. ToonWater opt-in, end to end

* **Setting:** `toonwater_enabled` checkbox, default `false`, in a "ToonWater (optional add-on)" group; read-only `toonwater_status` label; texts per FR-59. Driver `capabilities` hold no water capability (FR-51 AC1); `capabilitiesOptions` keep the titles.
* **New device:** off unless ticked at pairing: no water capability, no `/water.html` request, no warning (FR-51).
* **Existing devices (FR-56):** any water capability present -> enabled, missing ones added, nothing removed, values and Insights untouched; none present (eras 0/1) -> disabled, nothing added. The setting default is never read (R-05, U3). `alarm_water.hotwater`, `hotwater_dispensing`, `alarm_water_changed` are in `core` and never guarded (FR-31, R-36).
* **Off -> on:** queue: add 3 capabilities + options, clear `absentUntil`, `await probe` (<=5 s) -> status and save message: detected / 404 (capabilities stay, `setWarning`, no throw: D-4) / unreachable / unexpected. Values arrive through the normal `applyValues`; group `water` joins the cycle.
* **On -> off:** group leaves `activeGroups`; a per-feature generation counter drops a late water response (FR-53 AC3); capabilities removed; `unsetWarning`; status "Off"; the message warns that Flows using water stop working. The app never removes capabilities on its own, not on 404 or outage (D-3).
* **Cards:** not driven by a `capabilities=` filter (02 finding 3; U6). `update_water` and the app's `measure_water_changed` are **deprecated** (FR-75, FR-71: allowed by the contract; existing Flows keep running). What a user sees for water is what Homey generates from the capability - the system `measure_water_changed` trigger and Flow tags (04 7.3 facts c/d). Both listeners stay and are guarded: off -> `update_water` rejects with the FR-59 text and sends nothing (FR-54 AC2). Cost: no non-deprecated app water card exists; "refresh" is `update_status`. Deprecation is a one-way door (04 Appendix A forbids un-deprecating), accepted because FR-71/75 already ask for it.
* **Detection:** `probe` classifies one GET: 200 + `result=="ok"` + object `water` = detected; 404 = notfound; timeout/refused = unreachable (availability stays with the thermostat); other 200 = unexpected (flat ESP payload gets a hint, 03 5.5). Used at pairing (FR-61), on toggle and on address change; afterwards the poll group is the detector.
* **Migrated, never detected:** an `afterCycle` hook raises one timeline notification after 24 h of continuous 404 (store flags, FR-62); none for user-enabled devices.

## 6. Pairing

`onPair(session)`: handlers `listFeatures` (view renders one unticked checkbox per optional feature), `testConnection({address})`, `buildDevice({address,id,name,features})`. `testConnection` normalises (FR-03), GETs the thermostat (5 s), runs each optional `probe` (a failed probe never blocks, FR-61 AC3), returns `{address, readings:{currentTemp,currentSetpoint,programState}, features:{...}}` or throws a localized error (FR-02). `buildDevice` returns `buildNewDevice`; the view calls `Homey.createDevice(obj)` (promise form, HS-50). `data.id` stays the trimmed typed hostname (C-ID-3); `name` defaults to the id (new pairs only, C-ID-4). Vanilla JS on the Homey Style Library; Connect disabled until a test passes and again after an address edit (FR-02 AC5); strings via `Homey.__`; the server re-validates.

## 7. Flow cards

All 14 baseline ids, args, tokens and dropdown value ids stay; dropdown values carry `title` and `label` until HW-10 (R-17); `[[resume_program]]` is added to both languages (FR-73 AC4); the NL typo and the "Wh" token title are fixed. `cards.js` is a table `{kind,id,feature?,run}` registered in `Driver#onInit` (HS-20): conditions return strict booleans and accept `args.state` as string or `{id}` (FR-72, U7); `temperature_state_is` gains `vacation`; actions await the Toon and reject via `toUserMessage` (FR-73); `update_status` becomes "Update now" and refreshes all enabled groups; `update_powerusage`, `update_metertotals`, `update_water` are deprecated, listeners kept.
Triggers: `Driver#onInit` fetches each `getDeviceTriggerCard(id)` once; `applyValues` matches `changeRules` and calls `card.trigger(device, tokens, state).catch(this.error)` (FR-70 AC3). Rules: `meter_gas_changed`, `measure_water_changed` (both deprecated), `meter_power_changed` (one rule on peak+off-peak, token = sum, 3 decimals, FR-70 AC5), `alarm_water_changed`, new `burner_state_changed_to` (arg `state`; deliberately not `burner_state_changed`: Homey auto-runs `<custom capability>_changed` [02 finding 5] and could call an arg-bearing listener without state - precaution, unverified) plus condition `burner_state_is`. `temperature_state_changed` gets `manual:false` until HW-06 shows whether Homey already fires it (R-12, CD-4); flipping is a one-word edit.

## 8. Homey Compose and drift guard

Hand-authored sources live in `.homeycompose/` and `drivers/open-toon/*.compose.json` (HS-10/12); cards drop their `device` arg (Compose re-adds it unchanged, HS-12). `registry-vs-manifest.test.js`: every capability, setting and card id named by a feature exists in the composed manifest; every manifest card is claimed by exactly one feature; each optional setting is a `checkbox` with `value:false`; core capabilities equal `driver.compose.json`. The contract check (04 Appendix A) runs on source and built manifest (R-33).

## 9. Test seams

**Pure:** `parse`, `meters` (legacy `dev_2.x` first, `type` discovery fills gaps; fixtures labelled "derived, not captured" until HW-02), `address`, `featureState`, `planCapabilities`, `legacyIf`, `backoffMs`, `planSettingsChange`, `buildNewDevice`, `commands`, `toUserMessage`, rule evaluation. **Injected:** `ToonClient({fetch,timeoutMs})`, `Poller({timers,now,random})`, all of `this.homey`. `fake-homey.js` is a strict v3-shaped fake over `require('homey')` (resolves only in the runtime, HS-03): throws on invalid capability, unknown card, missing translation (real locale files), v2 calls; records add/remove calls, triggers, warnings; models documented auto-fire of custom triggers; manual clock. `mock-toon.js`: stateful `node:http` on `127.0.0.1:0`, per-path fault modes (404, 500, slow, garbage, partial, redirect, oversize, `NaN`, single tariff, vacation), request log. Tier 1 (poll, availability, back-off, toggle races): scripted stub `fetch` + manual clock. Tier 2 (end to end): real client vs mock with 150 ms timeouts, because `AbortSignal.timeout` ignores `mock.timers`. An `unhandledRejection` trap backs NFR-01; a script maps every `[M]` id to a test title (NFR-06).

## 10. Dependencies

Runtime: none (NFR-05); `homey-wifidriver`, `homey-log`, `request*` removed; `node_modules` untracked. Dev only, `--ignore-scripts`: `eslint@~8.57.1`, `eslint-config-athom@~4.0.2` (HS-06), `homey-lib`, the `homey` CLI in CI on Node 24 (it needs >=24; app code stays Node-22-safe). No `typescript` (02 finding 7). Tests on Node 22 via `node --test`.

## 11. MUST coverage

| MUST | Where |
|---|---|
| FR-01..03 | section 6, `address.js`, `buildNewDevice` |
| FR-10, 12, 20, 21, 24, 28, 31, 58 | `parse.js`, `meters.js`, `_setCap` skip rule, `vacation` enum value |
| FR-22 | `meters.js` (rule needs real dumps, OQ-05) |
| FR-11, 13, 14 | `commands.js`, `RESUME` table (`no` unverified) |
| FR-50..53, 56, 60, 111, 112 | section 5, `featureState`, `planCapabilities`, `legacyIf`, `_migrate`; FR-60 AC3: only `toonwater.js` names `/water.html` |
| FR-54, 55, 57, 59 | probe/status mapping, `absentOn404`, guarded cards, locale keys |
| FR-70, 72..74, 76 | `changeRules`, `cards.js`, `refresh`, CT-01 in CI |
| FR-80..82, 84 | `Poller`/`Lane`, availability rule, `onSettings`, `_teardown` |
| FR-100, 110, 113, 120, NFR-02, 05, 07, 14 | scans, era x mock matrix, compose, `>=12.9.0`, zero deps |
| NFR-01, 03, 04, 06, 08, 11, 15 | `_setCap` + trap, lane + 5 s timeout, URL/redirect/size cap, mock + fake, non-blocking init, provenance headers, only the configured host |

## 12. Risks, unverified, deviations

1. **Indirection** for a small app; mitigated by no generator, plain objects, debug logging of engine decisions, and the kill criterion in section 0.
2. **Platform limit on cards:** no per-device hiding of app cards; HW-05/HW-09 observe the editor. Deprecation is irreversible.
3. **Unverified Homey behaviour used:** `getSetting` old inside `onSettings` (docs-based; hence explicit `newSettings`); `setSettings` refreshing a `label` status (HW-13; fallback `setWarning` text); `driver.manifest` readable; options after `addCapability` (U2); auto-fire (U8); `redirect:'manual'` returns raw 3xx on Node 22 (assert in tier 2).
4. **Races** (toggle or address change mid-request): serial capability queue, epoch and generation counters; tests per FR-52 AC4, FR-53 AC3, FR-82 AC2.
5. **Hardware-bound:** meter discovery and `resume_program=no` sit in single tables. The Toon's nightly reboot (T6, one source) will mark the tile unavailable for ~2 minutes at defaults; accepted under FR-81.
6. **Deviations for the owner:** FR-52 AC5, FR-53 AC5, FR-54 AC1 assume a `capabilities=` filter - here system cards plus deprecation; FR-70 AC1 fires `temperature_state_changed` - here `manual:false` pending HW-06 (matches CD-4); the burner trigger id differs from FR-32's proposal.
