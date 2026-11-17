# 06 - Implementation plan: Open-Toon 2.0.0 (nl.vinceste.open-toon, SDK v3)

| | |
|---|---|
| Role | Delivery planner / tech lead |
| Date | 2026-11-12 |
| Base | branch `redesign/sdk3`, commit `5cc3b90` (= `Develop`). Line numbers in baseline references are at that commit. Nothing in this run is committed. |
| Inputs | `05-architecture.md` rev 2 (the design), `docs/adr/0001..0018` (normative), `01-requirements.md` (ACs), `02-homey-standards.md`, `04-compat-contract.md` (CT-01..CT-08), `00-architect-audit.md` section 5 (endpoint table) |
| Output | This plan: 8 slices, executed strictly in order by one engineer, each ending with the repo green |
| Trust | The planner ran only read-only commands (file reads, `npm view`, `node -e` on the baseline `app.json`). **Nothing below was executed.** Every command and tool behaviour that the plan relies on and that I could not confirm is listed in section 7 with its fallback. |

---

## 0. How an executing agent uses this document

1. Read, in this order: this plan (your slice and sections 1, 2), `05-architecture.md`, the ADRs named in your slice, the acceptance criteria of the requirement ids of your slice in `01-requirements.md`.
2. The ADRs win over the architecture text, the architecture text wins over this plan. A conflict is a **deviation**: keep it minimal, state it in the slice report ("deviations"), never silently resolve it.
3. A slice is **done** when its acceptance checks (section 3) and the four verification commands (section 1.1) all pass on the real working tree, and the ratchet files (section 1.3) are in the state the slice demands.
4. Do not start work of a later slice "because it is convenient". The ordering is chosen so that every test double exists before the code that needs it, and so that no slice has to be reopened.

## 1. Rules that apply to every slice

### 1.1 Definition of green: the four verification commands

Run at the repo root, all must exit 0 at the end of every slice (Node 25 on the dev machine; the code and tests must nevertheless use only APIs that exist in Node 22, ADR-0012 and rule 6):

| # | Command | Meaning |
|---|---|---|
| V1 | `npm run lint` | `eslint --ext .js,.cjs --max-warnings 0 --ignore-path .gitignore .` (Athom config, type-aware, ADR-0012) |
| V2 | `npm test` | `node --require ./test/helpers/register.cjs --test "test/**/*.test.js"`, offline, < 60 s, zero unhandled rejections |
| V3 | `npm run validate` | `node scripts/validate.js`: runs `homey app validate --level publish` from the devDependency CLI (no global install) and fails when the committed `app.json` or `locales/*.json` differ from what the CLI composed (it rewrites `app.json` and exits 1 on drift; a second run is then green) |
| V4 | `npm run pack:check` | `node scripts/check-pack.js`: `homey app build`, list `.homeybuild/`, fail on any path outside `app.js`, `app.json`, `drivers/`, `lib/`, `locales/`, `assets/`, `package.json`, `package-lock.json`, `LICENSE`, `README*.txt` (plus `node_modules/` **only while** `package.json` `dependencies` is non-empty), delete `.homeybuild/` afterwards |

In the tables of this document a `\|` inside a command stands for a plain `|` (regex alternation or shell pipe); all `grep` calls use `-E`.

Extra scripts that individual slices add and check (not part of V1-V4): `test:coverage` (S2), `validate:verified` (S3, informational), `check:requirements` (S1).

### 1.2 Conventions

* **Test titles carry requirement ids.** A test title starts with the id(s) whose acceptance criteria it proves, e.g. `FR-52 AC1: enabling adds the three water capabilities`. A test that rests on an unverified Toon/Homey behaviour also carries its hardware id, e.g. `[HW-07]`. A characterisation test of a baseline defect is titled `BD-n [baseline] ...`; the regression test that replaces it is titled `... [fixes BD-n]`.
* **No dead code, no TODO/FIXME, no `console.log`** (use `this.log`/`this.error`). Verifiers grep for `require('homey-wifidriver')`, `request-promise`, `Homey.__`, `socket.on`, `new Homey.Flow`, bare/member global timers, `TODO|FIXME|console.log` in every touched file.
* **Every new user-visible string in `en` and `nl` in the same slice** (locale files or manifest text objects).
* **Scope of the forbidden-leftover grep.** It applies to `app.js`, `drivers/**` (JavaScript), `lib/**` and `scripts/**`. `Homey.__`, `Homey.emit`, `Homey.createDevice` are the documented **front-end** API of pair views and are correct inside `drivers/open-toon/pair/*.html`. Files that must contain the forbidden literals as data (the lint fixtures under `test/fixtures/lint/`, the pattern lists in `test/static/*.test.js`, `docs/`) are exempt; keep such literals out of every other test file (assemble patterns from fragments where possible).
* **Git**: read-only commands only (`git status`, `git diff`, `git show 5cc3b90:<path>`, `git check-ignore`, `git ls-files`). `HEAD` must still be `5cc3b90` at the end of every slice.
* **npm**: `npm install --ignore-scripts` / `npm ci --ignore-scripts`, devDependencies only, never `-g`, never `sudo`. `node_modules/` is tracked at the base commit (1,880 files): installing tooling adds ignored files and may rewrite tracked ones; that is expected. Removing the dead runtime dependencies and pruning `node_modules/` is **slice 8** (until then the baseline code and its characterisation tests still need them). The owner's `git rm -r --cached node_modules` at commit time is not part of this run.
* **Provenance**: `lib/features/toonwater.js` starts with the header of `05-architecture.md` section 6.2; nothing is read from or paraphrased from `oepi-loepi/*`.
* **Size budget** (ADR-0002): `lib/` has at most 16 files, each under ~150 lines (hard limit enforced in S8: 250 lines).

### 1.3 Ratchets: how "green" can be strict while the work arrives in slices

> **Closed (review finding S-06).** All ratchets ended empty after S8. The three JSON files, `test/helpers/ratchet.js`, `test/static/baseline-ledger.test.js` and the `--write-pending` and `--strict` modes of `scripts/check-requirements.js` were then removed: the script now only checks that every mock-verifiable MUST/SHOULD id is named by a test title and that no title names an unknown id (`npm run check:requirements`). What follows is the plan as it was executed.

Four JSON files let a static test be strict from slice 1 without forcing the end state early. Each is validated by a test in `test/static/`; the rule is always "the file equals the real state", so a stale entry is a failure in either direction.

| File | Rule enforced | Start (S1) | End (S8) |
|---|---|---|---|
| `test/fixtures/requirements-pending.json` | exactly the MUST/SHOULD requirement ids whose verify column in `01-requirements.md` section 9 contains `M` and that no test title names yet (computed by `scripts/check-requirements.js`; also fails on any test title that names an unknown `FR-`/`NFR-` id) | all 73 ids | `[]` |
| `test/fixtures/baseline-pending.json` | exactly the defect ids `BD-1..BD-9` (section 4.3) that have no `[fixes BD-n]` test outside `test/baseline/`; and `test/baseline/` exists **iff** `drivers/open-toon/device.js` still contains `homey-wifidriver` | `BD-1..BD-9` | `[]`, `test/baseline/` absent |
| `test/fixtures/i18n-unused-allowed.json` | the set of keys present in `locales/en.json` but referenced by no code/HTML (missing keys in en/nl are always an error) | the baseline's unused keys (about 15, `00` section 2 "locales") | `[]` |
| `.eslintrc.json#ignorePatterns` | the only files allowed to violate lint and the layering rules; the static tests read this one list | `app.js`, `drivers/open-toon/device.js`, `drivers/open-toon/driver.js` | absent/empty (emptied in S4 when those files are rewritten) |

The pending list of requirement ids is cumulative: every slice's check says "none of these ids is still pending"; ids may leave earlier than listed, never later.

## 2. Slice overview

| Slice | Title | Size | Needs | Adds | Leaves for later |
|---|---|---|---|---|---|
| **S1** | Tooling, test infrastructure, baseline characterisation | L | - | `package.json`, lint, validate, pack check, fake Homey, mock Toon, fake clock, fetch adapter, fixtures, static tests, `BD-1..9` characterisation, minimal manifest repair | everything else |
| **S2** | Toon interface layer: `lib/toon` + `lib/messages.js` | M | S1 | errors, address, client, parse, meters, commands, user messages (en+nl), unit + L1 tests | engine, device |
| **S3** | Homey Compose manifest foundation + feature registry planners | M | S1 | `.homeycompose/**`, driver compose files, regenerated `app.json`, version 2.0.0, `lib/features/{index,core}.js`, `lib/engine/capabilities.js` (pure planners), synthetic-feature test | polling, device |
| **S4** | Engine and device lifecycle for the core feature | XL | S1-S3 | poller + lane + availability, `applyValues`, `reconcile`, `ToonDevice`, `ToonApp`, `driver.js` (client factory), migration of eras 0-3, write path, teardown; baseline code deleted | ToonWater, pairing, cards |
| **S5** | ToonWater and power-export features, incl. migration decision | L | S4 | `lib/features/{toonwater,export}.js`, toggle in `onSettings`, detection/back-off/status/warning/hint, legacy decision matrix | pairing checkbox, cards |
| **S6** | Pairing on `PairSession` | M | S5 | `lib/engine/pairing.js`, `onPair(session)`, `pair/start.html` | cards |
| **S7** | Flow cards and triggers | L | S6 | `lib/flow/cards.js`, trigger firing, burner cards wired, `update_*` semantics, legacy argument shapes | release hygiene |
| **S8** | Release hygiene: locales sweep, dependency removal, CI, docs files | M | S7 | zero runtime dependencies, `node_modules/` pruned, CI + Dependabot, README/CONTRIBUTING/changelog, all ratchets closed, coverage gate | - |

Dependency logic: S1 provides every double (fake Homey, mock Toon, clock, adapter) before any production code. S2 and S3 are independent of each other but both precede S4, which needs the client, the parsers, the manifest definitions (`burner_state`, `vacation`, settings, `CORE`) and the generic planners. S5 needs the engine. S6 needs the registry and the ToonWater probe (S5). S7 needs the device API (S4), the features' rules (S5) and the probe-free card guard data (S5).

The manifest cards are all declared in S3 (new burner cards, deprecations); their run listeners arrive in S7. Between S4 and S7 the repo is green but not releasable (no card listeners; from S4 to S6 no pairing handler). That is deliberate: it keeps every slice free of throw-away glue.

---

## 3. Slices

### S1 - Tooling, test infrastructure, baseline characterisation

