# 08 - Test report (QA): Open-Toon for Homey (nl.vinceste.open-toon)

| | |
|---|---|
| Role | QA engineer |
| Date | 2026-11-13 |
| Repo state | branch `redesign/sdk3`, base `5cc3b90`, working tree only (nothing committed, pushed or stashed by QA) |
| Inputs | `01-requirements.md` (section 9 table, section 11 hardware backlog), `05-architecture.md`, ADR-0001 to ADR-0018, the code in `lib/`, `drivers/`, `app.js`, the tests in `test/` |
| Verdict | **PASS for everything a mock can verify.** No defect found in the application; QA changed no application file. 33 of the 74 MUST/SHOULD requirements still have a part that only a real Toon or a real Homey can settle (section 10). Eight designed deviations from the requirement text are recorded by ADR and need the owner's acknowledgement (section 9). |

Trust levels. Everything here was observed against the in-repo mock Toon and the strict fake Homey, on a fake clock. Every Toon payload in the repo is a fixture whose `source` field says "derived ... not captured" (HW-02 in doc 01). The fake Homey encodes our reading of the Homey documentation, so a test that passes proves the code does what the design says, not that Homey does what the design assumes. Where the second matters, the item is in section 10.

## 1. Summary

| Question | Answer |
|---|---|
| Do the gates pass? | Yes: lint, tests, validate (publish level), pack check, audit of production dependencies (section 3) |
| Does every MUST and SHOULD have an automated test? | Yes: 74 of 74 name at least one test; the one that only hardware can settle in full (FR-05) has static checks for its AC1 (section 5) |
| Do the 16 end-to-end scenarios behave as designed? | Yes, 49 black-box tests with evidence (section 6) |
| Do the tests notice when behaviour breaks? | Yes: 14 of 14 injected faults are killed by the whole suite, and by the QA file alone (section 7) |
| Real defects found | None. Weak spots of the test set were found and fixed (section 8.2) |
| Tests | 1,400 pass, 0 fail, 0 skipped, 254 suites, 8.9 s; the same in three consecutive runs |

## 2. Scope and environment

| Item | State |
|---|---|
| Machine | macOS, Node.js v25.9.0. **No Node 22 binary is installed**, so nothing ran on the runtime of the Homey (Node 22). Node 22 compatibility rests on the lint rule for `engines.node`, the denylist test `test/static/node22.test.js` and the CI job (`.github/workflows/ci.yml`, Node 22 for lint and tests, Node 24 for validate and pack). The first CI run is the Node 22 verification. |
| Toon | none. Mock Toon with fault modes 500, timeout, refused, redirect, oversize, result-error, idle-close and water modes present, 404, html-200, 403, 500, old-shape, flat-ESP, junk, slow |
| Homey | none. Fake Homey with strict SDK v3 behaviour (throws on an invalid capability, a v2 signature, a missing translation) |
| Network | no test touches the network; a request to a host without a mock fails like an unroutable address |
| Git | not touched. `git status` shows the same changed files as at the start, plus the new files of section 4 |

## 3. Gate results

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `npm run lint` | 0 | no finding, `--max-warnings 0`, 4 s |
| 2 | `npm test` | 0 | 1,400 tests, 254 suites, 0 fail, 0 cancelled, 0 skipped, 8.9 s (three runs: identical counts, 8.85 to 8.95 s) |
| 3 | `npm run validate` | 0 | `homey app validate --level publish` passes; app.json and locales in sync. Two warnings: `energy.cumulative` has no `cumulativeImportedCapability` / `cumulativeExportedCapability` (FR-90 is deferred, section 9) |
| 4 | `npm run pack:check` | 0 | 36 files in the bundle; no `node_modules`, tests, docs or scripts in it |
| 5 | `npm audit --omit=dev` | 0 | found 0 vulnerabilities. `npm ls --omit=dev` is empty: the app has no runtime dependency |

Also run, as extra checks:

| Command | Result |
|---|---|
| `npm run test:coverage` | `lib/`: 100.00 % lines, 98.31 % branches, 99.27 % functions (gate: 90 % lines). `drivers/` and `app.js`: 98.88 % lines (uncovered: the two catch blocks of `device.js` lines 227-228 and 250-251) |
| `npm run check:requirements` | "every mock-verifiable MUST/SHOULD id has a test" |
| `npm run validate:verified` | passes at level `verified` (same two warnings) |
| `npm audit` (dev dependencies too) | 24 vulnerabilities (3 low, 17 moderate, 4 high), all in the dev tooling of the Homey CLI (for example `dockerode` / `uuid`). Not shipped (see pack check) and outside NFR-05 AC2, but Dependabot will report them (section 8) |

