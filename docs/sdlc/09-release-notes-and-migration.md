# 09 - Release notes and migration: Open-Toon 2.0.0

| | |
|---|---|
| Role | Technical writer / release engineer |
| Date | 2026-11-14 |
| Repo state | branch `redesign/sdk3`, base `5cc3b90` (= `Develop`), working tree only: nothing is committed, pushed or tagged |
| Inputs | the code (`lib/`, `drivers/`, `app.js`, `.homeycompose/`), `04-compat-contract.md`, `05-architecture.md`, ADR-0004, 0006, 0007, 0009, 0010, 0014, 0016, 0017, 0018, `08-test-report.md`, the Homey App Store guidelines that ship in the devDependency `homey-lib` (`lib/AIReviewer/data/guidelines.md`, checklist) |
| Audience | the owner (release decision), existing users (sections 1 to 8), contributors (sections 9 to 11) |
| Status | The documentation is complete. The code is verified against mocks, and on 2026-11-15 and 2026-11-17 it also ran on one Homey (a Homey Self-Hosted Server, firmware 13.5.4) with a simulated Toon (`13-self-hosted-test-report.md`). **No real Toon was involved**; every statement about what a Toon does is read from descriptions or from the design, and a statement about what Homey does is read from the Homey documentation or from the design unless `13` observed it. Both are marked in section 9 or 10 when only hardware can settle them. |

Short names: `FR-xx`, `NFR-xx`, `HW-xx` = `01-requirements.md`; `R-xx`, `U-x` = `04-compat-contract.md`; `O-x` = `08-test-report.md` section 8.3; `ADR-xxxx` = `docs/adr/`.

---

## 1. At a glance

Open-Toon 2.0.0 is a rebuild of the app for Homey SDK 3 (Node.js 22), with the same app id (`nl.vinceste.open-toon`), the same driver (`open-toon`), the same capabilities, the same Flow cards and the same setting for the address. **Existing devices and Flows carry over without being added again.** What is new:

* The app reads the Toon by itself every 30 seconds (setting: Update interval, 10 to 3600). Flows with an "Update ..." card are no longer needed.
* **ToonWater is an opt-in, per device** (setting "Enable ToonWater water meter"). Off: no water items, no requests for `/water.html`, no water entries in the Flow editor. On: all three. Devices that already had water items keep them and have the setting switched on; nothing is removed by the upgrade.
* New: the state of the boiler burner (capability and three Flow cards), the Vacation state (shown, not settable from Homey), optional power export (second opt-in setting).
* Update cards now fail when the Toon cannot be reached; Flow triggers that never fired before now fire; gas and electricity totals have three decimals; some cards are hidden (deprecated) but keep working.
* The app needs Homey firmware 12.9.0 or newer and runs on Homey Pro (Early 2023), Homey Pro (2016-2019) and Homey Pro mini. It is installed with the Homey command line tool; it is not in the App Store.

What you must do as an existing user: install with `npx homey app install` (never `homey app run`, never `--clean`), then look at the settings of each device once (section 5), and check Flows that you built on the cards of section 6 and 7.

---

## 2. Before you upgrade

| # | Step | Why |
|---|---|---|
| 1 | Check the firmware of the Homey: 12.9.0 or newer | A Homey below the floor keeps the old build; 2.0.0 cannot be installed there (ADR-0004). There is no evidence that anyone runs such a Homey (OQ-04). |
| 2 | Write down or screenshot your devices, their names and zones, and the Flows that use the Toon's cards, especially the ones with water | Homey does not downgrade an app (`04` section 6, [D] app-store/updates.md); if something does not behave as described, this is what you compare with. The old build cannot even be installed again from this repository: the baseline manifest fails `homey app validate` (`01` assumption A-09). |
| 3 | Do **not** use `homey app run` on the Homey that holds your devices | Stopping it with Ctrl+C uninstalls the app, and with it the devices (R-31, [D] homey-cli.md) |
| 4 | Do **not** add `--clean` to `homey app install` | It deletes all user data, paired devices and settings of the app (R-31) |
| 5 | Install with `npm ci --ignore-scripts`, `npx homey login`, `npx homey select`, `npx homey app install`; Node.js 24 or newer for the Homey command line tool | Version 2.0.0 is higher than any build that was installed before (all three earlier builds said `1.0.0`), which Homey requires for an update from the App Store (`04` rule 10; for a sideload the documentation says nothing, U9) |
| 6 | Optional but wise on the first Homey: install a *test* copy first with a spare Toon device, or wait for the hardware report | The in-place update has not been run on a real Homey (HW-12) |

