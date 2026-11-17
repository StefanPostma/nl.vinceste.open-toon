# 00 - Architect audit of nl.vinceste.open-toon (carried-over input)

> **Provenance / trust level.** This is the report of an "architect" subagent, copied into the repo on 2026-11-12 because the
> original scratch directory was lost. It is **model-generated**. The main agent spot-checked these claims against the code:
> `titleFormatted` of `set_temperature_state` lacks `[[resume_program]]` (app.json:388-391) while the arg exists (app.json:434);
> no polling exists (only a global `setTimeout` inside `debounce`, device.js:583); `meter_power` is written (device.js:377) but is
> not in the driver capability list; `super.onInit()` is never called; no trigger card is ever fired; `onDeleted()` calls
> `super.onDeleted()`. **Not independently verified:** the `homey-lib` validator result, the mock-harness results, the claims
> about the App Store app `nl.toonwater.toonwater`, the Node-22-from-12.9.0 platform fact, and the water.html payload shape.
> Treat everything load-bearing as a hypothesis and re-verify it. References to a "harness", "mock-toon.js", "fakehomey" and
> "scratchpad" refer to scratch files that no longer exist: they must be rebuilt inside the repo (see section 5 for the endpoint table).
> Line numbers refer to branch `Develop` @ `5cc3b90`.

Repo: this repository (branch `Develop`). No project files were modified by the architect.

---

## 0. Verdict (TL;DR)