## 4. What QA added (tests and tooling only)

| File | What it is |
|---|---|
| `test/scenario/qa-acceptance.test.js` | 49 black-box tests in 16 groups (QA-01 to QA-16) for the situations of section 6. It uses only the public surface: the pair session, the settings save, the Flow cards and the records of the world. Each test prints its evidence with `t.diagnostic`; titles name the requirement ids so the matrix counts them. |
| `test/static/provenance.test.js` | 3 tests for NFR-11 AC1: the header of `lib/features/toonwater.js` states the provenance, doc 01 section 13 and doc 03 record the licence status of the sources, and no file of the app carries a copyright line, a QML marker or the name of a file of the unlicensed code |
| `test/static/capability-titles.test.js` | 3 tests for FR-31 AC4 and NFR-14: titles and options of every baseline capability, and the values of the custom capability `temperature_state`, are unchanged (the contract test pinned the ids, not the words users read) |
| `test/helpers/mutants.cjs`, `scripts/qa-mutation.js` | the mutation check of section 7: 14 faults injected in memory at module load, no file on disk changes |
| `docs/sdlc/08-test-report.md` | this report |

Before the QA pass the suite had 1,345 tests; it has 1,400 now.

## 5. Requirement-to-test matrix (all MUST and SHOULD)

"Titles" counts the `describe`/`test` titles that name the id (`npm run check:requirements -- --matrix` lists them); "Files" counts the test files they are in. A requirement whose tests sit in nested blocks can name its id once only (FR-62: nine tests under one `describe`).

How acceptance criteria were checked. The script only proves that each id is named. QA went further: it ran the suite with the TAP reporter, parsed the nested test names and the AC lists of doc 01, and found 33 mock-verifiable ACs whose number no title names. Each was traced to a test by hand. FR-90 AC1 and AC2 are deferred by ADR-0016; FR-73 AC3 and NFR-13 AC2 describe what Homey and GitHub do, which no mock can show; FR-31 AC4 (the titles users read) had no test, and QA added one. The other 28 are covered under a title that names a neighbouring id (for example FR-52 AC1 and AC2 under "FR-52 / FR-59"), by the matrix tests of `toonwater-migration` (FR-50 AC2, FR-56 AC1 to AC4), by a static test (FR-59 AC3, FR-60 AC3, FR-73 AC4), or by the harness itself (FR-24 AC3 is the unhandled-rejection counter of `register.cjs`).