**Goal.** After this slice a new engineer can run lint, tests, validation and the pack check with no global tool, every test double named in ADR-0013 exists and is itself tested, the stability contract (CT-01) is a running test against the baseline manifest, and the nine baseline defects are pinned as tests so that later fixes are visible. No production code changes except the smallest manifest repair that makes `validate` pass.

**Work items.**

1. `package.json`: `name nl.vinceste.open-toon`, `license GPL-3.0`, `repository`/`bugs`/`homepage` -> `StefanPostma/nl.vinceste.open-toon`, `engines.node >=22`, `main app.js`, version **unchanged** (`1.0.0`, bumped in S3), scripts `test`, `lint`, `validate`, `pack:check`, `check:requirements`. `dependencies` **unchanged** (`homey-log`, `homey-wifidriver`; removed in S8). `devDependencies` (ADR-0011/0012): `homey ~4.6.3`, `eslint ~8.57.1`, `eslint-config-athom ~4.0.2`, `@types/homey npm:homey-apps-sdk-v3-types@^1.8.3`, `@types/node ~22`. **Never** `typescript` directly. Then `npm install --ignore-scripts` (lockfile regenerated).
2. `.gitignore` (`node_modules/`, `.homeybuild/`, `env.json`), `.homeyignore` (`docs/`, `test/`, `scripts/`, `*.md`, `CONTRIBUTING.md`, `.github/`, `tsconfig.eslint.json`), `.nvmrc` (`22`), `.eslintrc.json` (exactly ADR-0012 plus `ignorePatterns` for the three legacy files), `tsconfig.eslint.json` (ADR-0012 text; if TypeScript resolves `homey` to the CLI package instead of `@types/homey`, add `paths: {"homey": ["./node_modules/@types/homey"]}`, the lint canary below is the detector).
3. `scripts/validate.js` (runs the CLI through `node_modules/.bin/homey`, compares byte hashes of `app.json` and `locales/*.json` before/after, rewrites and fails on drift), `scripts/check-pack.js`, `scripts/check-requirements.js` (parses the section 9 table of `docs/sdlc/01-requirements.md`; exports the functions the static test uses; `--write-pending` regenerates the ratchet file).
4. `test/helpers/`:
   * `register.cjs`: hooks `Module._resolveFilename` so `'homey'` resolves to `test/helpers/fake-homey/index.js` (note: `node_modules/homey` now exists as the CLI package; the hook must win), installs `unhandledRejection`/`uncaughtException` counters that fail the test file when non-zero, with an explicit `expectUnhandled(n)` escape hatch used only by `test/baseline/**`.
   * `fake-homey/` (strict, SDK v3 shape; ADR-0013): `Homey.App/Driver/Device`, `this.homey` managers (`setTimeout/clearTimeout/setInterval/clearInterval` on the fake clock, `__` against the real `locales/*.json` that **throws on a missing key** and can be switched en/nl, `flow.get{Action,Condition,Trigger,DeviceTrigger}Card` that throw on an id not in the manifest, `notifications.createNotification`, `env`, `manifest`). Device model: `get/set` data, store, settings; `setSettings` does **not** call `onSettings`; `simulateSettingsSave(newSettings)` calls `onSettings({oldSettings,newSettings,changedKeys})`, rejection keeps the old settings, resolution persists `newSettings`; capabilities read from the real `app.json` (type, enum values, `step`, options): `setCapabilityValue` throws `Invalid Capability`, rejects a wrong type, an enum value outside the list and an **off-step `target_temperature`**; a capability value is stored **only when its registered listener resolves** (`simulateCapabilitySet`); `add/removeCapability`, `get/setCapabilityOptions`; `setUnavailable(message)` (a callback argument throws), `setAvailable`, `setWarning/unsetWarning`; `getDeviceTriggerCard(...).trigger()` records calls and, with flag `autoFireCustomTriggers`, models Homey's own `<custom capability>_changed`; v2-only API (`Homey.__`, `Homey.ManagerSettings`, `new Homey.FlowCardAction`, `socket.on`) throws a descriptive error; a fake `PairSession` (`setHandler`, `emit`, `showView`, `done`, `createDevice` with a duplicate-id error). Factory `createDevice({driverId, data, settings, store, capabilities, values})`, `deleteDevice()`, `restartApp()` (re-instantiates devices over the same fake store; needed by FR-62 and the migration tests).
   * `fake-clock.js` (`tick(ms)`, `runAll`, armed-timer count) behind `homey.setTimeout` and the injected `timers`.
   * `mock-toon.js`: stateful handler `(req) -> {status, headers, body, delayMs}` for every endpoint of `00` section 5 (reads and the `setSetpoint`/`changeSchemeState` writes mutating state), layouts `dev_2`/`dev_3`, single/two tariff, water modes `present/404/html-200/403/500/old-shape/flat-ESP/junk/slow`, faults `500/timeout/refused/redirect/oversize/result-error/idle-close`, vacation, request log `{start,end,abortedByClient,headers}`, `maxConcurrent()`, `openHandlers()`; a `node:http` wrapper on `127.0.0.1:0`; `fetchAdapter(handler,{timers})` with the contract of ADR-0013 (real `Response`s, delays on the injected timers, honours `signal`, the handler keeps "running" after a client abort).
   * `fixtures.js` (loader), `ratchet.js` (shared helper for section 1.3).
5. `test/fixtures/`: `toon/*.json` as `{ "source": "derived from 00 section 5 / issue #11, not captured; HW-02", "payload": {...} }` covering: thermostat (`activeState` 0,1,2,3,4,-1 as strings and numbers; `burnerInfo` 0-3; centi-degree strings incl. `"1975"`), power (`GetCurrentUsage` with and without `powerProduction`, no `dayUsage`), `getDevices.json` (`dev_2` two-tariff, `dev_2` single-tariff with `"NaN"` nt node, `dev_3` layout, node missing), water (ok, old shape without `total`, flat ESP `waterflow/waterquantity`, HTML), junk (`{}`, `{"result":"error"}`, truncated, empty, HTML) and the hostile shapes of ADR-0003 (`{"dev_2.4": null}`, `{"dev_2.4": {"hasOwnProperty": 1}}`, `{"__proto__": {"polluted": 1}}`, `{"water": []}`, `{"powerUsage": "460"}`); `eras.json` (= `04` Appendix B plus value variants a/b/c); `baseline-app.json` (byte-identical to `git show 5cc3b90:app.json`); `contract-exceptions.json` (ADR-0017 content); `lint/floating-promise-device.js`, `lint/global-timer.js`; the four ratchet files in their start state.
6. Static tests (`test/static/`): `contract.test.js` (CT-01 as revised by ADR-0017: baseline vs candidate, capability rule `capabilities ∪ keys(capabilitiesOptions) ∪ FEATURES[*].capabilities` + exception file with existing ADR files, `device` argument filter string, card/arg/token/dropdown/setting/enum/`energy`/class/app-id checks, no un-deprecation) **with a negative case per violation class**; `i18n.test.js` (every `__('k')` in `app.js`, `drivers/**`, `pair/*.html`, `lib/**` resolves in en and nl; manifest text objects have en+nl; unused-key ratchet); `layering.test.js` (the grep rules of `05` section 2 on every file not in `ignorePatterns`); `lint-canary.test.js` (ADR-0012); `node22.test.js` (denylist of post-22 APIs: `Promise.try`, `RegExp.escape`, `Error.isError`, `Float16Array`, `Math.f16round`, `Uint8Array.fromBase64`, `Atomics.pause`, `node:sqlite`; `.nvmrc` is `22`); `requirements.test.js` and `baseline-ledger.test.js` (ratchets); `fixtures.test.js` (every fixture has `source` and `payload`).
7. `test/baseline/*.test.js`: one test per defect `BD-1..BD-9` (section 4.3), run against the **unmodified** `app.js`/`device.js`/`driver.js` (committed `node_modules` supply `homey-wifidriver`/`request-promise-native`; the fake gets a permissive shim for the module-scope `require('homey')` of that library only inside `test/baseline/`).
8. `app.json`: the smallest repair that makes `homey app validate --level publish` pass: `[[resume_program]]` in en and nl `titleFormatted` of `set_temperature_state` (`app.json:388-391`) and a `brandColor`. No id, argument, token or value changes.

**Files touched.** `package.json`, `package-lock.json`, `.gitignore`, `.homeyignore`, `.nvmrc`, `.eslintrc.json`, `tsconfig.eslint.json`, `scripts/{validate,check-pack,check-requirements}.js`, `test/helpers/**`, `test/fixtures/**`, `test/unit/{fake-homey,fake-clock,mock-toon,fetch-adapter}.test.js`, `test/static/*.test.js`, `test/baseline/*.test.js`, `app.json`. **Not touched:** `app.js`, `drivers/**`, `locales/**`, `.github/**`.

**Requirement ids.** FR-76, FR-100, FR-120 (validate green), NFR-01, NFR-02, NFR-06, NFR-10, NFR-11 (licence), NFR-13, NFR-15 (layering), and the test-harness half of NFR-14.

**Acceptance checks.**