---

## 3. What changed for existing users

Legend: **Flows** = a Flow of yours can behave differently; **Look** = what you see on the tile or in settings; **Data** = what Insights or Energy records.

| Change | Who sees it | Kind | What to do |
|---|---|---|---|
| The app reads the Toon itself at the Update interval (default 30 s) | everyone | Look, Data | Nothing. Flows that only refresh values (timer plus "Update ...") can be removed. |
| New settings: Update interval, Status (last update, last problem), ToonWater, Power export | everyone | Look | Look at them once. |
| **ToonWater is a setting per device** | everyone; see section 5 | Look, Flows, Data | Check the setting of each device. |
| The update cards now fail with a clear message when the Toon cannot be reached (they used to do nothing silently) | users with timer Flows | Flows (R-09) | Fix the connection; a Flow that chains several update cards now stops at the first failing one. |
| Triggers that never fired now fire when their value changes: gas meter, power meter, water flow (while ToonWater is on), hot water dispensing | users who built Flows on them | Flows (R-11, R-13) | Check those Flows: they will start to run. The first value after a start never fires. |
| `temperature_state_changed` is a trigger that Homey itself fires for the temperature state; the app does not fire it | users of that trigger | Flows (R-12) | Nothing, if Homey fires it as documented; see limitation 5 |
| The power meter trigger delivers kWh with three decimals, peak and off-peak added together | users of that trigger | Flows | The token title now says kWh (it said Wh; the unit is kWh). |
| Gas and electricity totals have three decimals instead of whole numbers | everyone | Data (R-20) | Insights graphs step once to the finer value; the totals never go down because of this. |
| Device items `Burner` (off, heating, hot water, pre-heating) added; Flow cards "Burner state changed", "Burner state is" | everyone | Look | New cards, nothing breaks. Not logged in Insights; use the trigger. |
| The state **Vacation** is shown on the tile and in "Temperature state is"; it cannot be set from Homey | people who use vacation mode on the Toon | Look | Choosing it on the tile shows a message. Before, a Toon in vacation mode wrote an empty value. |
| `meter_power` (the single electricity total of version 0.0.1) is kept but no longer updated | devices paired with 0.0.1 only | Data | Use the peak and off-peak totals. It held one day's use, not a meter total (ADR-0014). |
| A lower meter reading is accepted only after three readings in a row show it; 0, empty or invalid readings are never accepted | everyone | Data | After a meter replacement Homey Energy may show one odd interval (ADR-0014). |
| A setpoint that the Toon reports off the 0.5 degree step (for example 19.75) is shown rounded to 0.5 | everyone | Look | Nothing; the capability steps by 0.5. |
| "Set temperature state" shows its "Program" choice again (it was missing from the card text since 2023); an unset choice counts as "resume program afterwards", the behaviour the app always had | people who made the Flow since 2023 | Flows (R-18) | Nothing. See limitation 2 about "Disable program". |
| The address setting is checked: an IPv4 address or a host name, with or without `http://` and a port; `https://` and IPv6 are refused with a message. The stored value is never rewritten | everyone | Look | Enter the address as the hint says. |
| Update interval is read defensively: a device from an old version has no value and uses 30 s | legacy devices | - | Nothing. |
| Pairing has a new screen with a live connection test, and offers ToonWater only when it is found. A new device is named after the Toon id unless you give a name (before: `ToonDevice`). | new devices | Look | Devices that exist keep their names, including `ToonDevice`. |
| Needs Homey firmware 12.9.0 or newer; Homey Cloud and Homey Bridge remain unsupported | everyone | - | See section 2 |
| Dependencies, committed `node_modules`, the old libraries (`homey-wifidriver`, `request-promise-native`, `homey-log`) are gone; the app talks to the address of your Toon and to nothing else | contributors | - | `npm ci --ignore-scripts` for the tooling |