| Id | Prio | Verify | Titles | Files | Result and notes |
|---|---|---|---|---|---|
| FR-01 | MUST | M+HW | 12 | 4 | pass. HW: AC4 pairing end to end (01-HW-01) |
| FR-02 | MUST | M | 20 | 4 | pass |
| FR-03 | MUST | M | 16 | 8 | pass |
| FR-04 | SHOULD | M+HW | 10 | 2 | pass. HW: AC2 how Homey words a duplicate id (01-HW-01) |
| FR-05 | SHOULD | HW | 4 | 2 | AC1 (static view source) pass; AC2 is hardware only (01-HW-01) |
| FR-10 | MUST | M | 5 | 2 | pass |
| FR-11 | MUST | M+HW | 4 | 3 | pass. HW: AC4 what the Toon does with a new setpoint (01-HW-03) |
| FR-12 | MUST | M+HW | 13 | 6 | pass. HW: AC3, activeState 4 = vacation comes from the audit (01-HW-04) |
| FR-13 | MUST | M+HW | 11 | 5 | pass. `resume_program = no` is a placeholder request (ADR-0015). HW: AC5 (01-HW-04) |
| FR-14 | MUST | M+HW | 7 | 4 | pass. HW: AC3 |
| FR-16 | SHOULD | M | 8 | 2 | pass |
| FR-20 | MUST | M | 6 | 4 | pass |
| FR-21 | MUST | M+HW | 4 | 2 | pass against derived payloads. HW: AC4 (01-HW-02) |
| FR-22 | MUST | M+HW | 6 | 3 | pass against derived payloads. HW: AC3 real getDevices.json (01-HW-02, OQ-05) |
| FR-24 | MUST | M | 11 | 6 | pass (AC3 is the harness-wide counter of NFR-01) |
| FR-25 | SHOULD | M+HW | 6 | 2 | pass. HW: AC4 |
| FR-28 | MUST | M+HW | 4 | 3 | pass. HW: AC3 |
| FR-30 | SHOULD | M+HW | 4 | 2 | pass. HW: AC4, the 0/1/2/3 mapping (01-HW-08) |
| FR-31 | MUST | M | 6 | 5 | pass |
| FR-32 | SHOULD | M+HW | 9 | 5 | pass; the trigger id is `burner_state_changed_to` (ADR-0009) |
| FR-50 | MUST | M | 5 | 2 | pass |
| FR-51 | MUST | M+HW | 7 | 4 | pass. HW: AC4 what the tile and editor show |
| FR-52 | MUST | M+HW | 9 | 3 | pass. HW: AC5; met through Homey system cards (ADR-0007) |
| FR-53 | MUST | M+HW | 5 | 2 | pass. HW: AC5 and Insights history (01-HW-06) |
| FR-54 | MUST | M+HW | 6 | 4 | pass as amended: AC1 has no `capabilities=` filter (ADR-0007), AC2 is a no-op on migrated devices (ADR-0018). HW: AC5 |
| FR-55 | MUST | M+HW | 12 | 4 | pass. HW: AC7 real status code (01-HW-07) |
| FR-56 | MUST | M | 6 | 3 | pass; AC6 amended by ADR-0018 |
| FR-57 | MUST | M | 6 | 1 | pass |
| FR-58 | MUST | M+HW | 5 | 3 | pass against a derived page. HW: AC5 units (01-HW-07) |
| FR-59 | MUST | M+HW | 5 | 3 | pass. HW: AC4 rendering (01-HW-13) |
| FR-60 | MUST | M | 8 | 4 | pass |
| FR-61 | SHOULD | M+HW | 15 | 3 | pass |
| FR-62 | SHOULD | M | 1 | 1 | pass; AC1 amended (restart-safe, ADR-0018). Nine tests sit under one describe, so only one title names the id |
| FR-70 | MUST | M | 10 | 5 | pass; AC1 for `temperature_state_changed`: Homey fires it, the app never does (ADR-0009, 04-HW-06) |
| FR-71 | SHOULD | M+HW | 3 | 2 | pass. HW: AC2 (04-HW-07) |
| FR-72 | MUST | M | 5 | 2 | pass |
| FR-73 | MUST | M | 7 | 2 | pass; AC3 is Homey blocking actions on an unavailable device (04-HW-12) |
| FR-74 | MUST | M | 12 | 4 | pass; AC4 follows ADR-0018 |
| FR-75 | SHOULD | M+HW | 3 | 1 | pass. HW: AC3 |
| FR-76 | MUST | M | 10 | 1 | pass |
| FR-77 | SHOULD | M | 9 | 3 | pass |
| FR-80 | MUST | M+HW | 5 | 3 | pass. HW: AC5 24 h (01-HW-10) |
| FR-81 | MUST | M+HW | 7 | 4 | pass as amended: count and time (ADR-0005). HW: AC5 (01-HW-09) |
| FR-82 | MUST | M+HW | 3 | 2 | pass. HW: AC3 (01-HW-13) |
| FR-83 | SHOULD | M | 7 | 4 | pass |
| FR-84 | MUST | M | 10 | 5 | pass |
| FR-85 | SHOULD | M+HW | 2 | 1 | pass. HW: how the labels render (01-HW-13) |
| FR-90 | SHOULD | M+HW | 3 | 1 | **DEFERRED by ADR-0016**: not built; tests assert the deferral; `npm run validate` prints two energy warnings |
| FR-100 | MUST | M | 9 | 6 | pass |
| FR-101 | SHOULD | M | 5 | 3 | pass |
| FR-110 | MUST | M+HW | 6 | 4 | pass. HW: AC2 install over a real old build (01-HW-12) |
| FR-111 | MUST | M | 17 | 5 | pass |
| FR-112 | MUST | M | 5 | 4 | pass |
| FR-113 | MUST | M | 4 | 2 | pass (QA-10 repeats it from the outside) |
| FR-114 | SHOULD | M | 2 | 2 | pass |
| FR-120 | MUST | M+HW | 5 | 3 | pass. HW: AC2 install on a Homey Pro |
| FR-121 | SHOULD | M | 4 | 2 | pass |
| FR-122 | SHOULD | M | 5 | 2 | pass |
| NFR-01 | MUST | M | 14 | 8 | pass |
| NFR-02 | MUST | M | 3 | 2 | static only: lint rule, denylist of newer APIs, CI on Node 22. Not run on Node 22 here (none installed) |
| NFR-03 | MUST | M+HW | 5 | 4 | pass. HW: AC4 (01-HW-10) |
| NFR-04 | MUST | M | 16 | 6 | pass |
| NFR-05 | MUST | M | 4 | 3 | pass |
| NFR-06 | MUST | M | 22 | 8 | pass: offline, 9 s, lib line coverage 100 % (gate 90 %) |
| NFR-07 | MUST | M+HW | 3 | 2 | pass. HW: AC2 model matrix (01-HW-15) |
| NFR-08 | MUST | M | 6 | 3 | pass as amended: 6 s normally, 10 s while a poll waits out its own 5 s timeout (ADR-0005) |
| NFR-09 | SHOULD | M | 4 | 3 | pass |
| NFR-10 | SHOULD | M | 7 | 4 | pass |
| NFR-11 | MUST | M | 5 | 4 | pass; AC1 is a human review, QA added a static provenance test |
| NFR-12 | SHOULD | M | 5 | 2 | pass |
| NFR-13 | SHOULD | M | 4 | 3 | AC1 as written: pass (the release step is written down), but the git index still tracks 1,880 `node_modules` files until the owner runs it; AC2 (close Dependabot PRs) is a GitHub action |
| NFR-14 | MUST | M | 7 | 6 | pass |
| NFR-15 | MUST | M | 4 | 4 | pass |
| NFR-16 | SHOULD | M+HW | 4 | 3 | pass. HW: AC2 a Dutch reader |

