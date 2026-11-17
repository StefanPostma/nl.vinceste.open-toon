# 11 - Delivery gate: is `redesign/sdk3` ready to hand to the owner for hardware testing?

| | |
|---|---|
| Role | Independent delivery gate reviewer (did not build any of this) |
| Date | 2026-11-14 |
| Repo state | branch `redesign/sdk3`, `git rev-parse HEAD` = `5cc3b904219279062f80b4af60f55927b3d75c6d` (= base commit `5cc3b90`), 0 commits since base, 0 stashes, everything in the working tree |
| Machine | macOS, Node.js v25.9.0, npm 11.12.1. No Node 22 binary, no Homey, no Toon |
| Verdict | **PASS_WITH_NOTES** - no blocker. Hand to the owner for hardware testing. Section 10 lists what the owner must do before committing and what needs an owner acknowledgement; section 11 lists what only hardware can settle. |

> **Addendum 2026-11-17:** after this gate the app ran on a Homey Self-Hosted Server (firmware 13.5.4) with a simulated Toon, and CI on Node 22 went green; see `13-self-hosted-test-report.md`. The statements below that say "no Homey" describe the day of the gate.

Everything below was re-run or re-read by me today. "Re-run" means I executed the command; "checked" means I read the file at the cited line. Where I relied on a document written by the team, I say so. The test report `08-test-report.md` is model-generated; I spot-checked five of its claims (section 7) and all five reproduced.

---

## 1. Gate commands (re-run)

| # | Command | Exit | Result I observed |
|---|---|---|---|
| 1 | `npm run lint` | 0 | `eslint --ext .js,.cjs --max-warnings 0`: no output, no finding |
| 2 | `npm test` | 0 | 1,433 tests, 262 suites, 0 fail, 0 cancelled, 0 skipped, 8.9 s (the report says 1,400: 33 tests of `test/unit/toon-probe.test.js` were added after it, section 7) |
| 3 | `npm run validate` | 0 | `homey app validate --level publish` from the devDependency CLI: "App validated successfully against level `publish`; app.json and locales in sync". Two warnings: `energy.cumulative` without `cumulativeImportedCapability` / `cumulativeExportedCapability` (FR-90 deferred by ADR-0016) |
| 3b | `npm run validate:verified` | 0 | passes at level `verified`, same two warnings |
| 4 | `npm run pack:check` | 0 | "Pack check passed: 36 files in the bundle". I built the bundle myself and listed it (section 5.3): app code, assets, locales, `README*.txt`, `LICENSE`, `package.json`, `package-lock.json` and the CLI's two-file `node_modules/homey` shim; no docs, tests, scripts or `.claude/` |
| 5 | `npm audit --omit=dev` | 0 | "found 0 vulnerabilities"; `npm ls --omit=dev` prints `(empty)` |
| 6 | `npm run check:requirements` | 0 | "every mock-verifiable MUST/SHOULD id has a test" |
| 7 | `npm run test:coverage` | 0 | `lib/**`: 100.00 % lines, 98.31 % branches, 99.27 % functions (gate 90 % lines) |

---

## 2. Repository hygiene

| Check | Result |
|---|---|
| HEAD still the base commit | yes, `5cc3b90…`; `git log 5cc3b90..HEAD` is empty; `git stash list` empty |
| `git status` summary | 109 modified, 563 deleted, 17 untracked paths. Outside `node_modules/`: 13 modified or deleted (`.github/dependabot.yml`, `.github/workflows/codeql-analysis.yml` deleted, `CONTRIBUTING.md`, `README.md`, `app.js`, `app.json`, `drivers/open-toon/{device,driver}.js`, `pair/start.html`, `locales/*.json`, `package.json`, `package-lock.json`) and 17 untracked (`.eslintrc.json`, `.github/workflows/ci.yml`, `.gitignore`, `.homeychangelog.json`, `.homeycompose/`, `.homeyignore`, `.nvmrc`, `README.nl.txt`, `README.txt`, `docs/`, `drivers/open-toon/driver.{,flow.,settings.}compose.json`, `lib/`, `scripts/`, `test/`, `tsconfig.eslint.json`) |
| `node_modules` | still **tracked**: `git ls-files node_modules` = 1,880 files. `.gitignore` now lists `node_modules`, and the local install for the new devDependencies left 562 tracked files deleted and 109 modified. This is exactly the state ADR-0011 describes ("removed from tracking in the release commit, performed by the owner"; hard rule 1 forbade git operations in this run). The owner's release checklist (`09` section 11) has the step `git rm -r --cached node_modules`. **Not a blocker, but the first thing the owner does before committing** (a plain `git add -A` would leave ~1,300 stale tracked files in the index) |
| Ignore files | `.gitignore`: `node_modules`, `.homeybuild`, `env.json`, `.claude/`. `.homeyignore`: `docs/`, `test/`, `scripts/`, `*.md`, `CONTRIBUTING.md`, `.github/`, `tsconfig.eslint.json`. `.nvmrc` = 22 |
| Secrets, stray files | grep for key/secret/token/password/sentry/PAT: only Flow-token wording and lockfile package names. No `env.json`, no `.homeybuild/`, no file > 500 KB outside `node_modules`. `.claude/workflows/*.js` sits in the repo directory but is gitignored and not in the bundle |
| TODO / FIXME / `console.*` | none in `app.js`, `drivers/`, `lib/`, `scripts/`, `test/`, `.homeycompose/`, `locales/` |
| Dead v2 APIs | none: no `socket.on`, `Homey.addDevice`, `homey-wifidriver`, `request-promise`, `homey-log`, `mapDeviceClass`, `debounce`, `WebAPIDevice`, jQuery. `require()` list of the app code = `homey`, `util` and relative `lib/` paths only |
| Lockfile | v3 (`package-lock.json:3`), regenerated; `devDependencies` = `homey ~4.6.3`, `eslint ~8.57.1`, `eslint-config-athom ~4.0.2`, `@types/homey` (= `homey-apps-sdk-v3-types`), `@types/node ~22`; `dependencies: {}` |
| CI | `.github/workflows/ci.yml`: job `test` on Node 22 (`npm ci --ignore-scripts`, lint, test, coverage, check:requirements), job `validate` on Node 24 (validate, `git diff --exit-code app.json locales/`, pack:check, validate:verified continue-on-error); `permissions: contents: read`, `persist-credentials: false`. **Never executed yet** (section 11). `codeql-analysis.yml` deletion is explained by ADR-0012 ("disabled and uses retired actions"). `dependabot.yml` now has `npm` + `github-actions` weekly (baseline had an empty `package-ecosystem`) |
| Docs vs code | `docs/ARCHITECTURE.md`, ADR-0001..0018, `05-architecture.md`, `09-release-notes-and-migration.md`, `10-hardware-test-plan.md` present and consistent with what I read in the code (feature registry, `store.toonwaterDecidedBy`, deprecations, compat floor, warning rule). Two staleness points: (a) `08-test-report.md` counts 1,400 tests and does not list `scripts/toon-probe.js` / `test/unit/toon-probe.test.js`, which were added afterwards (they are documented in `10` Annex 1 and in the README); (b) the numbered series skips `07-`: the security review's findings SEC-01 (fixture values copied from an add-on sample comment; corrected, `03` line 7 and section 13) and SEC-02 (floating Docker action in CI; removed, ADR-0012 rev 3) are recorded where they were applied, but no review write-up exists in `docs/sdlc/`. Neither affects the code |