---

## 4. How the upgrade behaves per device era

Three different builds carry the version `1.0.0` and four eras of devices exist (`04` section 2), so the version number cannot tell them apart. The app looks at what a device **has** (its capabilities) and at one marker in the device store (`migrationVersion`), which only devices from before 2.0.0 lack. It runs on the first start of the device, never waits for the network, and only **adds**: it never removes a capability, a setting or a Flow reference (ADR-0010, `lib/engine/capabilities.js:30`, `:156`). If it fails halfway, the device keeps working and the next start tries again.

| Era (how to recognise your device) | Items on the tile before | Added by the upgrade | ToonWater after the upgrade | What you see afterwards |
|---|---|---|---|---|
| **0**: paired with 0.0.1 (Dec 2018 to Feb 2019); has one "Power meter" total | 6 | Power meter peak and off-peak, Hot water dispensing, Burner | **Off** | The old single total stays but stops updating. No water items, no requests for `/water.html`. |
| **1**: paired between Feb 2019 and mid 2021 (no water items, no hot water item) | 7 | Hot water dispensing, Burner | **Off** | No water items; you can switch ToonWater on in the settings. A Flow that chained "Update water" keeps running (it resolves without doing anything, ADR-0018). |
| **2**: paired from mid 2021: has Water flow, Water today and Water meter total, but no Hot water dispensing | 10 | Hot water dispensing, Burner | **On** (preserved) | Water items, values, Insights history and Flows are untouched. See 5.3 for a Toon without the add-on. |
| **3**: paired with a 2023 build, or an era 2 device that ran it: also has Hot water dispensing | 11 | Burner | **On** (preserved) | As era 2. |
| **New device** paired with 2.0.0 | 9, plus the three water items if you tick the box when ToonWater is found | - | **Off** unless ticked | The pairing screen sets the marker. |

For all four eras: the device keeps its id, name, zone, class (`thermostat`), settings (`address`) and Insights logs. The `energy` setting of the driver (`cumulative: true`) is byte-identical to before, so Homey Energy treats the device exactly as it did (ADR-0016; `npm run validate` prints two warnings about it, see limitation 7). A device that was only partly migrated or hand-edited (some water items present, not all) is treated like era 2 and gets the missing items. Items you added yourself or that this version does not know are kept. A device that already ran the 2023 build has Hot water dispensing whatever its era; in every case the upgrade adds only what is missing.

A device whose address is still `0.0.0.0` or empty (never filled in) becomes unavailable with the message "Set the IP address of your Toon in the device settings"; when you enter a valid address, it starts without a restart.

---

## 5. Water data, Flows and the ToonWater setting

### 5.1 What ToonWater is, and what it is not

ToonWater is the community add-on that runs on the Toon and serves `/water.html`. Three items depend on it: Water flow (`measure_water`), Water today (`meter_water.today`) and Water meter total (`meter_water.total`), and, with them, the old cards "Update water" and the app's "The water flow changed".

**Hot water is not ToonWater.** "Hot water dispensing" (`alarm_water.hotwater`), the card "Hot water is dispensing" and the trigger "The hot water dispensing is changed" are read from the thermostat answer (`burnerInfo`), work on every device and are never touched by the setting (`04` R-36).

### 5.2 The decision at the upgrade, and why

| Your device before | ToonWater after | Water items | Requests for `/water.html` |
|---|---|---|---|
| none of the three water items (eras 0, 1) | off | none | none |
| all three, with values or without (eras 2, 3) | on | kept as they are | yes, see 5.3 |
| some of the three | on | the missing ones are added | yes |