| # | Command / action | Expected |
|---|---|---|
| 1 | `npm install --ignore-scripts` | exit 0, no `-g`, no scripts run |
| 2 | `node -e "const p=require('./package.json');process.exit(p.name==='nl.vinceste.open-toon'&&p.license==='GPL-3.0'&&p.engines.node==='>=22'&&['test','lint','validate','pack:check'].every(s=>p.scripts[s])&&Object.keys(p.dependencies).sort().join()==='homey-log,homey-wifidriver'&&['homey','eslint','eslint-config-athom','@types/homey','@types/node'].every(d=>p.devDependencies[d])&&!p.devDependencies.typescript?0:1)"` | exit 0 |
| 3 | V1 `npm run lint` | exit 0, no warnings (the tree incl. `test/**`, `scripts/**` is inside the type-aware project) |
| 4 | V2 `npm test` | exit 0, `fail 0`, wall time < 60 s |
| 5 | V3 `npm run validate` | exit 0 at publish level; a second run changes nothing |
| 6 | V4 `npm run pack:check` | exit 0; `.homeybuild/` absent afterwards |
| 7 | `node -e` comparing `git show 5cc3b90:app.json` with `app.json` | differ only in `brandColor` and the en/nl `titleFormatted` of `set_temperature_state`; `cmp <(git show 5cc3b90:app.json) test/fixtures/baseline-app.json` is empty |
| 8 | `git check-ignore node_modules .homeybuild env.json`; `grep -cE '^(docs/|test/|scripts/|\*\.md|CONTRIBUTING\.md|\.github/|tsconfig\.eslint\.json)$' .homeyignore` | prints all three paths; count is 7 |
| 9 | `grep -E 'invalid capability\|off-step\|unknown flow card\|missing translation\|v2-only\|setUnavailable callback\|does not call onSettings\|listener rejection' test/unit/fake-homey.test.js` | every strictness property of the fake has a test and `node --require ./test/helpers/register.cjs --test test/unit/fake-homey.test.js` passes |
| 10 | `node --require ./test/helpers/register.cjs --test test/unit/fetch-adapter.test.js` | passes; three equivalence tests named `abort-while-waiting`, `abort-while-streaming`, `completion-after-abort` run the same handler through `fetchAdapter` and through `node:http` + real `fetch` and assert equal observable results |
| 11 | `test/static/lint-canary.test.js` | passes: exactly one `@typescript-eslint/no-floating-promises` report on the fixture device; the second fixture (`global.setTimeout(...)`) is caught by `layering.test.js` and not by ESLint |
| 12 | `test/static/contract.test.js` | passes on the repaired `app.json`; contains at least 10 negative cases (capability dropped without exception, card removed, arg removed, arg retyped, dropdown value removed, token retyped, setting key removed, enum value removed, `energy` changed, filter string changed, card un-deprecated) and each is reported |
| 13 | `node --require ./test/helpers/register.cjs --test test/baseline/*.test.js`; `grep -rc '\[baseline\]' test/baseline` | passes; nine tests `BD-1` .. `BD-9 [baseline]` |
| 14 | `node -e "const p=require('./test/fixtures/requirements-pending.json');const gone=['FR-76','FR-100','NFR-01','NFR-02','NFR-06','NFR-10','NFR-11','NFR-13','NFR-15'];process.exit(gone.some(i=>p.includes(i))||!p.includes('FR-52')||p.length<50?1:0)"` | exit 0 |
| 15 | `node -e "process.exit(require('./test/fixtures/baseline-pending.json').join()==='BD-1,BD-2,BD-3,BD-4,BD-5,BD-6,BD-7,BD-8,BD-9'?0:1)"` | exit 0 |
| 16 | `git status --short -- app.js drivers locales .github`; `git rev-parse HEAD` | no output; `5cc3b90...` |
| 17 | `grep -rnE "TODO\|FIXME\|console\.log" scripts test` and the forbidden-leftover grep of section 1.2 over `scripts/` | no match; the only files that contain forbidden literals as data are under `test/fixtures/lint/` and `test/static/` |

**Risks / fallbacks.** (a) If `homey app build` needs a login or Docker, `check-pack.js` computes the list from the CLI's default ignore list plus `.homeyignore` in Node and the deviation is reported; the command name stays. (b) If the baseline library cannot be loaded even with the permissive shim, `test/baseline/` characterises `onDeleted`, the capability writes and the request URLs by calling the prototype methods on a hand-built instance; the `BD-n [baseline]` titles and the ledger rule stay. (c) If `homey app validate` cannot run offline, stop and report: it is the single most load-bearing assumption of the tooling.

---

### S2 - Toon interface layer: `lib/toon` and `lib/messages.js`

**Goal.** Everything that knows the Toon's HTTP interface exists as pure, hostile-input-safe modules plus one `fetch`-based client, with user-readable errors in English and Dutch. Nothing here requires Homey.

**Work items.**

1. `lib/toon/errors.js` (`ToonError {kind,status,cause}`, `KINDS`, `isNotFound`, `isAborted`), `address.js` (`normalizeAddress(any) -> {ok,host}|{ok:false,reason}`; never throws; rejects `https://` and IPv6 with their own reasons; `:99999`, `12`, `null`, `{}`, `" 192.168.1.50 "`, `192.168.1.50:80`), `client.js` (ADR-0003: `new URL` building, `redirect:'manual'`, `Accept-Encoding: identity`, `Connection: close`, per-request `AbortController` on injected timers with the epoch signal attached through an `abort` listener removed in `finally`, 2 MiB cap on a stream counter, `await res.body?.cancel()` on every non-success path, `JSON.parse(text)`, `result === 'error'`, no retries, no user text), `parse.js` (`parseThermostat`, `parsePower` -> `{values, notes}`; setpoint rounded to 0.5, temperature to 0.1; `activeState` table incl. `vacation`; `burnerInfo` table; `alarm_water.hotwater` from `burnerInfo === 2`; `powerProduction` -> `measure_power.export`; no `dayUsage` branch; 3-decimal meters; only finite values; `Object.hasOwn`, never methods on payload objects, never spreading a payload), `meters.js` (`discoverMeters` + `METER_RULES`, legacy `dev_2.x` keys first, ambiguity -> no write + one note), `commands.js` (`setpoint` x100 integer within 6..30, `RESUME` table of ADR-0015, `programOn/Off`, URL objects only).
2. `lib/messages.js`: `toUserMessage(homey, err)` over a literal `kind -> key` table (`error.timeout`, `error.network`, `error.http` with `__status__`, `error.bad_body`, `error.toon_error`, `error.aborted`, `error.address_https`, `error.address_ipv6`, `error.not_toon`, `error.vacation_readonly`), plain words, no internals (NFR-16 AC1).
3. `locales/en.json` and `locales/nl.json`: add exactly these keys in both; do not delete baseline keys yet.
4. Tests: `test/unit/{address,parse-thermostat,parse-power,meters,commands,client,messages}.test.js` over the S1 fixtures and the full FR-24 AC1 edge matrix; L1 client tests against the `node:http` mock; `package.json` script `test:coverage` (`--experimental-test-coverage --test-coverage-include="lib/**" --test-coverage-lines=90`).

**Files touched.** `lib/toon/{errors,address,client,parse,meters,commands}.js`, `lib/messages.js`, `locales/en.json`, `locales/nl.json`, `package.json` (script only), `test/unit/*.test.js` (new), `test/fixtures/*` (ratchet files, extra fixtures), `test/helpers/*` (only if a double needs a missing mode).

**Requirement ids.** FR-03, FR-10, FR-11, FR-12, FR-13, FR-14, FR-20, FR-21, FR-22, FR-24, FR-25 (parse), FR-28, FR-30, FR-31 (flag), FR-114 (precision), NFR-03 (timeouts, size cap, one request shape), NFR-04, NFR-15, NFR-16.

**Acceptance checks.**

| # | Command / action | Expected |
|---|---|---|
| 1 | V1-V4 | all exit 0 |
| 2 | `node --require ./test/helpers/register.cjs --test test/unit/address.test.js test/unit/parse-thermostat.test.js test/unit/parse-power.test.js test/unit/meters.test.js test/unit/commands.test.js test/unit/client.test.js test/unit/messages.test.js` | exit 0 |
| 3 | `npm run test:coverage` | exit 0; >= 90 % lines over `lib/**` |
| 4 | `grep -rnE "require\(['\"](node:)?(http\|https\|net\|dns\|undici\|child_process\|dgram\|tls)['\"]\)\|globalThis\.fetch\|setTimeout\(\|setInterval\(\|require\('homey'\)\|water\.html" lib` | no match (the client receives `fetch` and `timers` by injection; `/water.html` is first allowed in S5 in `lib/features/toonwater.js`) |
| 5 | Address table in `address.test.js` | contains `[fe80::1]`, `fe80::1`, `https://1.2.3.4`, `:99999`, `12`, `null`, `{}`, whitespace, `host:port`; none throws; IPv6 and `https://` return distinct reasons |
| 6 | Parser tests | `"1975"` -> `target_temperature` 20.0; `activeState` `"4"`/`4` -> `vacation`, `"-1"` -> `none`, unknown -> no value (never `undefined`); `burnerInfo` 0..3 -> `off/heating/hot_water/preheating` and `alarm_water.hotwater` only for 2; `"NaN"`, `null`, negative, `0` cumulative -> not emitted; two-tariff and single-tariff fixtures; `dev_3` fixture found via `METER_RULES`; ambiguity -> no value + one note |
| 7 | Hostile fixtures | each of the five shapes of ADR-0003 parses without throwing, emits no value, and `({}).polluted === undefined` afterwards (`{"__proto__":{"polluted":1}}`) |
| 8 | L1 client tests | server sees `connection: close` and `accept-encoding: identity`; after 50 error responses `server.getConnections() <= 1` and `process.getActiveResourcesInfo()` is unchanged; 3xx -> `redirect`; > 2 MiB -> `too_large` with the stream cancelled; `text/javascript` body parses; `result:"error"` -> `toon_error`; timeout via fake timers -> `timeout`; abort via signal -> `aborted`; per-request controller does not accumulate listeners on the epoch signal |
| 9 | `commands.test.js` | `setpoint(20.5)` -> `Setpoint=2050` (integer); 5.9, 30.1, NaN, `"20"` rejected; `RESUME.yes` and `RESUME.no` produce different request lists; `undefined` -> `yes` |
| 10 | `messages.test.js` + `test/static/i18n.test.js` | every `ToonError` kind has a key present in en and nl; the new keys exist in both files with no mismatch; no message contains `fetch`, `undici`, `ECONNRESET` or a capability id |
| 11 | `node -e "const p=require('./test/fixtures/requirements-pending.json');const gone=['FR-03','FR-10','FR-11','FR-12','FR-13','FR-14','FR-20','FR-21','FR-22','FR-24','FR-28','FR-30','NFR-04','NFR-16'];process.exit(gone.some(i=>p.includes(i))?1:0)"` | exit 0 (cumulative with S1) |
| 12 | `git diff --stat -- drivers app.js app.json` | empty |

**Risks / fallbacks.** The meter `type` strings (`METER_RULES`) and the `identity` encoding are M-confidence tables seeded from `03`; they are single-point tables and tagged `[HW-02]`/`[HW-H4]` in test titles, not hard-coded elsewhere.

---

### S3 - Homey Compose manifest foundation and feature-registry planners

**Goal.** The manifest is produced by Homey Compose from small reviewable sources, carries every capability, setting, card and metadata definition the design needs (so later slices never edit generated `app.json`), still satisfies the stability contract, and the generic, pure planners (feature registry, migration/capability plan) exist and are proven feature-agnostic with a synthetic feature.

**Work items.**