---

## 3. Stability contract (`04-compat-contract.md`), checked on the final `app.json`

I extracted the Appendix A script from `04` verbatim and ran it against `git show 5cc3b90:app.json` and the current `app.json`. Output: exactly three lines, `driver capability dropped from manifest: measure_water | meter_water.today | meter_water.total`, exit 1. Those three are the documented exception of **ADR-0017** (ids stay in `capabilitiesOptions` `app.json:725-737`, in `FEATURES[toonwater].capabilities` `lib/features/toonwater.js:20`, and on every paired device that has them; listed in `test/fixtures/contract-exceptions.json`). The revised CT-01 (`test/static/contract.test.js:139-141`) is green, and its negative cases (lines 164-228) prove that every other class of break is still reported. `test/fixtures/baseline-app.json` is byte-identical to `git show 5cc3b90:app.json` (I compared the parsed JSON; the test pins its sha1 at line 136).

| Contract item | Status | Evidence |
|---|---|---|
| App id, driver id, class | unchanged | `app.json:3` `nl.vinceste.open-toon`; `:756` `open-toon`; `:686` `thermostat` |
| `data.id` shape | unchanged `{id: <typed string, trimmed>}` | `lib/engine/pairing.js:138,153`. `driver.js:59` reads `getData().id` only to compare equality for the duplicate message (FR-04) |
| Setting key `address` | kept, value normalised on read, never rewritten | `app.json:766`; `drivers/open-toon/device.js:37,184`; `lib/toon/address.js:43-66`; `0.0.0.0` -> unavailable with `address_missing` (`device.js:185-187`) |
| 11 baseline capabilities | 8 in the driver list + `burner_state` (additive); water trio per ADR-0017 | `app.json:693-703` |
| Custom enum `temperature_state` | 5 baseline ids + additive `vacation` | `app.json:926-978` |
| 14 Flow cards, args, dropdown ids, token names/types | all present; `device` arg filter byte-identical `driver_id=open-toon` on all 16 cards (R-33) | `app.json:65-675`; `contract.test.js:302-308` |
| Deprecations (one-way) | `meter_gas_changed`, `measure_water_changed`, `update_powerusage`, `update_water`, `update_metertotals`; `update_status` not deprecated ("Update now") | `app.json:69,120,616-619,631,646,661` |
| `energy` block | byte-identical `{"cumulative": true}` | `app.json:704-706`; ADR-0016 |
| Migration present, additive, marker-gated | `migrate()` M-1..M-7: `store.migrationVersion` absent = legacy; legacy defaults from the capability list only; `addCapability` guarded by `hasCapability`; options reconciled; marker written last; nothing removed | `lib/engine/capabilities.js:19-33,126-168`; `lib/features/index.js:77-82`; `lib/features/toonwater.js:92` (`legacyIf` excludes `alarm_water.hotwater`) |
| Removal only by the user's toggle | `planCapabilities` removes only the capabilities of a feature in `switchedOff` | `capabilities.js:50-53`; `lib/engine/optional.js:104-119` |
| Era-0 plain `meter_power` | kept, never added, **never written** (frozen). Deviates from `04` R-25's "write if present" but is justified by ADR-0014 rev 2 (a daily figure in a cumulative slot; the HTTP answer has no `dayUsage`) and announced in `.homeychangelog.json` | `lib/toon/parse.js:172-179` has no `meter_power` output |
| Dropdown `label` vs `title` | both emitted (CD-6) | `app.json:236-291` etc. |
| `resume_program` unset / boolean | treated as `yes` / mapped | `lib/flow/cards.js:24-29`; `lib/toon/commands.js:48-52` |

---

## 4. Homey standards (`02-homey-standards.md`) on the final manifest and code