The decision uses the capability list only, never the network and never the default of the new setting (it is not documented whether Homey fills in defaults of new settings on devices that already exist, U3). So a device with water items and no add-on is **kept as it is** instead of being cleaned up: the alternative, removing the items of devices whose page is missing, could break Flows and delete Insights history, and the owner's rule is that existing users do not lose water data or Flows (ADR-0006, `04` section 7.4). The price: such a device keeps empty water items until the user switches the setting off.

### 5.3 A device with water items and no ToonWater on the Toon (the likely majority of eras 2 and 3)

* The status line in the settings says "Not found on this Toon (HTTP 404)".
* The app asks for the page once at the start and then every 15 minutes: at most 97 requests per 24 hours (95 measured with the mock, `08` O-2). This is the one place where "no 404 noise" is not literally true; it follows from "do not take anything away from existing users".
* If the device never held a water value, the tile shows **no warning**; instead Homey shows **one notification** after 24 hours of not finding it, naming the device and where to switch ToonWater off. The 24 hours survive a restart of the app (ADR-0018, `lib/features/toonwater.js:112-113`). If the device did hold a value once, a warning on the tile says "ToonWater is enabled but was not found on this Toon".
* If you do not use ToonWater: open the device settings and switch **Enable ToonWater water meter** off (see 5.4 for the consequences).

### 5.4 Switching ToonWater off or on yourself