1. `npx homey app compose` once (ADR-0002 step 1; if the subcommand is absent in the CLI, split by hand following the same file list), then maintain only compose sources: `.homeycompose/app.json` (id, `version 2.0.0`, `compatibility >=12.9.0`, `sdk 3`, `platforms ["local"]`, `brandColor`, `permissions []`, `category climate`, images, author, **all existing contributors kept**, `support/source/bugs/homepage` -> StefanPostma, `description` en+nl that is not the name, `tags` en+nl), `.homeycompose/capabilities/temperature_state.json` (baseline values + `vacation`), `.homeycompose/capabilities/burner_state.json` (ADR-0014 definition), `drivers/open-toon/driver.compose.json` (class, `platforms`, `connectivity ["lan"]`, `capabilities` = the nine `CORE` ids, `capabilitiesOptions` = superset incl. the water trio and `measure_power.export`, `energy {"cumulative": true}` byte-identical, `pair [start]`, images), `driver.settings.compose.json` (`address` + hint + pattern, `poll_interval`, `last_update`/`last_problem` labels, group "ToonWater (optional add-on)" with `toonwater_enabled` checkbox `value:false` + FR-59 hint with the Insights clause and `toonwater_status` label, group "Power export (optional)" with `export_enabled`), `driver.flow.compose.json` (all 14 baseline cards with ids/args/tokens unchanged; `deprecated: true` on `meter_gas_changed`, `measure_water_changed`, `update_powerusage`, `update_metertotals`, `update_water`; `[[resume_program]]` in `titleFormatted`; nl `!{{is|is niet}}`; `title` on every dropdown arg and `title`+`label` on dropdown values; `vacation` in `temperature_state_is` only; token title `kWh`; new `burner_state_changed_to` trigger with `state` dropdown and `burner_state_is` condition). **Never create `.homeycompose/locales/`.**
2. Run `npm run validate` until it is stable; commit-ready generated `app.json`; `package.json` version `2.0.0`; script `validate:verified`.
3. `lib/features/index.js` (`FEATURES`, `featureState(settings)`, `activeGroups(state)`, `legacyDefaults(capabilities)`, `capabilitiesFor(state)`), `lib/features/core.js` (`always:true`, the nine capabilities, groups `thermostat(critical)`, `power`, `meters`), `lib/engine/capabilities.js` (**pure** `planMigration`, `planCapabilities`; `reconcile` arrives in S4).
4. `test/helpers/feature-synthetic.js` (setting `synthetic_enabled`, one capability, one poll group on `/synthetic.json`).
5. Tests: `test/static/manifest.test.js`, `test/static/registry-vs-manifest.test.js` (every feature capability/setting/card exists in the manifest; optional-feature settings are `checkbox` with `value:false`; `CORE` equals `driver.compose.json` `capabilities`), extension of `contract.test.js` (exception file now exercised: the three water ids are absent from `capabilities`), `test/unit/planners.test.js` (L0 tables incl. the synthetic feature).

**Files touched.** `.homeycompose/**`, `drivers/open-toon/driver.compose.json`, `driver.settings.compose.json`, `driver.flow.compose.json`, `app.json` (generated), `package.json`, `lib/features/{index,core}.js`, `lib/engine/capabilities.js`, `test/helpers/feature-synthetic.js`, `test/static/*.test.js`, `test/unit/planners.test.js`, `test/fixtures/contract-exceptions.json`. **Not touched:** `app.js`, `drivers/open-toon/{device,driver}.js`, `locales/**`.

**Requirement ids.** FR-12 (enum value), FR-30 and FR-32 (definitions), FR-50, FR-51 (AC1 manifest side), FR-59 (setting texts), FR-71, FR-75, FR-77, FR-83 and FR-85 (definitions), FR-90 (deferral: `energy` unchanged, no imported capability), FR-100 (manifest en+nl), FR-110/FR-111 (pure planners), FR-120, FR-121 (manifest side), NFR-07, NFR-11 (package metadata, contributors), NFR-14 (contract on the composed manifest), FR-76.

**Acceptance checks.**

| # | Command / action | Expected |
|---|---|---|
| 1 | V1-V4 | all exit 0 |
| 2 | `npm run validate` twice; `shasum app.json locales/*.json` before and after the second run | exit 0 both times; hashes identical (no drift) |
| 3 | `test -d .homeycompose && ! test -e .homeycompose/locales && test -f drivers/open-toon/driver.compose.json && test -f drivers/open-toon/driver.settings.compose.json && test -f drivers/open-toon/driver.flow.compose.json` | exit 0 |
| 4 | `node -e` on `app.json` | `version==='2.0.0'`, `compatibility==='>=12.9.0'`, `sdk===3`, `platforms` `['local']`, driver `connectivity` `['lan']`, `brandColor` set, `description.en!==name.en`, `description.nl!==name.nl`, `tags.en`/`tags.nl` non-empty; `package.json` version equals it; the contributor list of the baseline is a subset |
| 5 | `node -e` on `app.json` | driver `capabilities` equals the nine `CORE` ids and contains none of `measure_water`, `meter_water.today`, `meter_water.total`; those three plus `measure_power.export` are keys of `capabilitiesOptions`; `JSON.stringify(energy)` equals the baseline's |
| 6 | `test/static/contract.test.js` | passes with `test/fixtures/contract-exceptions.json` naming exactly the three water ids -> ADR-0017 (file exists under `docs/adr/`); the filter string of every device argument is byte-identical `driver_id=open-toon`; the five cards are `deprecated:true`, `update_status` is not |
| 7 | `test/static/manifest.test.js` | passes: en+nl on every text object; dropdown args have `title`; `set_temperature_state.titleFormatted` en/nl contain `[[resume_program]]`; no `\|\|` in any `titleFormatted`; `toonwater_enabled` and `export_enabled` are `checkbox` with `value:false`; `toonwater_status` is `label`; `temperature_state` enum is the baseline list + `vacation`; `burner_state` has `getable:true, setable:false, uiComponent:'sensor', insights:false` and four values; `vacation` appears in the `temperature_state_is` dropdown and not in `set_temperature_state` |
| 8 | `node --require ./test/helpers/register.cjs --test test/unit/planners.test.js` | passes; includes: marker absent -> legacy; marker present -> no decision; era 0-3 fixtures produce the plans of `05` section 9 (adds only; extras kept; never `meter_power`); `desired` is never "all of `driver.manifest.capabilities`"; the synthetic feature (registered only inside the test) gets a setting, a poll group and a capability plan with **zero edits** to `lib/engine/**` |
| 9 | `npm run validate:verified` | exit 0 (informational; a failure is reported as a note, not a blocker) |
| 10 | `node -e` pending check | none of `FR-50, FR-71, FR-75, FR-77, FR-83, FR-90, FR-120, NFR-07, FR-32, FR-111` remains in `requirements-pending.json` (cumulative with S1-S2) |
| 11 | `git diff --stat -- drivers/open-toon/device.js drivers/open-toon/driver.js app.js locales` | empty |

**Risks / fallbacks.** The validator must accept `capabilitiesOptions` keys that are not in `capabilities` (read from `homey-lib` source by two reviewers, never run). If `npm run validate` rejects the manifest for that reason, **stop and report**: the fallback is an ADR-0017 amendment (a design change), not a silent re-listing of the water ids.

---

### S4 - Engine and device lifecycle for the core feature

**Goal.** A paired Toon is polled, kept available/unavailable correctly, written to safely, migrated offline per device era, and cleaned up on delete; the baseline `device.js`, `driver.js`, `app.js`, their `homey-wifidriver` dependency use and the lint exemptions are gone.

**Work items.**

1. `lib/engine/poller.js`: `Poller` (self-rescheduling `this.homey.setTimeout` chain, one in-flight cycle, first cycle 1 s + 0-2 s jitter, `activeGroups` in order, per-group try/catch, transport short-circuit, `every: n`), `Lane` (priority `write > refresh > poll`, exactly one request in flight, never aborts for priority, per-group refresh coalescing), pure `backoffMs` (floor = interval, ADR-0005) and `availabilityStep` (`failures >= 3 && elapsed >= 90 s || failures >= 2 && elapsed >= 15 min`), `intervalMs` (`clamp(Number(x) || 30, 10, 3600)`).
2. `lib/engine/apply.js`: `applyValues` as the single `setCapabilityValue` writer (finite-only, skips ids the device lacks, `.catch` on every call, `gen`/`featureGen`/`writeSeq`/`_stopped` guards), `meterGuard` (counter-decrease policy of ADR-0014; `meter_water.today` exempt), change detection returning `Change[]` and an `onChanges` callback (no trigger knowledge yet).
3. `lib/engine/capabilities.js`: `reconcile(device, plan)` (guarded add, options reconciliation only when `getCapabilityOptions` deep-differs, compensating removal on a failed step, `_stopped` checks, under the serial queue).
4. `lib/features/core.js`: add the three poll groups, parsers from S2, and the hot-water/burner value mapping.
5. `drivers/open-toon/device.js` (`ToonDevice extends Homey.Device`, thin hooks): `onInit` = migration (M-1..M-7, offline, marker last) -> reconcile -> poller start without awaiting the network; settings defaults resolved on read (`poll_interval`, `address`); `0.0.0.0`/empty -> `setUnavailable(__('address_missing'))` and no poller; `onSettings(newSettings, changedKeys)` via pure `planSettingsChange` (validation errors as localized `Error`s; address change bumps `gen`, aborts the epoch, starts the poller when the stored address was invalid; interval change; toggles array handled generically, used from S5); capability listeners for `target_temperature` (latest-wins single flight, `Math.round(deg*100)`, no optimistic write, refresh after 1.5 s) and `temperature_state` (rejects `vacation` with `error.vacation_readonly`); device methods the cards will call in S7 (`refresh(groupIds)`, `setTemperatureState`, `programOn/Off`); `last_update` (<= every 15 min) and `last_problem` (on transition); `_teardown()` idempotent, rejects queued tasks with `ToonError('aborted')`; every timer entry point is async with a top-level `try/catch`.
6. `drivers/open-toon/driver.js`: `onInit` only (`createClient(host, timers)` is the single place that references `globalThis.fetch`). Legacy `onPair(socket)` and `mapDeviceClass` are **deleted** (pairing returns in S6). `app.js`: `ToonApp` logging `Open-Toon started` and computing `debugPayloads` once from `process.env.DEBUG === '1' || this.homey.env.OPEN_TOON_DEBUG === '1'`.
7. `.eslintrc.json`: remove `ignorePatterns`. Delete `test/baseline/**`; add `[fixes BD-n]` regression tests for BD-1, BD-2, BD-4, BD-6, BD-9 and update `baseline-pending.json` to `["BD-3","BD-5","BD-7","BD-8"]`.
8. Tests: `test/unit/{poller,apply}.test.js`; `test/scenario/{device-lifecycle,device-writes,migration-eras,soak}.test.js` (see checks).