* The "SDK v3 migration" (PR #28, `fe4e659`) is **cosmetic**: it changed `sdk`/`compatibility` in `app.json` and ported the
  Flow-card registration in `driver.js`. Nothing else was migrated.
* **The current HEAD cannot be built or installed with the current Homey CLI.** `homey-lib` 2.53.0 rejects `app.json` even at
  `--level debug`: `Missing [[resume_program]] in flow.actions['set_temperature_state'].titleFormatted.en`. `homey app build/run/install`
  validate at debug level (CLI `lib/App.js:186,314,863`), so all three refuse to run.
* **Pairing a new Toon is almost certainly broken on v3**, for three independent reasons:
  * `driver.js:9` calls `socket.on(...)`, but the v3 `PairSession` documents only `done/emit/nextView/prevView/setHandler/showView`.
  * `start.html:43` calls `Homey.addDevice(...)`, but the v3 view API is `Homey.createDevice(): Promise`.
  * `start.html` depends entirely on jQuery `$`, which the current docs do not mention.
* **Already-paired devices run, but badly:**
  * There is **no polling at all**. Values change only at `onInit` or when a user's Flow runs an "Update ..." action card.
  * Every power update raises an unhandled rejection (`Invalid Capability: meter_power`).
  * Devices paired before v1.1.0 (water) raise three more per update.
  * `onDeleted()` throws.
  * The device is never marked unavailable.
  * All 5 trigger cards are never fired.
* `homey-wifidriver` does not fail at load time under v3, but ToonDevice uses **none** of it, because it never calls `super.onInit()`.
  The only library code path that actually executes (`onDeleted`) crashes. Recommendation: delete it.
* **Strategic flag:** a published, SDK v3, `platforms=local` App Store app, **`nl.toonwater.toonwater` ("toonWater" v1.1.30, by
  Rob van Oostveen / oepi-loepi)**, reportedly ships a `toonThermostat` driver with essentially this app's feature set.
  oepi-loepi announced a rewrite in issue #22 (2023-02-13).
* There is still no SDK v4: the manifest docs say `sdk` "should be 3". From Homey v12.9.0, apps run on **Node.js 22 on all platforms**.

---

## 1. Verified platform facts (load-bearing)

| Fact | Source |
|---|---|
| SDK v3 is current; manifest `sdk` "Should be 3"; `compatibility` "Use at least >=5.0.0" | apps.developer.homey.app/the-basics/app/manifest.md |
| Node.js: all platforms run Node 22 from Homey v12.9.0. Earlier: HP2016-19 Node 12 (<7.4) / 16 (<12.9); HP Early 2023 and mini Node 18 (<12.9) | the-basics/app.md section Node.js |
| Built-in `fetch` is "the preferred approach for new code"; there are node-fetch keep-alive issues on Node >=19 | upgrade-guides/node-22.md |
| The `homey` module exports only classes + `env` + `manifest`; managers live on `this.homey` (so `Homey.__`, `Homey.app` and `Homey.ManagerSettings` are gone) | upgrade-guides/upgrading-to-sdk-v3.md |
| `homey-log` v1 is SDK v2-only; v2.x needs `new Log({ homey: this.homey })` + a Sentry `HOMEY_LOG_URL` in `env.json` (latest 2.1.2, depends on `github:athombv/raven-node`) | upgrade guide + npm registry |
| Pair views: `onPair(session)` + `session.setHandler`. Front-end: `Homey.emit(): Promise`, `Homey.createDevice(): Promise`, `Homey.__()`. Callbacks "still supported for now" | upgrade guide; advanced/custom-views/custom-pairing-views.md; PairSession.html |
| Homey Style Library classes (`homey-form-*`) are available on Homey Pro since v8.1.0 | advanced/custom-views/html-and-css-styling.md |
| Use `this.homey.setTimeout/setInterval` (auto-cleared on app destroy); `onUninit()` exists on App, Driver and Device | guides/homey-cloud.md; Device.html |
| Unhandled promise rejections crash apps on Homey Cloud, "coming to Homey Pro in the near future" | guides/homey-cloud.md |
| `setUnavailable(message?) : Promise` (no callback); an unavailable device blocks capability actions **and Flow actions** | Device.html; the-basics/devices.md section Availability |
| Homey Cloud is not an option: Homey Bridge has no LAN access (`connectivity: lan` is not possible), and listing requires Verified Developer status and an official brand integration | guides/homey-cloud.md |
| Flow cards are not auto-generated for sub-capabilities; `"deprecated": true` hides a card while keeping existing flows working | the-basics/devices/capabilities.md; the-basics/flow.md |
| System capability trigger IDs: `meter_gas_changed`, `meter_power_changed`, `measure_water_changed`; `alarm_water` = "True when water has been detected" (a leak alarm) | athombv/node-homey-lib `assets/capability/capabilities/*.json` |
| `energy.cumulative` makes Homey Energy read `meter_power`, `meter_gas` and `meter_water`. The validator warns when `cumulativeImportedCapability`/`cumulativeExportedCapability` are missing | the-basics/devices/energy.md; homey-lib warnings |
| The CLI does **not** run `npm install` on build. It copies production deps from the **local** `node_modules` via `npm ls --parseable --all --only=prod`, then overwrites `node_modules/homey` with its own shim | homey CLI 4.6.3 `lib/App.js` `_copyAppProductionDependencies`, `lib/NpmCommands.js` |
| `homey app compose` keeps Flow card IDs. Cards whose device arg has `driver_id=open-toon` move to `driver.flow.compose.json`, and the build re-adds the arg `{type:'device', name:'device', filter:'driver_id=open-toon'}` unchanged | CLI `lib/App.js` `migrateToCompose`, `lib/HomeyCompose.js:~430` |
| The app is not on the App Store: `homey.app/.../app/nl.vinceste.open-toon/` and `/test/` both return 404, so it is sideloaded via the CLI | HTTP check |
| `water.html` payload (current ToonWater add-on) is `{"result":"ok","water":{"flow":N,"total":N,"value":N,"avgValue":N}}`, with `total`/`value` in litres | oepi-loepi/toonWater `ToonWaterApp.qml:284,422` (UNLICENSED repo: interface knowledge only, never copy code) |

---

## 2. Current-state audit

Severity: **B** = breaks build or runtime today; **D** = deprecated, latent, or works badly; **C** = cosmetic or dead code.
"(pre)" marks a pre-existing functional bug that is not specific to v3. "H:Sx" means confirmed by a harness scenario (section 5/8).

### app.json
| file:line | Sev | Finding | v3 / fix |
|---|---|---|---|
| app.json:388-391 | **B** | `set_temperature_state.titleFormatted` lacks `[[resume_program]]`, so validation fails at **debug** level and the CLI refuses build/run/install | Add `[[resume_program]]` to en+nl (verified: debug passes afterwards) |
| app.json (missing) | **B (publish)** | No `brandColor`, so `--level publish` fails | Add `"brandColor"` (verified: publish passes with this + the line above) |
| app.json (missing) | D | No `platforms`/`connectivity` (required only at `verified` level) | `"platforms":["local"]` on app + driver; driver `"connectivity":["lan"]` |
| app.json:3 | D | `version` 1.0.0 is identical to the **SDK v2** build on branch `Stable` (`origin/Stable:app.json` sdk 2, 1.0.0) | Bump |
| app.json:4 | D | `>=5.0.0` allows Node 12/16 runtimes (no `fetch`, no `?.` on Node 12) | `>=12.9.0` for the v3-native release |
| app.json:43-79 + device.js:7-13,472 | B (pre) | `activeState` 4 (vacation) is unmapped, so `temperature_state` is set to `undefined` (H:S4) | Map 4 explicitly; additive enum value `vacation` |
| app.json:107-109 | D | `energy.cumulative` without `cumulativeImportedCapability`, and the device has no `meter_power` / plain `meter_water`. Energy therefore gets W and gas, but no kWh and no water | Optional |
| app.json:105,140-145 | C | `alarm_water.hotwater` reuses the water-leak alarm for "hot water dispensing" | Keep (insights/flows depend on it) |
| app.json:152-171 | C | Single `address` text setting, default `0.0.0.0`, no `hint`/`pattern`; no poll-interval setting | Add hint/pattern + `poll_interval` |
| app.json:177,202,227 | D | Custom triggers `meter_gas_changed`/`meter_power_changed`/`measure_water_changed` reuse **system** capability trigger IDs (duplicate cards in the editor for `meter_gas`/`measure_water`) and are never fired | Fire them; mark `meter_gas_changed` and `measure_water_changed` `deprecated: true` |
| app.json:252,280 | D | `temperature_state_changed`, `alarm_water_changed` are never fired (no `getDeviceTriggerCard` anywhere). Issue #26 asks for exactly this | Fire them |
| app.json:212 | C | `meter_power_changed` token titled "Wh" while capabilities are kWh | Fix title (the card never fired, so this is safe) |
| app.json:314 | C | nl `titleFormatted` `!{{is||is niet}}` (double pipe) | `!{{is|is niet}}` |
| app.json:322-363 | C | Dropdown args have no `title` (fails `verified` level) | Add arg titles |
| app.json:30-33 | C | No `xlarge` images (optional), no `support`/`source`/`bugs`/`homepage` | Add |

### app.js / package.json / repo
| file:line | Sev | Finding | Fix |
|---|---|---|---|
| app.js:4 | D | `require('homey-log').Log` is unused; homey-log 1.0.6 is SDK v2-only and loads `raven` 0.12 for nothing | Delete |
| app.js:8 | - | `this.id` is valid in v3 (`App#id`) | none |
| package.json:2,15-24 | C | name `nl.eneco.toon`; repo/bugs/homepage point to athombv/nl.eneco.toon | `nl.vinceste.open-toon`, StefanPostma URLs |
| package.json:7-8 | D | Only runtime deps are `homey-log` ^1.0.6 and `homey-wifidriver` ^1.0.8, both pre-v3 | Remove both |
| device.js:4 vs package.json | D | `request-promise-native` is **not declared**; it only resolves via `homey-wifidriver`'s hoisted deps (`request` 2.88.0 is deprecated) | Replace with `fetch` |
| package.json:12 | C | `"run": "homeyConfig compose && athom project --run"` is obsolete | `homey app run`; add `validate`, `lint`, `test` |
| package.json:10,22 | C | No devDependencies; `license: ISC` vs `LICENSE` = GPL-3.0 | eslint + eslint-config-athom, types; `"license":"GPL-3.0"` |
| package-lock.json | C | lockfileVersion 1; all 3 open Dependabot PRs (#31 ajv, #32 underscore, #33 lodash) touch only packages that hang off `homey-wifidriver` | Regenerate; close the PRs as obsolete after dropping the dep |
| node_modules/ (1,880 of 1,900 tracked files) | D | Committed deps; no `.gitignore` or `.homeyignore` | Untrack after runtime deps are gone |
| README.md | C | Changelog lives in README; no `README.txt` (App Store long description) | Add |
| .github/dependabot.yml:8 | D | `package-ecosystem: ""` is invalid, so version updates never ran | `npm` + `github-actions` |
| .github/workflows/codeql-analysis.yml | D | GitHub reports the workflow as `disabled_inactivity`; it uses `actions/checkout@v2`, `github/codeql-action@v1` (retired) and an obsolete `HEAD^2` step | Replace with the CLI template's `homey-app-validate.yml` (`athombv/github-action-homey-app-validate@master`, `actions/checkout@v4`) |

### drivers/open-toon/driver.js
| file:line | Sev | Finding | Fix |
|---|---|---|---|
| driver.js:8-23 | **B** | `onPair(socket)` + `socket.on(ev,(data,cb))`. v3 passes a `PairSession` with no documented `.on`, so a TypeError at pairing start is likely (not verified on a device) | `onPair(session)` + `session.setHandler('testConnection', async ({address}) => ...)` |
| driver.js:11-16 | B (pre) | `testConnection` is a stub: it shadows `data` with `"test toon"` and the real call is commented out | Call the Toon |
| driver.js:36-37 | B (pre) | Passes `args.resume_program` ('yes'/'no'), which `device.updateState` ignores | Needs hardware to settle semantics |
| driver.js:45-59 | D | "Update ..." actions resolve even when the Toon is offline | Reject on failure |
| driver.js:69-71 | C | `mapDeviceClass()` is not an SDK hook (v3 has `onMapDeviceClass`); dead code inherited from the 2018 Athom template. `require('./device.js')` (:4) exists only for it | Delete |
| driver.js (missing) | D | No trigger cards obtained or fired | `this.homey.flow.getDeviceTriggerCard(id)` stored on the driver |

### drivers/open-toon/device.js
| file:line | Sev | Finding | Fix |
|---|---|---|---|
| device.js:5,18,25 | D | `extends WebAPIDevice` (homey-wifidriver 1.0.8, 2018), but `onInit` never calls `super.onInit()`. As a result `_apiCallQueue`, `_backOffStrategies`, `pollIntervals` and backoff are **never initialised**, and nothing from the library is used | `extends Homey.Device` |
| device.js:488-491 | **B** | `onDeleted()` calls `super.onDeleted()`, which reaches `WifiDevice.onDeleted`, which runs `this._backOffStrategies.forEach` on undefined and throws a **TypeError** | New `onDeleted`/`onUninit` that stop the poller |
| device.js:33-38 | **B** | The migration adds only `alarm_water.hotwater`. Water caps (added v1.1.0, `f705a70`, 2021) are never added to older devices, giving 3x `Invalid Capability` unhandled rejections per update | Generic "ensure all manifest capabilities" |
| device.js:374-378 | **B** | `setCapabilityValue('meter_power', ...)` targets a capability that is not in the driver, so every power update produces an unhandled rejection. The value is also day usage, which has the wrong semantics for a meter | Drop it (or compute a cumulative total) |
| device.js:326-328 -> 381 | B (pre) | For the `GetCurrentUsage` payload, `data['dev_2.4']` is undefined, so `.hasOwnProperty` throws a TypeError synchronously, and the `.catch` at :127 **swallows** it. The same happens if only `dev_2.6` is present (:338 is an OR) | Separate pure parsers with guards |
| device.js:417 | D (conditional) | `data.total` is **present** in the current ToonWater payload (doc comment :171 is stale). With an older add-on it is NaN and the value is rejected | `Number.isFinite` guard; fix the doc comment |
| device.js:25-57 | D | `onInit` awaits 4 HTTP calls with **no timeout**. A call to an unroutable IP was still pending after 20 s, so a wrong IP stalls init for minutes | Non-blocking poll start; 5 s timeout |
| device.js (whole) | D | **No polling.** Values refresh only at init or via the user's "Update ..." Flow cards | Poll loop |
| device.js:497-519 | D | `setAvailable`/`setUnavailable(message, callback, force)` overrides use a v2-style signature and are **never invoked** by live code, so the device never goes unavailable | Availability inside the poll loop |
| device.js:526-554 | C (B if reached) | `webAPIResponseHandler/webAPIErrorHandler` are reachable only through `apiCall()`, which is never used. :546 `Homey.__` does not exist in v3; :553 `super.webAPIErrorHandler` does not exist on the mixin | Delete; use `this.homey.__('offline')` |
| device.js:85-190,198-310 | D | `try{ return rp(...) }catch` cannot catch async errors; the `.catch(err=>{ if(err.error)... })` swallows anything without `.error` | Async/await with real error propagation |
| device.js:243,370,377,386,390,400,421-423,444,463-476 | D | `setCapabilityValue` is never awaited or `.catch`ed (an unhandled-rejection source) | A single `_setCap()` helper with `.catch(this.error)` |
| device.js:198-226 | B (pre) | `keepProgram` is ignored (always `state=2`); :224-225 is unreachable after `return`; 'none' sends `temperatureState=-1` | Needs hardware |
| device.js:384,398,442 | C | `Math.trunc` gives whole kWh/m3 (coarse Insights/Energy data) | Keep 3 decimals |
| device.js:6,234,569-586 | C | Unused `API_BASE_URL`, `data`, `debounce` (which also uses a global `setTimeout`) | Delete |
| device.js:332-341 | C (pre) | `dev_2.x` keys are hard-coded. oepi-loepi's HA integration resolves nodes by `type` and also checks `dev_3.x`/`dev_4.x`/`dev_7.x` adapters | Type-based discovery (needs real dump) |
| device.js (missing) | D | No `onUninit`, `onSettings` (address change), `onAdded`; no refresh after write actions | Add |

### drivers/open-toon/pair/start.html
| file:line | Sev | Finding | Fix |
|---|---|---|---|
| start.html:43-56 | **B (likely)** | `Homey.addDevice(device, cb)` is not part of the v3 front-end API (`Homey.createDevice(device): Promise`) | `createDevice` |
| start.html:3-62 | **B-risk** | The whole script depends on jQuery `$`, which current pair-view docs never mention. If it is absent, nothing works | Vanilla DOM |
| start.html:2 | D | Bare `__()`; the documented call is `Homey.__()` | `Homey.__` |
| start.html:4 vs 99-117 | B (pre) | `#test-connection` button **does not exist** in the markup, so `testConnection` is never called | Add a button; gate Connect on success |
| start.html:5-25,49-60 vs markup | C | `.mi-device-test/-error/-ok/-error-msg` elements are missing, so errors are invisible; the error path still shows "ok" and calls `Homey.done()` | Rewrite |
| start.html:13 | D | `Homey.emit(ev, data, callback)` uses the callback form | Promise form |
| start.html:18 | C | Copy-paste from a Xiaomi app ("Philips Light Bulb", "Dim Level") with undefined i18n keys | Remove |
| start.html:44 | C | Every device gets `name: 'ToonDevice'`; the user's "name" becomes `data.id` | `name` = user input; keep the `data.id` scheme |
| start.html:66-97 | C | Legacy CSS (`form-group`, `button`) | Homey Style Library (`homey-form-group/-label/-input`, `homey-button-primary-full`) |

### locales
| file:line | Sev | Finding |
|---|---|---|
| en.json:16,15,12,9,11 | C | Typos ("Somethink bad happend", "succesfull(y)", "an unique"); `"address": "IP adres"` is Dutch in en. The App Store rejects typos (guideline 1.11) |
| nl.json:7 vs en.json | C | `repair_migration_v3` exists only in nl (and is unused) |
| nl.json:19 | C | Message mentions a "Mi Home apparaat" and a "token" (copy-paste) |
| both | C | ~15 unused keys from Athom's cloud Toon app (login/username/password/found_toon/...); keys needed for poll, offline and test-connection errors are missing |

---

## 3. Architect's decisions (one recommendation each) - input for the new design, NOT binding

**(a) Replace `homey-wifidriver`: plain `Homey.Device` plus small in-repo modules.** ToonDevice uses nothing from the library. New layout:
`lib/ToonClient.js` (HTTP transport + endpoint methods), `lib/parse.js` (pure functions `payload -> { capabilityId: value }`
emitting only finite/valid values), poll loop in `device.js`.

**(b) HTTP client: built-in `fetch` with `AbortSignal.timeout(5000)`, `compatibility: ">=12.9.0"`.** Parse the body with
`JSON.parse(await res.text())` because the Toon serves `text/javascript`; check `res.ok` and `body.result !== 'error'`; a 404 on
`/water.html` means "add-on absent" (return `null`, not an error); no retries inside the client.

**(c) Polling.** Today there is none. Proposed: self-rescheduling `this.homey.setTimeout` chain (no `setInterval`) with an in-flight guard;
one cycle fetches thermostat -> current usage -> meter totals -> water; `poll_interval` setting default 30 s (min 10, max 3600);
after a `/water.html` 404 skip water for 15 min; after 3 consecutive failed cycles `setUnavailable(this.homey.__('offline'))`, first
success `setAvailable()`, back off up to 5 min, keep polling while unavailable (Homey blocks Flow actions on unavailable devices);
`onInit` runs the capability migration then schedules the first cycle WITHOUT awaiting network; write actions await the Toon then
schedule a refresh ~1.5 s later; `onSettings` validates `address` (throw -> Homey rejects) and restarts the poll on change;
`onDeleted` and `onUninit` clear the timer and set a `_stopped` flag; "Update ..." cards stay (existing Flows) and now reject on failure.

**(d) Pairing on `PairSession`.** `onPair(session)` registers `setHandler('testConnection', async ({ address }) => ...)` which normalises
`address` (trim, strip `http://` and trailing `/`, allow `host:port`), calls the thermostat endpoint with a 5 s timeout and returns
`{ currentTemp, currentSetpoint, programState }`; throws a localised Error on failure. `start.html` rewritten in vanilla JS with the
Homey Style Library: IP field, device-name field, "Toon hostname" field used as `data.id` (same scheme as today). Test button
shows live readings and enables Connect; Connect calls `Homey.createDevice({ name, data:{ id }, settings:{ address } })`.

**(e) Committed `node_modules`: untrack it after the runtime dependencies are removed** (the CLI copies the *local* `node_modules`).
Add `.gitignore` (`node_modules/`, `.homeybuild/`, `env.json`) and `.homeyignore`.

**(f) Flat `app.json` -> Homey Compose via `homey app compose`** as a mechanical step; card IDs and arg names are preserved.

**(g) `homey-log`: drop it** (never instantiated, no Sentry DSN).

**(h) Versions/metadata.** v1.1.0 hotfix release (keep `>=5.0.0`, Node 12-safe code) then v2.0.0 (`>=12.9.0`). `platforms: ["local"]`,
`connectivity: ["lan"]`. Use `homey app version` for `.homeychangelog.json`. Add `brandColor`, `support`/`source`/`bugs`, contributors
(moezie / Dennis Moes, oepi-loepi).

**(i) Data migration for already-paired devices (all additive, no re-pair).** In `onInit` add every capability from
`this.driver.manifest.capabilities` that `hasCapability` lacks; one-time migrations gated by store key `migrationVersion`;
`poll_interval` read as `Number(this.getSetting('poll_interval')) || 30`; `data.id` immutable; capability IDs, Flow card IDs and arg
names unchanged so Insights history and user Flows survive; duplicate trigger cards hidden with `deprecated: true`.

---

## 4. Architect's ordered work plan (superseded by the new SDLC plan; kept for reference)

Release 1 v1.1.0 "installable again": S1 manifest validity; S2 package.json metadata/tooling; S3 CI; S4 runtime hotfixes.
Release 2 v2.0.0 "v3-native": S5 Homey Compose; S6 drop homey-wifidriver / request-promise-native (`ToonClient`, `parse`);
S7 drop homey-log, untrack node_modules; S8 polling engine + availability + settings; S9 wire the 5 triggers; S10 pairing rewrite
+ locale clean-up; S11 release prep; S12 optional energy/data quality (3-decimal meters, `meter_power`, plain `meter_water`,
type-based meter-node discovery, export counters for issue #23).

---

## 5. Toon HTTP interface as used by the current `device.js`

All are `GET`, `http://<address>`, no auth, and the Toon responds with `Content-Type: text/javascript`.

| Purpose | URL (path?query) | Fields parsed | Notes |
|---|---|---|---|
| Thermostat status | `/happ_thermstat?action=getThermostatInfo` | `currentTemp`, `currentSetpoint` (centi-degC **strings**), `activeState` (0 comfort, 1 home, 2 sleep, 3 away, 4 vacation, -1 none), `burnerInfo` (0 off, 1 CH, 2 hot water, 3 preheat), `programState` | device.js:94,350-477 |
| Current usage | `/happ_pwrusage?action=GetCurrentUsage` | `powerUsage.value` (W), `powerUsage.dayUsage`/`dayLowUsage` (Wh) | `gasUsage{...}` is ignored; device.js:122,326-378 |
| Meter totals | `/hdrv_zwave?action=getDevices.json` | `dev_2.1.CurrentGasQuantity` (L), `dev_2.4`/`dev_2.6`/`dev_2.2` `.CurrentElectricityQuantity` (Wh, string, may be `"NaN"`) | device.js:151,332-402 |
| Water (ToonWater add-on) | `/water.html` | `water.flow` (L/min), `water.value` (L today), `water.total` (L) | 404 without the add-on; device.js:177,344,410-424 |
| Set state | `/happ_thermstat?action=changeSchemeState&state=2&temperatureState=<id>` | - | device.js:209 |
| Set setpoint | `/happ_thermstat?action=setSetpoint&Setpoint=<degC*100>` | - | device.js:247 |
| Program on / off | `/happ_thermstat?action=changeSchemeState&state=1` / `state=0` | - | device.js:272,297 |

Baseline harness results on the unmodified code (to be reproduced by the rebuilt test harness): S1 `Invalid Capability: meter_power`;
S2 +3 water `Invalid Capability` errors for legacy devices; S3 `Invalid value ... NaN` (water without `total`); S4 `temperature_state: undefined`
(vacation); S5 404 logged; S6 device offline but `available: true`; S7 sends `state=2` for resume=no; S8 `update_status` resolves while offline;
S9 `onDeleted` TypeError.

Suggested test layers: unit tests (`node --test`) for pure parsers against JSON fixtures (edge cases: `"NaN"` meter strings, missing `dev_2.4`,
`activeState` `"4"`/`"-1"`, water without `total`, `/water.html` 404, malformed JSON, `{"result":"error"}`); a stateful mock Toon HTTP server
plus a strict v3-shaped fake `homey` module run in CI with an assertion of zero unhandled rejections per scenario; `homey app validate --level publish`;
a real-Homey run against the mock; a legacy-upgrade simulation (a variant with the 2019 capability set); a manual regression checklist.

---

## 6. Open questions the architect raised (owner answers so far in brackets)

1. Continue or converge with toonWater? [OWNER: make ToonWater a feature that can be enabled - converge as an opt-in feature]
2. Hardware? [OWNER: has a Homey Pro and several Toons; start without hardware, validate later]
3. Distribution (App Store vs sideload)? [open]
4. Compatibility floor `>=12.9.0`? [open - decide in design]
5. Meter mapping (`dev_2.4/2.6` vs type-based; export counters, issue #23) - needs a real `getDevices.json` [open, hardware]
6. `resume_program = no` semantics - needs hardware [open, hardware]
7. Vacation state (`activeState` 4) as a new `vacation` enum value or "none"? [open]
8. Water capabilities for Toons without the add-on: leave empty or remove? [superseded by the opt-in ToonWater feature]
9. `alarm_water.hotwater` semantics (keep for compatibility, recommended) [open]
10. Branches: `Stable` is SDK 2 v1.0.0, `Develop` is SDK 3 "v1.0.0" [open]
11. Default poll interval 30 s? [open]

## 7. Corrections made earlier to the main agent's premises

* `homey-wifidriver` loads fine on v3; the real issue is that ToonDevice relies on nothing from it and `onDeleted` crashes.
* The water `total` is not a bug for the current ToonWater add-on (the doc comment is stale); the missing capability migration for older devices IS a confirmed bug.
* The Homey CLI does not install deps on build or publish; it copies the local `node_modules`.
* There is no polling or webhook of any kind.
* HEAD fails `homey app validate` at debug level, so it cannot be built or installed.