| You do | The app does | Consequence |
|---|---|---|
| Switch **on** (add-on installed) | adds the three water items, asks the Toon once, shows the status, starts polling `/water.html` | New Insights logs start; Homey's own cards and tags for the items appear. A 404 does not undo the switch: a fresh add-on may not have written its page yet. |
| Switch **off** | removes the three items, stops polling, sets the status to Off, tells you what it did | **Flows that use the items break and their Insights history may be lost** (Homey's documented behaviour for a removed capability; whether the history survives is not documented, `04` U5). The data itself is not lost: today's and total water live in the add-on. |
| Switch off, then on again | adds the items again under the same ids and titles | A Flow that used them may work again; whether Homey repairs it by itself, and whether the history comes back, is **not verified** (HW-05, HW-06). Check your Flows after every change. |

The hint of the setting, the message after saving and the README say the same thing, in English and Dutch. After a user's choice, `update_water` on a device with ToonWater off rejects with "ToonWater is not enabled for this device"; on a device that the upgrade switched off (eras 0, 1) it does nothing and resolves, so Flows from the time before 2.0.0 keep running.

### 5.5 What the Flow editor shows

* The app's own water cards ("Update water", "The water flow changed") are **deprecated**: hidden from the card list, still running in Flows that already use them (ADR-0007). They are hidden whether ToonWater is on or off.
* With ToonWater on, Homey itself adds its cards and tags for the three water items (for the water flow, for example, a trigger when it changes); with it off they disappear with the items. This is Homey's own mechanism; what the editor shows exactly has **not been checked on a real Homey** (`08` O-7, HW-05).
* "Update now" refreshes every part that is on, so it also refreshes the water readings while ToonWater is on.

### 5.6 What the app never does

It never switches ToonWater off by itself (a Toon that reboots, an add-on that is not installed or answers with an error only changes the status text and slows the requests), never edits a Flow, and never asks for water data while the setting is off.

---

## 6. Deprecated cards

A deprecated card is hidden from the "add card" list; Flows that already contain it keep running, with the same arguments and tokens (Homey documentation, `04` section 6). Nothing was removed or changed in its construction. Contract test: `test/static/contract.test.js` (CT-01).

| Card | Kind | Replacement | Behaviour in 2.0.0 |
|---|---|---|---|
| Update power usage (`update_powerusage`) | action | "Update now" | Refreshes the power reading; fails if the Toon is not reachable |
| Update meter totals (`update_metertotals`) | action | "Update now" | Refreshes the meter totals; fails if the Toon is not reachable |
| Update water (`update_water`) | action | "Update now" | ToonWater on: refreshes the water reading, a missing page never fails it. Off: rejects for devices where you switched it off, does nothing for devices that the upgrade switched off (5.4). |
| The gas meter changed (`meter_gas_changed`, app card) | trigger | Homey's own gas meter trigger | Now fires when the gas total changes |
| The water flow changed (`measure_water_changed`, app card) | trigger | Homey's own card for the water flow item | Fires while ToonWater is on |

"Update status" became **Update now** (same id `update_status`): it refreshes everything that is on, and fails only when the thermostat part fails.

---

## 7. Flows that behave differently

| Flow pattern | Before | Now | What to do |
|---|---|---|---|
| Timer, then "Update ..." cards, then use of the values | Cards always succeeded, even when the Toon was down | Cards fail with a message when the Toon cannot be reached, so the Flow stops there | Remove the timer Flow (the app polls) or accept the stop |
| Many timer Flows calling update cards at once | Each sent its own requests | Requests for the same part are joined into one | Nothing |
| Trigger "The gas meter changed" / "The power meter changed" / "The hot water dispensing is changed" that never ran | Never ran | Runs when the value changes | Check that the Flow does what you want |
| Trigger on the water flow | Never ran | Runs while ToonWater is on | As above |
| "Temperature state is ..." with `none` | Valid choice | Still valid; `vacation` is a new choice | Nothing |
| "Set temperature state" with the Program choice unset | Behaved as "resume program afterwards" | The same; the choice is visible again | Nothing |
| Insights graph of gas and electricity | Whole units | Three decimals | Nothing |

---

## 8. Settings and defaults of an upgraded device

| Setting | Key | Default on an upgraded device | Notes |
|---|---|---|---|
| IP address | `address` | what you entered | Unchanged key; read normalised, never rewritten |
| Update interval | `poll_interval` | 30 s (read as default while the stored value is missing) | 10 to 3600 |
| ToonWater | `toonwater_enabled` | decided once by the migration (section 4) | An explicit user choice is never flipped back |
| Power export | `export_enabled` | off | Adds `measure_power.export` (W), read from the power answer; not yet seen on an exporting household's Toon (ADR-0016) |
| Last update, Last problem, ToonWater status | `last_update`, `last_problem`, `toonwater_status` | "-" until the first reading | Read-only labels |

Not changed on purpose: `data.id`, device names and zones, class `thermostat`, the `energy` block, all capability ids and Flow card ids, argument names and dropdown values (`test/static/contract.test.js`, ADR-0017 records the one allowed exception: the three water ids left the driver's default list but stay on every device that has them).

---

## 9. Known limitations

1. **Nothing was run on a real Toon, and only one Homey model was tried.** The app has run on a Homey Self-Hosted Server (firmware 13.5.4, Node.js 24) with a simulated Toon (`13-self-hosted-test-report.md`); Homey Pro (Early 2023 and 2016-2019) and Homey Pro mini are untried. Every Toon answer in the tests is derived from descriptions (`source: "derived ..., not captured; HW-02"`), the meter discovery for the second Toon generation (`dev_3.x`) rests on medium-confidence type names, and the fake Homey encodes our reading of the Homey documentation. Which Toon and Homey models work is open (HW-02, HW-15); the hardware items are in `08-test-report.md` section 10 and `01-requirements.md` section 11.
2. **"Set temperature state" with "Disable program" is a placeholder.** It sends `state=0` with the preset (ADR-0015); on a real Toon it may not switch the program off the way the label says. "Resume program afterwards" is the proven behaviour of the old app (HW-04).
3. **Vacation cannot be set from Homey.** It can be shown and tested in Flows. The tile's picker lists it; choosing it shows an error message and changes nothing (ADR-0014).
4. **A user's "ToonWater off" destroys Flows and may delete history** (5.4). Whether switching on again repairs them is unknown (HW-05, HW-06).
5. **`temperature_state_changed`** is left to Homey, which is documented to fire "changed" triggers for custom capabilities. If hardware shows that it does not, the card is dead for Flows until a one-word change in `lib/features/core.js` (`08` O-6, `04` HW-06).
6. **No non-deprecated app card about water** exists (ADR-0007). The owner's "water cards appear when ToonWater is on" is met only by the cards that Homey generates for the water items.
7. **Homey Energy.** The `energy` block is byte-identical, so `npm run validate` prints two warnings (no `cumulativeImportedCapability` / `cumulativeExportedCapability`). The electricity total is therefore not offered to the Energy tab by this release; doing so changes the accounting of every upgraded device at once and waits for HW-11 (ADR-0016). Whether Homey's Energy tab mistakes `meter_water.today` for the home's water meter is unknown (`04` U10).
8. **Recovery after an outage** can take a few minutes (the back-off cap is 5 minutes; 60 to 90 s measured with the mock, `08` O-1; on the Self-Hosted Homey the device became unavailable after 2 min 8 s and recovered by itself, but the recovery time there was not measured because the test Mac slept, `13` section 2). The device is marked unavailable after about two minutes of silence at the default interval.
9. **Migrated devices without the add-on** send about 95 requests per day for `/water.html` until the user switches ToonWater off (5.3).
10. **Counter policy.** A meter total is accepted lower only after three readings in a row; the count restarts when the app restarts; one odd Energy interval can appear after a meter replacement.
11. **One device per Toon.** Two devices (or another Homey app) for the same Toon double the load; unsupported. The load budget (four requests per 30 seconds, one at a time) is a proposal until the 24-hour endurance run (HW-10).
12. **Not a store app.** The artwork shows a Toon with the supplier's logo on its screen (`03` section 10, item 3) and the name uses the registered-trademark sign; both are unsuitable for an App Store submission, and the trademark question (OQ-02) is the owner's. The package is store-ready in every other respect that a validator can check (`README.txt`, `README.nl.txt`, changelog, `brandColor`, `platforms`, `connectivity`).
13. **Node.js 22 was not run by the tests here.** The development machine runs Node 25; the first CI run (Node 22 for lint and tests, Node 24 for validate and pack) is the Node 22 verification (`08` section 2).
14. **`node_modules` is still tracked in git** until the owner runs the release step of section 11; closing the Dependabot pull requests #31 to #33 is a GitHub action.
15. **The development tooling has advisories** (24 at the last audit, all in the dev dependencies of the Homey command line tool; none is shipped; `npm audit --omit=dev` is clean, `08` section 3).

---

## 10. What only hardware can show (pointer)

This document's claims about Homey depend on the following items; the full list with what to observe is `08-test-report.md` section 10 (numbers `01-HW-xx` and `04-HW-xx`). A sensible order for the first day:

1. Capture the real answers of each Toon (`getThermostatInfo`, `GetCurrentUsage`, `getDevices.json`, `/water.html`) and pair (HW-01, HW-02, HW-07).
2. Switch ToonWater on and off and watch the Flow editor, the tile and Insights (HW-05, HW-06; sections 5.4 and 5.5).
3. Install this build over a real older build, per era, with real Flows (HW-12; section 4).
4. Unplug the Toon and see the message, the recovery time and which cards Homey blocks (HW-09).
5. Exercise "Set temperature state" with both Program choices and Vacation (HW-04).
6. Look at the Energy tab (HW-11) and run the 24-hour endurance test (HW-10).

---

## 11. Release checklist for the owner

Done in this working tree (no git operation was run):

* [x] Version `2.0.0` in `.homeycompose/app.json` (source of truth), `app.json` (generated), `package.json`, `package-lock.json`; the three agree and a test checks it (`test/static/docs.test.js`).
* [x] `.homeychangelog.json` has an English and a Dutch entry for 2.0.0 (the format the Homey command line tool writes).
* [x] `README.md` (English and Dutch), `README.txt` and `README.nl.txt` (App Store texts), `CONTRIBUTING.md`, `docs/ARCHITECTURE.md` and this document.
* [x] `npm run lint`, `npm test`, `npm run validate` and `npm run pack:check` pass (results in section 12).

For you to do:

* [ ] Acknowledge the eight designed deviations from the requirement text in `08-test-report.md` section 9.
* [ ] Run the hardware test plan (section 10) on the Homey Pro and the Toons; write the hardware report. Until then, say "untested" in release communication.
* [ ] `git rm -r --cached node_modules`, then commit (ADR-0011, CONTRIBUTING). Check that `git status` no longer lists `node_modules`.
* [ ] Let CI run once on GitHub (Node 22 and Node 24 jobs).
* [ ] Close the Dependabot pull requests #31 to #33 as obsolete.
* [ ] Decide the artwork and naming question (OQ-02) before any App Store submission; until then, publish as a sideload (`npx homey app install`).
* [ ] Tag `v2.0.0` after the hardware report.

---

## 12. Verification of this documentation

| Check | Result |
|---|---|
| `npm run lint` | passes, no warning (`--max-warnings 0`) |
| `npm test` | passes: 1,433 tests, 262 suites, 0 failed, 0 skipped (Node.js 25; the QA report `08` counted 1,400 before the later tooling tests were added) |
| `npm run validate` | passes at level `publish`; app.json and locales in sync; two Energy warnings (limitation 7). `npm run validate:verified` passes too |
| `npm run pack:check` | passes: 36 files in the bundle; no documentation, test, script or `node_modules` file in it; `README.txt` and `README.nl.txt` are in it |
| `npm run check:requirements` | every mock-verifiable MUST and SHOULD id has a test |
| Store texts | `README.txt` and `README.nl.txt`: two paragraphs each, plain text, no URL, no changelog, no list of features, not equal to the manifest description (Homey App Store guidelines 1.2, 1.3, 1.11) |
| Spelling | English texts of the manifest, locales and these documents were checked against a word list and read twice; Dutch texts were read twice (no Dutch dictionary was available offline). See section 13 |

## 13. Text notes

Typos fixed in the manifest sources (title-only changes; ids, argument names and values are untouched):

* `drivers/open-toon/driver.flow.compose.json`: English token title "Hotwater dispensing" became "Hot water dispensing"; Dutch card title "Update stroom gebruik" became "Update stroomgebruik".
* `drivers/open-toon/driver.settings.compose.json`: Dutch labels "IP Adres" became "IP-adres" (the pairing screen already said "IP-adres") and "Lokale Toon Instellingen" became "Lokale Toon-instellingen".

Left as they are, for the owner to decide, because tests pin them or because existing devices keep the title they were created with:

* Dutch "Warm water afgifte" (capability title), "De warm water afgifte is veranderd" and "Warmwater afgifte" (token): Dutch usually writes this compound as one word ("warmwaterafgifte"), and the three are spelled inconsistently. The capability title is pinned by `test/static/capability-titles.test.js`, and a device keeps the title of the moment it was created unless the migration re-applies options.
* Dutch "Stroom meterstand piek", "Stroom meterstand dal", "Water meter totaal" (also pinned) read better as "Stroommeterstand piek", "Stroommeterstand dal" and "Watermeter totaal"; "Brander-stand" (pinned by `test/static/manifest.test.js`) is usually written "branderstand".

---

## 14. Provenance and credits

* The ToonWater interface (the page `/water.html`, the field names and their units) is described in `03-reuse-inventory.md` section 5 and implemented independently in `lib/features/toonwater.js`, whose header records this. The repositories of `oepi-loepi` carry no licence; no code of them was copied or closely paraphrased. The water code that was already in this repository (pull request 21) is GPL-3.0 and was reused.
* Credits (README, manifest): oepi-loepi (water support), Paul Heeringa, Dennis Moes (moezie; the move to SDK 3 and the hot water flag), Vinceste IT (author). Toon is a trademark of its owner; the project is not affiliated with it.
* Licence: GPL-3.0 (`LICENSE`).