| Standard | Status | Evidence |
|---|---|---|
| HS-01/02 Node 22, built-in `fetch` | met | `package.json:6-8`; `drivers/open-toon/driver.js:49` injects `globalThis.fetch`; `lib/toon/client.js` is the only HTTP code (`test/static/layering.test.js`) |
| HS-03/05/04 zero runtime deps, `.gitignore`, `.homeyignore` | met | section 2 |
| HS-06 ESLint 8 + `athom/homey-app`, `no-floating-promises` live | met | `.eslintrc.json`; `tsconfig.eslint.json` types `node`,`homey`; `test/static/lint-canary.test.js` |
| HS-07/08 CI, Dependabot | met (CI not yet run) | section 2 |
| HS-10..12 Compose layout, generated `app.json` | met | `.homeycompose/app.json`, `drivers/open-toon/driver.{,flow.,settings.}compose.json`, `.homeycompose/capabilities/*.json`; `app.json:2` `_comment`; `validate.js` fails if the CLI rewrites `app.json`/locales |
| HS-13 manifest keys | met except optional `runtime` (validator at `verified` does not ask for it) | `brandColor`, `platforms`, `tags`, `support`, `source`, `bugs`, `homepage`, `contributors` `app.json:7-64`; description no longer repeats the name |
| HS-14/15 `compatibility >=12.9.0`, `platforms`, `connectivity` | met; **floor is an owner decision (OQ-04, ADR-0004)** | `app.json:5,7-9,687-692` |
| HS-16/17 validate `publish` + `verified`, `titleFormatted` | met | section 1; `app.json:487-490` has `[[state]], [[resume_program]]` in en and nl; nl `!{{is|is niet}}` fixed `:301,305` |
| HS-18 images/icons | sizes checked by `test/static/docs.test.js`; **`assets/icon.svg` and `drivers/open-toon/assets/icon.svg` are still byte-identical and unchanged from the baseline** (Store guideline 1.5/1.6; irrelevant for sideloading; the artwork decision is in the owner's checklist `09` section 11, OQ-02) | `cmp` |
| HS-19 permissions | `[]` | `app.json:54` |
| HS-20..22 lifecycle, Homey timers | met: `onInit` does not await the network, `onSettings`, `onDeleted`, `onUninit`, timers via `homey.setTimeout` | `device.js:36-92,259-266`; `client.js:148-151`; lint rule `homey-app/global-timers: error` |
| HS-23 no unhandled rejections | met: every write caught (`lib/engine/apply.js:65-75`), triggers `.catch` (`cards.js:139`), events (`poller.js:242`), harness counter (`test/helpers/register.cjs`) | |
| HS-24 `this.log`/`this.error`, no `console` | met | grep |
| HS-25 availability / warning | met: unavailable only on the critical group after count+time (`lib/engine/schedule.js:92-130`), water 404 = warning/status never unavailable (`optional.js:189-197`) | |
| HS-26 i18n en+nl | met | `test/static/i18n.test.js`; `locales/{en,nl}.json` same key set; validate "locales in sync" |
| HS-27 timezone | `device.js:236` uses `this.homey.clock.getTimezone()` synchronously; the installed SDK types declare `getTimezone(): string` (`node_modules/@types/homey/manager/clock.d.ts:21`) | |
| HS-30..35 add/remove guarded, no rename, sub-capability cards declared | met | `capabilities.js:126-147`; `app.json` cards |
| HS-37 settings | met: `address` has `hint` + `pattern`, `poll_interval` number 10..3600, `toonwater_enabled` checkbox `value: false`, status labels | `app.json:757-881` |
| HS-40..46 cards | met: titles, arg `title`s, `titleFormatted`, device triggers in the driver compose, deprecation | `driver.flow.compose.json` |
| HS-50/51 `PairSession`, Style Library, no jQuery, `data-i18n` | met | `driver.js:38-41`; `pair/start.html:37-84,193,220`; `test/static/pair-html.test.js` |
| HS-54 `README.txt`/`README.nl.txt`, `.homeychangelog.json` | met (plain text, no URLs, en+nl entry for 2.0.0) | files; `docs.test.js:85-153` |

---

## 5. Code review notes (independent read of `app.js`, `drivers/`, `lib/`, `pair/start.html`)

### 5.1 ToonWater opt-in (owner intent 2)
* Off: the water trio is not in the driver list (`driver.compose.json:13-23`), `buildNewDevice` holds only the capabilities of features that are on (`pairing.js:148-156`), `activeGroups` returns no water group (`features/index.js:62-64`), so `/water.html` is never requested; `/water.html` is named in exactly one file (`toonwater.js:19`; `test/static/layering.test.js`). QA evidence re-run: 240 cycles, 0 water requests, 0 log lines about water, 9 capabilities.
* On: `OptionalFeature._enable` adds the three capabilities with the manifest options, probes once, shows a status and reads the group at once (`optional.js:89-102`); the poll group runs every cycle with a 15-minute hold-off after 404 (`toonwater.js:93-103`, `schedule.js:143-149`).
* Off again: `_disable` drops in-flight answers first (`poller.invalidate`), removes the capabilities, clears warning and status (`optional.js:104-119,219-225`); a failed removal restores the running state and rethrows so Homey does not store the setting.
* Legacy devices: decided once from the capability list, recorded as `store.toonwaterDecidedBy = 'migration'`, never flipped again (`capabilities.js:156-168`).
* Flow editor: no `capabilities=` filter (ADR-0007); the app's water cards are deprecated, Homey's own cards and tags follow the capabilities. The owner's literal wording "water cards appear when on" is therefore met **only through Homey's system cards**; what the editor shows is hardware-only (section 11).

### 5.2 Robustness and security (NFR-01, NFR-04)
* URL built with `new URL` from a validated host; `redirect: 'manual'`; 2 MiB cap; 5 s timeout on injected Homey timers; `Connection: close` (`client.js:17,53,98-139`). Address rejects schemes other than `http`, userinfo, paths, IPv6, port > 65535, `0.x.x.x` (`address.js`). Flow arguments validated before a request exists (`commands.js:35-52`). Parsers use `Object.hasOwn`, never call payload methods, never emit `undefined`/`NaN` (`parse.js`); hostile fixtures (`__proto__`, null node, array water) exist. Error texts never carry bodies or stacks (`errors.js`).
* One race I looked for specifically (settings toggle during an in-flight poll) is handled by a per-group sequence number (`poller.js:77-79,217-237`) and by `switchedOff` in `optional.js:_show`.
* `onInit` migration is offline-first; a migration failure is logged and retried at the next start without making the device unavailable (`device.js:154-164`).

### 5.3 Bundle (built with the local CLI and listed)
36 files: `LICENSE`, `README.txt`, `README.nl.txt`, `app.js`, `app.json`, `assets/**` (3), `drivers/open-toon/**` (6), `lib/**` (15), `locales/*` (2), `node_modules/homey/{index.js,package.json}` (the CLI shim), `package.json`, `package-lock.json`. The 293 KB `package-lock.json` is copied by the CLI and is harmless; nothing from `docs/`, `test/`, `scripts/`, `.github/` or `.claude/` is in it.

### 5.4 Minor observations (not blockers)
* `scripts/toon-probe.js` (732 lines, read-only hardware probe with PII masking) and its 33 unit tests were added after the QA report; lint and tests cover it; it is not shipped.
* `pair/start.html` uses `placeholder="192.168.1.50"` as the one literal string; it is an example value, not a sentence.
* `toonwater_status` shows "-" until the feature is first switched (08 O-4); cosmetic.

---

## 6. Licensing and provenance (hard rule 4, NFR-11)

* `lib/features/toonwater.js:3-14` carries the provenance header: written from the interface description in `03` section 5.3 and from this repository's GPL-3.0 water code (PR #21, `f705a70`, `device.js:410-424` at `5cc3b90`); no file of `oepi-loepi/*` copied or paraphrased; invented sample values.
* `test/static/provenance.test.js` asserts the header, the licence record in `01` section 13 and `03`, and that no app file carries a copyright line, a QML marker (`\bqml\b`, `ToonWaterApp`, `import qs`, `import BxtClient`) or a file name of the unlicensed code. My own grep of `app.js`, `drivers/`, `lib/`, `locales/`, `.homeycompose/` for `oepi|\.qml|ToonWaterApp|WaterConfigScreen|home-assistant` finds only the header sentence and the contributor credit.
* All 24 Toon fixtures in `test/fixtures/toon/` carry a `source` field saying "derived from … not captured; HW-02"; none claims to be a capture.
* `03` section 13 is the provenance log; SEC-01 (two sample values once copied from an add-on comment) is recorded there as found and corrected.
* `package.json` `license: GPL-3.0` matches `LICENSE`; `app.json:39-51` still credits oepi-loepi, Paul Heeringa and moezie.

---

## 7. Critical reading of `08-test-report.md` and spot-checks

The report is careful about its own limits (fake Homey encodes a *reading* of the docs; every fixture is derived). I re-ran five of its claims:

| Claim in `08` | What I ran | Result |
|---|---|---|
| section 3: `lib/` 100.00 % lines, 98.31 % branches, 99.27 % functions | `npm run test:coverage` | identical figures |
| section 6, scenario 8: "95 page requests in 24 hours (limit 97)" for an enabled device on a Toon that answers 404 | `node --require ./test/helpers/register.cjs --test --test-reporter=spec test/scenario/qa-acceptance.test.js`, read the `EVIDENCE toonwater.on-404` line | `pageRequestsIn24h: 95`, `errorLines: 0`, Dutch status and warning texts as stated |
| section 6, scenario 7: 2 simulated hours, 0 water requests, 0 404s, 9 capabilities | same run, `EVIDENCE toonwater.off-without-addon` | `cycles: 240, waterRequests: 0, http404Answers: 0, waterLogLines: 0, warning: null` |
| section 7: mutant `no-backoff` killed, 3 failing in the QA file, 10 in the whole suite | `node scripts/qa-mutation.js no-backoff` (10 s) | "killed (3 failing) / killed (10 failing); 0 survived" |
| section 3: pack check 36 files, nothing outside the app | `npm run pack:check` and my own bundle listing | 36 files, listed in 5.3 |

Where the report is **out of date**: test count (1,400 vs 1,433 now) and the file list of section 4 (no `scripts/toon-probe.js`). Where the report is **right to be cautious** and I agree: NFR-02 was never executed on Node 22 (the machine has 25.9); the first CI run is that verification. Its section 9 (eight designed deviations) is accurate and is repeated in section 10 below because the owner has to acknowledge them.

---

## 8. Requirements traceability (every MUST and SHOULD of `01-requirements.md` section 9)

Status: **done** = fully verifiable now and verified; **partial** = the mock part is done and verified, a hardware part, a deferral or an owner step remains (named); **missing** = no implementation. Test files are from `npm run check:requirements -- --matrix`; code lines are what I read.

| Id | Prio | Status | Evidence (code; tests; what remains) |
|---|---|---|---|
| FR-01 | MUST | partial | `pairing.js:132-159`, `start.html:202-229`; `scenario/pairing`, `unit/pairing`, `static/pair-html`, QA-01. HW: AC4 end-to-end pairing (01-HW-01) |
| FR-02 | MUST | done | `pairing.js:67-115` (5 s via `client.js:53`, `NOT_A_TOON` :25); `scenario/pairing`, `unit/pairing`, QA-01 |
| FR-03 | MUST | done | `address.js:43-66`; `device.js:183-188`; `unit/address`, `unit/capabilities`, QA-01/04 |
| FR-04 | SHOULD | partial | `pairing.js:138-140`; `unit/pairing`, `scenario/pairing`. HW: AC2 Homey's own duplicate message |
| FR-05 | SHOULD | partial | AC1 static: `start.html` (Style Library, `data-i18n`, no jQuery), `static/pair-html`. HW: AC2 rendering light/dark, web/mobile |
| FR-10 | MUST | done | `parse.js:126-131`; `unit/parse-thermostat`, QA-02 |
| FR-11 | MUST | partial | `commands.js:35-41` (integer centi-degrees, 6..30), `device.js:123-130`; `unit/commands`, `scenario/device-writes`, QA-14. HW: AC4 Toon behaviour on a new setpoint |
| FR-12 | MUST | partial | `parse.js:14-16,136-139`, `app.json:970-976`, `device.js:111`; `unit/parse-thermostat`, `scenario/flow-cards`, QA-11. HW: AC3 `activeState 4` is from the audit |
| FR-13 | MUST | partial | `commands.js:29-32,48-52`, `cards.js:24-29`; `unit/commands`, `scenario/device-writes`, QA-14. `resume_program=no` is a placeholder (ADR-0015). HW: AC5 |
| FR-14 | MUST | partial | `commands.js:54-55`; `unit/commands`, `scenario/flow-cards`, QA-14. HW: AC3 |
| FR-16 | SHOULD | done | `schedule.js:57-62` (latest write wins), `poller.js:130-140`, `device.js:19`; `unit/poller`, `scenario/device-writes` |
| FR-20 | MUST | done | `parse.js:172-179`, `apply.js:84` (no write to a capability the device lacks); `unit/parse-power`, `unit/apply`, QA-02 |
| FR-21 | MUST | partial | `parse.js:105-110,188-204` (3 decimals, NaN fallback); `unit/parse-power`, QA-02/12. HW: AC4 real meters (01-HW-02) |
| FR-22 | MUST | partial | `parse.js:38-87` (`dev_2.x` first, then `type`, ambiguity note); fixtures dev2/dev3; `unit/meters`. HW: AC3 real `getDevices.json` (01-HW-02, OQ-05); the type table is medium confidence |
| FR-24 | MUST | done | `parse.js` never throws, `client.js:28-38,53,124-139`; junk/hostile fixtures; `unit/client`, `unit/meters`, QA-12; harness unhandled counter |
| FR-25 | SHOULD | partial | `features/export.js`, `parse.js:176-177`, setting `export_enabled` `app.json:867`; `scenario/export-feature`, `unit/export`. HW: AC4 an exporting household |
| FR-28 | MUST | partial | `parse.js:193-194`; `unit/parse-power`, QA-02. HW: AC3 |
| FR-30 | SHOULD | partial | `parse.js:18-19,141-148`, `.homeycompose/capabilities/burner_state.json`; `unit/parse-thermostat`, `static/manifest`. HW: AC4 the 0/1/2/3 table (01-HW-08) |
| FR-31 | MUST | done | `core.js:27`, `parse.js:145`, `cards.js:62` (unguarded), `toonwater.js:92` (not a water detector); `scenario/flow-legacy`, `static/capability-titles`, QA-07 |
| FR-32 | SHOULD | partial | `app.json:198-294,407-478`, `cards.js:63-72`, `core.js:72-77`; `scenario/flow-triggers`, QA-13. Trigger id is `burner_state_changed_to` (ADR-0009). HW: table of FR-30 |
| FR-50 | MUST | done | `driver.settings.compose.json:72-101`; `static/manifest`, `static/registry-vs-manifest` |
| FR-51 | MUST | partial | `driver.compose.json:13-23`, `pairing.js:142-156`; QA-01/07 (0 water requests in 240 cycles). HW: AC4 tile and editor |
| FR-52 | MUST | partial | `optional.js:89-102`, `capabilities.js:126-147`, `toonwater.js:107`; `scenario/toonwater-toggle`, QA-08/09. HW: AC5; "cards appear" is met via Homey system cards (ADR-0007) |
| FR-53 | MUST | partial | `optional.js:104-119`, `poller.js:77-79`; `scenario/toonwater-toggle`, QA-09. HW: AC5 editor, Insights history (01-HW-06) |
| FR-54 | MUST | partial | ADR-0007 (no filter, deprecated `app.json:119-120,645-646`), `cards.js:82-93` (reject for user-decided, no-op for migration-decided per ADR-0018); `scenario/flow-legacy`, QA-07. AC1/AC2 amended by ADR. HW: AC5 what happens to a Flow |
| FR-55 | MUST | partial | `toonwater.js:62-67`, `optional.js:156-217`, `locales/*.json:20-36`; `scenario/toonwater-detection`, QA-08 (404 evidence re-run). HW: AC7 real status code (01-HW-07) |
| FR-56 | MUST | done | `capabilities.js:30-33,156-168`, `features/index.js:77-82`, `toonwater.js:92`; `scenario/toonwater-migration`, `scenario/migration-eras`, QA-10. AC6 amended by ADR-0018 (hint instead of tile warning when no value was ever held) |
| FR-57 | MUST | done | `toonwater.js:93-103`, `schedule.js:143-149`, `poller.js:204`; `scenario/toonwater-detection`; 95 requests / 24 h re-run |
| FR-58 | MUST | partial | `toonwater.js:39-54`; `unit/toonwater-parse`, fixtures `water-ok`/`water-no-total`. HW: AC5 units against the Toon screen |
| FR-59 | MUST | partial | `locales/{en,nl}.json:20-36`, `app.json:829-857`; `unit/messages`, `scenario/toonwater-toggle`. HW: AC4 rendering |
| FR-60 | MUST | done | `toonwater.js:19` (single home of `/water.html`), `capabilities.js:50-53`; `static/layering`, `scenario/flow-triggers`, QA-07 |
| FR-61 | SHOULD | partial | `pairing.js:76-84,101-104`, `start.html:71-78`; `scenario/pairing`, `unit/pairing`. HW: visual check |
| FR-62 | SHOULD | done | `optional.js:188-217`, `toonwater.js:110-112`; `scenario/toonwater-detection` (restart-safe per ADR-0018) |
| FR-70 | MUST | partial | `cards.js:95-109,135-143`, `core.js:54-78`; `scenario/flow-triggers`, QA-13. `temperature_state_changed` is left to Homey (`core.js:69`, ADR-0009). HW: 04-HW-06 double-fire / not fired |
| FR-71 | SHOULD | partial | `app.json:68-69,119-120`; `static/manifest`. HW: AC2 editor hides deprecated cards |
| FR-72 | MUST | done | `cards.js:31-32,61-63`, `app.json:377-387`; `scenario/flow-cards`, QA-14 |
| FR-73 | MUST | done | `device.js:142-148`, `errors.js:72-78`, `app.json:487-490`; `scenario/flow-cards`, QA-15; validate passes. AC3 is Homey's own behaviour |
| FR-74 | MUST | done | `cards.js:40-43,57-60`, `poller.js:103-114`; `scenario/flow-legacy`, `unit/poller`, QA-14/15. AC4 per ADR-0018 |
| FR-75 | SHOULD | partial | `app.json:616-619,630-661`; `static/manifest`. HW: AC3 editor |
| FR-76 | MUST | done | `test/static/contract.test.js`, `test/fixtures/{baseline-app,contract-exceptions}.json`; my independent Appendix A run (section 3) |
| FR-77 | SHOULD | done | `app.json` titles/`titleFormatted`/arg titles, nl `!{{is|is niet}}` `:301,305`; `static/cards-vs-manifest`, `static/manifest`; validate `verified` |
| FR-80 | MUST | partial | `poller.js:47-50,163-214`, `device.js:36-56`; `unit/poller`, `scenario/device-lifecycle`, QA-02 (11 requests / 5.5 min, gaps 30,000 ms). HW: AC5 24 h |
| FR-81 | MUST | partial | `schedule.js:92-130,110-113`, `device.js:219-225`; `unit/schedule`, QA-03. AC1 amended to count + time (ADR-0005). HW: AC5 |
| FR-82 | MUST | partial | `capabilities.js:73-102`, `device.js:58-83`, `poller.js:62-69`, `optional.js:57-66`; QA-04. HW: AC3 |
| FR-83 | SHOULD | done | `app.json:780-798`, `schedule.js:89,97-107`, `device.js:65,70`; `unit/capabilities`, `scenario/device-lifecycle` |
| FR-84 | MUST | done | `device.js:85-92,259-266`, `poller.js:53-59`; `scenario/device-lifecycle`, QA-05 |
| FR-85 | SHOULD | partial | `app.json:808-826`, `device.js:20,205-218`; `scenario/device-lifecycle`. HW: 01-HW-13 rendering |
| FR-90 | SHOULD | partial | **deferred by ADR-0016** (energy block byte-identical; validator prints two warnings); `static/manifest` asserts the deferral. HW gate 01-HW-11 first |
| FR-100 | MUST | done | `locales/{en,nl}.json` same keys; `static/i18n`, `static/pair-html`; validate "locales in sync" |
| FR-101 | SHOULD | done | `static/locale-typos`, `test/fixtures/typos.json`; no "IP adres"/"Mi Home" in locales |
| FR-110 | MUST | partial | `capabilities.js:149-168` (additive, marker last); `scenario/migration-eras`, QA-10 (eras checked against `git show` of `app.json`). HW: AC2 install over a real old build (01-HW-12) |
| FR-111 | MUST | done | `capabilities.js:19-21,44-59,105-114,156-168`; `unit/planners`, `unit/capabilities`, `scenario/migration-eras` |
| FR-112 | MUST | done | `schedule.js:97-100`, `device.js:37-39`, `features/index.js:46-49`; `scenario/migration-eras`, `unit/poller` |
| FR-113 | MUST | done | `scenario/toonwater-migration` (eras x water x tariff), QA-10 |
| FR-114 | SHOULD | done | `apply.js:29-47` (an increase always passes; counter-decrease policy ADR-0014); changelog line; `scenario/flow-triggers` |
| FR-120 | MUST | partial | validate `publish` exit 0; `app.json:4` `2.0.0`; `package.json` fields; `static/repo-hygiene`, `static/validate-script`. HW: AC2 `homey app install` on the Homey Pro |
| FR-121 | SHOULD | partial | `app.json:53,7-9,59-63,687-692`, `README.txt`, `.homeychangelog.json`; `static/docs`. Store-only gaps: identical app/driver icons (HS-18), no `xlarge` images, naming/trademark (OQ-02) |
| FR-122 | SHOULD | done | `README.md` en (:10-183) and nl (:185-356): prerequisites and disclaimer, pairing, interval, "Update" Flows no longer needed, ToonWater and its Flow consequences, upgrading, reporting with `getDevices.json`/probe; `CONTRIBUTING.md` rewritten; credits `app.json:39-51`; `static/docs` |
| NFR-01 | MUST | done | `apply.js:65-75`, `cards.js:139`, `poller.js:242`, `register.cjs` counter; lint `no-floating-promises` with `@types/homey` (`static/lint-canary`); `unit/unhandled`, `scenario/soak` |
| NFR-02 | MUST | partial | `package.json:6-8`, CommonJS everywhere, `static/node22` denylist, CI on Node 22. **Not executed on Node 22** (machine has 25.9): the first CI run settles it |
| NFR-03 | MUST | partial | `schedule.js` Lane (one request in flight), `client.js:53` 5 s, back-off `schedule.js:110-113`; QA-02 `maxConcurrent 1`. HW: AC4 24 h load on a Toon 1 (01-HW-10, OQ-08) |
| NFR-04 | MUST | done | `client.js:98-139`, `address.js`, `commands.js:35-52`, `errors.js`; hostile fixtures; `unit/client`, `unit/address`, `unit/commands`, QA-16 |
| NFR-05 | MUST | done | `package.json:9` `{}`; `npm ls --omit=dev` empty; `npm audit --omit=dev` 0; grep for old libraries empty; `static/deps`, `static/check-pack` |
| NFR-06 | MUST | done | `npm test` 8.9 s offline; `test/helpers/{mock-toon,fake-homey,fake-clock}`; coverage 100 % lines; `check:requirements`; fixtures marked derived |
| NFR-07 | MUST | partial | `app.json:5,7-9,687-692` (ADR-0004 floor, owner to confirm OQ-04); README names supported/unsupported models; `static/docs`. HW: AC2 model matrix |
| NFR-08 | MUST | done | `device.js:36-56` (no network awaited), QA-15 timings (0 ms refused/500, 5 s timeout, 10 s while a poll waits: amended by ADR-0005) |
| NFR-09 | SHOULD | done | `schedule.js:214-220`, `optional.js:177-180`, `device.js:204-229`; QA-08 (0 error lines in 24 h of 404) |
| NFR-10 | SHOULD | done | module split `lib/{toon,engine,features,flow}`; `static/layering`, `static/lib-budget`, `static/lint-canary`; no dead code (grep); CI and Dependabot valid |
| NFR-11 | MUST | done | section 6 |
| NFR-12 | SHOULD | done | `scenario/soak`, QA-06 (timers `[2,2,2,2]` over three restarts) |
| NFR-13 | SHOULD | partial | `.gitignore`/`.homeyignore` in place, release step written (`09` section 11, ADR-0011, CONTRIBUTING); **`node_modules` still tracked (1,880 files) until the owner runs `git rm -r --cached node_modules`**; Dependabot PRs #31-#33 still to be closed on GitHub |
| NFR-14 | MUST | done | `static/contract`, `static/capability-titles`, `static/cards-vs-manifest`, `static/registry-vs-manifest`, `scenario/flow-cards`; exception file ADR-0017 |
| NFR-15 | MUST | done | `static/layering` ("fetch is the only outbound path"), QA-16 (only the typed hosts contacted, no auth/cookie headers); no `homey-log` |
| NFR-16 | SHOULD | partial | `locales/*.json` plain sentences, `errors.js` never leaks internals; `unit/messages`. HW: AC2 a Dutch reader |

Totals: 74 requirements (51 MUST, 23 SHOULD). 39 done, 35 partial, 0 missing. Of the 35 partials, 31 wait only for hardware, 1 is a deliberate deferral (FR-90, ADR-0016), 1 waits for the owner's release step (NFR-13), 1 waits for the first CI run (NFR-02), and FR-121's remainder is a Store/artwork decision (OQ-02).

---

## 9. Verdict

**PASS_WITH_NOTES.** All gates pass; the stability contract holds with exactly the three documented ADR-0017 exceptions; the migration is additive and marker-gated; the ToonWater opt-in behaves as the owner asked (verified against the mock, including the in-flight races); the licensing rule was kept and is machine-checked; the test report's claims reproduce. No defect in the application was found in this review. The notes are release-step items and acknowledgements, not code changes.

---

## 10. Notes for the owner (before committing, and to acknowledge)

**Before the first commit**
1. `git rm -r --cached node_modules` (ADR-0011; `09` section 11). Then `git status` must not list `node_modules`. Do this before any `git add`.
2. Review the untracked `docs/` tree (one `11-delivery-gate.md`, this file, is mine) and commit it with the code.
3. Push and watch the **first CI run**: the Node 22 job is the only Node 22 execution of lint, tests and coverage so far (NFR-02).

**Designed deviations that need your acknowledgement** (all recorded by ADR, repeated from `08` section 9)
4. Availability rule: unavailable after 3 failed cycles spanning >= 90 s (or 2 spanning >= 15 min), i.e. the 4th failed cycle at the 30 s default, not the 3rd (ADR-0005; FR-81 AC1).
5. Water Flow cards: no `capabilities=` filter; the app's `update_water` and `measure_water_changed` are deprecated; "water cards appear when on" is met only by Homey's system cards and tags (ADR-0007; FR-52/53/54). The editor's behaviour is hardware-only.
6. Migrated devices: `update_water` on an era-0/1 device resolves as a no-op (a chained legacy Flow keeps running); an era-2/3 device without the add-on gets a status and a timeline hint after 24 h, **no tile warning**, and keeps about 95 `/water.html` 404s per day until you untick the setting (ADR-0018; FR-54 AC2, FR-56 AC6, FR-62 AC1). Flip `warnWhenMigrationDecided` (`lib/features/toonwater.js:113`) to `true` to warn always.
7. `temperature_state_changed` is not fired by the app; the design relies on Homey firing it for the custom capability (ADR-0009; `lib/features/core.js:69`). If hardware shows otherwise, change `'homey'` to `'app'`.
8. FR-90 (kWh in Homey Energy) is deferred behind HW-11 (ADR-0016); `homey app validate` keeps printing two energy warnings until then.
9. Era-0 plain `meter_power` is frozen, never written again (ADR-0014; changelog line present).
10. `compatibility >=12.9.0` (ADR-0004, OQ-04): Homeys below firmware 12.9.0 keep the old build.
11. `resume_program = no` sends a placeholder request (`state=0&temperatureState=<id>`, ADR-0015) until hardware shows the real sequence.

**Documentation tidy-ups (optional)**
12. `08-test-report.md`: test count 1,400 -> 1,433 and add `scripts/toon-probe.js` / `test/unit/toon-probe.test.js` to section 4.
13. The numbered series has no `07-`: the security review's findings SEC-01 (`03` section 13) and SEC-02 (ADR-0012 rev 3) were applied, but the review itself has no write-up in `docs/sdlc/`.
14. Store readiness only (not needed for sideloading): app and driver icons are byte-identical and unchanged from the baseline (HS-18), no `xlarge` images, optional `runtime` key absent, `package-lock.json` (293 KB) travels in the bundle.

---

## 11. What can ONLY be verified on real hardware

The authoritative plan is `10-hardware-test-plan.md` (phases A-M, questions Q-01..Q-35). The items below are the ones this gate could not close and that carry the most risk; the ids in brackets are the plan's.

1. Pair end to end in Homey web and mobile, en and nl, light and dark; the duplicate-id message (FR-01 AC4, FR-04 AC2, FR-05 AC2, FR-59 AC4; 01-HW-01, Q-29).
2. Capture anonymised `getThermostatInfo`, `GetCurrentUsage`, `getDevices.json` and `/water.html` from each Toon with `scripts/toon-probe.js`; confirm the meter node discovery table, single vs two tariff, `powerProduction`, and replace the derived fixtures (FR-21, FR-22, FR-25, FR-28, FR-58; 01-HW-02, Q-01, Q-05, Q-11).
3. `/water.html` without the add-on: is it really HTTP 404; behaviour after a Toon reboot; units of `flow`/`value`/`total` against the Toon screen (FR-55 AC7, FR-58 AC5; 01-HW-07).
4. `burnerInfo` values 0/1/3 over a day (only 2 = hot water is confirmed by the baseline code) (FR-30, FR-32; 01-HW-08, Q-04).
5. `activeState 4` = vacation; `programState` semantics; what `set_temperature_state` with `resume_program` yes/no really does on the Toon (FR-12 AC3, FR-13 AC5, FR-14 AC3; 01-HW-04, Q-02, Q-03, Q-07).
6. Does Homey fire the app's `temperature_state_changed` for the custom capability, and exactly once (FR-70; 04-HW-06, Q-16).
7. Flow editor: which water cards are offered with ToonWater on and off; whether deprecated cards are hidden and still run; what happens to a Flow after `removeCapability` and after re-adding (FR-52 AC5, FR-53 AC5, FR-54 AC5, FR-71 AC2, FR-75 AC3; 01-HW-05, 04-HW-07/08/09, Q-18, Q-19, Q-20).
8. Whether Insights history survives `removeCapability` + `addCapability` (FR-53; 01-HW-06, Q-19).
9. Install 2.0.0 over a real old build (eras 1-3) without re-pairing: devices, names, zones, values, Flows, settings and store survive; defaults of the new settings keys on upgraded devices; titles/options of capabilities added by the migration; the `vacation` value in the picker (FR-110 AC2, FR-113; 01-HW-12, 04-HW-02/03/04/05, Q-22, Q-23, Q-24, Q-26).
10. Unplug/re-plug the Toon: unavailable message, recovery time (up to the 5 min back-off cap), which Flow cards Homey blocks while unavailable (FR-81 AC5, FR-73 AC3; 01-HW-09, 04-HW-12, Q-30, Q-31).
11. 24 h endurance at 10/30/60 s: Toon UI responsiveness, response time of `getDevices.json`, the nightly Toon reboot vs the availability rule (NFR-03 AC4, FR-80 AC5; 01-HW-10, Q-06, Q-15).
12. Settings UX on a real Homey: invalid-address error, save messages as toasts, `setWarning` rendering, read-only status labels re-asserted after a save (FR-59 AC4, FR-82 AC3, FR-85; 01-HW-13, Q-21).
13. Homey Energy page: W and gas from the Toon, whether `meter_water.today/total` are mistaken for the home's water meter, no double counting; gate for FR-90 (01-HW-11, Q-25).
14. The type of dropdown arguments in run listeners and whether `label`-only values render (04-HW-10, Q-17).
15. Several Toons on one Homey, optionally alongside the community "toonWater" app; other Homey Pro models (FR-04 AC3, NFR-07 AC2; 01-HW-14/15).
16. Anything about the Toon's HTTP behaviour the mock assumed: text/javascript JSON bodies, `Connection: close` handling, `result: error` shape (Q-13, Q-14).
17. The first GitHub Actions run on Node 22 and Node 24 (NFR-02, NFR-10 AC2).

---

## 12. Reproduce this gate

```
git rev-parse HEAD                       # 5cc3b904219279062f80b4af60f55927b3d75c6d
npm run lint && npm test && npm run validate && npm run validate:verified && npm run pack:check
npm audit --omit=dev && npm ls --omit=dev
npm run test:coverage && npm run check:requirements
node --require ./test/helpers/register.cjs --test --test-reporter=spec test/scenario/qa-acceptance.test.js | grep EVIDENCE
node scripts/qa-mutation.js no-backoff
# Appendix A of 04 against the baseline (expect exactly the three ADR-0017 ids, exit 1):
mkdir -p test/.gate-tmp
git show 5cc3b90:app.json > test/.gate-tmp/baseline.json
sed -n '/^```js$/,/^```$/p' docs/sdlc/04-compat-contract.md | sed '1d;$d' > test/.gate-tmp/contract-check.js
node test/.gate-tmp/contract-check.js test/.gate-tmp/baseline.json app.json
rm -rf test/.gate-tmp
git ls-files node_modules | wc -l        # 1880 until the owner runs git rm -r --cached node_modules
```
