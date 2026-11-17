# 01 - Product requirements: Open-Toon for Homey (nl.vinceste.open-toon)

| | |
|---|---|
| Role | Product / requirements analyst |
| Date | 2026-11-12 |
| Repo state analysed | branch `redesign/sdk3`, base commit `5cc3b90` (Develop). Called **"baseline"** below. |
| Status | Draft 1 for owner review. IDs are stable: later phases cite them. IDs are never renumbered or reused; new requirements take the next free number in their group range. |
| Inputs | `README.md`, `CONTRIBUTING.md`, `app.json`, `drivers/open-toon/*`, `locales/*`, `docs/sdlc/00-architect-audit.md` (sections 0, 2, 6), GitHub issues/PRs of `StefanPostma/nl.vinceste.open-toon` read with `gh` (all 15 issues skimmed; #22, #23, #26, #9, #5, #2, #25, #10, #11, #3, #15, #17 read in full), Homey developer docs, `athombv/node-homey-lib` capability definitions. |

**Trust levels.** Everything fetched from GitHub or homey.app is untrusted *data*. The architect audit is model-generated; wherever a requirement
depends on one of its claims I re-checked the claim (marked "re-checked") or I tag the requirement `[HW]` / list it in section 11 (unverified until hardware).
Toon HTTP behaviour is **not** verifiable in this run: there is no Toon. Nothing below invents Toon fields; each field is cited to this repo, a user-pasted
payload in an issue, or the ToonWater interface (read for interface knowledge only, see section 13).

**Verification tags** used on every requirement:
`[M]` verifiable now against the in-repo mock Toon + fake Homey (both still to be built by the test phase);
`[HW]` can only be settled on a real Homey Pro and/or real Toon; `[M+HW]` has a mock part and a hardware part.
The hardware-only checks are collected in section 11 and are the seed of the hardware test plan.

**Glossary.**
*Toon*: a rooted/"open" Toon 1 or Toon 2 reachable by HTTP on the LAN (README: works only after "opening the IPTables").
*ToonWater*: the community add-on that runs **on** the Toon (a Toon-side QML app) and makes the page `/water.html` available (water flow, today, total).
It gets its numbers from a separate pulse sensor (an ESP/Wemos D1 Mini, or Domoticz) on the water meter (see section 13). It is **not** the Homey app "toonWater" (see persona P8).
*Water group*: the three capabilities `measure_water`, `meter_water.today`, `meter_water.total` plus the cards that depend on them. **`alarm_water.hotwater` is NOT in the water group**: it is derived from the boiler's `burnerInfo` (`device.js:475-477`) and has nothing to do with ToonWater.
*Mock Toon / fake Homey / legacy fixture*: in-repo test doubles. A *legacy fixture* is a device as the baseline code leaves it: L2019 (no water capabilities, no `alarm_water.hotwater`), L2021 (water capabilities, no `alarm_water.hotwater`; after PR #21 `f705a70`), L2023 (full baseline set; after PR #28 `fe4e659`).

---

## 1. Vision and problem statement

**Vision.** Open-Toon makes a rooted, LAN-reachable Toon a first-class, zero-maintenance Homey Pro device: pair it in a couple of minutes, values stay fresh
without Flow workarounds, the device tile shows only what *that* Toon actually offers, every automation you ever built keeps working through updates,
and optional extras such as ToonWater are one checkbox away instead of permanent clutter.

**Problem statement (what is wrong today, with evidence).**

1. **The app cannot currently be installed or paired with current tooling.** `homey app validate` rejects the manifest (missing `[[resume_program]]` in `app.json:388-391`), the pair view uses a v2-style API (`start.html:43`, `driver.js:9`) and `testConnection` is a stub (`driver.js:11-16`) - audit section 0/2 (model-generated; the `titleFormatted` and stub claims re-checked in the code).
2. **Values never refresh by themselves.** There is no polling (re-checked: no timer anywhere except an unused `debounce`, `device.js:569-586`). Users hit this in #5 ("info does not update", 2019) and #25 ("temperature does not update", 2022). The maintainer's answer both times was a workaround: build your own Flow with a timer and the "Update status" card. That is the single most-voiced user pain.
3. **Meter values depend on hard-coded node names.** `dev_2.1`, `dev_2.4`, `dev_2.6`, `dev_2.2` (`device.js:332-341,381-402`). Users with other Toons see no gas/power totals (#9: "Alle values seem to start with a number 4 (dev_4.x)"; #10 repeats it) and were told to edit `device.js` by hand and run the CLI (#9, comments of 2019-11-21 and 2020-04-04). Non-developers cannot do that.
4. **Dead and wrong Flow cards.** Five trigger cards exist but are never fired (`app.json:175-303`; no `getDeviceTriggerCard` call anywhere). Requested features are missing: heating state as a card (#26), power export (#23), boiler values (#2).
5. **Water is forced on everyone.** Since PR #21 every device gets three water capabilities (`app.json:102-104`), and the code polls `/water.html` (`device.js:173-190`) even when the ToonWater add-on is not installed: empty tiles, a 404 per request, "water" cards in the Flow editor that can never work for most users. Older devices never get these capabilities at all, and then raise errors (audit section 2, `device.js:33-38`).
6. **Fragile runtime.** Unawaited `setCapabilityValue` calls, a non-existent capability `meter_power` written on every power update (`device.js:377`), an `onDeleted` that throws (`device.js:488-491`), no availability handling, no request timeouts (audit section 2). Homey is moving to crash apps on unhandled rejections (audit section 1).

**What the redesign must deliver (owner intent, 2026-11-12).** (1) re-design, re-use what is possible, follow the latest Homey standards;
(2) **ToonWater becomes an opt-in per-device feature** with no trace when off and no loss for people who already use it;
(3) everything verifiable against mocks first, with a hardware test plan for later (owner has a Homey Pro and several Toons).

---

## 2. Evidence base: what users actually said

| Issue | State | Voice (paraphrased; Dutch Homey users) | Requirement impact |
|---|---|---|---|
| #5 (2019) | closed | "Current temperature does not update after a while, energy/gas show nothing." Answer: create a time-based Flow with "update values". | FR-80 (automatic polling, MUST) |
| #25 (2022) | closed 2024 | "Temperature does not update, not even after restarting the app." Same workaround answer. | FR-80, FR-85 |
| #9 (2019) / #10 (2020) | closed | Toon with `dev_4.x` nodes: gas/power totals stay empty; fix = edit source. Reporter asks for an advanced setting or automatic detection "during initialisation". | FR-22 (MUST), FR-23 (COULD) |
| #11 (2020) | closed | Wants instantaneous gas usage; another user: `gasUsage` "isn't provided on every Toon (in fact, most won't)". Sample `GetCurrentUsage` payload pasted, including `powerProduction`. | FR-24 (absent data is normal), FR-29 (COULD), evidence for FR-25 |
| #23 (2021, open, 0 comments) | open | "Currently power *import* is passed to Homey. Can *export* be included, separately or as negative value on the existing power measure capability (if Homey allows negative values)?" | FR-25/26/27, see section 8 |
| #26 (2022, open, 0 comments) | open | "WHEN heating turns on (burnerinfo 0 to 1) then turn on floor-heating pump ... or an AND card 'heating is on'." | FR-30/32, see section 8 |
| #2 (2019, closed 2024) | closed | Boiler values (`boilerPressure`, `boilerOutTemp`, `boilerInTemp`, `boilerModulationLevel` from `/boilerstatus/boilervalues.txt`); use case: alarm when pressure is too low. A later comment: out/in temperature "no longer available in BoilerText". | FR-33 (WONT this release) |
| #3 (2019), #15 (2020), #17 (2021) | closed | Three different users ask for App Store / community store distribution. Owner's reasons to decline: registered trademark "Toon", the app is "almost the same as the original" (shared package name), not on current Homey libraries (comment 2024-03-25). | FR-120/121, open question OQ-02 |
| #22 (2021, open) | open | Owner: "Package updates - remove lodash and other critical packages". Contributor oepi-loepi (ToonWater author, 2023-02-13): "I am rewriting the app for Homey SDK3; I could publish it under my account, how do you feel about that?" Another user: "sounds like good news". | NFR-05, OQ-01 (converge vs. compete) |
| #4, #6, #16 | closed | CLI install problems (version string with a letter suffix `0.02a` rejected by the CLI validation; "prunePaths is not iterable"). | FR-120 (clean semver, installable) |
| PR #7 (closed unmerged), #21, #28 | - | #7 intended to remove the test-connection button and add single-tariff support; #21 (oepi-loepi) merged water; #28 (moezie) merged SDK3 bump + hot water. | context for FR-02, FR-21, FR-31 |

---

## 3. Personas

All personas are Dutch Homey Pro owners (Homey Pro Early 2023, Homey Pro 2016-2019, or Homey Pro mini; Homey Cloud/Bridge is excluded because it has no LAN access, audit section 1) with a **rooted Toon 1 or Toon 2** whose firewall they opened themselves (README disclaimer: "I will not help you open your IPTables"). They are comfortable with Homey Flows, not with Node.js.

| ID | Persona | Situation and goals | What hurts today | Key requirements |
|---|---|---|---|---|
| **P1** | **Existing user, no ToonWater** (probably the largest group: every device paired since PR #21 has water capabilities) | Sideloaded the app via CLI (#3/#15/#17: no store). Has Flows with a timer + "Update status" (workaround of #5/#25). | Empty water items on the tile, 404s, hand-built refresh Flows, no heating card. | FR-56 (keeps working), FR-59/FR-55 (can switch water off knowingly), FR-80, FR-110 |
| **P2** | **Existing user with ToonWater** | Has the ToonWater add-on on the Toon plus its pulse sensor; Flows and Insights on water. | Water values only update when a Flow runs. | FR-56 (must lose nothing), FR-57/58, FR-80 |
| **P3** | **New user without ToonWater** | Fresh pairing, wants a clean tile and Insights/Energy for temperature, power, gas. Cannot edit source code. | Pairing broken; wrong meter nodes; clutter. | FR-01..04, FR-22, FR-51, NFR-08 |
| **P4** | **New user with ToonWater** | Wants water on the tile; installs/enables the add-on in either order. Needs to know when the add-on is missing. | No explanation when `/water.html` is absent. | FR-52, FR-55, FR-61 |
| **P5** | **Energy-aware / solar owner** | Wants import + export, Homey Energy to show kWh and gas. | Import only (#23); totals truncated to whole kWh (`device.js:384`). | FR-21, FR-25..27, FR-90 |
| **P6** | **Heating automator** | Drives a floor-heating pump or alerts from the burner state. | Must "fiddle with temperature values" (#26). | FR-30, FR-32, FR-31 |
| **P7** | **Maintainer / contributors** (Stefan; oepi-loepi, moezie, Paul Heeringa are credited in `app.json:18-27`) | Part-time; at times no Toon on the wall (#2: "I'm abroad, my Toon is not on the wall"); now has a Homey Pro and several Toons for later validation. | No tests, no CI, committed `node_modules` (1,880 files), Dependabot noise (#22, PRs #31-#33), unclear licence headers. | NFR-05/06/10/11/13, FR-76 |
| **P8** | **Dual-app user** (secondary; risk persona) | Also has the community Homey app "toonWater" v1.1.30 by Rob van Oostveen (homey.app listing: drivers `toonThermostat` and `toonWater`, sensor-direct, "requires Homey v5.0.0+"; the audit's claim that it ships a thermostat driver is **confirmed by that listing**, but its feature set was not inspected). May run both apps against the same Toon/sensor. | Duplicate devices, double polling. | OQ-01, NFR-03 (LAN load), FR-61 (docs) |

---

## 4. Scope

**In scope (this redesign).**
Pairing; thermostat read/control (temperature, setpoint, temperature state, program on/off); power (current, peak/off-peak totals, export); gas totals; burner state and hot-water flag;
**ToonWater as an opt-in per-device feature**; Flow triggers/conditions/actions incl. deprecations; automatic polling, availability, settings; Homey Energy mapping; en + nl; in-place migration of already-paired devices; sideload installability and App Store *readiness*; a test strategy that needs no hardware.

**Out of scope / not this release.**
* Rooting a Toon or opening its firewall (README disclaimer stays), supporting the stock cloud-connected Toon, the Eneco/Quby cloud API.
* The Toon-side add-on itself (its QML app, installation on the Toon), the ESP/Wemos sensor, Domoticz, and reading the ESP *directly* (that is what the community Homey app "toonWater" does; we only read `/water.html` **from the Toon**).
* Water tariffs/costs, leak/break detection, water graphs on the Toon.
* Boiler pressure/temperatures/modulation (#2) - WONT now (FR-33), revisit after a real payload dump.
* Net-signed `measure_power` (negative = export) - WONT now (FR-27).
* Homey Cloud / Homey Bridge (no LAN access), push/webhook updates (the Toon offers none that we know of), multi-Toon aggregation, remote (WAN) access.
* Actual App Store *submission* (owner/legal decision: trademark, naming; see OQ-02). Store *readiness* is in scope (FR-121).
* Translating beyond en + nl.

---

## 5. Stability contract (baseline inventory that must survive)

The following are the identifiers existing users depend on. They may be **added to** and **deprecated** (`"deprecated": true`), never removed or renamed, unless an ADR explicitly justifies and migrates it. FR-76 turns this into an automated check.

* **App id** `nl.vinceste.open-toon`; **driver id** `open-toon` (`app.json:84`); pair view id `start` (`app.json:147-151`).
* **Device identity**: `data.id` = the string the user typed in the pair view (`start.html:36-39`); immutable. **Setting key** `address` (`app.json:161`).
* **Capabilities** (`app.json:94-106`): `target_temperature`, `measure_temperature`, `temperature_state` (enum `comfort|home|sleep|away|none`), `meter_power.peak`, `meter_power.offPeak`, `measure_power`, `meter_gas`, `measure_water`, `meter_water.today`, `meter_water.total`, `alarm_water.hotwater`; the custom enum capability `temperature_state` at app level (`app.json:34-81`).
* **Triggers**: `meter_gas_changed` (token `meter_gas`), `meter_power_changed` (token `meter_power`), `measure_water_changed` (token `measure_water`), `temperature_state_changed` (token `temperature_state`), `alarm_water_changed` (token `alarm_water.hotwater`) - `app.json:175-303`.
* **Conditions**: `temperature_state_is` (args `device`, `state`), `hotwater_dispensing` (arg `device`) - `app.json:305-379`.
* **Actions**: `set_temperature_state` (args `device`, `state`, `resume_program`), `enable_program`, `disable_program`, `update_status`, `update_powerusage`, `update_water`, `update_metertotals` (arg `device` each) - `app.json:381-540`.
* **Argument values**: dropdown value ids `comfort|home|sleep|away|none`, `yes|no`.

Known contract-relevant *defects* that may be fixed without breaking the contract (the cards never fired, so fixing them cannot surprise anyone): `meter_power_changed` token titled "Wh" while the value is kWh (`app.json:212`); NL typo `!{{is||is niet}}` (`app.json:314`).

---

## 6. Functional requirements

Notation: each requirement has a **MoSCoW** priority, a verification tag, the evidence it rests on, and acceptance criteria (AC) in Given/When/Then.
"The mock" = the in-repo mock Toon HTTP server; "the fake Homey" = the strict SDK-v3-shaped fake. Poll-related ACs assume fake timers.
Group ranges: Pairing FR-01..09 | Thermostat FR-10..19 | Power FR-20..27 | Gas FR-28..29 | Burner/hot water/boiler FR-30..39 | **ToonWater FR-50..69** | Flow cards FR-70..79 | Polling/availability/settings FR-80..89 | Energy FR-90..99 | i18n FR-100..109 | Migration FR-110..119 | Distribution/docs FR-120..129.

### 6.1 Pairing (FR-01..09)

#### FR-01 - Pair a Toon by IP address
`MUST` · `[M+HW]` · Evidence: `start.html:99-117`, `driver.js:8-23` (stub), audit section 2.
The user can add a Toon by entering its IP address (or hostname) and a unique device id, and the device appears with working values.
* AC1 **Given** the pair view and a reachable mock Toon, **When** the user enters address, id and name and presses Connect after a successful test, **Then** `createDevice` is called exactly once with `name` = entered name, `data.id` = entered id, `settings.address` = normalised address, and no ToonWater capability is part of the device (see FR-51).
* AC2 **Given** the user has not run a successful test, **When** the pair view is shown, **Then** Connect is disabled.
* AC3 **Given** an empty address or id, **When** the user presses Test or Connect, **Then** a localized (en/nl) inline message names the missing field and no network request is made.
* AC4 `[HW]` **Given** a real Homey Pro (web and mobile app) and a real Toon, **When** a user pairs, **Then** the flow completes end to end without a JavaScript error.

#### FR-02 - Test connection with live readings
`MUST` · `[M]` · Evidence: `driver.js:11-16` (stub), audit section 3(d). Replaces the missing test button (`start.html:4` vs markup).
Pressing Test calls the thermostat endpoint (5 s timeout) and shows what the Toon reported before anything is added.
* AC1 **Given** a mock Toon that answers `getThermostatInfo`, **When** Test runs, **Then** the view shows current temperature, setpoint and program state from the response and enables Connect.
* AC2 **Given** an address that times out (unroutable), **When** Test runs, **Then** within 6 s a localized "cannot be reached" message is shown, Connect stays disabled, and no unhandled rejection occurs.
* AC3 **Given** a host that answers HTTP 200 with HTML or JSON that lacks `currentTemp`/`currentSetpoint`, **When** Test runs, **Then** a localized "this does not look like an open Toon" message is shown (not the raw error text).
* AC4 **Given** HTTP 404/500 from the host, **When** Test runs, **Then** a localized message includes the HTTP status.
* AC5 **Given** Test succeeded and the user edits the address, **When** the field changes, **Then** Connect is disabled again until the next successful Test.

#### FR-03 - Address normalisation and validation
`MUST` · `[M]` · Evidence: `app.json:163` (default `0.0.0.0`, no validation), `start.html:34-36`. See also NFR-04.
* AC1 **Given** the inputs `192.168.1.50`, `192.168.1.50:80`, ` http://192.168.1.50/ `, `toon.local`, **When** normalised, **Then** the stored value is `192.168.1.50`, `192.168.1.50:80`, `192.168.1.50`, `toon.local` respectively.
* AC2 **Given** `0.0.0.0`, empty, `192.168.1.50/foo`, `192.168.1.50?x=1`, `user@host`, `a b`, `192.168.1.50:99999`, **When** validated, **Then** each is rejected with a localized message and nothing is stored.
* AC3 **Given** a legacy device whose stored address is the manifest default `0.0.0.0`, **When** the device starts, **Then** it does not send requests to `0.0.0.0`, it shows a localized "set the IP address" warning and stays unavailable until a valid address is saved.

#### FR-04 - Device identity and duplicates
`SHOULD` · `[M+HW]` · Evidence: `start.html:36-39` (`data.id` = typed id; en.json "Choose an unique name!").
New devices keep the `data.id` scheme of the baseline (a user-chosen unique id, trimmed, non-empty); the display name is a separate field defaulting to the id.
* AC1 **Given** an id with leading/trailing spaces, **When** pairing, **Then** `data.id` is stored trimmed.
* AC2 `[HW]` **Given** a device with `data.id` X exists, **When** the user pairs X again, **Then** no second device is created and the user sees a localized "already added" message (Homey itself rejects duplicate ids per driver; confirm message handling on hardware).
* AC3 **Given** two devices with different ids and different addresses, **When** both run, **Then** their polls and state are fully independent (a failure on one never changes the other).

#### FR-05 - Pairing UI quality
`SHOULD` · `[HW]` · Evidence: audit section 2 (jQuery dependency, Xiaomi copy-paste at `start.html:18`, legacy CSS).
* AC1 **Given** the pair view source, **When** statically checked, **Then** it uses only the documented `Homey.*` view API (`emit`, `createDevice`, `__`, `done`), no jQuery, no hard-coded user-visible strings, and the Homey Style Library classes.
* AC2 `[HW]` **Given** Homey web and the Homey mobile app in light and dark mode, **When** the pair view is opened, **Then** all elements are readable and operable (no text clipped, buttons reachable).

### 6.2 Thermostat read and control (FR-10..19)

#### FR-10 - Read temperature and setpoint
`MUST` · `[M]` · Evidence: `device.js:462-469`, audit section 5 (`currentTemp`, `currentSetpoint` are centi-degree strings).
* AC1 **Given** `currentTemp "2075"` and `currentSetpoint "1950"`, **When** polled, **Then** `measure_temperature` = 20.8 and `target_temperature` = 19.5 (rounded to 0.1 C).
* AC2 **Given** missing, empty or non-numeric values, **When** polled, **Then** the capabilities keep their previous values and no exception or rejection occurs.

#### FR-11 - Set target temperature
`MUST` · `[M+HW]` · Evidence: `device.js:233-261` (`setSetpoint&Setpoint=<C*100>`), `app.json:111-115` (min 6, max 30, step 0.5).
* AC1 **Given** the mock, **When** the capability is set to 21.5, **Then** exactly one request `/happ_thermstat?action=setSetpoint&Setpoint=2150` is sent (an **integer**; setting 19.1 sends `1910`, never `1910.0000000000002`).
* AC2 **Given** a value outside 6..30 or not a finite number (e.g. via a Flow), **When** set, **Then** the call is rejected with a localized error and no request is sent.
* AC3 **Given** the mock answers HTTP 500 or times out, **When** set, **Then** the promise rejects with a localized error (Homey shows it to the user) and the next poll restores the capability to the Toon's real setpoint.
* AC4 `[HW]` **Given** a real Toon running its program, **When** the setpoint is changed from Homey, **Then** the Toon shows the new setpoint and its documented return-to-program behaviour is recorded in the hardware test report (semantics are unverified in this run).

#### FR-12 - Read the temperature state (incl. vacation)
`MUST` · `[M+HW]` · Evidence: `device.js:7-13,470-474`; baseline defect: `activeState 4` is unmapped and sets the capability to `undefined` (audit section 2, harness S4, model-generated). Re-checked: `TEMPERATURE_STATES` has no value 4.
The enum gains one additive value `vacation` (en "Vacation", nl "Vakantie"); existing values and ids are untouched.
* AC1 **Given** `activeState` of `"0"`, `"1"`, `"2"`, `"3"`, `"4"`, `"-1"` (strings) and `0..4`, `-1` (numbers), **When** polled, **Then** `temperature_state` becomes `comfort`, `home`, `sleep`, `away`, `vacation`, `none` respectively.
* AC2 **Given** an unknown code (e.g. `"7"`) or a non-numeric value, **When** polled, **Then** the capability keeps its previous value, one debug-level log line is written, and `setCapabilityValue` is never called with `undefined`.
* AC3 `[HW]` **Given** a Toon in holiday mode, **When** polled, **Then** `activeState` is `4` and shows as `vacation` (the code-to-name table comes from the audit, not from this repo; confirm on hardware).
* Note: `vacation` is read-only: it is not offered in the `set_temperature_state` dropdown (`app.json:402-431` has no `none` either) but it is offered in the `temperature_state_is` condition.

#### FR-13 - Set the temperature state (capability and Flow action)
`MUST` · `[M+HW]` · Evidence: `device.js:198-226` (always `state=2`, `keepProgram` ignored; baseline defect), `app.json:433-453` (`resume_program`: "Resume program afterwards" / "Disable program").
The two options of `resume_program` must produce **observably different** behaviour, matching their labels. The exact Toon request sequence is a design decision validated on hardware (HW-04).
* AC1 **Given** the mock, **When** `set_temperature_state` runs with `state=sleep, resume_program=yes`, **Then** the request sequence recorded by the mock equals the one documented for "resume" in the design (ADR), and `temperature_state` becomes `sleep` after the confirming poll.
* AC2 **Given** `resume_program=no`, **When** the action runs, **Then** the recorded sequence differs from AC1 and equals the one documented for "disable program" in the design (ADR).
* AC3 **Given** the capability picker on the tile selects `away`, **When** applied, **Then** it behaves like the action with the default `resume_program=yes` (the default of `app.json:436`).
* AC4 **Given** the mock fails, **When** the action runs, **Then** it rejects with a localized message (see FR-73).
* AC5 `[HW]` **Given** a real Toon with an active program, **When** each option is used, **Then** the Toon's program state afterwards matches the label (program resumes vs. program disabled); the result is recorded in the hardware report.

#### FR-14 - Enable / disable the program
`MUST` · `[M+HW]` · Evidence: `device.js:267-310` (`changeSchemeState&state=1` / `state=0`), `app.json:456-483`.
* AC1 **Given** the mock, **When** `enable_program` runs, **Then** exactly one request `changeSchemeState&state=1` is sent and the action resolves after the Toon answered; `disable_program` sends `state=0` likewise.
* AC2 **Given** the Toon is unreachable, **When** either action runs, **Then** it rejects with a localized error (the baseline resolves silently, audit section 2).
* AC3 `[HW]` **Given** a real Toon, **When** each action runs, **Then** the Toon's program is switched on/off as seen on its screen.

#### FR-15 - Program state read-back
`COULD` · `[M+HW]` · Evidence: audit section 5 lists `programState` in the `getThermostatInfo` response, but its value semantics are **not** verified and no capability exposes it today.
Expose whether the program is active as a read-only value usable in a Flow condition ("Program is on/off").
* AC1 **Given** `programState` values documented by the hardware test, **When** polled, **Then** the value shows correctly and a condition card returns true/false accordingly.
* AC2 **Given** an unknown value, **When** polled, **Then** nothing is updated and nothing throws.

#### FR-16 - Coalesced writes and post-write refresh
`SHOULD` · `[M]` · Evidence: `device.js:230` comment "TODO doesn't work flawlessly every time (maybe due to multiple ... coming in simultaneously)".
* AC1 **Given** ten `target_temperature` sets within one second (a slider drag), **When** processed, **Then** at most two `setSetpoint` requests reach the mock and the **last** value wins.
* AC2 **Given** a successful write, **When** it completes, **Then** a refresh of thermostat state is performed within 3 s and the capabilities reflect the Toon's answer.
* AC3 **Given** a poll response that was requested *before* a write but arrives *after* it, **When** applied, **Then** it does not revert the newly written value (no flicker back to the old value).

### 6.3 Power (FR-20..29)

#### FR-20 - Current power
`MUST` · `[M]` · Evidence: `device.js:368-371` (`powerUsage.value`, W), `happ_pwrusage?action=GetCurrentUsage` sample in #11.
* AC1 **Given** `{"result":"ok","powerUsage":{"value":460,"avgValue":432.22}}`, **When** polled, **Then** `measure_power` = 460.
* AC2 **Given** the value as a numeric string `"460"`, **When** polled, **Then** `measure_power` = 460; **Given** a non-numeric value, **Then** the capability is untouched.
* AC3 **Given** the baseline defect (every power update wrote the undeclared capability `meter_power`, `device.js:377`), **When** a power poll runs, **Then** `setCapabilityValue` is never called with a capability id the device does not have.

#### FR-21 - Electricity meter totals (peak / off-peak)
`MUST` · `[M+HW]` · Evidence: `device.js:380-402` (peak from `dev_2.4`, off-peak from `dev_2.6`, single-tariff fallback `dev_2.2`, "NaN" strings, `Math.trunc`), #9.
* AC1 **Given** `CurrentElectricityQuantity` `"1030645.00"` (Wh), **When** polled, **Then** the peak capability = 1030.645 kWh (**three decimals**, not truncated to whole kWh as in `device.js:384`).
* AC2 **Given** a single-tariff meter where the peak node reports `"NaN"`, **When** polled, **Then** `meter_power.peak` is taken from the single-tariff node and `meter_power.offPeak` is left unchanged (not set to NaN).
* AC3 **Given** a two-tariff meter, **When** polled, **Then** both capabilities update.
* AC4 `[HW]` **Given** the owner's Toons (at least one with a single-tariff and one with a two-tariff meter if available), **When** polled, **Then** the totals equal the Toon screen / meter reading.
* Note: the move from whole kWh to 3 decimals is intended (better Insights) and is a value-precision change only (see FR-114).

#### FR-22 - Meter node discovery without editing code
`MUST` · `[M+HW]` · Evidence: #9, #10 (users with `dev_4.x`), the maintainer's own explanation that "different Toons use different device IDs" (#9 comment 2020-04-05, #10 comment 2021-06-29), hard-coded keys `device.js:332-341`.
The app finds the electricity and gas meter nodes in `getDevices.json` itself, so that no user has to read logs or edit code.
* AC1 **Given** three fixtures that carry the same meter data under `dev_2.x` (baseline), `dev_3.x` and `dev_4.x` keys, **When** polled, **Then** gas, peak and off-peak totals are identical in all three cases.
* AC2 **Given** a payload with several candidate nodes where the rule cannot decide, **When** polled, **Then** capabilities are left unchanged, and exactly one info-level log line (per device start) lists the candidate node keys, so a user or maintainer can report them (replaces the CLI-log procedure of #9).
* AC3 `[HW]` **Given** each of the owner's Toons (Toon 1 and Toon 2 if both exist), **When** the real `getDevices.json` is captured and fed to the discovery, **Then** the discovered nodes are the ones the Toon itself shows, and the captured (anonymised) payloads become fixtures. **No real payload exists in this repo yet; the discovery rule cannot be fully specified without one (OQ-05).**

#### FR-23 - Manual override of the meter nodes
`COULD` · `[M]` · Evidence: #10 ("make this change in the advanced settings").
* AC1 **Given** an advanced setting with an explicit node prefix, **When** set, **Then** discovery is bypassed and values come from that prefix; **When** cleared, **Then** discovery resumes.
* AC2 **Given** an override that matches nothing, **When** polled, **Then** a localized warning is set and no capability is zeroed.

#### FR-24 - Tolerance to partial or garbled payloads
`MUST` · `[M]` · Evidence: baseline `data['dev_2.4'].hasOwnProperty` throws when the node is absent and the `.catch` swallows it (`device.js:381`, audit section 2 / S1-S3); #11 ("gasUsage isn't provided on every Toon").
* AC1 **Given** each of these responses in turn - `{}`, `{"result":"error"}`, `{"result":"ok"}`, HTML error page, truncated JSON, empty body, a node present but a field missing, `"NaN"`, `null`, `"abc"`, a number where an object is expected, 20 MB of text - **When** parsed, **Then** no exception escapes, no capability is set to a non-finite value, and capabilities not covered by the response keep their value.
* AC2 **Given** a payload that contains only the thermostat fields (no meters, no water, no gas), **When** polled, **Then** thermostat capabilities update normally.
* AC3 **Given** any scenario above, **When** the scenario ends, **Then** the harness recorded zero unhandled rejections (see NFR-01).

#### FR-25 - Instantaneous power export (issue #23)
`SHOULD` · `[M+HW]` · Evidence: #23; the `GetCurrentUsage` sample pasted in #11 contains `"powerProduction": {"value":0, "avgValue":0.00}` (user-pasted, not verified here); `measure_power` has no `min` in `homey-lib` (negative values are possible, but see FR-27).
Add a new, additive, read-only capability for the current export power in W (proposed id `measure_power.export`; final id by ADR). `measure_power` keeps meaning "import" and is unchanged.
* AC1 **Given** `powerProduction.value = 1200`, **When** polled, **Then** the export capability = 1200 and `measure_power` still equals `powerUsage.value`.
* AC2 **Given** the Toon payload has no `powerProduction`, **When** polled, **Then** the export capability is untouched and nothing throws.
* AC3 **Given** the design's gating decision (always on vs. opt-in setting, OQ-06), **When** the gate is off, **Then** the capability is absent and consumes no request (it needs no extra request in any case: same payload as FR-20).
* AC4 `[HW]` **Given** a Toon connected to a household that exports to the grid, **When** exporting, **Then** the value matches the P1 meter display.

#### FR-26 - Cumulative export counters (issue #23)
`COULD` · `[HW]` · Evidence: #23; the meter node that carries produced energy is **unknown** to this repo (no real `getDevices.json` dump with production exists).
* AC1 **Given** a real captured payload from a household with production, **When** the discovery rule maps the production counters, **Then** a cumulative export capability (kWh, 3 decimals) updates and FR-90 can declare it as the exported capability.
* AC2 **Given** a Toon without production, **When** polled, **Then** the capability is absent or untouched (never a fabricated 0 counter that would corrupt Homey Energy).

#### FR-27 - Net-signed `measure_power` (negative = export)
`WONT` (this release) · Evidence: #23 offers it as an option; it would change the meaning of an existing capability (Insights history, user Flows that compare `measure_power` > x), violating the stability contract (section 5). Revisit only if hardware shows Homey Energy mis-attributes usage for exporters (OQ-06).
* AC1 **Given** the released app, **When** `measure_power` is read on a household that exports, **Then** it is never negative (documented behaviour; verified by FR-20 AC and a fixture with `powerProduction.value > 0`).

#### FR-28 - Gas meter total
`MUST` · `[M+HW]` · Evidence: `device.js:434-445` (`dev_2.1.CurrentGasQuantity`, litres, `Math.trunc(x/1000)`), `app.json:101`.
* AC1 **Given** `CurrentGasQuantity "1234567"` (L), **When** polled, **Then** `meter_gas` = 1234.567 m3 (three decimals).
* AC2 **Given** a Toon without a gas node, **When** polled, **Then** `meter_gas` is untouched and no error is logged at error level.
* AC3 `[HW]` **Given** a real Toon with a gas meter, **When** polled, **Then** the value equals the Toon display.

#### FR-29 - Instantaneous gas usage
`COULD` · `[M+HW]` · Evidence: #11 (`gasUsage.value`, "9 liter per hour" as read by the requester; another user says most Toons do not provide it).
* AC1 **Given** `gasUsage.value = 9` in the same payload as FR-20, **When** polled, **Then** an additive read-only capability shows it with the unit decided by the hardware check; **Given** the key is absent, **Then** the capability is not added (no fabricated 0).

### 6.4 Burner, hot water, boiler (FR-30..39)

#### FR-30 - Burner state
`SHOULD` · `[M+HW]` · Evidence: #26; `burnerInfo` is already fetched in the same call as the temperature (`device.js:475-477`), so it costs no extra request. Meaning of values: `2` = hot water is confirmed by the baseline code (`device.js:476`), `1` = heating is stated by the issue reporter, `0` = off and `3` = pre-heating come from the audit (section 5, model-generated) and are **unverified**.
Add an additive read-only enum capability (proposed id `burner_state`; values `off`, `heating`, `hot_water`, `preheating`; en/nl titles). No suitable system capability exists (checked `homey-lib` capability list: `heater_operation_mode` and `hot_water_mode` describe settable modes, not a burner status).
* AC1 **Given** `burnerInfo` `0`, `1`, `2`, `3` (numbers or strings), **When** polled, **Then** the capability is `off`, `heating`, `hot_water`, `preheating`.
* AC2 **Given** an unknown or missing `burnerInfo`, **When** polled, **Then** the capability is untouched (debug log only).
* AC3 **Given** a legacy device (L2019/L2021/L2023), **When** the new version starts, **Then** the capability is added without re-pairing (FR-111) and the device keeps all other values.
* AC4 `[HW]` **Given** a real Toon whose burner switches between idle, central heating and tap water, **When** observed for a day, **Then** the mapping table is confirmed or corrected; the mapping lives in one table in code so a correction is a one-line change.

#### FR-31 - Hot-water flag preserved (`alarm_water.hotwater`)
`MUST` · `[M]` · Evidence: `device.js:475-477`, `app.json:105,140-145,279-303,366-379`.
This is the *boiler* hot-water signal and stays on the device **whether or not ToonWater is enabled**.
* AC1 **Given** `burnerInfo` = 2, **When** polled, **Then** `alarm_water.hotwater` = true; **Given** any other valid value, **Then** false.
* AC2 **Given** ToonWater is disabled, **When** the device is inspected, **Then** `alarm_water.hotwater`, the trigger `alarm_water_changed` and the condition `hotwater_dispensing` are all present and working.
* AC3 **Given** the value flips false to true, **When** polled, **Then** `alarm_water_changed` fires once with token `alarm_water.hotwater` = true (FR-70).
* AC4 **Given** the device's title/units, **When** compared with the baseline, **Then** capability id and title are unchanged (`app.json:140-145`).

#### FR-32 - Burner Flow cards (issue #26)
`SHOULD` · `[M+HW]` · Evidence: #26 asks for a WHEN card ("heating turns on") and, failing that, an AND card ("heating is on").
Provide both, in the same style as `temperature_state_changed` / `temperature_state_is`: a trigger "Burner state changed to [[state]]" (state: any / off / heating / hot water / pre-heating; token with the new state) and a condition "Burner state !{{is|isn't}} [[state]]". Proposed ids `burner_state_changed`, `burner_state_is`; final ids by ADR; all with `titleFormatted`, en + nl.
* AC1 **Given** the state goes `off` to `heating` while a Flow listens for `heating`, **When** polled, **Then** the trigger fires exactly once; a listener for `hot_water` does not fire.
* AC2 **Given** the state stays `heating` over many polls, **When** polled, **Then** the trigger does not fire again.
* AC3 **Given** state `heating`, **When** the condition `is heating` runs, **Then** it returns `true`; `isn't hot_water` returns `true`.
* AC4 **Given** the very first value of a device (`null` before), **When** applied, **Then** the trigger does **not** fire (no phantom change; FR-70 AC4).

#### FR-33 - Boiler values (pressure, in/out temperature, modulation)
`WONT` (this release) · Evidence: #2 names `boilerPressure`, `boilerOutTemp`, `boilerInTemp`, `boilerModulationLevel` from `/boilerstatus/boilervalues.txt`; a user later says in/out temperature "no longer available in BoilerText". **No payload sample exists in the repo or issues, so a mock would be invented.** `homey-lib` has a `measure_pressure` (mbar) capability that would fit.
Revisit after a hardware capture; if done, follow the opt-in pattern of FR-50 (feature present only when the user turns it on, because not every boiler/adapter provides it).
* AC1 **Given** the released app, **When** its manifest is inspected, **Then** no boiler-value capability exists (so none can show an empty value); the open question OQ-07 tracks the hardware capture.

### 6.5 ToonWater as an opt-in feature (FR-50..69)

This group is the owner's explicit requirement. Terms: *enabled* = setting `toonwater_enabled` is true. "Water group" and "ToonWater" are defined in the glossary. The `address` and all other data keys are unaffected.

**Decisions taken in this group (with the alternatives that were rejected).**

* **D-1 Disable REMOVES the water capabilities (it does not just hide them).** The owner's words are "no water capabilities on the tile ... no water cards in the Flow editor". Hiding a capability (e.g. `uiComponent: null`) would leave it on the device, so Homey would still generate its system Flow cards and Insights/Energy entries for it; and a hidden capability that is no longer updated keeps a stale value that Flows can still read, which is worse than absence. Homey's documentation states that `removeCapability` "Any Flow that depends on this capability will become broken" (Device.html, quoted). That consequence is accepted *because disabling is a deliberate user action*; it is mitigated by D-3/D-4/D-5, by the hint text and by the confirmation message.
* **D-2 Existing devices that already have water capabilities are migrated to ENABLED** (preserve behaviour), even if no value has ever arrived. Devices without them (paired before PR #21) are migrated to *disabled* and get no water capabilities. Nothing is added or removed by the migration beyond that.
* **D-3 The app never removes capabilities on its own.** A 404 or an unreachable Toon never auto-disables ToonWater: capability removal only ever follows the user's checkbox. (Auto-removal would silently break Flows and could delete Insights history because of a transient LAN outage.)
* **D-4 Enabling is allowed even if the add-on is not found; the user is told clearly.** Rationale: the add-on's page file is only (re)written when flow or today's total changes (`ToonWaterApp.qml:283-287`, read for interface knowledge only), so a freshly installed or rebooted Toon may legitimately return 404 for a while (inference, to be confirmed: HW-07); blocking the checkbox would create a dead end. The same warning mechanism is needed anyway for migrated devices (D-2). Rejected: refusing to save the setting on 404.
* **D-5 Water cards stay *declared* in the manifest, are filtered to devices that have the water capability, and `update_water` on a device without it fails with a clear localized error** (rather than succeeding silently or requesting `/water.html`). Cards are not removed from the manifest because existing Flows reference them and because removing a card is not documented to be safe for existing Flows (flow.md documents only `"deprecated": true`). The exact filter is `driver_id=open-toon&capabilities=meter_water.total` (`&`-combination of `driver_id` and `capabilities` is the documented syntax; the editor behaviour when no device matches is **not documented** and is verified on hardware: HW-05).
* **D-6 No "hide only" mode now.** It is parked, not rejected: it could be added later as a second setting if users ask for a way to keep the Flows intact while removing the clutter.

#### FR-50 - Opt-in setting exists
`MUST` · `[M]`
Each Open-Toon device has a boolean setting `toonwater_enabled` (checkbox) in a settings group "ToonWater (optional add-on)", persisted by Homey per device, with localized label and hint (exact texts in FR-59).
* AC1 **Given** the composed manifest, **When** inspected, **Then** the driver settings contain a checkbox with id `toonwater_enabled`, a `label` and a `hint`, each with `en` and `nl`.
* AC2 **Given** a device, **When** the setting is read, **Then** it is a boolean (never undefined: legacy devices get a value from FR-56).

#### FR-51 - Default OFF for new devices
`MUST` · `[M]` · Evidence: owner intent; baseline puts water in the driver capability list (`app.json:102-104`).
* AC1 **Given** the composed driver manifest, **When** its default `capabilities` list is read, **Then** it contains none of `measure_water`, `meter_water.today`, `meter_water.total` and the setting default is `false`.
* AC2 **Given** a freshly created device in the fake Homey, **When** it initialises and polls for ten intervals against a mock that counts requests, **Then** the mock received **zero** requests to `/water.html`, the device has none of the three water capabilities, and `alarm_water.hotwater` is present.
* AC3 **Given** the same device, **When** the mock's `/water.html` would return 404, **Then** the log contains no water-related warning or error line and the device shows no warning.
* AC4 `[HW]` **Given** a real Homey with a newly paired Toon, **When** the device tile and the Flow editor are inspected, **Then** no water item and no water card is offered for that device.

#### FR-52 - Enabling adds capabilities, cards and polling
`MUST` · `[M+HW]`
* AC1 **Given** a device with ToonWater off and a mock that serves a valid `/water.html`, **When** the user ticks `toonwater_enabled` and saves, **Then** `onSettings` completes without error, the three water capabilities exist with their baseline ids, titles and options (`app.json:128-139`: "Water today"/"Water vandaag", "Water meter total"/"Water meter totaal"), and the first values appear within 10 s (enabling triggers an immediate fetch; it does not wait for the next scheduled cycle).
* AC2 **Given** the same, **When** the next poll cycles run, **Then** `/water.html` is requested once per cycle (subject to FR-57) and the three values update (units per FR-58).
* AC3 **Given** the device is currently unavailable (Toon offline) when the user ticks the box, **When** saved, **Then** the capabilities are still added, the status becomes "Toon not reachable" (FR-55) and values appear after the Toon returns.
* AC4 **Given** ticking, unticking and ticking again in quick succession (three saves within one second), **When** all complete, **Then** the final state equals the last save, no duplicate-capability or invalid-capability error occurs, and no unhandled rejection is recorded (capability changes are serialised).
* AC5 `[HW]` **Given** a real Homey, **When** enabling, **Then** the three items appear on the tile and the water cards become selectable for this device in the Flow editor.

#### FR-53 - Disabling stops polling and removes capabilities and cards
`MUST` · `[M+HW]`
* AC1 **Given** an enabled device with water values, **When** the user unticks and saves, **Then** the three capabilities no longer exist (`hasCapability` false) and `toonwater_status` shows "Off" (FR-59).
* AC2 **Given** the same, **When** three further poll intervals pass, **Then** the mock records **no** request to `/water.html` after the save completed.
* AC3 **Given** a `/water.html` request that is in flight at the moment of saving, **When** its response arrives after the capabilities were removed, **Then** the response is discarded: no `setCapabilityValue` on a removed capability (the baseline's `Invalid Capability` unhandled rejection), no log line at error level, no unhandled rejection.
* AC4 **Given** disabling, **When** the device is inspected, **Then** temperature, power, gas, burner and `alarm_water.hotwater` capabilities and their values are untouched and keep updating (FR-60).
* AC5 `[HW]` **Given** a real Homey, **When** disabling, **Then** the tile no longer shows water items, and the water cards are no longer offered for this device in the Flow editor. Whether Insights keeps the history of the removed capabilities is recorded (HW-06).

#### FR-54 - Flows that reference water, and the disable/enable round trip
`MUST` · `[M+HW]` · Decision records D-1, D-3, D-5.
* AC1 **Given** the composed manifest, **When** inspected, **Then** `update_water` and `measure_water_changed` are still declared (ids unchanged) and carry the filter `driver_id=open-toon&capabilities=meter_water.total` (or the final equivalent) on their `device` argument.
* AC2 **Given** ToonWater is disabled for a device and a (legacy) Flow runs `update_water` for it, **When** the action runs, **Then** it rejects with the localized message "ToonWater is not enabled for this device" ("ToonWater staat niet aan voor dit apparaat"), sends no request to the Toon, and nothing is logged at error level.
* AC3 **Given** the user disables ToonWater, **When** the settings save returns, **Then** the returned message tells the user that water items were removed and that Flows using them need to be updated (en/nl text in FR-59); the app does not attempt to edit or delete any Flow.
* AC4 **Given** an enabled device is disabled and later re-enabled, **When** re-enabled, **Then** the capabilities return with the **same ids**, so a Flow built on them can resolve again.
* AC5 `[HW]` **Given** a real Homey with a Flow that uses a water trigger, condition tag and `update_water`, **When** ToonWater is disabled and later re-enabled, **Then** it is recorded exactly what happens to that Flow (shown as broken? healed on re-enable? run errors?) - this is documented in the hardware report and in the README ("what happens to my Flows") because Homey's behaviour is only partly documented (HW-05).

#### FR-55 - The user learns that the add-on is not installed (404 / unreachable)
`MUST` · `[M+HW]`
Three situations are told apart and never confused with a Toon outage:
(a) **HTTP 404** on `/water.html` -> "ToonWater not found on this Toon";
(b) **Toon unreachable** (timeout, refused, DNS) -> handled by normal availability (FR-81); the ToonWater status says "Toon not reachable";
(c) **HTTP 200 but unusable body** (not JSON, `result` != `ok`, no `water` object) -> "unexpected response".
* AC1 **Given** the user enables ToonWater and the mock returns 404, **When** the settings save returns, **Then** the returned message is the localized "not found" text (FR-59), the capabilities are added anyway (D-4), `toonwater_status` = "Not found on this Toon (HTTP 404)" and the device carries a persistent warning (`setWarning`) with the localized text "ToonWater is enabled but was not found on this Toon".
* AC2 **Given** the state of AC1, **When** the mock starts returning a valid payload, **Then** within one backoff window (FR-57) the warning is removed (`unsetWarning`), the status becomes "Detected", and the values appear. The warning is removed in **every** exit path (including disabling, deleting the device and a restart), because Homey warnings are persistent.
* AC3 **Given** a 404, **When** the thermostat endpoint is healthy, **Then** the device stays **available** and all non-water capabilities keep updating.
* AC4 **Given** a 404 that persists for 24 h of polling, **When** observed, **Then** no error-level log line exists and no more than 97 `/water.html` requests were made (one initial probe plus one per 15 minutes, FR-57), and no notification was created for a user-enabled device (FR-62 AC2).
* AC5 **Given** the Toon is unreachable when the user enables ToonWater, **When** saved, **Then** the returned message says the Toon could not be reached (not "add-on not found") and the status reads "Toon not reachable".
* AC6 **Given** a 200 response with `{"result":"error"}` or HTML, **When** polled, **Then** status = "Unexpected response", device stays available, capabilities keep their last values.
* AC7 `[HW]` **Given** a real Toon without the add-on, **When** `/water.html` is requested, **Then** the real status code is recorded (the audit says 404; this was not verifiable here) and the messages are adjusted if it differs (HW-07).

#### FR-56 - Existing devices keep their water behaviour (migration default)
`MUST` · `[M]` · Evidence: owner "Existing users must not lose water data or Flows"; decision D-2; baseline devices L2021/L2023 have the water capabilities, L2019 does not (audit section 2, `device.js:33-38`).
Runs once per device on the first start of the new version, gated by the store key `migrationVersion` (FR-111), and **never again afterwards** (so a user who later disables ToonWater is not flipped back).
* AC1 **Given** a legacy device with all three water capabilities and settings `{address}` only, **When** the new version starts, **Then** `toonwater_enabled` = true, no capability was added or removed, their last values are still readable immediately after start, and `/water.html` polling continues.
* AC2 **Given** a legacy device with some but not all water capabilities (e.g. only `measure_water`), **When** the new version starts, **Then** `toonwater_enabled` = true and the missing water capabilities are added (additive, no value loss).
* AC3 **Given** a legacy device without any water capability (L2019), **When** the new version starts, **Then** `toonwater_enabled` = false, **no** water capability is added, and zero requests go to `/water.html`. (The baseline-audit recommendation "add every manifest capability that is missing" must therefore exclude the water group; see FR-111.)
* AC4 **Given** a migrated device, **When** the migration set `toonwater_enabled` via `setSettings`, **Then** `onSettings` is not triggered by it (Homey does not call `onSettings` for programmatic changes, Device.html) and no capability add/remove loop starts.
* AC5 **Given** migration already ran and the user disabled ToonWater, **When** the app restarts, **Then** the setting stays false and no water capability is re-added.
* AC6 **Given** a migrated device with all water values `null` (add-on never present) and 404 on `/water.html`, **When** polled, **Then** the device behaves like AC1 of FR-55 (warning + status) - behaviour is *preserved*, but the user is told (FR-62).
* AC7 **Given** the Flows that existed on the baseline (cards `update_water`, `measure_water_changed` trigger, tags from the three capabilities), **When** the new version starts, **Then** every card id still resolves in the fake Homey and the device still has the capabilities those Flows use.

#### FR-57 - Fault-isolated water polling and back-off
`MUST` · `[M]`
`/water.html` is requested only when enabled. A water failure never affects the other endpoints, availability or the poll schedule.
* AC1 **Given** enabled and the mock returns 404, **When** polled, **Then** after the first 404 the app requests `/water.html` at most once every 15 minutes (not every cycle), logs the transition once at info level, and the other endpoints keep their normal cadence.
* AC2 **Given** the back-off is active and the mock then serves a valid payload, **When** the next retry occurs (or the user re-saves the setting or address), **Then** normal per-cycle polling resumes and the warning clears.
* AC3 **Given** the water request throws, times out (5 s) or returns garbage, **When** a cycle runs, **Then** thermostat/power/meter capabilities are updated in that same cycle and the device does not count the cycle as failed for availability (FR-81).
* AC4 **Given** two enabled devices on two different mock Toons, **When** one returns 404, **Then** the other continues polling at the normal cadence.

#### FR-58 - Water payload parsing and units
`MUST` · `[M+HW]` · Evidence: `device.js:171` (doc comment of the payload), `device.js:410-424`; payload `{"result":"ok","water":{"flow":N,"total":N,"value":N,"avgValue":N}}` with `total`/`value` in litres is documented by the ToonWater interface (`ToonWaterApp.qml:284`, interface knowledge only; section 13).
* AC1 **Given** `{"result":"ok","water":{"flow":4,"total":7350214,"value":137,"avgValue":200}}`, **When** polled, **Then** `measure_water` = 4 (L/min), `meter_water.total` = 7350.214 (m3) and `meter_water.today` = 0.137 (m3).
* AC2 **Given** a payload without `total` (older add-on versions; the baseline writes NaN, `device.js:417`), **When** polled, **Then** `flow` and `value` update and `meter_water.total` keeps its previous value.
* AC3 **Given** non-numeric, negative or `null` fields, **When** polled, **Then** those fields are ignored (the system capability `meter_water` has `min: 0`), nothing throws.
* AC4 **Given** `avgValue`, **When** parsed, **Then** it is ignored (no capability uses it; kept out of scope).
* AC5 `[HW]` **Given** a real ToonWater installation, **When** water is drawn, **Then** `flow`, `value`, `total` match the add-on's own Toon screen (units confirmed).

#### FR-59 - Settings UX: label, hint, status, messages (en + nl)
`MUST` · `[M]` · Texts below are the required wording (may be polished by the UX phase, but must stay semantically equal and exist in both languages).

| Element | en | nl |
|---|---|---|
| Group heading | ToonWater (optional add-on) | ToonWater (optionele add-on) |
| Checkbox label (`toonwater_enabled`) | Enable ToonWater water meter | ToonWater-watermeter inschakelen |
| Hint | Only turn this on if the ToonWater add-on is installed on your Toon (it provides the page /water.html). This adds water flow, water today and water total to this device and water cards to the Flow editor. Turning it off removes them again; Flows that use them will stop working until you turn it back on. | Zet dit alleen aan als de ToonWater-add-on op je Toon is geïnstalleerd (die levert de pagina /water.html). Hierdoor komen waterdebiet, water vandaag en water totaal op dit apparaat en waterkaarten in de Flow-editor. Uitzetten verwijdert ze weer; Flows die ze gebruiken werken dan niet meer totdat je het weer aanzet. |
| Status label (`toonwater_status`, read-only) | ToonWater status | ToonWater-status |
| Status: off / detected / not found / unreachable / unexpected | Off / Detected / Not found on this Toon (HTTP 404) / Toon not reachable / Unexpected response | Uit / Gevonden / Niet gevonden op deze Toon (HTTP 404) / Toon niet bereikbaar / Onverwacht antwoord |
| Save message: enabled and found | ToonWater found. Water values will appear shortly. | ToonWater gevonden. De watergegevens verschijnen zo meteen. |
| Save message: enabled, not found | ToonWater was not found on this Toon. The water items were added but stay empty until the add-on is installed and running. | ToonWater is niet gevonden op deze Toon. De wateronderdelen zijn toegevoegd, maar blijven leeg totdat de add-on is geïnstalleerd en draait. |
| Save message: disabled | ToonWater turned off. The water items were removed; Flows that used them need to be updated. | ToonWater is uitgezet. De wateronderdelen zijn verwijderd; Flows die ze gebruikten moeten worden aangepast. |
| Device warning | ToonWater is enabled but was not found on this Toon | ToonWater staat aan maar is niet gevonden op deze Toon |
| `update_water` rejection | ToonWater is not enabled for this device | ToonWater staat niet aan voor dit apparaat |

* AC1 **Given** the composed manifest and locale files, **When** statically checked, **Then** every string in the table exists in both `en` and `nl`, no placeholder is untranslated, and none contains a typo found by the spell-check list of FR-101.
* AC2 **Given** each situation of FR-52..55, **When** it occurs in the fake Homey, **Then** the message actually returned/set equals the table entry in the device's language (the fake Homey exposes `__()` with both locales).
* AC3 **Given** the settings page, **When** laid out, **Then** the ToonWater group follows the `address`/poll settings and its status label is read-only.
* AC4 `[HW]` **Given** a real Homey in Dutch and in English, **When** the settings are opened, **Then** the texts are readable, not truncated, and the save messages appear as toasts.

#### FR-60 - Boundary: the toggle touches only the water group
`MUST` · `[M]`
* AC1 **Given** any device state, **When** ToonWater is toggled on, off and on again, **Then** the set of non-water capabilities, their values and their Insights options is identical before and after, and `alarm_water.hotwater` is never added/removed by the toggle.
* AC2 **Given** ToonWater is off, **When** `update_status`, `update_powerusage` or `update_metertotals` run, **Then** none of them requests `/water.html`.
* AC3 **Given** the code base, **When** searched, **Then** `/water.html` is requested from exactly one module, reachable only through the enabled check.

#### FR-61 - Pairing awareness of ToonWater
`SHOULD` · `[M+HW]`
At pairing, the connection test may probe `/water.html` once and tell the user whether ToonWater was detected, without changing the default (still OFF).
* AC1 **Given** the mock serves a valid `/water.html`, **When** the test runs, **Then** the result panel shows the localized "ToonWater detected - you can enable it in the device settings after adding" and the created device still has `toonwater_enabled` = false (or true only if the user ticked an explicit, unticked-by-default checkbox, if the design offers one, OQ-03).
* AC2 **Given** the mock returns 404, **When** the test runs, **Then** no warning, error or red state is shown (the add-on is optional); the pairing proceeds normally.
* AC3 **Given** the probe times out, **When** the test runs, **Then** the thermostat test result still decides success (a ToonWater probe failure never blocks pairing).

#### FR-62 - One-time hint for migrated devices that never saw the add-on
`SHOULD` · `[M]` · Evidence: D-2 preserves the old clutter for devices whose add-on never existed; the owner should be able to clean up knowingly.
* AC1 **Given** a device enabled *by migration* whose `/water.html` returned 404 on every attempt during the first 24 h after the update, **When** that period ends, **Then** exactly one Homey timeline notification (en/nl) says that ToonWater is switched on for this Toon but not found, and where to switch it off; a store flag prevents repeats across restarts.
* AC2 **Given** a device enabled by the user, **When** 404 persists, **Then** no notification is created (the user already got the save message and the warning).
* AC3 **Given** the device was deleted or disabled before the 24 h passed, **When** the time passes, **Then** nothing is created.

#### FR-63 - Water in Homey Energy
`COULD` · `[HW]` · Evidence: `energy.cumulative` makes Homey Energy read `meter_water` (the **plain** capability) as the water meter (energy.md, quoted: "The `meter_water` capability tracks the total amount of water consumed ... in cubic metres"); the baseline device has only the sub-capabilities (`meter_water.today`, `.total`), so water does not reach Energy (audit section 2).
* AC1 **Given** ToonWater enabled, **When** polled, **Then** a plain `meter_water` equals `meter_water.total`; **Given** disabled, **Then** it is absent. Existing sub-capabilities stay.
* AC2 `[HW]` **Given** a real Homey, **When** the Energy page is opened, **Then** water appears (or the idea is dropped if Homey shows it twice or ignores it).

### 6.6 Flow cards (FR-70..79)

#### FR-70 - Triggers actually fire
`MUST` · `[M]` · Evidence: five triggers declared (`app.json:175-303`), none ever fired (audit section 0; re-checked, no `getDeviceTriggerCard` in `driver.js`/`device.js`).
Each trigger fires **only when the underlying value changes**, with its existing token (names/types unchanged).
* AC1 **Given** the device value changes from A to B, **When** a poll applies it, **Then** the matching trigger fires exactly once with the token set to B and with `device` = the device: `meter_gas_changed` (`meter_gas`), `meter_power_changed` (`meter_power`), `measure_water_changed` (`measure_water`, only while ToonWater is enabled), `temperature_state_changed` (`temperature_state`: the **id**, e.g. `sleep`), `alarm_water_changed` (`alarm_water.hotwater`: boolean).
* AC2 **Given** an unchanged value over many polls, **When** applied, **Then** no trigger fires.
* AC3 **Given** a trigger listener that throws or rejects, **When** firing, **Then** the error is caught and logged; polling continues; no unhandled rejection.
* AC4 **Given** a capability that has never had a value (`null`), **When** its first value arrives, **Then** no trigger fires; **Given** the app restarts and the first polled value differs from the value Homey stored, **Then** the trigger fires once (a real change that happened while the app was down).
* AC5 **Given** `meter_power_changed`, **When** peak or off-peak changes, **Then** it fires with `meter_power` = the sum of both in kWh (3 decimals); its token title says "kWh" (the "Wh" of `app.json:212` was wrong). Whether additional tokens `peak`/`offpeak` are added is a design detail (additive only).

#### FR-71 - Deprecate duplicates of system cards
`SHOULD` · `[M+HW]` · Evidence: `meter_gas_changed` and `measure_water_changed` reuse the ids of Homey's system capability triggers (audit section 1, 2); flow.md: `"deprecated": true` keeps a card working but hides it from the "Add card" list.
* AC1 **Given** the composed manifest, **When** inspected, **Then** `meter_gas_changed` and `measure_water_changed` carry `"deprecated": true`, still fire (FR-70), and the other three triggers do not.
* AC2 `[HW]` **Given** a real Homey, **When** the Flow editor "Add card" list is opened for a device, **Then** the deprecated app cards are not listed, and an existing Flow using one still triggers.

#### FR-72 - Conditions are boolean and cover the new enum value
`MUST` · `[M]` · Evidence: `driver.js:30-34`, `app.json:305-379`.
* AC1 **Given** `temperature_state` = `home`, **When** `temperature_state_is` runs with `state=home`, **Then** it returns `true`; with `state=sleep` it returns `false`; **Given** the capability is `null`, **Then** it returns `false` (never `undefined`/`null`).
* AC2 **Given** `hotwater_dispensing`, **When** `alarm_water.hotwater` is `true`/`false`/`null`, **Then** the card returns `true`/`false`/`false`.
* AC3 **Given** the `temperature_state_is` dropdown, **When** inspected, **Then** it contains the five baseline ids plus `vacation` (FR-12) and the baseline default `comfort`.

#### FR-73 - Action cards: real results and localized failures
`MUST` · `[M]` · Evidence: baseline actions resolve even when the Toon is offline (audit section 2, harness S8).
* AC1 **Given** the mock is healthy, **When** `set_temperature_state`, `enable_program`, `disable_program` run, **Then** each resolves only after the Toon's HTTP response was received and checked (`result` not `error`).
* AC2 **Given** the Toon is unreachable or answers an error, **When** any action runs, **Then** the promise rejects with a localized (en/nl) message, not a raw stack/English-only text.
* AC3 **Given** the unavailable device, **When** an action card is run, **Then** the behaviour is Homey's (it blocks the action; documented) and the app does not add a second layer of failure.
* AC4 **Given** the composed `app.json`, **When** validated at `publish` level, **Then** it passes - in particular `set_temperature_state.titleFormatted` contains `[[state]]` **and** `[[resume_program]]` in en and nl (`app.json:388-391` is missing it today).

#### FR-74 - The four "Update ..." actions keep working
`MUST` · `[M]` · Evidence: existing user Flows built on the maintainer's workaround (#5, #25).
`update_status`, `update_powerusage`, `update_metertotals`, `update_water` stay (ids and args unchanged). Each forces an immediate refresh of its part and resolves when done.
* AC1 **Given** the mock, **When** each runs, **Then** the corresponding endpoint(s) are requested once and the capabilities update before the promise resolves.
* AC2 **Given** an unreachable Toon, **When** any runs, **Then** it rejects with the localized "Toon cannot be reached" (the baseline silently resolves).
* AC3 **Given** a run while a scheduled poll is in flight, **When** executed, **Then** it joins or follows that poll (no parallel duplicate requests to the Toon).
* AC4 **Given** `update_water` on a device without ToonWater, **When** executed, **Then** FR-54 AC2 applies.

#### FR-75 - Deprecate redundant "Update ..." cards for new Flows
`SHOULD` · `[M+HW]` · Rationale: once FR-80 polls automatically, these cards no longer need to be offered to new users (#5/#25 were the only reason they were needed).
`update_powerusage`, `update_metertotals` and `update_water` get `"deprecated": true`; **`update_status` stays visible** as the one "Update now" card (its title is reworded to "Update now" / "Update nu" and it refreshes every enabled endpoint).
* AC1 **Given** the manifest, **When** inspected, **Then** those three cards are deprecated and `update_status` is not.
* AC2 **Given** a Flow built on a deprecated card, **When** it runs, **Then** it behaves as in FR-74.
* AC3 `[HW]` **Given** the Flow editor, **When** browsing the app's action cards, **Then** only the non-deprecated ones are listed.

#### FR-76 - Stability contract is machine-checked
`MUST` · `[M]` · Evidence: section 5.
* AC1 **Given** a baseline snapshot of ids (extracted from `git show 5cc3b90:app.json` and stored as a test fixture), **When** the test compares it with the composed manifest, **Then** every baseline capability id, trigger/condition/action id, their argument names and types, the driver id and the setting key `address` still exist (deprecated is allowed; absent or renamed fails the test).
* AC2 **Given** an intentional break, **When** an ADR-referenced exception list contains it, **Then** the test passes only for those listed ids.

#### FR-77 - Flow card text quality
`SHOULD` · `[M]` · Evidence: `app.json:314` (NL `||`), `app.json:322-363` (dropdown args without `title`), `app.json:212`.
* AC1 **Given** every flow card, **When** statically checked, **Then** it has `title` and `titleFormatted` (where it has arguments) in en and nl, all `[[arg]]` placeholders match the declared args, every dropdown argument has a title, and the NL text uses `!{{is|is niet}}` correctly.

### 6.7 Polling, availability, settings (FR-80..89)

#### FR-80 - Automatic polling
`MUST` · `[M+HW]` · Evidence: #5, #25 (the most-voiced user pain), `device.js` has no polling (audit section 0).
* AC1 **Given** a healthy mock and the default interval (30 s), **When** 5 minutes of fake time pass, **Then** each active endpoint was requested 10 times (+/- 1), with no manual Flow.
* AC2 **Given** the device starts, **When** `onInit` runs, **Then** it returns without waiting for the network (NFR-08) and the first cycle starts within 5 s.
* AC3 **Given** a response that takes longer than the interval, **When** the cycle runs, **Then** the next cycle starts only after the previous one finished (no overlap, never two parallel cycles per device).
* AC4 **Given** one endpoint fails in a cycle, **When** the cycle runs, **Then** the remaining endpoints are still requested and applied.
* AC5 `[HW]` **Given** a real Toon over 24 h at the default interval, **When** observed, **Then** values stay current and the Toon stays responsive (its own UI is not sluggish; NFR-03).

#### FR-81 - Availability
`MUST` · `[M+HW]` · Evidence: baseline never marks the device unavailable (`device.js:497-519` dead overrides); `setUnavailable(message?)` and Homey blocking Flow actions on unavailable devices (devices.md, via audit section 1).
A cycle *fails* when the core thermostat endpoint fails (timeout, network error, HTTP >= 500, unusable body). Optional endpoints (water, meter totals) never make the device unavailable.
* AC1 **Given** three consecutive failed cycles, **When** the third fails, **Then** `setUnavailable` is called with the localized "Toon cannot be reached" / "Toon is onbereikbaar" (`locales` key `offline`); not earlier.
* AC2 **Given** the device is unavailable, **When** the Toon answers again, **Then** `setAvailable` is called after the first successful cycle and values refresh.
* AC3 **Given** the device is unavailable, **When** time passes, **Then** polling continues with back-off up to 5 minutes between attempts (so the device recovers by itself, with no Flow and no restart).
* AC4 **Given** the first failing cycle after a long healthy period, **When** it fails, **Then** capability values are **not** cleared or zeroed.
* AC5 `[HW]` **Given** the Toon is unplugged and re-plugged, **When** observed, **Then** the tile shows unavailable with the message, then recovers by itself.

#### FR-82 - Changing the address
`MUST` · `[M+HW]` · Evidence: baseline has no `onSettings` (audit section 2); `app.json:161-168`.
* AC1 **Given** an invalid new address (FR-03), **When** saved, **Then** `onSettings` throws a localized error and the stored address is unchanged (that a thrown error rejects the save is the expected Homey behaviour but is not stated in the Device docs read, so confirm on hardware: HW-13).
* AC2 **Given** a valid new address, **When** saved, **Then** the in-flight requests of the old address are aborted, no response from the old address is applied afterwards, the next cycle uses the new address within one interval, and if ToonWater is enabled it is re-probed (FR-55).
* AC3 `[HW]` **Given** a real Homey, **When** an invalid address is saved, **Then** the user sees the error and the field keeps its old value.

#### FR-83 - Poll interval setting
`SHOULD` · `[M]` · Evidence: audit section 3(c) (default 30 s, min 10, max 3600; the default is an open question in the audit: confirm on hardware, NFR-03).
Setting `poll_interval` (seconds, number, with hint en/nl: "How often Homey reads the Toon. Lower values put more load on the Toon." / "Hoe vaak Homey de Toon uitleest. Lagere waarden belasten de Toon meer.").
* AC1 **Given** 5, 10, 3600, 3601, `"abc"`, empty, **When** saved, **Then** 5, 3601, `"abc"` are rejected with a localized message; 10 and 3600 are accepted; empty uses the default 30.
* AC2 **Given** a change from 30 to 60, **When** saved, **Then** the next schedule uses 60 without restarting the app.

#### FR-84 - Lifecycle: nothing runs after the device is gone
`MUST` · `[M]` · Evidence: baseline `onDeleted` throws (`device.js:488-491`); no `onUninit`.
* AC1 **Given** a running device, **When** it is deleted or `onUninit` is called, **Then** its timers are cleared, in-flight requests are aborted, and the mock sees no further requests.
* AC2 **Given** a response that arrives after teardown, **When** received, **Then** it is ignored (no `setCapabilityValue`, no log at error level, no unhandled rejection).
* AC3 **Given** `onDeleted`, **When** called, **Then** it does not throw.

#### FR-85 - Visible status and last error
`SHOULD` · `[M+HW]` · Evidence: #9 (a user could not get a diagnostic report for a CLI-installed app; support relied on console logs).
* AC1 **Given** read-only settings "Last successful update" and "Last problem" (en/nl, e.g. "Laatste succesvolle update"), **When** polls succeed or fail, **Then** they show a timestamp and a short localized reason (e.g. timeout, HTTP 404, unusable response) - no stack traces, no raw payloads.
* AC2 **Given** repeated identical failures, **When** shown, **Then** the text is updated, not appended (no unbounded growth).

### 6.8 Energy (FR-90..99)

#### FR-90 - Homey Energy shows import kWh and gas
`SHOULD` · `[M+HW]` · Evidence: `app.json:107-109` (`energy.cumulative: true` without imported/exported capability; the validator warns, audit section 2); energy.md.
Declare the imported-energy capability so Homey Energy gets kWh next to W and gas. Because the Toon reports two tariff counters, this needs one additive total capability (proposed `meter_power.imported` = peak + off-peak, 3 decimals); the existing `meter_power.peak`/`offPeak` stay.
* AC1 **Given** peak = 1000.100 and off-peak = 2000.200, **When** polled, **Then** the imported total = 3000.300; **Given** only the single-tariff counter, **Then** the total equals it; **Given** one counter missing/NaN, **Then** the total is not updated (no half sums).
* AC2 **Given** the manifest, **When** validated, **Then** `energy.cumulative` is true with `cumulativeImportedCapability` pointing at an existing capability, and the validator emits no energy warning.
* AC3 `[HW]` **Given** a real Homey, **When** the Energy page is opened, **Then** the Toon is listed with W, kWh and gas and does not double count other devices (recorded in the hardware report).
* Exported counterpart: see FR-26 (COULD).

### 6.9 Internationalisation (FR-100..109)

#### FR-100 - Every user-visible string exists in en and nl
`MUST` · `[M]` · Evidence: HARD RULE 6; locales `locales/en.json`, `nl.json`; manifest strings.
* AC1 **Given** the composed `app.json`, **When** scanned recursively, **Then** every object that holds a user-visible text (`name`, `description`, `title`, `titleFormatted`, `hint`, `label`, `values[].title/label`, `tokens[].title`, `example`) contains both `en` and `nl` keys with non-empty, different-from-key strings.
* AC2 **Given** every `__('key')` / `Homey.__('key')` use in `app.js`, `drivers/**/*.js`, `drivers/**/pair/*.html`, **When** resolved against both locale files, **Then** the key exists in both; no unused key exists in either (CI check).
* AC3 **Given** a missing translation, **When** the check runs, **Then** it fails the build (the fake Homey throws on a missing key).

#### FR-101 - Locale clean-up
`SHOULD` · `[M]` · Evidence: audit section 2 locales (typos "happend", "succesfull(y)", "an unique", Dutch "IP adres" in `en.json:11`, "Mi Home" copy-paste in `nl.json:19`, ~15 unused cloud-app keys; the App Store reviews texts).
* AC1 **Given** `en.json`, **When** reviewed against the baseline list of typos, **Then** none remain; **Given** `nl.json`, **Then** no mention of "Mi Home", "token" or "battery" remains, and `repair_migration_v3` exists in both or neither.
* AC2 **Given** the key set, **When** diffed against the baseline, **Then** removed keys are all unused ones (verified by AC2 of FR-100).

### 6.10 Migration of already-paired devices (FR-110..119)

#### FR-110 - No re-pair
`MUST` · `[M+HW]` · Evidence: stability contract (section 5); the nl locale's `repair_migration_v3` ("device must be re-added", `nl.json:7`) is exactly what must **not** happen.
* AC1 **Given** each legacy fixture (L2019, L2021, L2023) with name, zone and values, **When** the new version starts, **Then** the device keeps `data.id`, the `address` setting, its name, and all capability values that still exist; it does not become unavailable because of the update.
* AC2 `[HW]` **Given** a real Homey with a device installed from the baseline build (sideload), **When** the new build is installed over it, **Then** the device, its Insights history and a Flow built on every card of section 5 survive and run.

#### FR-111 - Idempotent, additive capability migration
`MUST` · `[M]` · Evidence: `device.js:33-38` (only `alarm_water.hotwater` is migrated; older devices never got the water capabilities; audit section 2).
The migration adds the *non-ToonWater* capabilities the new version needs (`alarm_water.hotwater`, burner state FR-30, import total FR-90, export FR-25 if gated on) and sets capability options; it handles the water group exclusively through FR-56. It is gated by the store key `migrationVersion` and safe to run twice.
* AC1 **Given** each legacy fixture, **When** the migration runs, **Then** the resulting capability set equals the expected set (a table in the test) and **no** capability from the baseline set that the device had is removed (except by the user via FR-53).
* AC2 **Given** the migration already ran, **When** the device restarts, **Then** `addCapability`/`removeCapability` are not called (spy; they are documented as expensive).
* AC3 **Given** L2019, **When** migrated, **Then** it does not receive `measure_water`, `meter_water.today`, `meter_water.total` (FR-56 AC3) and raises no `Invalid Capability` error on any later poll (the baseline raised three per update).

#### FR-112 - Defaults for settings that legacy devices do not have
`MUST` · `[M]`
* AC1 **Given** a legacy device whose settings object is `{address}` only, **When** it runs, **Then** it polls at the default interval (30 s), `toonwater_enabled` is resolved by FR-56, and no code path reads `undefined` as a number or string.
* AC2 **Given** a stored `poll_interval` of an invalid type, **When** read, **Then** the default is used and one debug log line is written.

#### FR-113 - Legacy upgrade matrix
`MUST` · `[M]`
* AC1 **Given** the three legacy fixtures crossed with a mock with and without ToonWater and with a single-tariff and a two-tariff meter payload, **When** the new version starts and polls three cycles, **Then** the harness records zero unhandled rejections, zero `Invalid Capability` errors, the expected capability set (FR-111 table), the expected `toonwater_enabled` (FR-56) and the expected request log (`/water.html` only when enabled).

#### FR-114 - Value precision change is harmless
`SHOULD` · `[M]`
`meter_gas`, `meter_power.peak/offPeak` move from whole numbers (`Math.trunc`) to three decimals.
* AC1 **Given** the old stored value 1234 and the first new reading 1234.567, **When** applied, **Then** it is accepted, the trigger fires at most once for that step (never repeatedly), and the changelog mentions the precision change.

### 6.11 Distribution, docs (FR-120..129)

#### FR-120 - Installable and valid
`MUST` · `[M+HW]` · Evidence: HEAD fails `homey app validate` at debug level (audit section 0), version strings with letters break the CLI (#6).
* AC1 **Given** the repo, **When** `homey app validate --level publish` runs in CI, **Then** it passes with zero errors (warnings reviewed); the `version` is plain semver (`MAJOR.MINOR.PATCH`) and greater than any published build.
* AC2 `[HW]` **Given** the owner's Homey Pro, **When** `homey app install` (or `run`) is executed, **Then** the app installs without error and starts without errors in the app log.
* AC3 **Given** `package.json`, **When** read, **Then** `name`, `repository`, `bugs`, `homepage` point at `nl.vinceste.open-toon` / `StefanPostma` (not `nl.eneco.toon`/athombv), `license` is `GPL-3.0` matching `LICENSE`, and `engines.node` is declared per NFR-02.

#### FR-121 - App Store readiness (not submission)
`SHOULD` · `[M]` · Evidence: #3/#15/#17 and the owner's reasons (trademark, shared package name, not on current libraries). The new code removes two of the three reasons; the trademark/naming one is a human decision (OQ-02).
* AC1 **Given** the manifest, **When** validated at `publish` level, **Then** it has `brandColor`, `platforms: ["local"]`, `connectivity: ["lan"]`, images in all required sizes, a `README.txt`, a `.homeychangelog.json` entry and `support`/`source`/`bugs` links.

#### FR-122 - Documentation (en + nl) incl. what to do about Flows
`SHOULD` · `[M]`
* AC1 **Given** `README.md`, **When** reviewed, **Then** it explains in English and Dutch: prerequisites (rooted Toon, open firewall - disclaimer kept), pairing, what the polling interval means, that **"Update ..." Flows are no longer needed**, the ToonWater feature (what it is, how to enable it, what disabling does to Flows, what the status values mean), upgrading from the old build, and where to report issues (with the requested data from #9: anonymised `getDevices.json`).
* AC2 **Given** the repo, **When** inspected, **Then** `CONTRIBUTING.md` no longer claims to be "Athom"'s guideline for this repo (it is the unmodified Athom template) and `app.json` contributors still credit oepi-loepi, Paul Heeringa (and moezie).

---

## 7. Non-functional requirements

#### NFR-01 - Reliability: no unhandled rejections, no escaped exceptions
`MUST` · `[M]` · Evidence: baseline raises an unhandled rejection on every power update (`device.js:377`), 3 more on legacy water devices, unawaited `setCapabilityValue` (`device.js:243,370,...`), a swallowing `.catch` (`device.js:127`); Homey Cloud already crashes apps on unhandled rejections and Homey Pro will (audit section 1).
* AC1 **Given** the whole mock scenario matrix (healthy, 404 water, slow, timeout, garbage bodies, partial payloads, legacy fixtures, rapid toggles, delete during poll, address change during poll), **When** each scenario runs under a harness that installs `process.on('unhandledRejection'/'uncaughtException')`, **Then** each records zero events.
* AC2 **Given** the source, **When** linted, **Then** every promise-returning call is awaited, returned or explicitly handled (`no-floating-promises`-equivalent), and every `setCapabilityValue` goes through one helper that catches and logs.

#### NFR-02 - Node.js 22, CommonJS
`MUST` · `[M]` · Evidence: Node.js table (app.md, re-checked): every Homey platform runs Node 22 from firmware v12.9.0; the dev machine has Node 25.
* AC1 **Given** the repo, **When** CI runs, **Then** lint, tests and `homey app validate` pass on Node 22 (not Node 25-only), `package.json` declares `engines.node` consistent with NFR-07, and the code is CommonJS (`'use strict'`, `require`).
* AC2 **Given** the source, **When** scanned, **Then** it uses no API newer than Node 22 and, if the chosen compatibility floor (NFR-07) is below 12.9.0, no API newer than that floor's Node version (e.g. no global `fetch` on Node 16).

#### NFR-03 - LAN load on the Toon
`MUST` · `[M+HW]` · Evidence: the Toon is a small embedded device; no measurement of the Toon's load capacity exists in the repo or the issues, so this budget is a **proposal to be validated on hardware** (HW-10).
* AC1 **Given** default settings and healthy mock, **When** 10 minutes pass, **Then** the mock saw at most 4 requests per 30 s (thermostat, power, meter totals, plus water only when enabled), strictly sequential (never two concurrent requests per Toon), each with a 5 s timeout.
* AC2 **Given** failures, **When** they persist, **Then** the request rate decreases (back-off up to 5 min; water 15 min), never increases, and there is no immediate retry loop.
* AC3 **Given** two or more devices, **When** polled, **Then** their cycles are independent but never bursty beyond one request in flight per Toon.
* AC4 `[HW]` **Given** 24 h at the default interval on each owned Toon, **When** observed, **Then** the Toon's own UI stays responsive and the measured response times are recorded; if not acceptable the default interval or the throttling of the heaviest endpoint is changed by ADR.

#### NFR-04 - Input validation and security
`MUST` · `[M]` · Evidence: the address is user-controlled and is concatenated into URLs (`device.js:94,122,151,177,209,247,272,297`); `setpoint` and state values come from Flows.
* AC1 **Given** every accepted address form, **When** a URL is built, **Then** it is built by a URL builder (not string concatenation) so that path, query and credentials cannot be injected via the address (FR-03 AC2), and only `http:` is used.
* AC2 **Given** a server that answers with a redirect to another host, **When** requested, **Then** the redirect is not followed (the request fails with a localized error).
* AC3 **Given** a response larger than the cap (proposed 2 MiB), **When** read, **Then** it is abandoned and treated as unusable (FR-24 AC1).
* AC4 **Given** numeric arguments (setpoint, interval) and enum arguments (state), **When** received from a Flow, **Then** they are validated against range/enum before any request is built.
* AC5 **Given** logs and settings texts, **When** inspected, **Then** they contain no stack traces from user-visible paths and never raw response bodies above debug level.
* Documented residual risk: the Toon API is unauthenticated plain HTTP on the LAN (README); this is inherent and is stated in the README (FR-122).

#### NFR-05 - No stale runtime dependencies
`MUST` · `[M]` · Evidence: #22, Dependabot PRs #31-#33 touch only packages hanging off `homey-wifidriver`; `homey-log` v1 is SDK-v2-only; `request-promise-native` is undeclared and `request` is deprecated (audit section 2).
* AC1 **Given** `package.json`, **When** read, **Then** `dependencies` is empty (or every entry is justified by an accepted ADR) and `homey-wifidriver`, `homey-log`, `request`, `request-promise-native` are absent from code and lockfile.
* AC2 **Given** `npm ls --omit=dev`, **When** run, **Then** it lists no packages; `npm audit --omit=dev` reports nothing.

#### NFR-06 - Testable without hardware
`MUST` · `[M]` · Evidence: HARD RULE 7 and owner intent 3.
* AC1 **Given** a clean checkout, **When** `npm test` runs offline on Node 22, **Then** it completes in under 60 s using an in-repo mock Toon (stateful HTTP server with fault modes: 404, 500, timeout, slow, garbage, partial, redirect, oversize), a strict SDK-v3-shaped fake Homey (throws on invalid capability, v2-only API use, missing translation, wrong `setUnavailable` signature) and JSON fixtures.
* AC2 **Given** each requirement tagged `[M]`, **When** the test suite is listed, **Then** at least one test names its id (e.g. in the test title) - a script checks that every `[M]` requirement id appears in the tests, and that no test mentions an unknown id.
* AC3 **Given** the pure parsing/mapping modules, **When** coverage is measured, **Then** line coverage is at least 90%.
* AC4 **Given** a test that needs hardware knowledge (a field semantics), **When** it is written, **Then** it is explicitly labelled with its HW-xx id and its fixture is marked "derived from issue/audit, not captured" until a capture replaces it.

#### NFR-07 - Supported Homey models and platform declaration
`MUST` · `[M+HW]` · Evidence: app.md Node.js table (re-checked); homey-cloud guide (via audit): Homey Cloud/Bridge has no LAN access.
Supported: Homey Pro (Early 2023), Homey Pro (2016-2019) on firmware that meets the chosen floor, Homey Pro mini. Not supported: Homey Cloud, Homey Bridge. The compatibility floor is an ADR (recommended `>=12.9.0`: one runtime, Node 22 everywhere, built-in `fetch`; the baseline says `>=5.0.0`, `app.json:4`) - OQ-04.
* AC1 **Given** the manifest, **When** inspected, **Then** `platforms` is `["local"]`, the driver `connectivity` is `["lan"]`, and `compatibility` equals the ADR value.
* AC2 `[HW]` **Given** each available model (at least the owner's Homey Pro), **When** the app runs, **Then** it installs and polls; models not available for testing are listed as "untested" in the README.

#### NFR-08 - Startup and action latency
`MUST` · `[M]` · Evidence: the baseline `onInit` awaits four un-timed HTTP calls; a wrong IP stalled init for >20 s (audit section 2).
* AC1 **Given** an unroutable address, **When** the device starts, **Then** `onInit` resolves in under 1 s, the device shows its last values, and the first poll runs in the background.
* AC2 **Given** an unreachable Toon, **When** a Flow action or capability set is run, **Then** it settles (rejects) within 6 s.
* AC3 **Given** a healthy mock, **When** a device is paired or started, **Then** all capabilities have values within 10 s.

#### NFR-09 - Logging hygiene
`SHOULD` · `[M]` · Evidence: owner "no 404 noise"; baseline logs every payload at every update (`device.js:97,125,...`).
* AC1 **Given** a 24 h simulated outage or a persistent 404, **When** logs are collected, **Then** each distinct condition is logged once on entering and once on leaving the state (not once per poll), at info or warn level, never error level for expected conditions (404 on water, Toon offline).
* AC2 **Given** default log level, **When** a healthy poll runs, **Then** it logs at most one short line per cycle or none; raw payloads only behind a debug switch.

#### NFR-10 - Maintainability
`SHOULD` · `[M]` · Evidence: audit section 3(a), section 2 dead code (`mapDeviceClass`, `debounce`, `webAPI*` handlers).
* AC1 **Given** the source, **When** reviewed, **Then** transport (HTTP client), parsing (pure functions payload -> capability values), polling engine and Homey glue are separate modules; no dead code from the audit remains; ESLint (athom config) passes.
* AC2 **Given** a pull request, **When** CI runs, **Then** validate (publish level), lint and tests run via GitHub Actions on Node 22 with current actions, and `dependabot.yml` is valid (`package-ecosystem` set; baseline `""` is invalid).

#### NFR-11 - Licensing and provenance
`MUST` · `[M]` · Evidence: HARD RULE 4; `LICENSE` is GPL-3.0; the oepi-loepi repositories carry no licence (`gh api`: `license: null` for `toonWater` and `nl.toonwater.toonwater`).
* AC1 **Given** the water implementation, **When** reviewed, **Then** it is written from the interface description (URL, fields, units) in FR-58 and section 13, contains no file or closely paraphrased code from the unlicensed repositories, and the provenance is recorded in the docs (section 13 / ADR).
* AC2 **Given** code that originates from this repo's PR #21 (GPL-3.0), **When** reused, **Then** it is marked as such in the provenance record; `package.json` `license` = `GPL-3.0`.
* AC3 **Given** `app.json` contributors, **When** inspected, **Then** earlier contributors remain credited.

#### NFR-12 - Resource stability
`SHOULD` · `[M]`
* AC1 **Given** 1,000 poll cycles under fake timers with random faults, **When** finished, **Then** at most one scheduled timer per device remains, open handles/listeners are not growing, and memory does not grow beyond a fixed small bound.

#### NFR-13 - Repository hygiene
`SHOULD` · `[M]` · Evidence: 1,880 of ~1,900 tracked files are `node_modules`; no `.gitignore`/`.homeyignore`; lockfile v1.
* AC1 **Given** the repo after the redesign, **When** `git ls-files` is inspected, **Then** `node_modules/` is untracked (the Homey CLI copies the local `node_modules`, so a developer runs `npm ci` first), `.gitignore` covers `node_modules/`, `.homeybuild/`, `env.json`, and `.homeyignore` excludes tests and docs from the app package.
* AC2 **Given** Dependabot PRs #31-#33, **When** the redesign lands, **Then** they are closed as obsolete.

#### NFR-14 - Backward compatibility (umbrella)
`MUST` · `[M]`
* AC1 **Given** section 5 and FR-76, FR-110, FR-113, **When** the full suite runs, **Then** all three pass; any deliberate exception is recorded in an ADR and listed in the exception file of FR-76 AC2.

#### NFR-15 - No external communication
`MUST` · `[M]` · Evidence: audit section 3(g) (drop `homey-log`, no Sentry DSN); privacy by default.
* AC1 **Given** the mock scenario matrix with a network spy, **When** the app runs, **Then** the only outbound connections are to the configured Toon address(es); there is no telemetry, update check or third-party call.

#### NFR-16 - Plain, accurate user-facing language
`SHOULD` · `[M+HW]`
* AC1 **Given** every localized user-facing message that reports a problem, **When** reviewed, **Then** it names the cause in plain words, says what the user can do next, and contains no internals (no HTTP library names, no stack traces, no capability ids).
* AC2 `[HW]` **Given** a Dutch-speaking tester, **When** shown each message on a real Homey, **Then** they judge it understandable (recorded in the hardware report).

---

## 8. Judgement of the open feature requests

### Issue #26 - "BurnerInfo as card in Homey" -> FR-30 (state) + FR-32 (cards): **SHOULD**

*Why not MUST.* The redesign's release must not be blocked by a feature whose value semantics are only partly confirmed: `2` = hot water is in the code (`device.js:476`), `1` = heating is stated by the requester, `0`/`3` come from the (model-generated) audit. A MUST needs a verified spec; this has a verified half.
*Why not COULD.* (1) It is the only open request that is cheap and low-risk: `burnerInfo` is already read in the same request as the temperature (`device.js:475-477`), so there is **no extra LAN request**. (2) The work is additive (a new capability and two new cards; nothing existing changes) and fits the pattern of `temperature_state` / `temperature_state_changed` / `temperature_state_is`. (3) It addresses the app's core value, automation: today the requester has to "fiddle with temperature values". (4) It makes the five dead triggers' fix (FR-70) pay off at once, because the burner trigger shares the same change-detection. (5) The mapping is one table, so a hardware correction is a one-line change.
*Promotion rule.* If the hardware capture (HW-08) confirms 0/1/2/3 early, promote to MUST before release; if it contradicts, the table is corrected, not the requirement.
*What is deliberately preserved.* `alarm_water.hotwater` (burner = 2) is independent and MUST stay (FR-31).

### Issue #23 - "Stroom export" -> FR-25 (instant export, **SHOULD**), FR-26 (cumulative, **COULD**), FR-27 (net-signed power, **WONT**)

*Instantaneous export is SHOULD.* The request is concrete, long-standing (2021) and open. The `GetCurrentUsage` sample in #11 shows a `powerProduction.value` next to `powerUsage.value`, i.e. it arrives in the request FR-20 already makes: no new LAN load. It is additive, so no break. It is not MUST because the only evidence for the field is a user-pasted sample from 2020 (no payload from a household that actually exports), and not every user has solar.
*Cumulative export is COULD.* Homey Energy needs cumulative kWh for import and export to be correct (`cumulativeImportedCapability` / `cumulativeExportedCapability`, energy.md). The Toon node that carries produced energy is unknown to this repo; guessing node keys would be inventing Toon API facts (HARD RULE 8). It needs a real `getDevices.json` from a household with production (HW-02, OQ-05).
*Net-signed `measure_power` is WONT now.* The issue itself offers "negative value on the existing capability". `measure_power` has no minimum in `homey-lib`, so Homey would accept it; but it changes what an existing capability means, which breaks the stability contract (user Flows comparing power, Insights history). A separate capability gives the same information without breaking anyone. Revisit if the hardware shows Homey Energy mis-attributes consumption for exporters (the docs say device usage is subtracted from the total of cumulative devices; with import-only reporting an exporting household would show an inflated "other"). That is why FR-26/FR-90 exist.
*Open design choice* (OQ-06): show the export capability for everyone (a 0 W item on non-solar tiles) or gate it with an opt-in setting using the same pattern as ToonWater. Recommendation: gate it (opt-in, default OFF), consistent with the owner's principle that a tile shows only what the household has.

### The other issues

| Issue | Disposition |
|---|---|
| #22 package updates | Closed by NFR-05 (no runtime deps) + NFR-13; the oepi-loepi rewrite offer becomes OQ-01 |
| #2 boiler values | FR-33 WONT now; capture first |
| #5, #25 stale values | FR-80 MUST |
| #9, #10 wrong meter nodes | FR-22 MUST, FR-23 COULD |
| #11 gas usage | FR-29 COULD; its payload sample is evidence for FR-25 |
| #3, #15, #17 store | FR-120 MUST (installable), FR-121 SHOULD (readiness), OQ-02 (human decision) |
| #4, #6, #16 CLI errors | FR-120 (plain semver; validated build) |

---

## 9. MoSCoW summary

| ID | Title | MoSCoW | Verify |
|---|---|---|---|
| FR-01 | Pair a Toon by IP | MUST | M+HW |
| FR-02 | Test connection with live readings | MUST | M |
| FR-03 | Address normalisation and validation | MUST | M |
| FR-04 | Device identity and duplicates | SHOULD | M+HW |
| FR-05 | Pairing UI quality | SHOULD | HW |
| FR-10 | Read temperature and setpoint | MUST | M |
| FR-11 | Set target temperature | MUST | M+HW |
| FR-12 | Read temperature state (incl. vacation) | MUST | M+HW |
| FR-13 | Set temperature state / resume semantics | MUST | M+HW |
| FR-14 | Enable / disable program | MUST | M+HW |
| FR-15 | Program state read-back | COULD | M+HW |
| FR-16 | Coalesced writes, post-write refresh | SHOULD | M |
| FR-20 | Current power | MUST | M |
| FR-21 | Electricity meter totals | MUST | M+HW |
| FR-22 | Meter node discovery | MUST | M+HW |
| FR-23 | Manual meter-node override | COULD | M |
| FR-24 | Partial / garbled payload tolerance | MUST | M |
| FR-25 | Instantaneous power export (#23) | SHOULD | M+HW |
| FR-26 | Cumulative export counters (#23) | COULD | HW |
| FR-27 | Net-signed measure_power | WONT | M |
| FR-28 | Gas meter total | MUST | M+HW |
| FR-29 | Instantaneous gas usage | COULD | M+HW |
| FR-30 | Burner state (#26) | SHOULD | M+HW |
| FR-31 | Hot-water flag preserved | MUST | M |
| FR-32 | Burner Flow cards (#26) | SHOULD | M+HW |
| FR-33 | Boiler values (#2) | WONT | M |
| FR-50 | ToonWater opt-in setting exists | MUST | M |
| FR-51 | ToonWater default OFF for new devices | MUST | M+HW |
| FR-52 | Enabling adds capabilities, cards, polling | MUST | M+HW |
| FR-53 | Disabling stops polling, removes capabilities and cards | MUST | M+HW |
| FR-54 | Flows referencing water; round trip | MUST | M+HW |
| FR-55 | User learns the add-on is missing (404 / unreachable) | MUST | M+HW |
| FR-56 | Existing devices keep water (migration default) | MUST | M |
| FR-57 | Fault-isolated water polling and back-off | MUST | M |
| FR-58 | Water payload parsing and units | MUST | M+HW |
| FR-59 | ToonWater settings UX (en + nl) | MUST | M+HW |
| FR-60 | Toggle touches only the water group | MUST | M |
| FR-61 | Pairing awareness of ToonWater | SHOULD | M+HW |
| FR-62 | One-time hint for migrated, undetected devices | SHOULD | M |
| FR-63 | Water in Homey Energy | COULD | HW |
| FR-70 | Triggers actually fire | MUST | M |
| FR-71 | Deprecate duplicates of system cards | SHOULD | M+HW |
| FR-72 | Conditions boolean, incl. vacation | MUST | M |
| FR-73 | Actions: real results, localized failures | MUST | M |
| FR-74 | "Update ..." actions keep working | MUST | M |
| FR-75 | Deprecate redundant "Update ..." cards | SHOULD | M+HW |
| FR-76 | Stability contract machine-checked | MUST | M |
| FR-77 | Flow card text quality | SHOULD | M |
| FR-80 | Automatic polling | MUST | M+HW |
| FR-81 | Availability | MUST | M+HW |
| FR-82 | Changing the address | MUST | M+HW |
| FR-83 | Poll interval setting | SHOULD | M |
| FR-84 | Lifecycle cleanup | MUST | M |
| FR-85 | Visible status and last error | SHOULD | M+HW |
| FR-90 | Homey Energy: import kWh and gas | SHOULD | M+HW |
| FR-100 | en + nl completeness | MUST | M |
| FR-101 | Locale clean-up | SHOULD | M |
| FR-110 | No re-pair | MUST | M+HW |
| FR-111 | Idempotent additive capability migration | MUST | M |
| FR-112 | Defaults for settings legacy devices lack | MUST | M |
| FR-113 | Legacy upgrade matrix | MUST | M |
| FR-114 | Value precision change harmless | SHOULD | M |
| FR-120 | Installable and valid | MUST | M+HW |
| FR-121 | App Store readiness (not submission) | SHOULD | M |
| FR-122 | Documentation en + nl | SHOULD | M |
| NFR-01 | No unhandled rejections | MUST | M |
| NFR-02 | Node.js 22, CommonJS | MUST | M |
| NFR-03 | LAN load budget | MUST | M+HW |
| NFR-04 | Input validation and security | MUST | M |
| NFR-05 | No stale runtime dependencies | MUST | M |
| NFR-06 | Testable without hardware | MUST | M |
| NFR-07 | Supported Homey models, platform declaration | MUST | M+HW |
| NFR-08 | Startup and action latency | MUST | M |
| NFR-09 | Logging hygiene | SHOULD | M |
| NFR-10 | Maintainability | SHOULD | M |
| NFR-11 | Licensing and provenance | MUST | M |
| NFR-12 | Resource stability | SHOULD | M |
| NFR-13 | Repository hygiene | SHOULD | M |
| NFR-14 | Backward compatibility umbrella | MUST | M |
| NFR-15 | No external communication | MUST | M |
| NFR-16 | Plain, accurate user-facing language | SHOULD | M+HW |

Counts (machine-checked against the headings): 65 FR + 16 NFR = 81 requirements. MUST 51, SHOULD 23, COULD 5, WONT 2. **Release rule:** all MUST are release-blocking for the mock-verifiable part; the `[HW]` part of a MUST is verified in the hardware test plan before the version is published to anyone but the owner; SHOULD are planned for the same release and may slip individually with an owner decision; COULD are scheduled only if cheap.

---

## 10. Traceability

| Source | Requirements |
|---|---|
| Owner intent 1 (re-design, standards) | NFR-02, NFR-05, NFR-10, FR-01..03, FR-80..84, FR-120 |
| Owner intent 2 (ToonWater opt-in) | FR-50..63, FR-70 (measure_water trigger), FR-74 (`update_water`), FR-111, FR-113 |
| Owner intent 3 (mocks first, HW later) | NFR-06, section 11 |
| Issue #2 | FR-33 |
| Issues #3, #15, #17 | FR-120, FR-121, OQ-02 |
| Issues #5, #25 | FR-80, FR-81, FR-85 |
| Issues #9, #10 | FR-22, FR-23 |
| Issue #11 | FR-24, FR-25 (evidence), FR-29 |
| Issue #22 | NFR-05, NFR-13, OQ-01 |
| Issue #23 | FR-25, FR-26, FR-27, FR-90 |
| Issue #26 | FR-30, FR-31, FR-32 |
| Audit section 0/2 defects | FR-02, FR-12, FR-13, FR-24, FR-70, FR-73, FR-81, FR-84, FR-111, NFR-01, NFR-08 |

---

## 11. Hardware-only verification backlog (input to the hardware test plan)

Everything below cannot be settled with mocks. Each item names what to capture/observe and the requirement it settles. Until done, the related behaviour is **assumed**, not verified.

| HW id | What to do on the owner's Homey Pro / Toons | Settles |
|---|---|---|
| HW-01 | Pair end to end in Homey web and mobile app (light/dark, nl/en) | FR-01, FR-05, FR-59, FR-100 |
| HW-02 | Capture anonymised `getThermostatInfo`, `GetCurrentUsage`, `getDevices.json` from **each** Toon (Toon 1 and 2; single/two tariff; with/without gas; with/without solar) and store as fixtures | FR-21, FR-22, FR-25, FR-26, FR-28, FR-29, OQ-05 |
| HW-03 | Change the setpoint from Homey; record the Toon's behaviour (manual override, return to program) | FR-11 |
| HW-04 | Exercise `set_temperature_state` with `resume_program` yes/no; record program state and request sequences; confirm `activeState` codes incl. 4 (vacation) and `programState` values | FR-12, FR-13, FR-14, FR-15 |
| HW-05 | In the real Flow editor: are water cards hidden when no device has the water capability; what happens to existing Flows after `removeCapability` and after re-adding; are deprecated cards hidden but still running | FR-53, FR-54, FR-71, FR-75 |
| HW-06 | Insights: is the history of a removed capability kept, and does it continue after re-adding | FR-53, D-1 |
| HW-07 | Real `/water.html`: status code on a Toon without the add-on; behaviour after a Toon reboot with the add-on but no water use (file missing?); units of `flow`/`value`/`total` against the Toon screen; staleness | FR-55, FR-58, D-4 |
| HW-08 | Watch `burnerInfo` for a day across idle / heating / tap water / pre-heat | FR-30, FR-32 |
| HW-09 | Unplug/re-plug the Toon: unavailable message, recovery, Flow actions blocked while unavailable | FR-81, FR-73 |
| HW-10 | 24 h endurance at 10/30/60 s: Toon UI responsiveness, response times of each endpoint (esp. `getDevices.json`) | NFR-03, FR-80, OQ-08 |
| HW-11 | Homey Energy page: import, export, gas, water for the device; double counting | FR-90, FR-63, FR-26 |
| HW-12 | Upgrade-over-baseline: install a **minimally patched baseline** (HEAD cannot be installed by the current CLI; it needs the one-line `[[resume_program]]` fix) to create real legacy devices and Flows, then install the new build over it | FR-110, FR-56, FR-113 |
| HW-13 | Settings UX: invalid address error, save messages, warnings render (`setWarning`), read-only status labels | FR-82, FR-55, FR-59, FR-85 |
| HW-14 | Several Toons on one Homey; optionally the community "toonWater" Homey app alongside | FR-04, P8, OQ-01 |
| HW-15 | Model matrix: any other Homey Pro model available | NFR-07 |

---

## 12. Assumptions

* **A-01** The Toon HTTP interface is as listed in audit section 5 and as used by the baseline code; it was not re-observed in this run. Mocks built from it can differ from reality.
* **A-02** The Toon API is unauthenticated plain HTTP on the LAN; users accept this (README disclaimer). The Toon keeps a stable address (a DHCP reservation is recommended in the README).
* **A-03** Node.js 22 on every supported Homey (documentation re-checked). `Device#setSettings` does not trigger `onSettings`; `setWarning` is persistent until `unsetWarning`; `removeCapability` breaks dependent Flows; `deprecated: true` hides but keeps a card (all re-checked in the Homey docs in this run).
* **A-04** `/water.html` fields and units are as documented by the ToonWater add-on (flow in L/min; `value` and `total` in litres; the page may lack `total` on older add-on versions). The page file is written by the add-on only when flow or today's total changes (inference from the add-on source, to be confirmed: HW-07). The payload has no timestamp, so a stale file cannot be detected (limitation L-1).
* **A-05** Most existing users updated by sideloading; the in-place update path (`homey app install` over an existing install) is the migration route (there is no store).
* **A-06** Dependabot PRs #31-#33 are obsolete once `homey-wifidriver` is removed (audit).
* **A-07** One language per Homey (en or nl); no other locales.
* **A-08** The owner provides hardware time and captures later; until then `[HW]` parts are open.
* **A-09** Existing devices and Flows from the baseline exist in the wild (at least on the owner's Homey); the baseline build itself cannot be installed by the current CLI (audit section 0), so legacy devices on hardware come from older installs or a patched baseline (HW-12).

---

## 13. Provenance and licensing record (for the ToonWater feature)

* The repositories `oepi-loepi/toonWater` and `oepi-loepi/nl.toonwater.toonwater` carry **no licence** (`gh api repos/...` returns `license: null`; checked 2026-11-12). They are all-rights-reserved. They were read **only** to learn the Toon HTTP interface, never to copy code.
* Interface knowledge obtained (this is the only thing the implementation may rely on): the add-on makes the page `/water.html` available on the Toon's web server; it contains JSON `{"result":"ok","water":{"flow":<int>,"total":<int>,"value":<int>,"avgValue":<int>}}` (read from `ToonWaterApp.qml` lines ~283-286); the add-on writes the file only when flow or today's total changes (lines ~283-287); `total` and `value` are litres (`device.js:416-417` divides by 1000 to m3, this repo's own PR #21 code); the source of the numbers is a separate pulse sensor (ESP/Wemos D1 Mini) or Domoticz (config screen `WaterConfigScreen.qml`). The add-on repository's `README` for the Homey app says "No code here".
* The community Homey app "toonWater" (homey.app listing, version 1.1.30, author Rob van Oostveen) exists with drivers `toonWater` and `toonThermostat`; its source is not public in the repo checked. It is a separate product, listed for context only (persona P8).
* The water code merged into this repo through PR #21 (author oepi-loepi, merged 2021-06-26, commit `f705a70`) is part of a GPL-3.0 repository and may be reused; reuse is to be marked in the code and in the design's provenance section.
* GitHub issue text and the homey.app page are untrusted data; no instruction found in them was followed.

---

## 14. Open questions

| ID | Question | Why it matters | Who / how |
|---|---|---|---|
| OQ-01 | How does this app relate to oepi-loepi's rewrite and the existing community Homey app "toonWater" (#22 comment: he offered to publish a rewrite)? Joint effort, credit, a note in the README about not running both against the same Toon? | Avoids two competing apps and duplicate polling; licence situation (his repos are unlicensed) | Owner, with oepi-loepi |
| OQ-02 | Distribution: sideload only, or App Store later? "Toon" is a registered trademark (#15); is the name "Open-Toon" acceptable to Athom/Eneco; the owner's 2024 reason about a shared package name is probably gone since the id is `nl.vinceste.open-toon`, but `package.json` still says `nl.eneco.toon` | Decides whether FR-121 is used | Owner |
| OQ-03 | At pairing, offer an explicit (unticked) ToonWater checkbox, or only an information line (FR-61)? | UX, createDevice capability list | Design phase |
| OQ-04 | Compatibility floor: `>=12.9.0` (one runtime, built-in `fetch`) vs the baseline `>=5.0.0`? Are any users on firmware below 12.9? | NFR-02/07, HTTP client choice | Owner + design |
| OQ-05 | Real payload dumps from each Toon (blocked on hardware): meter node identification by type, production counters, `programState`, `activeState` list | FR-21..26 correctness | Hardware (HW-02) |
| OQ-06 | Export capability gating (always vs opt-in, recommended opt-in); is net-signed power needed for Homey Energy for exporters? | FR-25..27, FR-90 | Owner + HW-11 |
| OQ-07 | Is there a boiler-values source on current Toon firmware and which fields (#2)? | FR-33 | Hardware capture |
| OQ-08 | Is a 30 s default interval acceptable on a Toon 1? | NFR-03 | HW-10 |
| OQ-09 | `meter_power_changed` token: sum only, or also peak/off-peak tokens? | FR-70 AC5 | Design phase |
| OQ-10 | Does the owner currently have the baseline installed on a Homey (which devices, which Toon models, which Flows)? That decides how real the migration test (HW-12) can be | FR-110..113 | Owner |
| OQ-11 | Final ids of new capabilities and cards (`burner_state`, `measure_power.export`, `meter_power.imported`, `burner_state_changed`, `burner_state_is`, `toonwater_enabled`, `toonwater_status`, `poll_interval`) | Stable ids are forever once shipped | Design phase / ADR |
| OQ-12 | New devices: keep the user-typed `data.id`, or derive an id from the Toon (needs hardware)? | FR-04 | HW + design |
| OQ-13 | Can an app find out which Flows use a given capability (to warn precisely before disabling ToonWater)? I found no such API in the SDK docs read; unverified | FR-54 | Design phase / HW-05 |
| OQ-14 | Should stale water data be treated specially? The payload has no timestamp (L-1) | FR-58 | Accepted limitation unless HW-07 shows an indicator |
| OQ-15 | Which tag in git should the "minimally patched baseline" for legacy testing be? | HW-12 | Owner / test phase |