**Files touched.** `lib/engine/{poller,apply,capabilities}.js`, `lib/features/{index,core}.js`, `drivers/open-toon/{device,driver}.js`, `app.js`, `.eslintrc.json`, `locales/{en,nl}.json` (keys: `offline`, `address_missing`, `error.*` used here), `test/unit/*`, `test/scenario/*`, `test/baseline/**` (deleted), ratchet files.

**Requirement ids.** FR-03 (AC3), FR-10, FR-11, FR-12, FR-13, FR-14 (device side), FR-16, FR-20, FR-21, FR-22, FR-24, FR-28, FR-30, FR-31, FR-80, FR-81, FR-82 (address part), FR-83, FR-84, FR-85 (labels), FR-110, FR-111, FR-112, FR-113 (core part), FR-114, NFR-01, NFR-03, NFR-08, NFR-09, NFR-10, NFR-12, NFR-15.

**Acceptance checks.**

| # | Command / action | Expected |
|---|---|---|
| 1 | V1-V4 | all exit 0; `.eslintrc.json` has no `ignorePatterns` for app files |
| 2 | `grep -rnE "homey-wifidriver\|request-promise\|homey-log\|Homey\.__\|socket\.on\|mapDeviceClass\|new Homey\.Flow\|TODO\|FIXME\|console\.log" app.js drivers lib` | no match |
| 3 | `test ! -d test/baseline`; `node -e "process.exit(require('./test/fixtures/baseline-pending.json').join()==='BD-3,BD-5,BD-7,BD-8'?0:1)"`; `grep -rc "fixes BD-" test/scenario` | exit 0; regression titles exist for BD-1, BD-2, BD-4, BD-6, BD-9 |
| 4 | `test/unit/poller.test.js` | `backoffMs` table incl. interval 3600 (never below the interval, cap `max(300 s, interval)`); `availabilityStep` for intervals 10/30/3600 (30 s hiccup at 10 s does not flip; 2 failures over 15 min at 3600 s does); lane ordering and refresh coalescing; clamp of `"abc"`, `"45"`, `5`, `99999` |
| 5 | `test/unit/apply.test.js` | `meterGuard`: `[100,99]` held, `[100,99,99,99]` accepted with one info line, `[100,"NaN",100]` and `[100,0,0,0]` ignored, `meter_water.today` exempt; finite-only; undeclared ids skipped (BD-1: `meter_power` is never written) |
| 6 | `test/scenario/device-lifecycle.test.js` | cadence at 30 s (FR-80 AC1); `onInit` returns < 1 s with an unroutable address (NFR-08 AC1); first values within 10 s; "Toon unreachable 10 min" = one request per cycle; "meters returns 500" = thermostat and power still applied (FR-80 AC4); availability after the predicate and recovery without a Flow (FR-81, CT-06; BD-6); values never cleared; `0.0.0.0` then a valid address saved -> poller starts, device available, no warning set; address change mid-flight uses the new host next cycle and the old host sees nothing more; delete mid-flight, delete while a refresh is queued (rejects with the `aborted` text in the same tick), zero requests after delete, `_teardown()` twice (BD-9); log capture: one line per state transition, no per-cycle error lines (NFR-09) |
| 7 | `test/scenario/device-writes.test.js` | integer `Setpoint`; slider drag of 20 changes -> <= 2 requests; no `setCapabilityValue` before the Toon confirmed; failing write -> rejection with localized text, stored value equals the Toon's after the refresh, no change event; write during a slow poll: server-side `maxConcurrent() === 1`, started when the poll request settled, settles <= 6 s (normal) / <= 10 s (pending poll timeout); 10 simultaneous refreshes -> one targeted cycle; a write every 2 s for 5 min does not starve power/meters (refreshed at least every 2 intervals); vacation fixture -> `temperature_state` becomes `vacation`, never `undefined` (BD-4); selecting `vacation` rejects with `error.vacation_readonly` and sends nothing |
| 8 | `test/scenario/migration-eras.test.js` (CT-02, CT-07) | eras 0, 1, 2, 3 and a new pair, each with `address` variants `"0.0.0.0"`, `"192.168.1.50:80"`, `" 192.168.1.50 "`, an unknown extra setting and an unknown extra capability: resulting capability list equals the plan of `05` section 9; era-0 `meter_power` kept and never written; the water trio on eras 2/3 untouched; zero `Invalid Capability`; zero unhandled rejections; marker `store.migrationVersion` written last; no request before the marker; second start calls neither `addCapability` nor `removeCapability`; `data`, name, class, `energy` unchanged (BD-2); `poll_interval` absent -> 30 |
| 9 | `test/scenario/soak.test.js` | 1,000 cycles with random faults: exactly one armed timer per device, epoch-controller listeners <= 1, lane queue 0, `openHandlers() === 0`, `process.getActiveResourcesInfo()` unchanged, zero unhandled rejections; network spy: every request targets the configured host only (NFR-15) |
| 10 | `node -e` pending check | none of `FR-16, FR-80, FR-81, FR-84, FR-110, FR-111, FR-112, NFR-08` remains pending (cumulative with S1-S3) |
| 11 | `npm run test:coverage` | exit 0, >= 90 % lines over `lib/**` |

**Risks / fallbacks.** Largest slice. If it cannot be completed in one session, the engineer stops at a green sub-state in this order and reports: (i) poller/lane/apply + unit tests, (ii) device lifecycle + migration, (iii) write path + soak. Between sub-states the repo must be green (the baseline stays until (ii) is done; the lint exemption is removed in the same step the file is replaced).

---

### S5 - ToonWater and power-export features, including the migration decision

**Goal.** ToonWater is an opt-in feature end to end: off by default, no water capability/request/log noise when off; on adds the three capabilities and polling; existing users keep water exactly as they have it; every race of ADR-0006 is a test. Power export is the second feature on the same engine.

**Work items.**

1. `lib/features/toonwater.js` (provenance header; the only file naming `/water.html`): the feature object of `05` section 6.2 (`parseWater` with `/1000` for `value` and `total`, `flow` unscaled, independent optional fields, flat ESP payload -> `unexpected` + hint key; `probe` -> `detected|not_found|unexpected|unreachable` with `probeBudgetMs: 3000`; water group with `absentOn404: 15 min` and `failBackoffMs 5 min` x3 then 15 min; `legacyIf`; `cards: {guarded:['update_water'], triggers:['measure_water_changed'], onDisabled:'reject'}`; rule for `measure_water_changed`; `hintAfter404Ms`; `warnWhenMigrationDecided:false`) and `lib/features/export.js` (ADR-0016). Register both in `lib/features/index.js`.
2. Engine: `planSettingsChange` toggles handled for registered optional features; Off->On and On->Off sequences of `05` section 6.5 inside the serial queue (`featureGen++` first on disable and no abort of the in-flight water request, guarded add with compensating removal, options only when different, write-priority 3 s probe, `refreshSoon(['water'],0)` scheduled not awaited, status re-assert after a save via `this.homey.setTimeout(0)` guarded by `_stopped`); migration M-2 now computes `toonwater_enabled = legacyIf(...)` and writes `store.toonwaterDecidedBy`; options reconciliation also covers the present-but-unlisted trio; warning rule of ADR-0018 (`computeWarning` knows feature flags only); `store.waterFirst404At` / `store.waterHintSent` and the timeline notification.
3. `locales/en.json` + `nl.json`: all FR-59 strings with the ADR-0006 Insights clause, warning, hint, save messages, `toonwater.*` statuses; ratchet files updated.
4. Tests (below). `BD-3`, `BD-5` regressions.

**Files touched.** `lib/features/{toonwater,export,index}.js`, `lib/engine/{capabilities,poller,apply}.js`, `drivers/open-toon/device.js`, `locales/{en,nl}.json`, `test/unit/{toonwater-parse,toonwater-probe,export}.test.js`, `test/scenario/{toonwater-toggle,toonwater-detection,toonwater-migration,export-feature}.test.js`, ratchet files, `test/static/registry-vs-manifest.test.js` (now covers both real features).

**Requirement ids.** FR-25, FR-31 (AC2: hot water works with ToonWater off), FR-50, FR-51 (AC1/AC2 via the plan), FR-52, FR-53, FR-54 (round trip: same ids; card part in S7), FR-55, FR-56, FR-57, FR-58, FR-59, FR-60, FR-62, FR-82, FR-85, FR-110, FR-113, NFR-03, NFR-09, NFR-11, NFR-12, NFR-14.

**Acceptance checks.**