Totals: 51 MUST and 23 SHOULD. 41 are verified by mocks alone, 32 have a mock part and a hardware part, FR-05 is hardware only. All 74 are named by at least one test.

HW ids. Doc 01 section 11 and doc 04 both number hardware checks `HW-01...`, and the tests carry the numbering of doc 04/05 in their `[HW-nn]` tags. This report writes `01-HW-nn` or `04-HW-nn` to say which it means. The hardware test plan has to reconcile the two lists (section 8, O-9).

## 6. The scenarios

Run `node --require ./test/helpers/register.cjs --test --test-reporter=spec test/scenario/qa-acceptance.test.js` to read every `EVIDENCE` line. All of them also assert that no unhandled rejection or uncaught exception happened (`assertNoUnhandled`), and that no error-level line was written by a device, unless said otherwise.

| # | Scenario | Tests | Result and evidence |
|---|---|---|---|
| 1 | Fresh pairing: good IP, wrong IP, timeout | QA-01 (5 tests) | **pass.** Good IP: the test shows 20.3 C, setpoint 18.5, program on, state home; Connect makes one device with 9 capabilities and none of the three water items; values on the tile after 2 s; `toonwater_enabled` false; the page `/water.html` was asked for once (the probe of the test), never by the device. Wrong IP: one sentence, in en and nl, no device, 0 timers left, only the typed host contacted. Timeout: the sentence arrives after exactly 5,000 ms; no device; no timer of the app left. Also: HTTP 500 says "code 500"; an HTML page says "does not look like an open Toon"; seven invalid inputs (empty, `0.0.0.0`, `192.168.1.50/foo`, `user@host`, `a b`, port 99999, `https://...`) are refused without any request. Pairing against a Toon without the add-on: one probe, then no request for 30 minutes, no warning, no log line about water. |
| 2 | Polling updates values | QA-02 | **pass.** After a change on the Toon (21.5 C, setpoint 20, 1,800 W, gas 5,300 m3, peak 3,800 kWh) the tile shows it at the next cycle. Each of the three endpoints: 11 requests in 5.5 minutes, every gap exactly 30,000 ms, never two requests at once (`maxConcurrent` 1). |
| 3 | Toon goes offline, unavailable after the designed number of cycles, recovers | QA-03 (6 tests) | **pass.** Rule (ADR-0005): unavailable when 3 failed cycles span 90 s or more, or 2 span 15 minutes or more. At the default 30 s: unavailable at the **4th** failed cycle, 120 s after the first failed request (timeout: 140 s; 147 to 167 s after the fault began). At 10 s: 6th cycle, 160 s. At 3,600 s: 2nd cycle, 3,603 s. Message "Your Toon cannot be reached"; one `setUnavailable`; no value cleared; no error-level line. Back-off while down: gaps 120, 240, 300 s, then 300 s (timeouts add their 5 s). Recovery without a Flow or restart: available again 60 s (refused, HTTP 500) or 90 s (timeout) after the Toon returned, with the new value (22.1 C); the worst case is the 5-minute cap. A hiccup of two failed cycles does not flip the device. An app restart while the device is unavailable: it stays unavailable, 0 `setAvailable` until the Toon answers, then 1. |
| 4 | Address change in the settings | QA-04 (3 tests) | **pass.** New address: values of the new Toon (17.0 C) 2 s after the save; the old Toon gets 0 further requests; 21 requests to the new Toon in 3 minutes. Invalid addresses (`0.0.0.0`, `192.168.1.50/foo`, `a b`, `https://...`, empty) are refused with a sentence in en and nl, the stored address stays, the device keeps polling the old one. The same host in another spelling restarts nothing. A request to the old Toon in flight at the save: its answer (29.99 C) is never written. |
| 5 | Device deletion stops all timers; the mock sees no further request | QA-05 (3 tests) | **pass.** Deleted between two cycles: 1 timer before, 0 after, 0 requests in the next 10 minutes. Deleted with a request in flight and ToonWater and export on: 0 timers of the app after (the one that remains is the mock's own delayed answer), 0 requests in the next 10 minutes, no error line for the late answer. One of two devices deleted: the other keeps its cadence (30 requests in 5 minutes). `onDeleted` and `onUninit` twice do not throw. |
| 6 | One poll loop per device after an app restart | QA-06 | **pass.** Two devices, three restarts: timers `[2, 2, 2, 2]`. Per device and endpoint 10 requests in 5 minutes at 30,000 ms gaps; the device without ToonWater asked for the page 0 times. |
| 7 | ToonWater OFF on a Toon without the add-on | QA-07 (2 tests), QA-01 | **pass.** 2 simulated hours (240 cycles): 0 requests for `/water.html`, 0 HTTP 404 answered by the Toon, 0 log lines mentioning water, no warning, 9 capabilities and none of the water items. `update_water` rejects with "ToonWater is not enabled for this device" and sends nothing; `update_status` works and does not ask for the page. In the manifest `update_water`, `measure_water_changed` and `meter_gas_changed` are `deprecated`; `alarm_water_changed` and `update_status` are not. What the Flow editor shows is hardware only (section 10). |
| 8 | ToonWater ON with the add-on | QA-08 (2 tests) | **pass.** The save says "ToonWater found. Water values will appear shortly."; status "Detected"; three `addCapability`, in manifest order, no `removeCapability`; first values 0 L/min, 0.137 m3, 7,350.214 m3 within 10 s; a changed page (6 L/min, 223 L, 7,350,300 L) shows as 6, 0.223, 7,350.3 at the next cycle; 10 page requests in 5 minutes; `measure_water_changed` fired once; every other capability unchanged; `update_status` then reads thermostat, power, meters and the page. With a Toon that answers 404 (Dutch Homey): the Dutch message, status "Niet gevonden op deze Toon (HTTP 404)" and one warning; 95 page requests in 24 hours (limit 97); the device stays available; no error line. |
| 9 | Toggle ON, OFF, ON during an in-flight poll | QA-09 (3 tests) | **pass.** (a) Starting off, a thermostat request in flight, three saves at once: all fulfilled, the trio once (3 adds, 3 removes, 3 adds, in order), no duplicate, no error line. (b) Starting on, the water request in flight, a stale page (99 L/min, 1,111.111 m3) on its way, then off and on: the stale values are never written; the end state is on with the fresh values (5, 0.222, 8,000). (c) Off while the water request is in flight: the late answer is dropped, 0 requests after the switch, no error line, no warning. |
| 10 | Legacy upgrade, 2019, 2021, 2023 devices, with and without water data | QA-10 (10 tests) | **pass.** The era fixtures were first checked against `git show` of `app.json` at `881a519` (2019), `f705a70` (2021) and `fe4e659` (2023): identical capability lists. 2019: gets `alarm_water.hotwater` and `burner_state`, ToonWater off, no water item, 0 page requests. 2021: the same two added, ToonWater on. 2023: only `burner_state` added, ToonWater on. For 2021 and 2023, with stored water values and with all null, on a Toon with the add-on (values follow: 0, 0.137, 7,350.214; 4 page requests in 3 cycles) and without (the stored values stay, for example 12.345 m3; one 404, then held back). In every case: same device id and name, nothing removed, nothing lost, no error line, 0 unhandled rejections, every baseline card still resolves, a restart afterwards adds nothing. |
| 11 | Vacation state | QA-11 | **pass.** `activeState` 4 gives `temperature_state` `vacation`; `temperature_state_is` answers true for vacation and false for home; the condition dropdown offers vacation, the action dropdown does not; picking it on the tile is refused with "Vacation mode can only be set on the Toon itself." and sends nothing; `undefined` is never written; when the holiday ends the state follows (`home`). |
| 12 | Malformed and NaN payloads | QA-12 (3 tests) | **pass.** Nine junk answers on the thermostat (HTML page, truncated JSON, empty body, `{}`, `{"result":"error"}`, `"abc"`/`null`/`"NaN"` fields, a JSON number, 20 MB of text, a redirect): the tile keeps its values, 0 capability writes, no error line. `NaN`, `null` and text in the power and meter answers: counters and power keep their values, the thermostat still updates, the device stays available. A counter that reads 0, or one lower reading, is held back (ADR-0014). |
| 13 | Every trigger fires exactly once per change | QA-13 (2 tests) | **pass.** Gas (token 5,300), power (token 7,920.771 kWh = peak plus off-peak), water (token 4), hot water on and off (true, false), burner heating: each fired exactly once per change and not in the two quiet cycles after it; the first values fired nothing; two changes in one cycle fire each trigger once; `measure_water_changed` never fires while ToonWater is off. `temperature_state_changed` is not fired by the app: with the fake modelling Homey, it fires once per change. Whether the real Homey does that is 04-HW-06. |
| 14 | Condition and action cards | QA-14 (2 tests) | **pass.** Conditions answer true, false and false for no value, never `undefined`. Actions: 21.5 sends `Setpoint=2150` (an integer); `resume_program` yes sends `state=2&temperatureState=2`, no sends `state=0&temperatureState=2` (different, as the labels say; the second is the placeholder of ADR-0015); `enable_program` sends `state=1`, `disable_program` `state=0`; `update_powerusage` and `update_metertotals` make one request to their own endpoint and the value is in when the card resolves; `update_status` reads thermostat, power and meters. |
| 15 | Update actions reject when offline | QA-15 (4 tests) | **pass.** With a Toon that does not answer, refuses the connection or answers 500: all seven cards that ask the Toon (`update_status`, `update_powerusage`, `update_metertotals`, `update_water`, `set_temperature_state`, `enable_program`, `disable_program`) reject, in en and nl, with the exact sentence of the locale and no internals. Time: 0 ms for a refused connection and for 500; for a timeout 5 s, or 10 s when a poll request is already waiting out its own 5 s (the amended NFR-08 AC2). A removed device rejects with "The request was cancelled ..."; a device without an address with "Set the IP address ...". No error-level line, no unhandled rejection. |
| 16 | Nothing leaves the LAN | QA-16 | **pass.** Across pairing, polling, a write, a toggle and an address change only the two typed hosts are contacted, and no request carries an authorization or cookie header. |

## 7. Do the tests notice a broken app? (mutation check)

`node scripts/qa-mutation.js` (about 7 minutes) injects each fault in memory when the modules load, runs the QA file and then the whole suite, and calls the fault "killed" when at least one test fails. Failing tests are counted from the reporter.

| Injected fault | What it breaks | QA file | Whole suite |
|---|---|---|---|
| `water-polled-while-off` | `/water.html` is read for every device (FR-51, FR-60) | killed (9 failing) | killed (120) |
| `water-items-on-every-device` | every new or migrated device gets the water items (FR-51, FR-56, FR-111) | killed (6) | killed (83) |
| `legacy-water-always-off` | the migration switches ToonWater off for devices with water data (FR-56) | killed (8) | killed (104) |
| `switch-off-keeps-the-items` | unticking ToonWater removes nothing (FR-53) | killed (1) | killed (14) |
| `stop-is-a-no-op` | deleting a device leaves its poller running (FR-84) | killed (4) | killed (10) |
| `timer-never-cleared` | a cancelled poller leaves its old timer, loops multiply (FR-80, NFR-12) | killed (1) | killed (4) |
| `address-change-ignored` | a new address keeps polling the old Toon (FR-82) | killed (3) | killed (10) |
| `never-unavailable` | the device never becomes unavailable (FR-81 AC1) | killed (4) | killed (10) |
| `never-available-again` | an unavailable device never recovers (FR-81 AC2) | killed (4) | killed (14) |
| `no-backoff` | an offline Toon is asked every interval for ever (FR-81 AC3, NFR-03) | killed (3) | killed (10) |
| `missing-page-asked-every-cycle` | a 404 on `/water.html` is asked again every cycle (FR-57) | killed (5) | killed (15) |
| `update-cards-resolve-silently` | the Update cards resolve when the Toon is down (FR-73, FR-74) | killed (3) | killed (23) |
| `first-value-fires-trigger` | the first value of a capability fires its trigger (FR-70 AC4) | killed (2) | killed (17) |
| `trigger-fires-twice` | every change fires its trigger twice (FR-70 AC1) | killed (2) | killed (16) |

14 of 14 killed by both. Two faults survived the first version of the QA file and the file was strengthened (section 8.2).

## 8. Findings

### 8.1 Defects in the application

None found. All five failures of the first run of the QA file were mistakes in the new tests (a timer of the mock counted as the app's, a status label read before the re-assert timer of HW-13 had fired, Homey's own trigger modelled before the first value, and the amended 10 s bound), not application behaviour.

### 8.2 Weak spots of the test set, found and fixed

* **Delete-while-idle was not asserted.** The first QA-05 deleted a device with a request in flight, when no timer is armed; the fault `timer-never-cleared` survived. A test that deletes between two cycles and asserts 1 timer before and 0 after was added.
* **A fault that did nothing.** The first `missing-page-asked-every-cycle` patched an export that the module also uses through a private binding, so it changed no behaviour and "survived". It now patches the ledger.
* **A regression can hang the run instead of failing it.** With `stop-is-a-no-op` and `address-change-ignored`, tests in `device-lifecycle`, `flow-cards`, `device-writes` and `unit/poller` wait for ever. `npm test` has no per-test timeout, so CI would sit until the job limit. `node --test --test-timeout=5000` turned the hang into a failure in 10 s on `unit/poller.test.js`. Recommendation (not applied, `package.json` is outside the QA remit): add `--test-timeout=60000` to the `test` script.
* **Capability titles were not pinned.** The contract test checks ids only. `capability-titles.test.js` pins titles and options.

### 8.3 Observations (not defects)

* **O-1 Recovery lag.** After the Toon is back, the device can stay unavailable for up to the back-off cap of 5 minutes (measured 60 to 90 s). Expect this on hardware.
* **O-2 A migrated user without the add-on keeps a small amount of 404 traffic.** Devices that already had the water items (2021 and 2023 builds) are switched on by the migration (D-2, ADR-0018). If their Toon has no add-on they send one request for `/water.html` at each start and then one per 15 minutes (95 in 24 hours measured, limit 97), get no tile warning, and a timeline hint after 24 hours. This is the one place where "no 404 noise" is not literally true; it follows from "existing users must not lose water data or Flows". The user can switch it off in the settings.
* **O-3 One probe at pairing.** The connection test asks `/water.html` once (FR-61), so a Toon without the add-on sees exactly one 404 at pairing and none after.
* **O-4 Status label.** `toonwater_status` shows "-" (the manifest default) on a device that never had ToonWater on, and "Off" only after it was switched off. FR-59 specifies "Off" for the disabled state only. Cosmetic.
* **O-5 `resume_program = no`.** The request (`state=0&temperatureState=2`) is a placeholder (ADR-0015) and the mock models the same guess. If the real Toon ignores it, the Flow action resolves but the preset does not change. Hardware only (01-HW-04).
* **O-6 `temperature_state_changed` is Homey's.** The app never fires it (`source: 'homey'` in `lib/features/core.js`). If hardware shows that Homey does not fire the trigger for a custom capability, the card is dead for Flows; the fix is one word ('app'). 04-HW-06.
* **O-7 Water cards.** After ADR-0007 no app card about water is visible in the Flow editor, with ToonWater on or off: `update_water` and `measure_water_changed` are deprecated, and "Update now" (`update_status`) covers the page when it is on. The owner's wording "water cards appear when it is on" is met only by the cards Homey generates for the water capabilities. Only hardware shows what the editor displays (04-HW-07, 04-HW-08, 01-HW-05).
* **O-8 Dev tooling audit.** 24 advisories in the dev dependencies of the Homey CLI (section 3). Not shipped.
* **O-9 Two hardware numberings.** See the note under the matrix.
* **O-10 Node 22.** Not run here (section 2).

## 9. Designed deviations from the requirement text (all recorded by ADR; owner acknowledgement)

| Requirement | What the text says | What is built and measured | ADR |
|---|---|---|---|
| FR-81 AC1 | unavailable at the third failed cycle | count **and** time: 3 failures spanning 90 s, or 2 spanning 15 minutes. At 30 s that is the 4th cycle (120 s), at 10 s the 6th (160 s), at 3,600 s the 2nd | 0005 |
| NFR-08 AC2 | an action settles within 6 s | 6 s normally; 10 s while a poll request is waiting out its own 5 s timeout (measured 10,000 ms) | 0005 |
| FR-54 AC1, FR-52 AC5, FR-53 AC5 | water cards carry a `capabilities=` filter; app cards appear when on | no filter; both app water cards deprecated; Homey's own cards do the job | 0007 |
| FR-54 AC2, FR-74 AC4, FR-56 AC6, FR-62 AC1 | `update_water` rejects when off; warning for every migrated device; hint | no-op for devices the migration decided; no tile warning for a migrated device that never held a value; hint restart-safe | 0018 |
| FR-70 AC1 | the app fires `temperature_state_changed` | Homey fires it | 0009 |
| FR-90 (SHOULD) | declare `cumulativeImportedCapability` | deferred; the energy block is byte-identical to the baseline; `validate` prints two warnings | 0016 |
| NFR-03 AC3 | cycles of two devices independent | holds per device; two devices on one Toon are unsupported | 0005 |
| NFR-13 AC1, AC2 | `node_modules` untracked; Dependabot PRs closed | `.gitignore` is in place, the release step is written down, the index still tracks 1,880 files until the owner runs it; closing PRs is a GitHub action | 0011 |

## 10. Not verifiable without hardware (input for the hardware test plan)

| Id | What to do or observe | Settles | Why a mock cannot show it |
|---|---|---|---|
| 01-HW-01 | Pair end to end in the Homey web and mobile app, light and dark, en and nl | FR-01, FR-04, FR-05, FR-59, FR-100 | the real pairing screen and the real text of a refused `createDevice` |
| 01-HW-02 | Capture anonymised `getThermostatInfo`, `GetCurrentUsage` and `getDevices.json` of each Toon (Toon 1 and 2, one and two tariffs, with and without gas and solar) | FR-21, FR-22, FR-25, FR-28 | every fixture is derived; the meter discovery table is seeded from medium-confidence type strings |
| 01-HW-03 | Change the setpoint from Homey | FR-11 | what the Toon does with a manual setpoint |
| 01-HW-04 | `set_temperature_state` with `resume_program` yes and no; confirm `activeState` 4 and `programState` | FR-12, FR-13, FR-14 | the `no` request is a guess (O-5); code 4 comes from the audit |
| 01-HW-05 / 04-HW-07 / 04-HW-08 / 04-HW-09 | Flow editor: which water cards appear with the setting on and off; what happens to a Flow after `removeCapability` and after re-adding; do deprecated cards run and disappear | FR-52 to FR-54, FR-71, FR-75 | the editor is Homey's; O-7 |
| 01-HW-06 | Is the Insights history of a removed capability kept, and does it continue after re-adding | FR-53 | Homey's database |
| 01-HW-07 | Real `/water.html`: the status code without the add-on (the design assumes 404), after a reboot, units of `flow`, `value`, `total`, staleness | FR-55, FR-58 | no add-on in this run |
| 01-HW-08 | Watch `burnerInfo` for a day (idle, heating, tap water, pre-heat) | FR-30, FR-32 | only 2 = hot water is confirmed by code |
| 01-HW-09 / 04-HW-12 | Unplug and re-plug the Toon: message, recovery time (O-1), and which Flow cards Homey blocks while unavailable | FR-81, FR-73 | Homey's behaviour |
| 01-HW-10 | 24 h at 10, 30 and 60 s: Toon UI responsiveness, response time of each endpoint, especially `getDevices.json`; check the nightly Toon reboot against the availability rule | NFR-03, FR-80, FR-81 | the load budget is a proposal |
| 01-HW-11 | Homey Energy page: import, gas, water, double counting | FR-90, FR-63 | Homey's Energy; FR-90 is deferred behind this |
| 01-HW-12 | Install a minimally patched baseline on the Homey Pro to create real legacy devices and Flows, then install this build over it | FR-110, FR-56, FR-113 | the fake encodes our reading of what an update keeps |
| 01-HW-13 | Settings UX: the error of an invalid address, the save messages, `setWarning`, the read-only status labels, the status re-asserted after a save | FR-59, FR-82, FR-85 | the fake models these from the documentation |
| 01-HW-14 | Several Toons on one Homey, with and without the community "toonWater" app | FR-04 | no second app |
| 01-HW-15 | Any other Homey model | NFR-07 | one machine |
| 04-HW-06 | Does Homey fire `temperature_state_changed` itself, and not twice | FR-70 | O-6 |
| 04-HW-10 | The type of `args.state` and `args.resume_program` in the run listeners | FR-13, FR-73 | the cards accept both shapes, but the real one is not known |
| CI | First run of the workflow on GitHub (Node 22 for lint and tests, Node 24 for validate and pack) | NFR-02 | no Node 22 here |

Suggested first day on the Homey Pro: capture the payloads (01-HW-02, 01-HW-07), pair (01-HW-01), switch ToonWater on and off and look at the editor, the tile and Insights (01-HW-05, 01-HW-06), unplug the Toon (01-HW-09), install over a real old build (01-HW-12), then leave the 24 h run going (01-HW-10).

## 11. Reproduce

```
npm run lint && npm test && npm run validate && npm run pack:check && npm audit --omit=dev
npm run test:coverage && npm run check:requirements
node --require ./test/helpers/register.cjs --test --test-reporter=spec test/scenario/qa-acceptance.test.js
node scripts/qa-mutation.js            # about 7 minutes; or name one fault: node scripts/qa-mutation.js no-backoff
```