| # | Command / action | Expected |
|---|---|---|
| 1 | V1-V4 | all exit 0 |
| 2 | `grep -rln "water\.html" app.js drivers lib` | exactly `lib/features/toonwater.js`; its first lines contain the provenance header; `grep -rn "oepi-loepi" lib` prints only that header |
| 3 | `test/unit/toonwater-parse.test.js`, `toonwater-probe.test.js` | `value: 12345` -> `meter_water.today` 12.345; `total` likewise; `flow` unscaled; payload without `total` updates the other two; negative, `null`, `"abc"`, `[]` ignored; flat `waterflow/waterquantity` -> `unexpected` with the sensor-module hint; probe returns the four classes for 200+ok, 404, 200+HTML (`html-200`), 403, 500, refused, timeout; a probe cancelled by teardown -> `unreachable` |
| 4 | `test/scenario/toonwater-toggle.test.js` | new device off: zero `/water.html` requests and no water capability over 30 simulated minutes (FR-51/BD-5); off->on adds exactly the trio, runs the options reconciliation once (a second save with equal options calls `setCapabilityOptions` zero times), first water values within 10 s (FR-52 AC1); on->off removes exactly the trio, leaves `alarm_water.hotwater`, burner, power, gas and their values untouched, zero `/water.html` afterwards, a late in-flight water response is dropped with no `Invalid Capability` and no error-level log (FR-53 AC3); tick/untick/tick resolves to the last save with no duplicate add or invalid remove (FR-52 AC4); "second `addCapability` rejects" -> compensating removal, `onSettings` rejects, setting stays false, no stray capability; slow poll in flight + save with toggle -> `onSettings` resolves <= 8 s fake time with the FR-59 text; toggle during an address change processes the address first; status-label transition during a save is re-asserted afterwards; `onSettings` never reads `getSetting` for the changed keys |
| 5 | `test/scenario/toonwater-detection.test.js` | modes `404`, `html-200`, `403`, `500` over 24 h fake time: <= 97 `/water.html` requests for 404 and <= 100 for the others (FR-55 AC4, FR-57), the device stays available, thermostat/power/meters unaffected, one info line on entering and one on leaving, never error level; warning rule: user-decided + 404 -> `setWarning`; migration-decided + all values `null` -> status label and **no** warning; migration-decided + any historical value -> warning; `unsetWarning` on first valid payload, on disable, on delete, at every `onInit` while off; FR-62: hint at 24 h exactly once for a migration-decided device, surviving `restartApp()` at 12 h; `createNotification` rejects once -> no `waterHintSent`, retried, delivered once; never for user-decided devices |
| 6 | `test/scenario/toonwater-migration.test.js` (CT-03, FR-56, FR-113) | matrix eras {0,1,2,3} x water values {present, all `null`, only `meter_water.total` set, partial capability set} x setting {absent, `false`, `true`} x marker {absent, present}: while the marker is absent the stored setting is ignored; none-of-three -> `false`; any-of-three -> `true` with missing ones added and nothing removed; `store.toonwaterDecidedBy` is `'migration'`; zero `/water.html` unless the result is true; a user switch-off survives `restartApp()` and nothing is re-added; the present-but-unlisted trio gets its titles via the options reconciliation; a device without `toonwaterDecidedBy` behaves as `'user'`; `removeCapability` is never called by the migration; zero `Invalid Capability`, zero unhandled (BD-2, BD-3) |
| 7 | `test/scenario/export-feature.test.js` | `export_enabled` toggles `measure_power.export`; the value comes from `powerProduction.value` with no additional request; off -> not added, never written; `measure_power` never negative |
| 8 | `soak.test.js` re-run with ToonWater enabled and faults | the NFR-12 counts hold |
| 9 | `node -e` ratchet checks | `baseline-pending.json` equals `["BD-7","BD-8"]`; none of `FR-25, FR-52, FR-53, FR-55, FR-56, FR-57, FR-58, FR-59, FR-60, FR-62, FR-82, FR-85, FR-113, NFR-03, NFR-09, NFR-12` remains pending |
| 10 | `test/static/registry-vs-manifest.test.js` | every card is claimed by at most one feature or `core`; both optional settings are checkboxes defaulting to false; every `__('toonwater.*')` key exists in en and nl |
| 11 | `npm run test:coverage` | >= 90 % lines |

**Risks / fallbacks.** The 404-for-missing-add-on assumption (`03` T8) and whether `label` settings re-render are hardware questions; the tests carry `[HW-07]`/`[HW-13]`, and the load bound does not depend on them (escalated back-off). `CD-2` fallback (`onDisabled:'noop'` for everyone) stays a one-word change.

---

### S6 - Pairing on `PairSession`

**Goal.** A new Toon can be paired: live connection test with readings, optional ToonWater checkbox shown only when the add-on was detected, a device created with the right capabilities, settings and store marker. Vanilla JS, Homey Style Library, promise APIs only.

**Work items.** `lib/engine/pairing.js` (`testConnection(client, features)`, pure `buildNewDevice({name,id,address,features})` incl. `capabilitiesOptions` for a ticked trio and `store {migrationVersion:1, toonwaterDecidedBy:'user'}`), `Driver#onPair(session)` with `setHandler('testConnection')` and `setHandler('createDevice')` (typeof-checks of every field first), `drivers/open-toon/pair/start.html` rewritten (address, Toon id, name, Test button, readings panel via `textContent`, unticked ToonWater checkbox only for `detected`, Connect disabled until a successful test and again when the address changes, inline error from `createDevice`), pairing locale keys en+nl, tests.

**Files touched.** `lib/engine/pairing.js`, `drivers/open-toon/driver.js`, `drivers/open-toon/pair/start.html`, `locales/{en,nl}.json`, `test/unit/pairing.test.js`, `test/scenario/pairing.test.js`, `test/static/pair-html.test.js`, ratchet files.

**Requirement ids.** FR-01, FR-02, FR-03, FR-04, FR-05, FR-51, FR-61, FR-100, NFR-04, NFR-16.

**Acceptance checks.**

| # | Command / action | Expected |
|---|---|---|
| 1 | V1-V4 | all exit 0 |
| 2 | `grep -nE '\$\(\|jQuery\|Homey\.addDevice\|innerHTML\|socket\.on\|[^.]__\(' drivers/open-toon/pair/start.html drivers/open-toon/driver.js` and `grep -cE 'Homey\.createDevice\|Homey\.emit\|Homey\.__' drivers/open-toon/pair/start.html` | first: no match; second: >= 3 |
| 3 | `test/scenario/pairing.test.js` (fake `PairSession`) | good IP: readings returned, device created; wrong IP: localized error <= 6 s and no device; 404/500: `error.http` with the status; non-Toon JSON: `error.not_toon`; `https://` and IPv6 get their own messages and no request; empty/invalid address: error and zero requests; numeric `id` or `address` from the view: localized error, no throw (R-11); empty id rejected; duplicate id: the fake's `createDevice` error is shown inline; name defaults to id |
| 4 | Same file, ToonWater | probe `detected` -> `features.toonwater==='detected'`, checkbox offered, **unticked** by default; `404` -> nothing offered (FR-61 AC2); probe failure never fails the test (FR-61 AC3); a probe must finish in 3 s |
| 5 | `test/unit/pairing.test.js` | `buildNewDevice` unticked: `toonwater_enabled:false`, the trio absent from `capabilities`, `export_enabled:false`, `poll_interval:30`, `data:{id}`, `store {migrationVersion:1,toonwaterDecidedBy:'user'}`; ticked: trio present, `capabilitiesOptions` carries their manifest titles; the produced device, fed into the fake, initialises with no migration and no `/water.html` request when unticked |
| 6 | `node -e` pending check | none of `FR-01, FR-02, FR-04, FR-05, FR-51, FR-61` remains pending |
| 7 | `HW` labelling | the tests whose outcome depends on Homey's own pairing UI carry `[HW-01]` in the title |

---

### S7 - Flow cards and triggers

**Goal.** All 14 baseline cards keep their ids/arguments and work with real results; the dormant triggers fire on change only; the two burner cards work; `update_*` cards reject honestly; legacy argument shapes and the legacy `update_water` Flows behave as promised.

**Work items.** `lib/flow/cards.js` (`CARDS` table `{kind,id,feature?,run}` + `register(driver)`; `normalizeDropdown` for `"x"` and `{id}`; `resume_program` `undefined`->`yes`; strict-boolean conditions; actions await the Toon and reject with `toUserMessage`; `update_status` refreshes every enabled group and rejects only if `thermostat` failed; `update_powerusage`/`update_metertotals`/`update_water` reject only for their own group; `update_water` guard per ADR-0018: no-op for migration-decided devices, FR-59 rejection for user-decided; `hotwater_dispensing` and `alarm_water_changed` never guarded), `driver.js` `onInit` obtains the device trigger handles once, `core.js` and `toonwater.js` rules (`meter_gas_changed`, `meter_power_changed` with peak + off-peak in kWh, `alarm_water_changed` token `alarm_water.hotwater`, `burner_state_changed_to` with the `state` dropdown compared in the run listener, `measure_water_changed` while on; `temperature_state_changed` with `source:'homey'` per ADR-0009), device `onChanges` -> `card.trigger(device, tokens, state).catch(this.error)` only when `prev !== null && prev !== next`, tests, locale keys for card errors.

**Files touched.** `lib/flow/cards.js`, `lib/features/{core,toonwater}.js`, `lib/engine/apply.js`, `drivers/open-toon/{driver,device}.js`, `locales/{en,nl}.json`, `test/scenario/{flow-cards,flow-triggers,flow-legacy}.test.js`, `test/static/cards-vs-manifest.test.js`, ratchet files.

**Requirement ids.** FR-12, FR-13, FR-14, FR-31, FR-32, FR-54, FR-70, FR-71, FR-72, FR-73, FR-74, FR-75, FR-77, FR-114, NFR-01, NFR-14, NFR-16.

**Acceptance checks.**

| # | Command / action | Expected |
|---|---|---|
| 1 | V1-V4 | all exit 0 |
| 2 | `test/static/cards-vs-manifest.test.js` | every manifest action/condition has exactly one registered listener after `driver.onInit`; deprecated cards still have listeners; every trigger id used by a rule exists in the manifest; every card is claimed by exactly one feature or `core` |
| 3 | `test/scenario/flow-cards.test.js` (CT-04, CT-08) | each of the 14 cards invoked with legacy argument shapes (`state` as string and as `{id}`; `resume_program` `yes`, `no`, `undefined`, `true`) against a Toon that is up, down, and without `/water.html`; up -> resolve after fresh data; down -> reject with a localized text within 6 s (BD-8); a failing part that was not requested never rejects the card; ten `update_status` at once -> one targeted cycle; `set_temperature_state` with `no` sends a different request list than `yes` and never the baseline's fixed `state=2` (BD-7); conditions return strict booleans (`null` -> `false`); `temperature_state_is` accepts `vacation`; `set_temperature_state` has no `vacation` value |
| 4 | `test/scenario/flow-legacy.test.js` | era-1 fixture (migration-decided off): `update_water` **resolves**, zero `/water.html` requests, one debug line; user-decided off: rejects with the FR-59 text and sends nothing; era-2/3 fixture with ToonWater on: refreshes only the water group and a 404 never rejects; with ToonWater off `hotwater_dispensing`, `alarm_water_changed` and `alarm_water.hotwater` all still work (R-36, FR-31) |
| 5 | `test/scenario/flow-triggers.test.js` (CT-05) | the first value ever fires nothing; a change fires exactly once; an unchanged value fires nothing; a counter step from integer to 3 decimals fires once; `meter_power_changed` token is peak + off-peak in kWh; `alarm_water_changed` token key `alarm_water.hotwater`; `burner_state_changed_to` fires for every change and the run listener filters on `args.state` (`any` matches all); `measure_water_changed` never fires while ToonWater is off; `temperature_state_changed` is fired by app code only when `autoFireCustomTriggers` is false in the fake and the rule table says `'app'` (default `'homey'` -> zero app fires, `[HW-06]`); `card.trigger` rejection is caught |
| 6 | `node -e` ratchet checks | `baseline-pending.json` equals `[]`; none of `FR-54, FR-70, FR-72, FR-73, FR-74, FR-114, NFR-14` remains pending |
| 7 | `node --require ./test/helpers/register.cjs --test test/static/contract.test.js` | still passes (nothing un-deprecated, no argument changed) |

---

### S8 - Release hygiene: locale sweep, dependency removal, CI, documents, closure of all ratchets

**Goal.** The shipped app contains only its own code; the repository is hygienic; every ratchet is empty; the documents the ADRs require exist in en and nl. The later "Docs & Release" workflow phase edits these documents, it does not have to create them.

**Work items.** (1) Locale sweep: fix the typos, `"address": "IP adres"` in en, "Mi Home"/token text in nl, drop `repair_migration_v3` and every unused cloud-app key; `i18n-unused-allowed.json` -> `[]`; add `test/fixtures/typos.json` denylist test. (2) `package.json` `dependencies: {}`; `npm install --ignore-scripts` (prunes `node_modules/`), lockfile v3; `engines`. (3) `.github/workflows/ci.yml` (job `test` Node 22: `npm ci --ignore-scripts`, lint, test; job `validate` Node 24: `npm ci --ignore-scripts`, validate, pack check, `git diff --exit-code app.json locales/`; non-blocking `athom-validate` pinned by SHA; `actions/checkout@v4`, `actions/setup-node@v4`), `.github/dependabot.yml` (`npm` + `github-actions`, weekly), delete `.github/workflows/codeql-analysis.yml`. (4) Documents: `README.md` (users, ToonWater opt-in in plain language, "what happens to my Flows and Insights history", two devices on one Toon unsupported, one odd Energy interval after a meter replacement, install via CLI never `--clean`, untested Homey models, dev setup incl. Node 22 vs CLI 24, credits), `README.txt`, `README.nl.txt`, `CONTRIBUTING.md` (short, no Athom boilerplate), `.homeychangelog.json` 2.0.0 en+nl with the lines required by `05` section 8 and `05` section 14. (5) Final gates: `scripts/check-requirements.js` strict (pending `[]`), coverage gate, `lib/` size budget test, `test/static/deps.test.js`, `test/static/docs.test.js`.

**Files touched.** `locales/*.json`, `package.json`, `package-lock.json`, `node_modules/` (pruned), `.github/**`, `README.md`, `README.txt`, `README.nl.txt`, `CONTRIBUTING.md`, `.homeychangelog.json`, `test/static/{deps,docs,ci,locale-typos,lib-budget}.test.js`, ratchet files.

**Requirement ids.** FR-100, FR-101, FR-121, FR-122, NFR-02, NFR-05, NFR-06 (AC3 coverage), NFR-10 (AC2 CI), NFR-11, NFR-13, NFR-14, NFR-16.

**Acceptance checks.**

| # | Command / action | Expected |
|---|---|---|
| 1 | V1-V4 | all exit 0; `npm run pack:check` now rejects `node_modules/` in the bundle |
| 2 | `node -e "const p=require('./package.json');process.exit(Object.keys(p.dependencies||{}).length===0?0:1)"`; `npm ls --omit=dev`; `npm audit --omit=dev` | exit 0; no packages listed; zero vulnerabilities (audit needs network: if offline, record as not run) |
| 3 | `node -e "const l=require('./package-lock.json');process.exit(l.lockfileVersion===3&&!/homey-wifidriver\|homey-log\|request-promise\|\"node_modules\/(request\|underscore)\"/.test(JSON.stringify(l))?0:1)"`; `ls node_modules \| grep -E '^(homey-log\|homey-wifidriver\|request\|request-promise-native\|underscore)$'`; `npm ls lodash` | exit 0; empty; `lodash` only as `homey > inquirer > lodash`, `dev: true` in the lockfile (a development-only transitive of the Homey CLI, which pins `inquirer@8.1.2` in its latest release 4.6.3, so it cannot be removed without dropping the CLI that `validate` and `pack:check` need; it never ships, see check 1 and `npm ls --omit=dev`) |
| 4 | `grep -rnE "homey-wifidriver\|request-promise\|homey-log" app.js drivers lib package.json test` | no match (test fixtures excluded only by name `test/static/deps.test.js` rule text) |
| 5 | `node -e "process.exit(require('./test/fixtures/requirements-pending.json').length===0&&require('./test/fixtures/baseline-pending.json').length===0&&require('./test/fixtures/i18n-unused-allowed.json').length===0?0:1)"`; `node scripts/check-requirements.js --strict` | exit 0 |
| 6 | `npm run test:coverage` | exit 0; >= 90 % lines over `lib/**` (NFR-06 AC3) |
| 7 | `test/static/lib-budget.test.js` | `lib/` has <= 16 files, none > 250 lines |
| 8 | `test/static/i18n.test.js` | every key in en and nl, no unused key, no key only in one language; typo denylist (`Somethink`, `happend`, `succesfull`, `an unique`, `Mi Home`, `"IP adres"` in en) finds nothing |
| 9 | `test/static/ci.test.js`, `test/static/docs.test.js` | `ci.yml` has `node-version: 22` for the test job and `24` for validate, runs V1-V4, pins actions; `dependabot.yml` has `package-ecosystem: npm` and `github-actions`; `codeql-analysis.yml` is absent; README.md/README.txt/README.nl.txt contain the ToonWater Flows-and-Insights sentence, the two-devices note and the Energy note in the right language; `.homeychangelog.json` has `2.0.0` with `en` and `nl` |
| 10 | `.gitignore` effect | `git check-ignore node_modules` succeeds; `git ls-files node_modules` still lists the tracked files (the owner's `git rm -r --cached node_modules` is a documented release step in `CONTRIBUTING.md`, not done here) |
| 11 | `git rev-parse HEAD` | still `5cc3b90...`; `git status --short` shows only working-tree changes |
| 12 | `scripts/check-requirements.js --matrix` | prints every MUST/SHOULD id with at least one test file and title (input for `08-test-report.md`) |

---

## 4. Coverage matrices

### 4.1 Requirement ids to slices (every MUST and SHOULD of `01` section 9)

`T` = first test lands in the slice, `C` = completes the requirement, `-` = not involved. FR-90 is a SHOULD that the design **defers** (ADR-0016); its slice verifies the deferral (energy block byte-identical, no imported capability).

| Id | Prio | S1 | S2 | S3 | S4 | S5 | S6 | S7 | S8 | Id | Prio | S1 | S2 | S3 | S4 | S5 | S6 | S7 | S8 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FR-01 | M | - | - | - | - | - | C | - | - | FR-80 | M | - | - | - | C | - | - | - | - |
| FR-02 | M | - | - | - | - | - | C | - | - | FR-81 | M | - | - | - | C | - | - | - | - |
| FR-03 | M | - | T | - | T | - | C | - | - | FR-82 | M | - | - | - | T | C | - | - | - |
| FR-04 | S | - | - | - | - | - | C | - | - | FR-83 | S | - | - | T | C | - | - | - | - |
| FR-05 | S | - | - | - | - | - | C | - | - | FR-84 | M | - | - | - | C | - | - | - | - |
| FR-10 | M | - | T | - | C | - | - | - | - | FR-85 | S | - | - | T | T | C | - | - | - |
| FR-11 | M | - | T | - | C | - | - | - | - | FR-90 | S | - | - | C | - | - | - | - | - |
| FR-12 | M | - | T | T | T | - | - | C | - | FR-100 | M | T | T | T | T | T | T | T | C |
| FR-13 | M | - | T | - | T | - | - | C | - | FR-101 | S | - | - | - | - | - | - | - | C |
| FR-14 | M | - | T | - | T | - | - | C | - | FR-110 | M | - | - | T | T | C | - | - | - |
| FR-16 | S | - | - | - | C | - | - | - | - | FR-111 | M | - | - | T | C | - | - | - | - |
| FR-20 | M | - | T | - | C | - | - | - | - | FR-112 | M | - | - | - | C | - | - | - | - |
| FR-21 | M | - | T | - | C | - | - | - | - | FR-113 | M | - | - | - | T | C | - | - | - |
| FR-22 | M | - | T | - | C | - | - | - | - | FR-114 | S | - | T | - | T | - | - | C | - |
| FR-24 | M | - | T | - | C | - | - | - | - | FR-120 | M | T | - | C | - | - | - | - | T |
| FR-25 | S | - | T | T | - | C | - | - | - | FR-121 | S | - | - | T | - | - | - | - | C |
| FR-28 | M | - | T | - | C | - | - | - | - | FR-122 | S | - | - | - | - | - | - | - | C |
| FR-30 | S | - | T | T | C | - | - | - | - | NFR-01 | M | T | - | - | T | - | - | C | - |
| FR-31 | M | - | T | - | T | T | - | C | - | NFR-02 | M | T | - | - | - | - | - | - | C |
| FR-32 | S | - | - | T | - | - | - | C | - | NFR-03 | M | - | T | - | T | C | - | - | - |
| FR-50 | M | - | - | C | - | - | - | - | - | NFR-04 | M | - | T | - | - | - | C | - | - |
| FR-51 | M | - | - | T | - | T | C | - | - | NFR-05 | M | - | - | - | - | - | - | - | C |
| FR-52 | M | - | - | - | - | C | - | - | - | NFR-06 | M | T | - | - | - | - | - | - | C |
| FR-53 | M | - | - | - | - | C | - | - | - | NFR-07 | M | - | - | C | - | - | - | - | - |
| FR-54 | M | - | - | T | - | T | - | C | - | NFR-08 | M | - | - | - | C | - | - | - | - |
| FR-55 | M | - | - | - | - | C | - | - | - | NFR-09 | S | - | - | - | T | C | - | - | - |
| FR-56 | M | - | - | - | - | C | - | - | - | NFR-10 | S | T | - | - | T | - | - | - | C |
| FR-57 | M | - | - | - | - | C | - | - | - | NFR-11 | M | T | - | T | - | T | - | - | C |
| FR-58 | M | - | - | - | - | C | - | - | - | NFR-12 | S | - | - | - | T | C | - | - | - |
| FR-59 | M | - | - | T | - | C | - | - | - | NFR-13 | S | T | - | - | - | - | - | - | C |
| FR-60 | M | - | - | - | - | C | - | - | - | NFR-14 | M | T | - | T | T | T | - | C | T |
| FR-61 | S | - | - | - | - | T | C | - | - | NFR-15 | M | T | T | - | C | - | - | - | - |
| FR-62 | S | - | - | - | - | C | - | - | - | NFR-16 | S | - | T | - | - | T | T | T | C |
| FR-70 | M | - | - | - | - | - | - | C | - | FR-76 | M | T | - | T | - | - | - | T | C |
| FR-71 | S | - | - | T | - | - | - | C | - | FR-77 | S | - | - | C | - | - | - | T | - |
| FR-72 | M | - | - | - | - | - | - | C | - | FR-75 | S | - | - | T | - | - | - | C | - |
| FR-73 | M | - | - | - | - | - | - | C | - | FR-74 | M | - | - | - | T | - | - | C | - |

Not scheduled by design: COULD (FR-15, FR-23, FR-26, FR-29, FR-63) and WONT (FR-27, FR-33).

### 4.2 Legacy-upgrade scenarios: device eras x ToonWater states

Fixtures: `test/fixtures/eras.json` (`04` Appendix B + L2018). Stable ids and identity are asserted in every row (`data.id`, name, class, `energy`, setting keys, capability ids, card ids).

| Case | Capabilities before | Core migration (S4, `migration-eras`) | ToonWater decision (S5, `toonwater-migration`) | Cards (S7, `flow-legacy`) |
|---|---|---|---|---|
| Era 0 (0.0.1), ToonWater off | 6 incl. plain `meter_power` | adds `meter_power.peak/offPeak`, `alarm_water.hotwater`, `burner_state`; `meter_power` kept, never written | `toonwater_enabled=false`, `decidedBy='migration'`, nothing added, zero `/water.html` | `update_water` resolves, zero requests |
| Era 1 (L2019), off | 7 | adds `alarm_water.hotwater`, `burner_state` | as era 0 | `update_water` resolves (the #5/#25 workaround Flow keeps running) |
| Era 2 (L2021), ToonWater **on** (values / all null / only total) | 10 incl. the trio | adds `alarm_water.hotwater`, `burner_state`; trio untouched | `true`, nothing added or removed, values/tags/system card survive; all `null` -> status label, no warning, FR-62 hint at 24 h | `update_water` refreshes water; 404 never rejects |
| Era 3 (L2023), **on** | 11 | adds `burner_state` | as era 2 | as era 2; hot-water cards work |
| Partial water set | 1-2 of the trio | as era | `true`, missing ones added, nothing removed | - |
| Any era, user switched ToonWater off, app restarts | trio absent | steady state: no add/remove | stays `false`, nothing re-added (FR-56 AC5) | `update_water` rejects (user-decided) |
| Any era, ToonWater **on** with the add-on present | trio | polls water | values flow; first values <= 10 s after enabling | `measure_water_changed` system card/tags exist (fake) |
| New pair, checkbox off / on | 9 / 12 | marker at pairing; no migration | per checkbox, `decidedBy='user'`, options passed at `createDevice` (S6) | - |
| Settings gaps: `poll_interval` absent, `address` `"0.0.0.0"` / `"host:80"` / padded | any | defaults on read, never persisted; `0.0.0.0` -> unavailable, no poller; later valid address starts the poller | - | - |

### 4.3 Baseline defects (characterised in S1, fixed later)

| Id | Baseline behaviour (`00` section 5 harness S1-S9) | Fixed in | Regression test |
|---|---|---|---|
| BD-1 | every power update raises `Invalid Capability: meter_power` (`device.js:374-378`) | S4 | `device-lifecycle` "undeclared capability never written" |
| BD-2 | devices without the water trio raise three `Invalid Capability` per update | S4 (+S5 matrix) | `migration-eras`, `toonwater-migration` |
| BD-3 | water payload without `total` -> NaN rejected | S5 | `toonwater-parse` |
| BD-4 | `activeState` 4 writes `temperature_state: undefined` | S4 (parse in S2) | `device-writes` vacation |
| BD-5 | a 404 on `/water.html` is logged at every update | S5 | `toonwater-toggle` (off) and `toonwater-detection` |
| BD-6 | unreachable Toon, device still `available: true` | S4 | `device-lifecycle` availability |
| BD-7 | `resume_program = no` still sends `state=2` | S7 (table in S2) | `flow-cards` |
| BD-8 | `update_status` resolves while the Toon is offline | S7 | `flow-cards` |
| BD-9 | `onDeleted` throws `TypeError` (`device.js:488-491`) | S4 | `device-lifecycle` teardown |

### 4.4 ADRs to slices

| ADR | Slice(s) | ADR | Slice(s) |
|---|---|---|---|
| 0001 registry | S3 (generic planners), S5 | 0010 migration | S3 (plan), S4 (execute), S5 (water decision) |
| 0002 Compose/layout | S3, S8 (budget) | 0011 dependencies | S1 (devDeps), S8 (removal) |
| 0003 client | S2 | 0012 tooling | S1, S8 (CI) |
| 0004 floor/version | S3 | 0013 test architecture | S1 (doubles), every slice |
| 0005 scheduler | S4 | 0014 vacation/burner/meters | S2, S3, S4 |
| 0006 ToonWater | S3 (texts), S5 | 0015 resume | S2 (table), S7 (cards) |
| 0007 water cards | S3 (deprecations), S7 | 0016 export/energy | S3 (deferral), S5 |
| 0008 pairing | S6 | 0017 contract exception | S1 (test), S3 (exercised) |
| 0009 triggers/deprecations | S3 (manifest), S7 | 0018 decided-by flag | S5, S7 |

### 4.5 Test layers to slices (ADR-0013)

L0 pure: S2, S3, S4, S5. L1 client against `node:http`: S2 (+ adapter equivalence in S1). L2 scenarios under the fake Homey/clock/adapter: S4, S5, S6, S7. L3 static: S1 (contract, i18n, layering, canary, node22, ratchets), S3 (manifest, registry), S6, S7, S8. L4 manifest: V3 and V4 in every slice.

## 5. Test strategy in one paragraph

Everything is verified without hardware on Node 22-compatible code: pure parsers and planners against labelled fixtures (L0), `ToonClient` against a real `node:http` mock (L1), the whole device and driver under a strict SDK-v3 fake with a fake clock and an in-process `fetch` adapter whose equivalence with real `fetch` is itself tested (L2), repository-wide static contracts (stability contract with the ADR-0017 exception file, i18n, layering, lint canary, requirement-id coverage) (L3), and the Homey CLI validator plus a pack listing (L4). Strictness is introduced at slice 1 and relaxed only through four ratchet files that must shrink to empty by slice 8. Tests whose outcome depends on unobserved Toon or Homey behaviour carry their `HW-xx` id in the title so that the hardware backlog is the exact set of tagged tests.

## 6. Hand-over to the later workflow phases

* **QA (`08-test-report.md`)**: `node scripts/check-requirements.js --matrix` (S8) prints the requirement-to-test matrix; the QA scenarios named in the workflow map to: pairing -> S6 tests; polling/offline/recovery/address/delete/soak -> `device-lifecycle`, `soak`; ToonWater off/on/toggle races -> `toonwater-toggle`; legacy upgrade -> `migration-eras`, `toonwater-migration`, `flow-legacy`; vacation, malformed payloads -> `parse-*`, `device-writes`; triggers/conditions/actions -> `flow-*`.
* **Docs (`09-release-notes-and-migration.md`, README polish)**: S8 creates the documents the ADRs require; the docs phase edits them. The changelog lines that must appear are listed in `05` section 8 and section 14 (update cards now fail when the Toon is unreachable; dormant triggers start firing; gas and kWh gain three decimals; `vacation` added; plain `meter_power` frozen; ToonWater is now a per-device setting; Flows/Insights consequence of disabling).
* **Hardware test plan (`10-hardware-test-plan.md`)**: the backlog is `grep -rhoE "\[HW-[0-9A-Za-z]+\]" test | sort -u` plus `05` section 17. Not verifiable here, by design: real `/water.html` status/headers/units without the add-on, `activeState` 4 and `burnerInfo` 0..3, real `getDevices.json` per Toon generation (`METER_RULES`), `Accept-Encoding`/`Connection: close` on the Toon's web server, `resume_program = no` request sequence, whether Homey re-renders `label` settings and merges poller `setSettings` during a save, `onSettings` UI timeout, options after `addCapability` and for a present-but-unlisted capability, Flow-editor behaviour on remove/re-add, Insights history after `removeCapability`, `temperature_state_changed` auto-fire, picker behaviour when the listener rejects, `env.json` reaching `this.homey.env`, 24 h load at 10/30/60 s and the availability constants, Homey Energy page, upgrade over a real patched baseline per era, pairing UI on web and mobile.
* **Not done in code, stays with the owner**: `git rm -r --cached node_modules`, closing Dependabot PRs #31-#33 (NFR-13 AC2), new original artwork for the driver icon and store images, asking the ToonWater author about the name (`03` section 10), choosing App Store versus sideload.

## 7. Planner's unverified assumptions and what to do if they fail

| # | Assumption (not executed by the planner) | Slice | If it fails |
|---|---|---|---|
| 1 | `homey app validate --level publish` runs offline from the devDependency CLI, without login or Docker, on Node 25 | S1 | stop and report (the whole tooling rests on it) |
| 2 | `homey app build` runs without login; `.homeybuild/` lists as expected | S1 | `check-pack.js` falls back to the CLI default ignore list + `.homeyignore` computed in Node; report the deviation |
| 3 | `homey app compose` exists in CLI 4.6.3 and migrates the flat manifest mechanically (ADR-0002, from CLI source) | S3 | split by hand using the file list of ADR-0002; the drift check in V3 proves the result |
| 4 | the validator accepts `capabilitiesOptions` keys that are not in `capabilities` | S3 | stop; ADR-0017 amendment needed, not a silent re-listing |
| 5 | `eslint-config-athom@4.0.2` + ESLint 8.57 + `typescript ^6` run on Node 25; `homey` resolves to `@types/homey`, not to the CLI package at `node_modules/homey` | S1 | `paths` entry in `tsconfig.eslint.json`; the lint canary is the detector; ADR-0012 fallback if the CLI flips the app into TypeScript mode |
| 6 | the baseline `homey-wifidriver` loads under the permissive shim in `test/baseline/` | S1 | prototype-level characterisation (S1 risk b) |
| 7 | Node's `--test-coverage-include`/`--test-coverage-lines` flags exist (Node >= 22.8) | S2 | compute coverage with `--experimental-test-coverage` output in `scripts/` and assert 90 % there |
| 8 | `npm install --ignore-scripts` can reach the registry; tracked `node_modules/` content may be rewritten by it | S1, S8 | report; do not hand-edit `node_modules/` |
| 9 | the fake Homey's reading of undocumented behaviour (U1-U13 of `04`) is what Homey does | all | by design: those tests carry `[HW-xx]` |
