# 10 - Hardware test plan: Open-Toon for Homey (nl.vinceste.open-toon)

| | |
|---|---|
| Role | Hardware validation planner |
| Date | 2026-11-14 |
| For | The owner (Stefan), who has a Homey Pro and several Toons. Written so that a non-developer can follow it: every step says what to do, what you should see, what to write down, and has a pass/fail box. |
| App under test | version 2.0.0, branch `redesign/sdk3`, base commit `5cc3b90`, working tree (nothing committed) |
| Inputs | `00-architect-audit.md` (sections 5, 6), `01-requirements.md` (sections 11, 14), `04-compat-contract.md` (section 10), `05-architecture.md`, `08-test-report.md` (sections 8, 10), ADR-0004, 0005, 0006, 0007, 0015, 0018, the code under `lib/` and `drivers/` |
| Companion tool | `scripts/toon-probe.js`, a read-only probe that writes a masked JSON file you can paste into a GitHub issue or chat (tests: `test/unit/toon-probe.test.js`). Not part of the app package. |

## 0. Trust, and what was and was not verified when this plan was written

Nothing in this plan has been run on a Homey or a Toon: there was none. It was written against the mock Toon, the fake Homey and the documents of this repository, which are model-generated apart from the code itself.

**Verified in this run (2026-11-14, Homey CLI 4.6.3, Node.js 25.9 on macOS):**

* The CLI commands and flags used below exist, as printed by `--help`: `homey login`, `select`, `list`, `tools`, `app install`, `app run` (with `--remote`, `--clean`, `--network`), `app validate`, `app build`, `api raw --path ... --json`, `api apps get-app | restart-app | uninstall-app | get-app-usage` (each with `--id`), `api devices get-devices`, `api flow get-flows`, `api insights get-logs`. The exact output of the `api` commands was not run (no Homey).
* The CLI 4.6.3 needs **Node.js 24 or newer** (`node_modules/homey/package.json`, `engines.node >=24`). The app itself runs on Node.js 22 on the Homey.
* `homey app run --remote` uploads to the Homey; without `--remote` the app runs in a Docker container on your computer, and `--remote` is the default only for Homey Pro 2019 and earlier (CLI help text). When `run` stops (Ctrl+C), the CLI calls `uninstallApp`, so the app and its devices are removed (`node_modules/homey/lib/App.js` lines 353-380). `homey app install` passes `clean = false` unless you add `--clean`.
* The previous version cannot be installed as it is: `5cc3b90` fails `homey app validate --level debug` with "Missing [[resume_program]] in flow.actions['set_temperature_state'].titleFormatted.en". With the two-line patch of step HT-B.2 it validates, and `homey app build` succeeds when you run it from inside the folder. Running the CLI from another folder with `-p` failed in my test (a folder inside this repository; not tried with a sibling folder), so the plan always changes into the folder first.
* The older SDK 2 builds `380e999` (era 1) and `426e2c2` (era 2) validate with CLI 4.6.3 without a patch. Whether a current Homey accepts to install an SDK 2 app was **not** verified.
* `scripts/toon-probe.js` against the mock Toon over real HTTP: only the four GET requests of the app, one at a time, no redirect followed, personal data masked (33 tests).

**Not verified, and therefore written as "expect" and not as fact:** every screen of the Homey app and the Homey web app (menu names are from memory and change between Homey versions: follow the intent, not the words), where the log of a sideloaded app can be read, what Homey does with Flows and Insights when a capability is removed, every behaviour of a real Toon. The answers to these are what this plan is for (section 15).

**Rules about data.** The files you collect (screenshots, Homey snapshots, probe files) contain your household: names of devices and Flows, meter readings, times. Keep them in a folder outside this repository (never commit them). Share only the probe files, after reading them (Annex 1.3).

## 1. How to use this plan

### 1.1 Order and time

| Block | Phases | Time | Needs |
|---|---|---|---|
| Day 1, morning | A (preparation), B (baseline) | 2 to 3 h, then leave the baseline running for at least 3 h | Homey Pro, one Toon |
| Day 1, afternoon | C (upgrade) | 1.5 h | the baseline of block 1 |
| Day 1, evening | D (pairing), E (tile), F (Flow cards) | 3 h | one Toon, a hot tap, a kettle |
| Day 2 | G (ToonWater), H (offline), I (settings), J (delete) | 4 h | one Toon with and one without the ToonWater add-on if you have them |
| Day 2 evening, then 24 h | L (endurance and load) | 5 min to start; checks every few hours | the probe running on your computer |
| Any time | K (several Toons, other models) | 1 h | a second Toon |
| Last | M (wrap-up) | 30 min | |

**If you have only two hours:** do A.1 to A.7, C.1 to C.5 (on whatever is installed now), D.6, E.1 to E.8, G.4, G.6, H.2, H.5, and start phase L.

### 1.2 How a step looks

**HT-E.2  Set the target temperature from the tile**  (what it proves: FR-11, 01-HW-03)

- **Do:** what to do, in order
- **Expect:** what you should see
- **Record:** what to write down or save
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes: ...

* PASS: everything under Expect happened. FAIL: something did not. N/A: you cannot do the step (say why in Notes).
* **Severity of a FAIL**, write it next to the box: **BLOCKER** (data or Flows lost, the app crashes, the device cannot be added, the Toon misbehaves), **MAJOR** (a feature does not work), **MINOR** (a wrong word, a wrong colour, a slow screen), **INFO** (different from the document but harmless; the answer to a question).
* Steps that answer one of the open questions of section 15 name it ("answers Q-04").
* Ids: `HT-<phase letter>.<number>`; inside a sentence a step is cited without the prefix (`G.2` means `HT-G.2`); `Q-nn` are the questions of section 15; `FR-`/`NFR-` are requirements of document 01; `01-HW-nn` and `04-HW-nn` are the older hardware lists of documents 01 and 04 (Annex 4 maps them to this plan, which settles the double numbering noted in `08-test-report.md` O-9).

### 1.3 Safety rules (read these first)

1. **Never add `--clean`** to `homey app install` or `homey app run`. It deletes the data of the app on the Homey: paired devices, settings.
2. **`homey app run` removes the app when you press Ctrl+C**, with all its devices. Use `homey app install` for everything that must survive (upgrade, endurance). Use `run --remote` only for a short session with fixture devices.
3. **The upgrade is one way.** Homey does not install a lower version over a higher one (documented in 04 R-31, not tested). After the upgrade of phase C the only way back is to uninstall the app, which removes its devices. Make the snapshots of A.7 and C.1 first.
4. **Prefer fixture devices.** If your real Homey holds real Flows, add extra "Open Toon" devices with new ids (for example `test-1`) and build test Flows on those. Do not run the upgrade test over devices that you cannot afford to add again unless you have made the snapshots and accepted the risk.
5. **Write down the state of every Toon before you touch it** (A.5) and put it back afterwards: setpoint, active state, program on/off. Do not leave a Toon in Away, Sleep or Vacation. Change setpoints by 1 to 2 degrees around the current value, never to the extremes. Tell the people in the house.
6. **Do not run two testers against one Toon at the same time without knowing it**: the app, the probe, a second Homey app and the Toon's own screen all load the same small device.
7. **Stop and report** (do not continue) when: a device or Flow of yours disappears without you removing it (BLOCKER), the Toon reboots or hangs during the test, the Homey shows the app as crashed, or two devices of the app behave as one.

## 2. Phase A - Preparation

**HT-A.1  Inventory**  (needed for NFR-07, 01-HW-15)
- **Do:** Fill in the table below on paper or in the report (Annex 3): every Homey and every Toon you will use.
- **Expect:** Homey firmware 12.9.0 or newer (Homey app or web: Settings, System, About; wording may differ). Older firmware cannot take version 2.0.0 (`compatibility >=12.9.0`, ADR-0004).
- **Record:** the table.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

| Item | Fill in |
|---|---|
| Homey model and firmware (Pro Early 2023, Pro 2016-2019, Pro mini) | |
| Toon A: Toon 1 or Toon 2, software version, IP address (fixed), tariff (single or two), gas meter yes/no, solar yes/no, ToonWater add-on installed yes/no and version | |
| Toon B: same | |
| Toon C: same | |
| Other Homey apps that also read these Toons (for example the community app "toonWater") | |
| Which Open-Toon version is installed on the Homey today, which devices and Flows exist (answers OQ-10) | |

**Roles for the tests.** *Toon-with* = a Toon that has the ToonWater add-on installed and delivering. *Toon-without* = a Toon without it (or one where you can uninstall it). *Toon-single* / *Toon-two* = single / two-tariff meter. *Toon-solar* = a Toon in a household that feeds back. One Toon can fill several roles; with only one Toon you can still do everything except the "without add-on" columns of phase G (uninstall the add-on for those, if you can).

**HT-A.2  Tooling on your computer**
- **Do:**
  1. `node --version` must print v24 or newer (the Homey tool needs it). If not, install Node.js 24 or newer (nodejs.org, or `nvm install 24`).
  2. Get the code: use your checkout of this repository on branch `redesign/sdk3`, in `~/Projecten/Toon` (change the path in the commands below if yours differs).
  3. In that folder: `npm ci --ignore-scripts`. This installs the Homey tool inside the project: no global install is needed, and every command below can be run as `npx homey ...` from the project folder.
  4. Optional: `npm install -g homey` gives you a `homey` command everywhere. Its version may be newer than the 4.6.3 that this plan was checked against: run `homey --version` and expect small differences.
  5. For the baseline folder of phase B (which has no tool of its own) define once per terminal window: `HOMEY="node $HOME/Projecten/Toon/node_modules/homey/bin/homey.js"` and use `$HOMEY app install` there. Never type `npx homey` in a folder that has no `node_modules/homey`: npx would download the latest `homey` from the internet instead.
- **Expect:** `npx homey --version` prints `4.6.3`.
- **Record:** Node version, Homey tool version.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-A.3  The repository is green on your machine**
- **Do:** `npm run lint && npm test && npm run validate && npm run pack:check`
- **Expect:** all four succeed (the test run takes under a minute; `validate` prints two warnings about `energy.cumulative`, which is known and deferred, ADR-0016). If one fails, stop: the build is not what this plan was written for.
- **Record:** the last lines of each command.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-A.4  Log in to Homey and choose your Homey**
- **Do:** `npx homey login` (a browser opens; log in with your Athom account). `npx homey list` shows your Homeys. `npx homey select --name "<name of your Homey>"`. `npx homey api diagnose` if the Homey is not found.
- **Expect:** `npx homey select current` shows the right Homey and `npx homey api apps get-apps --json` returns a list.
- **Record:** the name of the selected Homey.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-A.5  Toon baseline card**  (one per Toon)
- **Do:** Photograph or write down what the Toon shows now: room temperature, setpoint, active preset (Comfort, Home, Sleep, Away), program on or off, the time. Note the fixed IP address. Check that the Toon is reachable from your computer: open `http://<ip>/happ_thermstat?action=getThermostatInfo` in a browser.
- **Expect:** a page of text that starts with `{"result":"ok"`. If the Toon does not answer, fix the network or the Toon's open firewall first (not covered by this app).
- **Record:** the photo and the text (the text stays private: it is only for you).
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-A.6  First probe of every Toon**  (answers Q-01, Q-05, Q-13, Q-14; settles 01-HW-02, 04-HW-13)
- **Do:** `mkdir -p ~/open-toon-test/probe`, then for each Toon, in the project folder:
  - `node scripts/toon-probe.js <ip> --label "idle, nothing running" --out ~/open-toon-test/probe/`
  - (A Toon without the ToonWater add-on answers 404 for the water page; that is expected and shown as `toonWater: not_found`.)
- **Expect:** four lines (thermostat, power, meters, water), exit code 0, a file `toon-probe-<UTC time>.json`. Open it in a text editor: `readOnly: true`, `target.host` is `<redacted>`, no name, no address, no serial number anywhere (Annex 1.3). `metersAnalysis.nodes` lists the meter nodes of the Toon.
- **Record:** the file per Toon; in the notes: which Toon, and whether `legacyKeysPresent` shows `dev_2.1`, `dev_2.4`, `dev_2.6`, `dev_2.2` as true.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-A.7  Snapshot of your Homey (before anything changes)**  (04-HW-01; mandatory before phase B or C)
- **Do:** In a private folder: `mkdir -p ~/open-toon-test/snapshots`, then
  - `npx homey api raw --path /api/manager/devices/device --json > ~/open-toon-test/snapshots/A7-devices.json`
  - `npx homey api raw --path /api/manager/flow/flow --json > ~/open-toon-test/snapshots/A7-flows.json`
  - `npx homey api raw --path /api/manager/flow/advancedflow --json > ~/open-toon-test/snapshots/A7-advancedflows.json`
  - `npx homey api raw --path /api/manager/insights/log --json > ~/open-toon-test/snapshots/A7-insights.json`
  - `npx homey api apps get-app --id nl.vinceste.open-toon --json > ~/open-toon-test/snapshots/A7-app.json` (an error here means the app is not installed: that is fine).
  - Also take screenshots of the Devices list, the tile of each Open Toon device, and the Flows overview.
- **Expect:** JSON files with content (a file must start with `{` or `[`; if the tool printed a status line first, delete that line). If a path is refused, run `npx homey api schema` to see the real paths, and write down the ones that work (the paths come from document 04 and were not run).
- **Record:** the files and the working paths. These files hold your household: keep them private.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-A.8  Where to read the app log** (unverified, find out once)
- **Do:** Try, in this order, and write down which works: (1) `npx homey tools` opens the Homey Developer Tools in a browser; look for your Homey, then the apps and the log or output of Open-Toon; (2) a session with `npx homey app run --remote` prints the log in the terminal (the app is removed when you stop it: only on a Homey where that is acceptable). Optional: to also log the raw answers of the Toon, create a file `env.json` in the project folder with `{"OPEN_TOON_DEBUG": "1"}` before `homey app install` (ADR-0005; the file is not committed). Remove the file and install again when you are done.
- **Expect:** you can read lines such as `Open-Toon started` and `Open-Toon driver started`.
- **Record:** how you reached the log. Every "app log" step below needs this.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-A.9  Choose how you run the app on your Homey**  (the three ways, and what each is good for)
- **Do:** Read the table, then decide per phase. Whatever you choose, run the command in the project folder and without `--clean`.
- **Expect:** you know which command to type; for everything that must survive (phases C, G, H, L) it is `install`.
- **Record:** the way you chose and the output of the first run.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

| Way | Command | Where the app runs | You need | What happens at the end | Use it for |
|---|---|---|---|---|---|
| Install | `npx homey app install` | on the Homey, for good | nothing else | it stays until you uninstall it; a newer version is expected to replace it and keep the devices (C.1 tests exactly that) | all tests of this plan, in particular the upgrade (C), ToonWater (G), offline (H), the 24-hour run (L) |
| Run on the Homey | `npx homey app run --remote` | on the Homey, in development mode | nothing else; the log scrolls in your terminal | Ctrl+C **uninstalls the app and its devices** | a short session with fixture devices when you want to read the log live; always on Homey Pro 2016-2019 (there it is the default) |
| Run in Docker | `npx homey app run` | in a Docker container on your **computer**, talking to the Homey | Docker Desktop (or another Docker) installed and running; options `--docker-socket-path` and `--network` exist for unusual setups | Ctrl+C uninstalls | Homey Pro (Early 2023) and Homey Pro mini only (there it is the default). Not for the acceptance tests: the Toon is then reached from your computer's network path, not from the Homey's |

If Docker is missing or fails, add `--remote`. The Homey Pro model decides the default (CLI help of 4.6.3: "Defaults to true for Homey Pro 2019 and earlier").

## 3. Phase B - The baseline: install the previous version first

**Why.** The promise of the redesign is "no need to add your Toon again, your Flows keep working" (FR-110). Only an upgrade over a real old install shows it. The previous version is the one on `Develop`, commit `5cc3b90` (version string `1.0.0`; "era 3" in document 04).

| Era | What it is | Commit | Capabilities of a device paired with it | Use |
|---|---|---|---|---|
| 3 | `Develop` today: SDK 3, hot water flag | `5cc3b90` | 11: the 7 of era 1, the 3 water items and `alarm_water.hotwater` | **required** |
| 2 | with water, no hot water flag | `426e2c2` (SDK 2) | 10: the 7 of era 1 and the 3 water items | optional |
| 1 | `Stable`, no water | `380e999` (SDK 2) | 7 | optional |

The new version is `2.0.0`, higher than all of them, so the upgrade is accepted. The installed devices of the three eras differ only in their capability list, and that is what the app migrates by (ToonWater ON when a device already has water items, OFF when it has none).

**HT-B.1  What is on your Homey today?**  (decides the next steps; answers OQ-10)
- **Do:** Use the snapshot A7 and the Homey app: is Open-Toon installed, which version, which devices, which Flows use its cards? In `A7-devices.json`, find the devices of the app and read their `capabilities` list: with `measure_water` the device is era 2 or 3; with `alarm_water.hotwater` era 3; with neither era 1.
- **Expect:** one of three situations: (a) the app is not installed on the Homey you test on; (b) it is installed with devices and Flows that you want to keep; (c) it is installed but you only use it for testing.
- **Record:** the situation and the era of each device.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:


*If (b) or (c): your installed build is the baseline. Skip B.2 and B.3, go to B.4 and then phase C. In case (b) the snapshots of A.7 are your only way back.* *If (a): continue with B.2.*

**HT-B.2  Build the patched baseline in its own folder**  (needed because `5cc3b90` does not validate, see section 0)
- **Do:** `mkdir ~/Projecten/Toon-baseline`
  - `git -C ~/Projecten/Toon archive 5cc3b90 | tar -x -C ~/Projecten/Toon-baseline`
  - `cd ~/Projecten/Toon-baseline`
  - The patch adds `[[resume_program]]` to the title of one Flow card, in English and Dutch:
  - `node -e "const fs=require('fs');let s=fs.readFileSync('app.json','utf8');s=s.replace('Set temperature state to [[state]]\"','Set temperature state to [[state]], [[resume_program]]\"').replace('Zet de temperatuurstand op [[state]]\"','Zet de temperatuurstand op [[state]], [[resume_program]]\"');fs.writeFileSync('app.json',s)"`
  - `grep -n "resume_program\]\]" app.json` (two lines) and then `$HOMEY app validate --level debug` (see A.2 for `$HOMEY`).
- **Expect:** `grep` shows two lines; validate ends with "App validated successfully against level `debug`" after two warnings about `energy.cumulative`. This folder is outside the repository; `git archive` changes nothing in your checkout. (If you prefer a throw-away copy of an older era, use `380e999` or `426e2c2` in place of `5cc3b90`; those need no patch.)
- **Record:** the validate output.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-B.3  Install the baseline**
- **Do:** In `~/Projecten/Toon-baseline`: `$HOMEY app install`. Then look at the Homey: Apps, Open-Toon.
- **Expect:** "Homey App `nl.vinceste.open-toon` successfully installed"; version 1.0.0 shown. (The build copies the committed `node_modules` of the old build; that is normal for that version.)
- **Record:** the console output and the version shown in the Homey app.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-B.4  Create baseline devices**  (01-HW-12, 04-HW-14; answers Q-32)
- **Do:** Add one device per Toon with the old pairing screen: fields "IP adres" and "Choose an unique name!" (that name becomes the device id: use `OT-A`, `OT-B`), then Connect. There is no test button in the old screen. Give the devices a name and a zone.
- **Expect:** Honest answer unknown: the old screen uses jQuery and `Homey.addDevice`, which the audit expects to fail on SDK 3 (`00` section 0). Either the device is created, or the screen does nothing or shows an error. Both outcomes are information.
- **Record:** what happened, with a screenshot. **If the old screen cannot add a device:** use devices that already exist (situation (b) or (c) of B.1), or install an SDK 2 build of era 1 or 2 from a folder as in B.2 (it may be refused by the Homey: write that down) and pair there. If none of this works you cannot build a baseline: mark phase C "N/A, no baseline possible" and test only fresh installs.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-B.5  Make the baseline hold values, Flows and history**
- **Do:** The old build does not refresh by itself. Build a refresh Flow: WHEN "Every 5 minutes" (or any timer you have) THEN the four cards "Update status", "Update power usage", "Update meter totals", "Update water" for each device (this is the workaround of issues #5 and #25). Then build the legacy Flow set of Annex 2.1: one small Flow for every card that exists in the old build (12 cards), each sending a notification that names the card. Let it run for at least 3 hours, ideally overnight.
- **Expect:** the tile shows values after the first refresh; some Flows fire (the old build never fires a trigger: that is a known defect and part of what changes); Insights fills up. Water items are empty on a Toon without add-on.
- **Record:** screenshots of each tile and of the Insights graphs; note the time you stop.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-B.6  Baseline snapshot and observations**  (04-HW-01)
- **Do:** Repeat the commands of A.7 into files named `B6-...`. Write down which known defects of the old build you saw: values stale without the refresh Flow, `Invalid Capability` lines in the log (if you can read it), the pairing result of B.4.
- **Expect:** the devices JSON shows the capability list of the era and the settings `{address}` only.
- **Record:** the files and the observations.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

## 4. Phase C - Upgrade in place (no re-pair)

**HT-C.1  Last snapshot, then upgrade**  (answers Q-26; 01-HW-12, 04-HW-02)
- **Do:** Snapshot as in A.7 (`C1-...`). Then in the project folder `~/Projecten/Toon`, on branch `redesign/sdk3`: `npx homey app install` (no `--clean`). Note the time.
- **Expect:** "successfully installed"; the app now shows version 2.0.0; the devices are still there, with the same names and zones, in the same minute. Nothing asks you to add a Toon again.
- **Record:** console output; time; screenshot of the Devices list.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-C.2  The first minutes**  (FR-110 AC2, NFR-08)
- **Do:** Open each device tile right after the install and again after 1 and 5 minutes. If you can read the app log (A.8), read it.
- **Expect:** the old values are visible immediately; the device is not unavailable for more than about a minute; fresh values arrive within 10 seconds of the first poll (the first cycle starts 1 to 3 seconds after the app starts); no `Invalid Capability`, no `TypeError`, no `unhandled` in the log; lines such as `Open-Toon started`.
- **Record:** screenshot per device, log excerpt.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-C.3  Capabilities per era, ToonWater default**  (FR-56, FR-111, ADR-0010, ADR-0018; answers Q-22, Q-23, Q-24)
- **Do:** For each upgraded device open the tile and the settings. Take a new snapshot of the devices JSON (`C3-devices.json`) and compare the `capabilities` with B.6.
- **Expect:** 
  - Every device keeps all the capabilities it had. Every device gains **Burner / Brander** (`burner_state`) and, if era 1 or 2, the hot-water flag (`alarm_water.hotwater`).
  - A device that had water items (era 2 or 3) keeps them and its setting **Enable ToonWater water meter** is ticked; a device without water items (era 1) gets none and the box is unticked. No device gets water items it did not have.
  - The settings show the new groups: Local Toon Settings (IP Address, Update interval 30), Status, ToonWater (optional add-on), Power export (optional) with the box unticked. The IP address is unchanged. (If the interval shows empty or 0, record it: the app reads an empty value as 30, FR-112; `04` U3.)
  - The state picker contains Vacation / Vakantie.
- **Record:** the capability list before and after, screenshots of the settings page, the titles of the new items in English and Dutch.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-C.4  Your old Flows**  (FR-76, FR-110; 04 rule 6; answers Q-18)
- **Do:** Open each Flow of Annex 2.1 and the refresh Flow. Do not edit them. Start those that you can start (conditions, actions). Watch the Flows list for red or disabled Flows.
- **Expect:** no Flow is broken or disabled; every card is still found (also the deprecated ones: "Update power usage", "Update meter totals", "Update water", "The gas meter changed", "The water flow changed" are hidden from the card picker but keep working in existing Flows); the card "Set temperature state" now shows its extra choice ("Resume program afterwards" / "Disable program") in the text; "Update status" is now called "Update now".
- **Record:** screenshot of the Flows list and of two edited cards; any card that shows as broken.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-C.5  Insights history survives**  (FR-110; Q-27)
- **Do:** Open the Insights of one upgraded device: temperature, target temperature, power, the two meters, gas, hot water.
- **Expect:** the graphs show the history from before the upgrade followed by new points. Meters and gas now have three decimals (before: whole numbers): one visible step, once, is expected (FR-114). The hot water alarm and the other items are not reset.
- **Record:** screenshot of two graphs across the upgrade moment.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-C.6  Triggers that never fired before**  (FR-70; answers Q-16)
- **Do:** Let the Flows of B.1 run for an hour while the Toon is in use (a hot tap, a kettle, a change of preset on the Toon's screen). Count the notifications per Flow.
- **Expect:** each trigger Flow fires **once per change**: gas (token in m3), power meter (token = peak + off-peak in kWh, three decimals), hot water on and off, burner state (new card). "Temperature state changed" fires **exactly once** per change (if it fires twice, or not at all, that is the open question Q-16).
- **Record:** the notification list; for the state trigger how many times it fired per change.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-C.7  Restart and install again: nothing is added twice**  (FR-111 AC2; answers Q-26)
- **Do:** `npx homey api apps restart-app --id nl.vinceste.open-toon`. Then run `npx homey app install` again (same version 2.0.0).
- **Expect:** after the restart the devices come back with their values; no new timeline notifications about ToonWater or migration; the capability lists in a new snapshot are identical to C3. The second install is accepted or refused with a message (record which); the devices and Flows survive either way.
- **Record:** the console output, the new snapshot, whether installing the same version works.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-C.8  Repeat for the other eras** (optional)
- **Do:** Uninstall the app (`npx homey api apps uninstall-app --id nl.vinceste.open-toon`; this removes its devices and cannot be undone). Install the baseline of another era from a folder as in B.2, create devices and Flows, wait, and repeat C.1 to C.7.
- **Expect:** the result of the table in C.3 for that era: era 1 devices end with ToonWater off and no water items, era 2 devices with ToonWater on.
- **Record:** per era, a short table of the results.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

## 5. Phase D - Pairing a new device

Do phase D on the upgraded app (2.0.0). Repeat D.1 to D.6 in the **Homey web app and in the Homey mobile app**, in **light and dark mode**, with the Homey in **English and in Dutch** if you can switch (01-HW-01). Start with one combination and do the rest for D.6 and D.12 only.

**HT-D.1  The pairing screen opens**  (FR-01, FR-05)
- **Do:** Add a device, choose the app Open-Toon®, then its driver.
- **Expect:** A screen with the text "Enter the IP address of your Toon, then test the connection." (nl: "Vul het IP-adres van je Toon in en test daarna de verbinding."), three fields (IP address / IP-adres, Toon id / Toon-id, Name / Naam), the buttons "Test connection" / "Verbinding testen" and "Connect" / "Verbinden"; **Connect is disabled**.
- **Record:** screenshot.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-D.2  Empty fields**  (FR-01 AC3)
- **Do:** Press Test connection with an empty address. Then with an address and an empty id, press Connect (it is disabled: note that).
- **Expect:** the message "Enter the IP address of your Toon." (nl: "Vul het IP-adres van je Toon in."); Connect stays disabled.
- **Record:** screenshot.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-D.3  Invalid addresses**  (FR-03)
- **Do:** Test these one by one: `0.0.0.0`, `192.168.1.50/foo`, `https://192.168.1.50`, `a b`, `192.168.1.50:99999`.
- **Expect:** an inline message each time, in plain words ("This is not a valid address. Enter the IPv4 address of your Toon, for example 192.168.1.50." and for https "The Toon speaks plain http. Remove https:// from the address."); nothing is sent to the network; Connect stays disabled.
- **Record:** screenshot of two of them; the exact texts.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-D.4  An address where no Toon is**  (FR-02 AC2, NFR-08)
- **Do:** Enter a free address in your network (for example `192.168.1.250`) and press Test connection. Start a stopwatch.
- **Expect:** after at most about 6 seconds a message such as "The Toon did not answer in time..." or "Homey cannot reach the Toon..."; Connect disabled; no hanging spinner.
- **Record:** seconds until the message; the text.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-D.5  Something that is not a Toon**  (FR-02 AC3, AC4)
- **Do:** Test the address of your router or of the Homey itself (anything that answers on port 80 with a web page).
- **Expect:** "This does not look like an open Toon..." or "The Toon answered with an error (code 404)...". Never raw HTML, never a stack trace.
- **Record:** which text you got for which device.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-D.6  A real Toon**  (FR-01 AC4, FR-02 AC1; answers Q-08)
- **Do:** Enter the address of Toon A, a Toon id (for example `ot-a-test`) and a name, press Test connection.
- **Expect:** "Connected. The Toon reports:" followed by Temperature, Setpoint / Ingestelde temperatuur, Program / Programma (On or Off, Aan or Uit), Active state / Actieve stand (Comfort, Home, Sleep, Away, Vacation or No state), and Connect becomes enabled. **Compare each reading with the Toon's own screen** (A.5).
- **Record:** screenshot of the result; the four readings next to the four values on the Toon; any difference (for example Program shows Off while the Toon runs its program).
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-D.7  ToonWater is mentioned only when it is there**  (FR-61; answers Q-05)
- **Do:** Test Toon-with, then Toon-without.
- **Expect:** Toon-with: an extra paragraph "ToonWater was found on this Toon. Tick the box..." and an **unticked** box "Enable ToonWater". Toon-without: nothing about water, no error, no red text. The ToonWater page is asked once at this moment, so a Toon without the add-on sees one 404 at pairing (accepted, `08` O-3).
- **Record:** screenshot of both.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-D.8  Changing the address after a test**  (FR-02 AC5)
- **Do:** After a successful test change one digit of the address.
- **Expect:** the result disappears and Connect is disabled again until the next successful test.
- **Record:** screenshot.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-D.9  The same Toon id twice**  (FR-04 AC2; answers Q-29)
- **Do:** Add a device with id `ot-a-test` (D.10). Then try to add another with the same id.
- **Expect:** no second device. The message is either the app's "A Toon with this id has already been added. Choose another id." or a message of Homey itself; write down which and its exact words.
- **Record:** screenshot, the words.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-D.10  Connect (ToonWater not ticked)**  (FR-01 AC1, FR-51 AC4)
- **Do:** With Toon A tested, leave the ToonWater box unticked (or absent), press Connect, choose a zone.
- **Expect:** the device appears with the name you typed (or the id if you left the name empty). Within 10 seconds the tile shows temperature, target temperature, temperature state, power, the two meters (if your Toon has them), gas, hot water flag and Burner. **No water items.** Open the settings: ToonWater unticked.
- **Record:** screenshot of the tile and of the settings.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-D.11  Connect with ToonWater ticked**  (FR-52 AC1)
- **Do:** Add a device for Toon-with with the box ticked.
- **Expect:** the tile also has Water flow, Water today / Water vandaag and Water meter total / Water meter totaal; the settings show ToonWater ticked and the status "Detected" / "Gevonden".
- **Record:** screenshot.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-D.12  Looks and layout**  (FR-05 AC2, FR-100)
- **Do:** Look at the pairing screen, the tile and the settings in: web light, web dark, mobile light, mobile dark, English, Dutch.
- **Expect:** nothing is cut off or unreadable; buttons can be reached; no English text in the Dutch screens and no `pair.something` keys; no typo.
- **Record:** screenshots; each defect with its screen.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-D.13  Cancel**
- **Do:** Start pairing, run a successful test, then close the screen without pressing Connect.
- **Expect:** no device is created.
- **Record:** the Devices list.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-D.14  Two Toons**  (FR-04 AC3)
- **Do:** Add Toon B with its own id.
- **Expect:** two independent devices; values of each match its own Toon.
- **Record:** both tiles next to both Toon screens.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

## 6. Phase E - The device tile, item by item

Use a device made in phase D (or an upgraded one). Where a step compares with the Toon, look at the Toon's screen and at the tile within the same minute. The app asks the Toon every 30 seconds by default, so allow up to 35 seconds before you call a value stale.

**HT-E.1  Temperature**  (FR-10; `measure_temperature`, "Temperature" / "Temperatuur")
- **Do:** Compare the tile with the Toon at three moments in an hour.
- **Expect:** the same value to 0.1 degree.
- **Record:** three pairs (tile, Toon, time).
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-E.2  Target temperature: read and set**  (FR-11, FR-16; answers Q-09; 01-HW-03)
- **Do:** Read the target temperature and compare with the Toon. Note the Toon's program state. Then set a value 1 degree higher from the tile (the slider or the +/- buttons; the step is 0.5, range 6 to 30). Watch the Toon. Drag the slider quickly over several steps and let go. Finally put the original value back.
- **Expect:** the Toon shows the new setpoint within a few seconds, and the tile shows it too and does not jump back to the old value for a moment; after a quick drag the **last** value wins. A value that is not a multiple of 0.5 on the Toon (for example 19.75) is shown rounded to 0.5 on the tile.
- **Record:** how the Toon presents it (a manual override? until when? does it return to the program at the next program change?), tile versus Toon after each action, anything odd. This is the evidence for Q-09.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-E.3  Temperature state**  (FR-12, FR-13 AC3; answers Q-03, Q-08; 01-HW-04)
- **Do:** Compare the picker "Temperature state" / "Temperatuurstand" with the preset on the Toon. Select each of Comfort, Home, Sleep, Away on the tile, one at a time, waiting for the Toon each time. Then select "Vacation" and "No state" on the tile. Put the original state back.
- **Expect:** the tile matches the Toon. Each of the four presets switches the Toon to that preset (as a temporary override). Selecting Vacation shows "Vacation mode can only be set on the Toon itself." (nl: "De vakantiestand kan alleen op de Toon zelf worden ingesteld.") and the picker returns to the current state. Selecting "No state" is expected to be refused with "The request was not sent because a value is not valid..." (record what really happens).
- **Record:** per preset: the Toon's screen and what the probe says (`node scripts/toon-probe.js <ip> --label "after tile: sleep" --no-water`: look at `activeState`, `programState`, `currentSetpoint`).
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-E.4  Electricity meter totals**  (FR-21; answers Q-01; 01-HW-02)
- **Do:** Compare "Power meter peak (total)" / "Stroom meterstand piek" and "Power meter off-peak (total)" / "Stroom meterstand dal" with the Toon's energy screen or the smart meter (kWh). On a single-tariff Toon check which item moves.
- **Expect:** values with three decimals, equal to the Toon's within its rounding. Two-tariff: the item of the active tariff increases. Single-tariff: one item follows the meter and the other stays empty (a dash) or unchanged, never 0 and never NaN.
- **Record:** tile, Toon screen and meter display together, with the time; which of `dev_2.4`, `dev_2.6`, `dev_2.2` your Toon has (probe, `metersAnalysis`).
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-E.5  Power now**  (FR-20)
- **Do:** Note the "Power" value. Switch on a kettle (about 2 kW) and watch the tile; switch it off.
- **Expect:** the value rises by about the kettle's power within one interval and falls again; it never shows a negative value, even on a Toon with solar panels.
- **Record:** before, during, after, the Toon's own figure.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-E.6  Gas meter**  (FR-28; answers Q-01)
- **Do:** Compare "Gas meter" with the gas meter display (m3) and the Toon's energy screen. Run the central heating or hot water for a while.
- **Expect:** equal to three decimals within the Toon's rounding; increasing only. No value stays empty on a Toon that has a gas meter.
- **Record:** tile, display, time. If the gas value stays empty, run the probe and note `metersAnalysis` (this is exactly issues #9 and #10).
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-E.7  Hot water flag**  (FR-31; answers Q-04, Q-33)
- **Do:** Run the hot tap for about two minutes, then close it. Watch "Hot water dispensing" / "Warm water afgifte" and the Timeline.
- **Expect:** the item turns on within one interval and off again afterwards. Note that Homey treats this as a water alarm: a red icon and Timeline texts such as "Water alarm turned on" are expected (known quirk, `04` section 5).
- **Record:** the times (tap on, tile on, tap off, tile off). Also: does it turn on when the central heating runs without a tap (it should not)?
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-E.8  Burner**  (FR-30; answers Q-04; 01-HW-08)
- **Do:** Watch "Burner" / "Brander" during: idle; heating (raise the setpoint 2 degrees above the room temperature on the Toon; restore afterwards); hot tap; and, if you can provoke it, a pre-heat before a program change.
- **Expect:** Off / Uit when idle, Heating / Verwarmen, Hot water / Warm water, Pre-heating / Voorverwarmen. All four values are a **hypothesis**: only "2 = hot water" is confirmed by the old code. The tile shows no graph for this item (it is not logged).
- **Record:** per situation: what the tile said and what the burner really did (sound, the Toon's flame symbol). Start the day-long watch of Q-04 here if you want to cover pre-heat.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-E.9  Power export** (optional; only with Toon-solar)  (FR-25, FR-26; answers Q-11)
- **Do:** In the settings tick "Show power export" / "Teruglevering tonen" in the group "Power export (optional)". Look at the tile in the sun. Untick it afterwards.
- **Expect:** a new item "Power export" / "Teruglevering" appears and shows the power fed back in watts (positive), equal to the P1 or inverter reading; "Power" stays the import. Unticking removes the item with the save message (record its words).
- **Record:** tile versus P1 display, the probe's `power.body.powerProduction` at the same moment.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-E.10  Insights**  (FR-114)
- **Do:** After a day, open the Insights of the device.
- **Expect:** logs for temperature, target temperature, power, both meters, gas and the hot water flag, continuous, with no spikes to 0 and no decreasing meter. There is no log for Burner.
- **Record:** screenshot.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-E.11  Homey Energy**  (FR-90 is deferred; answers Q-25; 01-HW-11)
- **Do:** Open Homey Energy and find the Toon. Compare with your other energy devices.
- **Expect:** no fixed expectation: the app declares `energy.cumulative` without an imported-energy item (ADR-0016, two validator warnings). Write down: is the Toon listed, does it show power and gas, is anything counted twice, does water appear.
- **Record:** screenshots of the Energy day and week views.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-E.12  Titles in both languages**  (FR-100, FR-101)
- **Do:** Look at every item title and every unit on the tile in English and in Dutch.
- **Expect:** no missing translation, no typo, units kWh, m3, W, degrees C.
- **Record:** a list of anything wrong.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-E.13  The log is clean**  (NFR-01, NFR-09)
- **Do:** After an hour of normal running, read the app log (A.8).
- **Expect:** no `Invalid Capability`, no `TypeError`, no `unhandled`; at most one short line per state change; no line at all per healthy poll.
- **Record:** an excerpt, or "no access to the log".
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

## 7. Phase F - The Flow cards, one by one

Build the Flows of Annex 2.2 first: one small Flow per card, each ending in a notification that names the card and its tokens. Use a device from phase D or an upgraded one. The manifest holds 6 trigger, 3 condition and 7 action cards; five of them are deprecated (hidden in the card list for new Flows, still working in old ones).

**HT-F.1  The card list**  (FR-71, FR-75, FR-77; answers Q-18, Q-20; 04-HW-07)
- **Do:** Open a new Flow and browse the cards of the app (WHEN, AND, THEN) with a device selected. Do it with a device that has ToonWater off.
- **Expect:** these are offered: WHEN "Temperature state changed", "The power meter changed", "The hot water dispensing is changed", "Burner state changed to ..."; AND "Current temperature state is ...", "Hot water is dispensing", "Burner state is ..."; THEN "Set temperature state to ...", "Enable program", "Disable program", "Update now". These are **not** offered for a new Flow: "The gas meter changed", "The water flow changed", "Update power usage", "Update meter totals", "Update water". Dutch titles read well and the arguments (state, resume program) have titles. Homey's own cards for the capabilities (for example "The temperature changed", "The target temperature changed") are also there and are not ours.
- **Record:** screenshot of each list; any card that is missing or extra; Dutch words that read badly.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-F.2  Trigger: temperature state changed**  (FR-70; answers Q-16; 04-HW-06)
- **Do:** Change the preset on the Toon's screen from Home to Comfort and back, then from the tile.
- **Expect:** the Flow runs **once per change** with the token `temperature_state` showing the new state. If it runs twice the app and Homey both fire it; if never, Homey does not fire it for custom capabilities (the app deliberately does not, `lib/features/core.js`, `source: 'homey'`).
- **Record:** how many runs per change, the token texts.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-F.3  Trigger: the power meter changed**  (FR-70 AC5)
- **Do:** Wait for the next meter change (a few minutes while something is on).
- **Expect:** one run per change; token `meter_power` = peak plus off-peak in kWh with three decimals; the token title says kWh (it said Wh in the old build).
- **Record:** token value against the tile sum.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-F.4  Trigger: the hot water dispensing is changed**  (FR-31 AC3)
- **Do:** Open and close the hot tap.
- **Expect:** two runs, token true then false.
- **Record:** the notification times.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-F.5  Trigger: burner state changed to ...**  (FR-32; 01-HW-08)
- **Do:** Make two Flows: one with "any state", one with "Heating". Raise the setpoint so the burner starts, then lower it.
- **Expect:** the "any" Flow runs at every change with the new state in the token; the "Heating" Flow only when the state becomes Heating; neither runs again while the state stays the same; neither runs for the first value after an app restart (restart the app and check).
- **Record:** the list of runs with times.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-F.6  Deprecated triggers still run**  (FR-71 AC2; 04-HW-07)
- **Do:** Keep an old Flow with "The gas meter changed" (from phase B, or one made before the upgrade). Let the gas counter change.
- **Expect:** it runs once per change with token `meter_gas` in m3; the card cannot be chosen for a new Flow. The same for "The water flow changed" on a device with ToonWater on (phase G).
- **Record:** the runs.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-F.7  Conditions**  (FR-72)
- **Do:** For "Current temperature state is ..." run the Flow with each state in the dropdown (Comfort, Home, Sleep, Away, No state, Vacation) while the Toon is in one of them, with "is" and with "isn't" (the NL texts are "is gelijk aan" and "is niet gelijk aan"). Do the same for "Hot water is dispensing" (tap open and closed) and "Burner state is ...".
- **Expect:** true exactly for the real state, false otherwise; never an error; the dropdown values show readable names (if they show blank or technical words, that is the label/title question of `04` R-17).
- **Record:** a small table: real state, chosen state, result.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-F.8  Action: Set temperature state**  (FR-13, FR-73; answers Q-02, Q-17; 01-HW-04, 04-HW-10)
- **Do:** Run "Set temperature state to Sleep, Resume program afterwards", then "... Disable program", for Sleep and Away. **Follow the protocol of Q-02 exactly** (probe after every action).
- **Expect:** the action ends green when the Toon answers. "Resume program afterwards" sets the preset as a temporary override like the Toon's own screen does. For "Disable program" the app currently sends a **placeholder** request (ADR-0015): it may not do what the label says. That is what this step finds out. The argument arrives as text or as an object; the app accepts both (`04` U7); if the action fails with "The request was not sent because a value is not valid" record the card and arguments.
- **Record:** Q-02 table.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-F.9  Actions: Enable program, Disable program**  (FR-14; 01-HW-04)
- **Do:** Run "Disable program", look at the Toon, probe; run "Enable program".
- **Expect:** the Toon's program turns off and on as you can see on its screen; the action ends green; `programState` changes accordingly. Restore the original program state.
- **Record:** Toon screen, probe `programState` before and after.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-F.10  Action: Update now**  (FR-74, FR-75)
- **Do:** Change the preset on the Toon, then immediately run "Update now" (set the device interval to 300 first so that the poller does not do it for you).
- **Expect:** the tile shows the new state within a few seconds of the action; the action ends green.
- **Record:** seconds from the action to the new value.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-F.11  Old Update cards in old Flows**  (FR-74 AC1, AC2; FR-75 AC2)
- **Do:** Keep the refresh Flow of B.5 (four Update cards on a timer). Let it run.
- **Expect:** it keeps running without errors; "Update water" on a device with ToonWater **on** reads the page; on a device whose ToonWater was switched off **by you** it ends with the error "ToonWater is not enabled for this device" ("ToonWater staat niet aan voor dit apparaat"); on a device that the **upgrade** left off (era 1) it ends green without doing anything (ADR-0018).
- **Record:** the result per device.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-F.12  Actions when the Toon is unreachable**  (FR-73 AC2; NFR-08 AC2)
- **Do:** See H.3: run each action while the Toon is unplugged and the device is still available (within the first two minutes), and again when the device has become unavailable.
- **Expect:** within about 6 seconds (10 s at most) each action that needs the Toon fails with a sentence in the language of the Homey ("The Toon did not answer in time..." and similar), not a stack trace. Once the device is unavailable, Homey itself blocks the card (its own message; Q-30).
- **Record:** the text of each failure and how many seconds it took.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

## 8. Phase G - ToonWater: off, on, with and without the add-on

**What ToonWater is.** A community add-on that runs on the Toon and serves the page `/water.html` with flow, today and total. The app reads it only when you tick **Enable ToonWater water meter** in the device settings (group "ToonWater (optional add-on)"). Off by default for new devices; devices that already had water items keep them. Turning it off **removes** the three water items (Water flow, Water today / Water vandaag, Water meter total / Water meter totaal); that is the one thing in the app that can break a Flow, which is why this phase tests it twice over.

**Test devices.** *D-new*: a device made in phase D. *D-migrated*: an upgraded era 3 device (it had water items). *D-legacy*: an upgraded era 1 device if you made one (C.8). Run each step on **Toon-with** and **Toon-without**; the columns of the result are in Notes.

**HT-G.1  OFF, Toon without the add-on: a clean tile**  (FR-51; the owner's wish)
- **Do:** With D-new on Toon-without (ToonWater unticked), look at the tile, the settings and the Flow editor (choose this device in a WHEN card list and in a THEN card list).
- **Expect:** no water item on the tile; ToonWater unticked and its status shows a dash or "Off"; **no water card** is offered for this device (no "Water flow changed", no "Update water", no water tags in the tag picker). The hot water flag and its cards are **there**: they are not ToonWater.
- **Record:** screenshots of the tile, the card pickers and the tag picker. Answers whether the owner's wish "no water cards in the Flow editor" holds (`08` O-7; Q-20).
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-G.2  OFF: no water traffic and no noise**  (FR-51 AC2, AC3; NFR-09; answers Q-05)
- **Do:** Leave D-new on Toon-without running for one hour. Read the app log (A.8) and search for "water" and "404". Optional, the strongest proof: look at what the Toon's web server logged, or at your router's or firewall's log for requests from the Homey to `/water.html` (how to read the Toon's log is not known to this plan; write down what you found).
- **Expect:** no line about water in the app log; no warning on the tile; no timeline entry. If you can see the Toon's requests: none for `/water.html` from the Homey.
- **Record:** the log excerpt (or its absence) and any Toon-side evidence.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-G.3  OFF, Toon with the add-on installed**  (FR-51; answers Q-05)
- **Do:** The same as G.1 and G.2 on Toon-with with ToonWater unticked.
- **Expect:** identical to G.1 and G.2: the app does not touch the add-on when you did not ask for it.
- **Record:** as G.1 and G.2.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-G.4  Turn ON with the add-on**  (FR-52, FR-58, FR-59; answers Q-05; 01-HW-07)
- **Do:** On Toon-with: tick the box and press Save. Start a stopwatch. Probe the water page at the same time: `node scripts/toon-probe.js <ip> --label "water page before use"`. Compare the three values with the add-on's own screen on the Toon.
- **Expect:** the save finishes within a few seconds (note how long) and a toast says "ToonWater found. Water values will appear shortly." (nl: "ToonWater gevonden. De watergegevens verschijnen zo meteen."); the status line reads "Detected" / "Gevonden"; three items appear on the tile and fill within 10 seconds; Water flow is in litres per minute, Water today and Water meter total are in m3 with three decimals (the add-on's litres divided by 1000); they agree with the add-on's screen. The probe shows `toonWater: detected`.
- **Record:** seconds to save, to first values; tile versus add-on screen; the probe file (it holds the real payload, the answer to Q-05).
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-G.5  What the Flow editor offers now**  (answers Q-20; 01-HW-05, 04-HW-08, 04-HW-09)
- **Do:** Open the card pickers of this device again, and the tag picker.
- **Expect:** Homey's own cards and tags for the three new items are offered (for example a trigger when the water flow changes, tags for the three values). The app's own water cards ("The water flow changed", "Update water") stay hidden because they are deprecated. "Update now" refreshes the water page too.
- **Record:** the exact list of water-related cards and tags, with screenshots. If the editor offers **no** card to act on water, say so: the owner's wish needs a different answer then (`05` section 6.7).
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-G.6  Use water**  (FR-58; answers Q-05)
- **Do:** Open a cold tap for a minute, then close it. Probe during the flow (`--label "tap open"`) and a few minutes after.
- **Expect:** Water flow rises above 0 while the tap runs and returns to 0 afterwards (or stays at the last value: record which, the page may not be rewritten when nothing changes, Q-05); Water today and total increase by about what you drew; the Insights log fills; an old Flow on "The water flow changed" and a new one on Homey's card both run.
- **Record:** litres drawn (bucket), the values before and after, how long until flow returned to 0, the probe files.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-G.7  Turn ON without the add-on**  (FR-55; answers Q-05)
- **Do:** On Toon-without: tick the box and Save. Wait 30 minutes. Probe: `node scripts/toon-probe.js <ip> --label "no add-on"`.
- **Expect:** the toast "ToonWater was not found on this Toon. The water items were added but stay empty until the add-on is installed and running." (nl: "ToonWater is niet gevonden op deze Toon. ..."); the three items exist and are empty; the status line "Not found on this Toon (HTTP 404)" / "Niet gevonden op deze Toon (HTTP 404)"; a warning on the tile "ToonWater is enabled but was not found on this Toon" (nl: "ToonWater staat aan maar is niet gevonden op deze Toon"); **the device stays available and all other items keep updating**. The probe shows the real status code of the missing page: 404 is the assumption.
- **Record:** the three texts, screenshot with the warning, the status code from the probe.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-G.8  The add-on arrives later**  (FR-55 AC2, FR-57 AC2)
- **Do:** With D-new still on and "not found", install the ToonWater add-on on that Toon (or start it) and let water flow once. Note the time.
- **Expect:** within about 15 minutes (the app asks only every 15 minutes after a 404) the status becomes "Detected", the warning disappears, the values fill in. Saving the settings again re-probes at once.
- **Record:** minutes until it was detected.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-G.9  Turn ON, and the Toon is off**  (FR-52 AC3, FR-55 AC5)
- **Do:** With ToonWater unticked, unplug the Toon (see H.2), tick the box and Save.
- **Expect:** the toast "The Toon could not be reached, so ToonWater could not be checked. The water items were added; they fill in as soon as the Toon answers." (nl: "De Toon was niet bereikbaar, ..."); the items exist; the status "Toon not reachable"; no "not found" warning. Plug the Toon in again: within a few minutes the status becomes "Detected".
- **Record:** the toast, the statuses over time.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-G.10  Turn OFF: what happens**  (FR-53, FR-54; answers Q-19; 01-HW-05, 01-HW-06, 04-HW-08)
- **Do:** Before: make two Flows on D-new with ToonWater on: one with Homey's trigger for the water flow, one that uses the "Water meter total" tag in a notification; note an Insights graph of Water today. Then untick the box and Save.
- **Expect:** the toast "ToonWater turned off. The water items were removed; Flows that used them need to be updated and their Insights history may be lost." (nl: "ToonWater is uitgezet. ..."); the three items disappear from the tile and the status reads "Off"/"Uit"; **temperature, power, meters, gas, hot water flag and Burner are untouched and keep updating**; the Toon is no longer asked for the water page (check as in G.2).
- **Record:** the Homey side, which is the open question: how does Homey show the two Flows (broken? disabled? still running with an empty tag?), can you open and repair them, is the Insights history of Water today still there? Screenshots of each.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-G.11  Turn ON again**  (FR-54 AC4, AC5; answers Q-19)
- **Do:** Tick the box again and Save.
- **Expect:** the three items return with the same names; the Flows of G.10 work again or can be repaired by selecting the card again; record whether the Insights graph continues the old history or starts empty.
- **Record:** screenshots, what you had to repair.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-G.12  Quick toggling**  (FR-52 AC4)
- **Do:** Tick, untick, tick, Save each time without waiting for a long time (three saves within a few seconds).
- **Expect:** the end state matches the last save: one set of three items, no duplicates, no error toast, no red lines in the log.
- **Record:** screenshot, log.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-G.13  Turn OFF, and the Toon is off**
- **Do:** With ToonWater on, unplug the Toon, untick the box, Save.
- **Expect:** the save succeeds and the items are removed (nothing needs the Toon for that).
- **Record:** the toast.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-G.14  The Toon reboots while ToonWater is on**  (A-04; answers Q-05)
- **Do:** With ToonWater on and Toon-with: restart the Toon (its menu, or the plug). Let `node scripts/toon-probe.js <ip> --samples 30 --every 30 --label "after reboot"` run for 15 minutes, starting as soon as the Toon answers. Draw water once during that time.
- **Expect:** no fixed expectation: the add-on may serve `/water.html` only after the first change of flow, so the page may be missing for a while after a reboot (the app shows "Not found" and keeps all values). Record when the page appears.
- **Record:** `watch.latency.water.outcomes` and `watch.outcomeChanges` of the probe file: the sequence "http 404" then "ok" and the minute.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-G.15  An upgraded device with water items, on a Toon without the add-on**  (FR-56, FR-62; ADR-0018; `08` O-2)
- **Do:** Take D-migrated on Toon-without (an era 2 or 3 device that never had real water data). After the upgrade leave it for 24 hours or more. Then restart the app (C.7) and wait again.
- **Expect:** ToonWater is ticked by the upgrade; the status says "Not found on this Toon (HTTP 404)"; the tile shows **no warning** (the upgrade, not you, switched it on); after about 24 hours exactly **one** Timeline note: "ToonWater is switched on for <name>, but it has not been found on this Toon for 24 hours. If you do not use ToonWater, switch it off in the settings of this device." (nl: "ToonWater staat aan voor <name>, maar is de afgelopen 24 uur niet gevonden ..."); it does not come back after a restart.
- **Record:** the time of the note, how many notes.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-G.16  An upgraded device without water items**  (FR-56 AC3)
- **Do:** Take D-legacy (era 1), if you have one.
- **Expect:** ToonWater unticked, no water items, no request for the page (G.2), and ticking the box works as in G.4/G.7.
- **Record:** as G.1, G.4.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-G.17  Address of the sensor module instead of the Toon** (optional; FR-55)
- **Do:** If you know the IP of the ESP/Wemos sensor module of ToonWater: set the device address to it with ToonWater on.
- **Expect:** the status "Unexpected response: this looks like the address of the ToonWater sensor module, not of the Toon" (nl: "Onverwacht antwoord: dit lijkt het adres van de ToonWater-sensormodule, niet van de Toon"). Put the right address back.
- **Record:** the status; (do not paste the module's page, it may hold network details).
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

## 9. Phase H - Offline behaviour

Use a device with the default interval (30 seconds). Use a stopwatch. "Unplug" = switch the Toon off at the wall or block its address in your router; blocking is gentler.

**HT-H.1  Healthy start**
- **Do:** Let the device run for 10 minutes. Note the "Last successful update" in the settings.
- **Expect:** values current, device available.
- **Record:** the time.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-H.2  The Toon disappears**  (FR-81 AC1, AC4; ADR-0005; answers Q-31; 01-HW-09, 04-HW-12)
- **Do:** Unplug the Toon. Start the stopwatch. Watch the tile every 30 seconds.
- **Expect:** the values stay (they are **not** cleared or set to zero). The tile becomes unavailable with the text "Your Toon cannot be reached" (nl: "Toon is onbereikbaar") after about 2 to 3 minutes: the rule is "3 failed rounds spanning 90 seconds"; in the mock that is 120 seconds after the first failed request at the 30-second interval (140 s if the Toon hangs instead of refusing). Before that nothing changes.
- **Record:** seconds until unavailable, the text, the settings line "Last problem" / "Laatste probleem".
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-H.3  Flow cards and the tile while it is down**  (FR-73, FR-74 AC2; answers Q-30)
- **Do:** In the first two minutes (still available) run "Update now", "Set temperature state ..." and "Disable program". Once unavailable run them again, and try to move the target temperature on the tile.
- **Expect:** while available: each fails within about 6 seconds with a plain sentence in your language. Once unavailable: Homey blocks the cards and the tile controls itself (it shows the device as unavailable). Write down exactly what Homey says and what a chained Flow does after the failed card.
- **Record:** the sentences, the seconds, the behaviour of the Flow.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-H.4  The Toon comes back**  (FR-81 AC2, AC3; `08` O-1; answers Q-31)
- **Do:** Plug the Toon in. Start the stopwatch the moment the Toon answers in a browser. Do not touch Homey.
- **Expect:** the device becomes available again by itself and the values refresh; typically after 60 to 90 seconds; in the worst case up to 5 minutes (the back-off while down grows to 5 minutes). No Flow and no app restart is needed.
- **Record:** seconds from "Toon answers" to "available"; the log line "the Toon answers again: device set available".
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-H.5  A short hiccup**  (FR-81; ADR-0005)
- **Do:** Unplug for 40 to 60 seconds and plug in again.
- **Expect:** the device never becomes unavailable.
- **Record:** yes/no.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-H.6  App restart and Homey restart while the Toon is down**  (NFR-08, FR-84)
- **Do:** With the Toon unplugged and the device unavailable: restart the app (`npx homey api apps restart-app --id nl.vinceste.open-toon`). Then, with the Toon plugged in again, restart the Homey itself.
- **Expect:** after the app restart the device stays unavailable (not available for a moment) and your other devices of other apps are unaffected; the app starts within seconds even though the Toon is down. After the Homey restart the device comes back with its old values at once and fresh ones within 10 seconds.
- **Record:** what you saw and how long it took.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-H.7  Nightly Toon reboot**  (answers Q-15)
- **Do:** Leave the device running overnight with the app log (A.8) or the Timeline visible in the morning. Run `node scripts/toon-probe.js <ip> --samples 960 --every 60 --label "overnight"` from 22:00 to 14:00 if you can (this adds a little load; see L.1).
- **Expect:** no fixed expectation. If the Toon reboots by itself at night (`03` T6, one source) the device may flip to unavailable and back once. Record whether and when.
- **Record:** `watch.outcomeChanges` of the probe file (the time the Toon stopped and started answering) and the Timeline entries of the device.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-H.8  ToonWater while the Toon is down**  (FR-55)
- **Do:** With ToonWater on, repeat H.2 and H.4 and read the settings.
- **Expect:** during the outage the ToonWater status says "Toon not reachable", **not** "not found", and there is no "not found" warning; after recovery the status returns to "Detected" without you doing anything.
- **Record:** the statuses over time.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

## 10. Phase I - Settings changes

**HT-I.1  The settings page**  (FR-59 AC4, FR-85; answers Q-21; 01-HW-13)
- **Do:** Open the settings in English and in Dutch.
- **Expect:** groups "Local Toon Settings" / "Lokale Toon Instellingen" (IP Address / IP Adres, Update interval / Update-interval in seconds), "Status" (Last successful update / Laatste succesvolle update, Last problem / Laatste probleem; read-only), "ToonWater (optional add-on)" / "ToonWater (optionele add-on)" (the tick box and the status line), "Power export (optional)" / "Teruglevering (optioneel)". Hints are readable and not cut off. The "Last successful update" time moves forward in steps of 15 minutes or more (it is written at most every 15 minutes, to spare the Homey's storage).
- **Record:** screenshots; whether the read-only lines re-draw by themselves after a poll or only after you close and reopen the page (Q-21).
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-I.2  An invalid address**  (FR-82 AC1, AC3; FR-03; answers Q-21)
- **Do:** Enter `0.0.0.0`, then `192.168.1.50/foo`, then `https://192.168.1.50`, then an empty field, and save each time.
- **Expect:** an error with a plain sentence and **the old address stays** (reopen the page to check); the device keeps working with the old address. Write down: does Homey show the sentence of the app, does the field in the page snap back or stay with your wrong text?
- **Record:** screenshots and the sentences.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-I.3  A new address**  (FR-82 AC2)
- **Do:** With two Toons: change the address of the device from Toon A to Toon B, save, and watch the tile. Change it back.
- **Expect:** within one interval the values are those of Toon B; the old Toon is no longer asked. The same address typed as `http://<ip>/` is accepted and changes nothing visible.
- **Record:** the seconds until Toon B's values appear; compare the tile with Toon B's screen.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-I.4  The update interval**  (FR-83; answers Q-06)
- **Do:** Try 5, 3601, `abc` and an empty value, then 10, 60 and 3600. Note which layer refuses what: Homey's own field limits or the app.
- **Expect:** 5, 3601 and `abc` are refused ("The update interval must be a number of seconds from 10 to 3600." / "Het update-interval moet een aantal seconden van 10 tot 3600 zijn."); 10, 60 and 3600 are accepted; an empty value means 30. A change takes effect without restarting the app (watch the tile with the power item: at 10 seconds it changes faster than at 60).
- **Record:** the result per value.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-I.5  The save with ToonWater on a slow Toon**  (answers Q-21)
- **Do:** Tick ToonWater and save while the Toon is slow or when it does not answer.
- **Expect:** the save finishes within about 8 seconds; the toast appears; the page does not hang.
- **Record:** seconds until the toast.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-I.6  Power export**  (FR-25; optional)
- **Do:** Tick and untick "Show power export" on a device.
- **Expect:** the item appears and disappears; the save message names the consequence for Flows and Insights (en/nl); the other items are untouched.
- **Record:** the toast words.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-I.7  Rename and move the device**
- **Do:** Rename the device and move it to another zone.
- **Expect:** it keeps working; Flows that use it still find it.
- **Record:** yes/no.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

## 11. Phase J - Deleting and lifecycle

**HT-J.1  Delete a device**  (FR-84; NFR-12)
- **Do:** With two devices on two Toons running, delete one. Read the log (A.8). Wait 5 minutes.
- **Expect:** it disappears without an error; no `TypeError` in the log (the old build threw one); the other device keeps updating at its normal pace; the "Last successful update" of the other device is unaffected. If you can see the deleted device's Toon: it receives no more requests.
- **Record:** log excerpt, what the Toon showed.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-J.2  Delete with ToonWater on and a warning showing, and delete while unavailable**
- **Do:** Delete a device that has the "not found" warning (G.7); delete another while its Toon is unplugged.
- **Expect:** both disappear cleanly; no later log line mentions them.
- **Record:** log.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-J.3  Add the same Toon again**
- **Do:** Add the Toon you deleted again, with the same id.
- **Expect:** allowed; a fresh device; no leftover value, warning or status from the deleted one; Insights start empty.
- **Record:** screenshot.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-J.4  Flows that used the deleted device**
- **Do:** Open a Flow that used it.
- **Expect:** Homey shows a missing device in the usual way. Record how.
- **Record:** screenshot.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-J.5  Disable and enable the app; uninstall and install**
- **Do:** Disable the app in the Homey app (Apps, Open-Toon, the menu) and enable it again. Then uninstall it (this removes all its devices) and run `npx homey app install` again.
- **Expect:** disabled: devices unavailable; enabled: they recover and values return. Uninstall: clean. Fresh install: starts without errors, the first device can be added (phase D).
- **Record:** what you saw; the log of the first start.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

## 12. Phase K - Several Toons and other models

**HT-K.1  Two Toons at once**  (FR-04 AC3; 01-HW-14)
- **Do:** Two devices on two Toons for a day; unplug Toon A for ten minutes.
- **Expect:** Toon A's device goes unavailable and recovers; Toon B's device never notices.
- **Record:** both tiles' behaviour.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-K.2  Toon 1 and Toon 2, single and two tariff**  (answers Q-01, Q-28)
- **Do:** Run the probe on every Toon you own (A.6) and compare `metersAnalysis` and the thermostat fields.
- **Expect:** no fixed expectation: compare the node keys (`dev_2.x` or others), the `type` strings and the quantity kinds (`number` or `nan`) between Toons.
- **Record:** one line per Toon in the Q-01 table.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-K.3  The community app "toonWater" next to this one** (optional; 01-HW-14, persona P8)
- **Do:** If you have it: run both apps against the same Toon for an hour.
- **Expect:** no fixed expectation: record whether the Toon slows down (L) and whether anything conflicts.
- **Record:** yes/no and a sentence.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-K.4  Other Homey models** (optional; NFR-07, 01-HW-15)
- **Do:** On every other Homey model you have (Pro 2016-2019, Pro mini): install, add a device, check the tile (E.1 to E.8) and the offline test (H.2, H.4).
- **Expect:** the same as on the first Homey. Models you cannot test stay "untested" in the README.
- **Record:** model, firmware, result.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

## 13. Phase L - Endurance and the load on the Toon

**Idea.** The question is not "does it run" but "does our polling hurt the Toon". The probe acts as a constant measuring instrument (the same four requests every 60 seconds in every run, so its own load is the same everywhere) while the app's interval is the thing that changes: 3600 seconds (almost no load from the app, the control), 60, 30 (default) and 10. If the Toon's answers get slower or fail at shorter intervals, or the Toon's own screen gets sluggish, the interval is too aggressive. Between runs, wait 10 minutes.

**HT-L.1  The measuring run**  (NFR-03, FR-80 AC5; answers Q-06; 01-HW-10)
- **Do:** Use one device on one Toon, nothing else polling that Toon (see K.3). For each interval in this order: 3600, 60, 30, 10: set the device's Update interval (I.4), wait 5 minutes, then run for two hours in the project folder:
  - `node scripts/toon-probe.js <ip> --samples 120 --every 60 --label "app interval 30 s" --out ~/open-toon-test/probe/`
  - Ctrl+C stops early and still writes the file. Every 30 minutes use the Toon's own screen (open the thermostat, the energy screen, a menu) and write down how responsive it feels, with a stopwatch if you can: seconds from touch to screen.
- **Expect:** no fixed expectation: this is a measurement. Proposed acceptance (to be confirmed by you): no `timeout` or `network` outcome in `watch.latency` at 30 s; the median and the 95th percentile of the answer time of each endpoint at 30 s within twice those of the control run; the Toon's screen as quick as in the control run. `getDevices.json` (the `meters` endpoint) is the heaviest answer: look at it first.
- **Record:** per run the file name and, from `watch.latency`, for thermostat, power, meters (and water): `outcomes`, `medianMs`, `p95Ms`, `maxMs`; the screen notes; whether the Toon rebooted (its clock or uptime).
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-L.2  24 hours at the default**  (FR-80 AC5, NFR-03 AC4)
- **Do:** With the device at 30 seconds: `node scripts/toon-probe.js <ip> --samples 1440 --every 60 --label "24 h at 30 s"`. Leave everything else as normal. If you want the raw answers of the Toon in the app log, install once with an `env.json` as in A.8.
- **Expect:** values stay current for 24 hours; at most the nightly flip of H.7; the Toon stays responsive.
- **Record:** the probe file; `npx homey api apps get-app-usage --id nl.vinceste.open-toon` at the start and at the end (its output format was not seen; write it down as it is); the number of Timeline entries the app made.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-L.3  Data quality after 24 hours**  (FR-114, NFR-12)
- **Do:** Open the Insights of the device.
- **Expect:** continuous graphs, meters only increase, no zeros, no gaps except outages you caused; not an excessive number of points.
- **Record:** screenshots.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-L.4  Burner and state over a day** (answers Q-04, Q-07, Q-08)
- **Do:** One day with heating and hot water use: `node scripts/toon-probe.js <ip> --samples 1440 --every 60 --no-water --label "burner day"`. Keep a paper log of what you did and when (tap, setpoint changes, preset changes, program transitions).
- **Expect:** `watch.fieldChanges` lists every change of `burnerInfo`, `activeState` and `programState` with its time.
- **Record:** the file and the paper log (Q-04).
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

## 14. Phase M - Wrap-up

**HT-M.1  Restore**
- **Do:** Put every Toon back as in A.5 (setpoint, preset, program). Decide which test devices to keep. Remove `env.json` from the project folder if you made one and install again.
- **Expect:** the heating works as before.
- **Record:** yes/no.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

**HT-M.2  The report**
- **Do:** Fill in Annex 3. Put the probe files (after reading them, Annex 1.3), the answers to the Q-nn of section 15 and the list of FAILs in a GitHub issue or in a chat. Keep screenshots and snapshots private unless you have blanked what is personal.
- **Expect:** someone who was not there can see what was tested, on what, and what happened.
- **Record:** the link or message.
- **Result:** [ ] PASS | [ ] FAIL | [ ] N/A | Notes:

## 15. Questions only hardware can answer

Each question says what the app assumes today and where (so a wrong assumption is a small, known edit), why a mock cannot answer it, the experiment, what to collect, and what to change depending on the answer. File and line numbers are those of this working tree on 2026-11-14; if the lines moved, search for the named constant. Every Toon payload in the repository is a fixture whose `source` says "derived ... not captured" (`test/fixtures/toon/*.json`): the captures below replace them.

The probe commands use `<ip>`; add `--out ~/open-toon-test/probe/` to each. Annex 1.4 says which field of the probe file answers which question.

### Q-01 Which meter nodes does each Toon use: `dev_2.x` or other adapters?  (OQ-05, FR-21, FR-22, FR-26; issues #9, #10; 01-HW-02, 04-HW-13)
* **Assumes:** gas, peak, off-peak and single-tariff are read from `dev_2.1`, `dev_2.4`, `dev_2.6`, `dev_2.2`; if a key is missing a node whose `type` is exactly one of the strings of `METER_RULES` is used (`lib/toon/parse.js:38`, `discoverMeters` :68); two candidates for one role means no value and one log line. The type strings (`gas`, `elec_delivered_nt`, `elec_delivered_lt`, `elec`) are from document 03 section 4.4 with medium confidence. Users with `dev_4.x` were told to edit the code (issues #9, #10).
* **Why hardware:** no real `getDevices.json` is in the repository; all three layouts of the fixtures are derived.
* **Experiment:** on every Toon (Toon 1 and Toon 2, single and two tariff, with and without gas, with and without solar): `node scripts/toon-probe.js <ip> --label "toon X, two tariff, gas, no solar"`. Compare each counter with the screen of the Toon and the meter display (E.4, E.6).
* **Collect:** the probe file per Toon; photos of the meter displays; the app log line "meter nodes are ambiguous ..." if it appears. From the file: `metersAnalysis.legacyKeysPresent`, and for every node `key`, `type`, `fields`, `quantities` (`number`, `nan`, `other`). Look for nodes whose type contains `received` or `production` and whose quantity is a number: those are the export counters (Q-11).
* **Decision:** all Toons show the four legacy keys with the types above: keep. A Toon with other keys but the same type strings: works already, add its masked file as a fixture. A Toon with other type strings: add them to `METER_RULES` (one table, one line each) and add a fixture. A Toon where two nodes share a type: choose a tie rule or build the manual override (FR-23). Export counters present: design FR-26 (cumulative export) with the real key. Replace the derived fixtures with the masked captures (`test/fixtures/toon/`, update the `source` line, keep the "NaN" cases).

### Q-02 What does `resume_program` really do?  (FR-13, FR-14, FR-15; ADR-0015; 01-HW-04)
* **Assumes:** "Resume program afterwards" sends `changeSchemeState&state=2&temperatureState=<preset>`, the temporary override that the old build always sent; "Disable program" sends `state=0&temperatureState=<preset>`, **a placeholder** with no hardware evidence (`lib/toon/commands.js:29-32`); `enable_program` is `state=1`, `disable_program` is `state=0`. The mock Toon models the same guesses (`test/helpers/mock-toon.js:335`). Meaning of `programState` (0 off, 1 program, 2 temporary override) is a hypothesis (`lib/toon/parse.js:160`).
* **Why hardware:** only the Toon can say what it does with these requests.
* **Experiment:** program ON, start from the preset Home. Tip: add a program step 10 to 15 minutes ahead on the Toon itself so you need not wait for hours (restore the program afterwards). For every row wait 15 seconds, then `node scripts/toon-probe.js <ip> --no-water --label "<row>"` and photograph the Toon.

  | Row | Action | Also watch |
  |---|---|---|
  | R0 | on the Toon's screen: choose Sleep (reference) | does the screen say "temporary" or similar; what happens at the next program step (`nextTime`, `nextState` in the file) |
  | R1 | Flow "Set temperature state to Sleep, Resume program afterwards" | same as R0: is it the same state as R0? |
  | R2 | Flow "Set temperature state to Sleep, Disable program" | is the program switched **off** on the Toon's screen; is Sleep applied; what happens at the next program step |
  | R3 | Flow "Enable program" | program back on |
  | R4 | the tile picker: Sleep | equal to R1? |
  | R5 | Flow "Disable program", then "Set temperature state to Away, Resume program afterwards" | does it switch the program back on? |
  | R6 | the tile target temperature +1 degree | what `programState` and `activeState` become; when does it revert |
  | R7 | Flow "Enable program"; put the Toon back as in A.5 | |
* **Collect:** per row: the probe file label, `programState`, `activeState`, `currentSetpoint`, the Toon's words, the time.
* **What the Toon community's own clients do (2026-11-15, `12-tsc-interface-findings.md` section B):** both pick `state` from the current `programState`: 0 when the program is off, otherwise 2 with the preset. Nobody sends `state=0&temperatureState=<id>` while the program is on, so our "Disable program" placeholder is untested in that situation. Expectation for R5: a `state=2` request while the program is off probably reports `programState` 2 (the program is back on).
* **Optional raw requests (the app never sends these; you run them with `curl` and put the Toon back afterwards):** (a) from program-on, `state=0&temperatureState=<id>` as one request, against two requests, `state=0` and then `state=0&temperatureState=<id>`: which one leaves the program off with the preset applied; (b) `state=8&temperatureState=<id>`, which the community's web app calls "locked" (program stays on), and what the Toon's screen calls it.
* **Decision:** if R2 leaves the program off and applies the preset: the placeholder is right, remove the "unverified" marks (README, ADR-0015). If it does not: find the sequence that does (for example a `state=0` followed by a `state=2` request), put it in `RESUME.no` and fix the mock's state machine and the tests that pin the old sequence. If no sequence does it: make "Disable program" identical to "Resume program afterwards" and change the label (the fallback of ADR-0015). If R5 shows that "resume" switches the program back on, say so in the README.

### Q-03 How does vacation show up?  (OQ-07, FR-12; 01-HW-04)
* **Assumes:** `activeState` 4 is vacation (`lib/toon/parse.js:14`, from document 03 I2 and the audit); the mock starts it with `state=8&temperatureState=4` and shows `programState` 4 (`test/helpers/mock-toon.js:338`); the app never sets vacation; the tile picker lists it but refuses it.
* **Why hardware:** the code table comes from third-party notes, not from a Toon.
* **Disputed (12 section B):** the mock's `state=8&temperatureState=4` entry follows a Home Assistant integration, while the Toon community's web app names programState 8 "locked base" and holiday 4/5, and holiday is entered through a different, internal request (SetHoliday). Treat the request as unverified; capture holiday mode started on the Toon's own screen first, and try the raw request only afterwards, and only if you are willing to put the Toon back by hand.
* **Experiment:** put the Toon into holiday mode on its own screen for ten minutes; probe; look at the tile ("Vacation" / "Vakantie"); run "Current temperature state is Vacation"; select Vacation on the tile; end holiday mode on the Toon and probe again. Restore the Toon.
* **Collect:** `activeState`, `programState`, `currentSetpoint`, `nextState` before, during and after; the tile; the toast words.
* **Decision:** code 4 confirmed: keep. Another code: change the table (`TEMPERATURE_STATES`), the mock and the fixtures. A code that the app does not know appears at any time (also -1 or 5): add it as an enum value (additive) or map it to "No state"; the app already keeps the old value and logs a note for an unknown code.

### Q-04 What do the `burnerInfo` values mean?  (FR-30, FR-32, issue #26; 01-HW-08)
* **Assumes:** 0 off, 1 heating, 2 hot water, 3 pre-heating (`BURNER_STATES`, `lib/toon/parse.js:18`). Only 2 is confirmed by the old code; 1 by the reporter of issue #26; 0 and 3 by the audit (model-generated).
* **Why hardware:** the boiler decides.
* **Known (12 section A):** 0, 1 and 2 have three independent sources in the Toon community's code; 3 has one, which counts it as hot water. So 3 is the value to provoke and write down.
* **Experiment:** E.8 for single moments, and L.4 for a whole day: `node scripts/toon-probe.js <ip> --samples 1440 --every 60 --no-water --label "burner day"` with a paper log of what you did. Try to provoke pre-heating by setting a program step with a higher setpoint 30 minutes ahead.
* **Collect:** `watch.fieldChanges["thermostat.burnerInfo"]` (`seen` counts and `changes` with times), `watch.ranges["thermostat.currentModulationLevel"]`, your paper log.
* **Decision:** values match: keep, and promote FR-30/FR-32 to confirmed. A value is different: edit `BURNER_STATES` (and `HOT_WATER` follows), the English and Dutch titles of `burner_state` (`.homeycompose/capabilities/burner_state.json`) and the fixtures. A value that never shows up (3): keep it, say "unconfirmed" in the README. A value above 3 that does show up: add an enum value (additive; the app keeps the old state and logs a note for unknown ones).

### Q-05 What is the real `/water.html`?  (FR-55, FR-58, A-04, OQ-14, L-1; 01-HW-07, 04-HW-13)
* **Assumes:** `{"result":"ok","water":{"flow":N,"total":N,"value":N,"avgValue":N}}`; `flow` in litres per minute, `value` (today) and `total` in litres, shown as m3 with three decimals (`lib/features/toonwater.js:39`); `total` is missing on add-on versions older than 1.1.16; a Toon without the add-on answers HTTP 404; the add-on writes the page only when flow or today's total changes, so the page may be missing or stale after a reboot (an inference).
* **Why hardware:** no add-on was available; the facts come from a read of the add-on's interface, not from a run.
* **Experiment:** G.4, G.6, G.7 and G.14. On Toon-with: probe at rest, with a tap open, 10 minutes after, and after a reboot; also read the add-on's own screen and its version, and the physical water meter. On Toon-without: probe once.
* **Collect:** the probe files (`endpoints[water]`: `status`, `contentType`, `body`), the add-on version, the litres you drew, the meter readings.
* **Decision:** units differ (for example `total` in m3): change the divisors in `parseWater`. Another status than 404 on a Toon without the add-on (403, 200 with HTML): adjust the "not found" classification (FR-55 AC7) and the status text. The page stays stale or missing after quiet periods: add that to the README (no timestamp exists to detect it, L-1) and keep the 15-minute back-off. `total` absent on a current add-on: the fixture `water-no-total` becomes the normal case.

### Q-06 How much polling can the Toon take?  (NFR-03, OQ-08, FR-80 AC5; 01-HW-10; audit open question 11)
* **Assumes:** one request at a time, four per 30-second cycle at most (thermostat, power, meters, and water when on), each with a 5-second timeout; default interval 30 s, limits 10 to 3600 s (`lib/engine/schedule.js:88`); the heaviest answer is `getDevices.json`. There is no measurement of the Toon's capacity anywhere.
* **Why hardware:** the Toon is a small embedded computer; its limits are unknown.
* **Experiment:** L.1 (four runs of two hours with the app at 3600, 60, 30 and 10 seconds, the probe at 60 seconds as the constant instrument) and L.2 (24 hours at 30 seconds).
* **Collect:** per run `watch.latency` (outcomes, `medianMs`, `p95Ms`, `maxMs` per endpoint), the Toon-screen notes, reboots.
* **Decision:**

  | Result | Change |
  |---|---|
  | no timeouts, answer times at 30 s and at 10 s within twice the control run, the screen is as quick | keep 30 s default and 10 s minimum |
  | trouble only at 10 s | raise the minimum to 30 s (setting limit and the clamp in `intervalMs`) |
  | trouble at 30 s | default 60 s; read the meters every second cycle (`every: 2` of the group, ADR-0005) |
  | trouble at 60 s | read the meters every 5 minutes at most and tell the README that this Toon is fragile |
  Any change is an ADR amendment and a changelog line.

### Q-07 What do the `programState` values mean?  (FR-15, pairing screen "Program: On/Off")
* **Assumes:** 0 means the program is off, 1 and 2 mean it runs (2 after a temporary override); everything else (such as 4) is not shown (`parseProgram`, `lib/toon/parse.js:160`).
* **Experiment:** the rows of Q-02 and Q-03; note `programState` each time, and compare D.6 ("Program: On/Off" at pairing) with the Toon's screen for both program settings.
* **Collect:** a table of `programState` against what the Toon says.
* **Decision:** adjust `parseProgram`; if the values are clear, FR-15 (a "Program is on" condition) becomes cheap to add.

### Q-08 The preset codes and odd setpoints  (FR-10, FR-12; ADR-0014)
* **Assumes:** `activeState` 0 Comfort, 1 Home, 2 Sleep, 3 Away, -1 none (`lib/toon/parse.js:14`); the setpoint is in hundredths of a degree and is rounded to 0.5 on the tile (a Toon set to 19.75 by another client shows 20.0).
* **Experiment:** E.3, D.6 and Q-02: choose each preset on the Toon's screen and probe; set 19.75 on the Toon if its screen allows.
* **Collect:** preset name on the Toon against `activeState`; the setpoint text and the tile value. Also: after a manual setpoint change, does `activeState` read -1 or 6 (one Toon bridge calls 6 "manual", the simulator says -1; 12 section A), and which `programState` values appear (the nine codes of 12 section A; the app only reports 0, 1, 2, 3 and 8).
* **Decision:** a different order: change `TEMPERATURE_STATES` (and then the mock, the fixtures and every Flow that stored the old meaning, which is why this must be settled before release). Setpoints finer than 0.5 are a tile display question only.

### Q-09 What does a new setpoint do on the Toon?  (FR-11 AC4; 01-HW-03)
* **Assumes:** `setSetpoint&Setpoint=<degrees x 100>` makes a temporary manual setpoint; the Toon decides when it returns to the program (not known).
* **Experiment:** E.2 with probes before, right after, and after the next program step.
* **Collect:** `programState`, `activeState`, `currentSetpoint` at each moment; what the Toon's screen says.
* **Decision:** document the behaviour in the README ("the Toon returns to its program at the next program step" or not). If the Toon treats it as permanent while the program is on, say that too.

### Q-10 Is there an instantaneous gas value?  (FR-29 COULD; issue #11)
* **Assumes:** `gasUsage.value` is null or missing on most Toons (the app reads only the total).
* **Experiment:** run the probe while the boiler burns (`--label "boiler on"`).
* **Collect:** `endpoints[power].body.gasUsage`, and `CurrentGasFlow` of the gas node in the meters answer.
* **Decision:** a real number with a clear unit on your Toons: FR-29 can be planned; otherwise it stays out.

### Q-11 Power export and export counters  (FR-25, FR-26, OQ-06, issue #23; 01-HW-11)
* **Assumes:** `powerProduction.value` (watts, never negative) is in the same answer as the import; the node that carries the produced energy is unknown (`lib/toon/parse.js:172`).
* **Experiment:** on Toon-solar in sunshine: E.9; probe with `--label "exporting"`; compare with the P1 or inverter display; look for `elec_received_*` nodes in `metersAnalysis`.
* **Collect:** `power.body.powerProduction`, the P1 display, the nodes of Q-01.
* **Decision:** values match: keep. They do not: fix or drop the item. Counters present: design FR-26 with the real node. Also settle whether Homey Energy treats a household that exports wrongly (E.11): only then think about a net power item (FR-27).

### Q-12 Boiler values (pressure, temperatures, modulation)  (FR-33, OQ-07, issue #2)
* **Assumes:** nothing: not built. Issue #2 names a file `/boilerstatus/boilervalues.txt` that this plan did not verify.
* **Experiment:** open `http://<ip>/boilerstatus/boilervalues.txt` in a browser (a read-only request) and write down whether it exists. If it does, copy the text, remove anything personal and keep it.
* **Collect:** exists or not, its format and field names.
* **Decision:** it exists and is stable: FR-33 can be planned as an opt-in feature like ToonWater (ADR-0006 pattern). Otherwise it stays out.

### Q-13 How does the Toon treat our request headers?  (ADR-0003 H4)
* **Assumes:** `Accept-Encoding: identity` and `Connection: close` on every request (`lib/toon/client.js:17`); the Toon answers uncompressed and closes after each answer.
* **Experiment:** the probe sends the same headers: if it works, the headers are accepted. Also: `curl -sv "http://<ip>/happ_thermstat?action=getThermostatInfo" -H "Accept-Encoding: gzip" -o /dev/null` and note the response headers.
* **Collect:** the `Server`, `Content-Encoding` and `Connection` response headers (the probe writes them for every answer: `endpoints[*].server`, `.contentEncoding`, `.connection`), answer times with and without the headers. The community's own firmware config enables gzip for `text/html`, which is why the app asks for `identity`.
* **Decision:** if the Toon misbehaves with `Connection: close` (resets, slow), remove it; if it always sends compression despite `identity`, the client must decode it.
* **Known platform behaviour (not a hardware question):** after an answer over the 2 MiB cap the app cancels the stream, but Node 22's `fetch` may keep the socket open for a while when the server still has data to send (ADR-0003, 2026-11-15). A real Toon is not expected to send that much; if the probe ever reports `too_large`, note it and how long the Toon shows an open connection.

### Q-14 Content type and body shape of every answer  (T3)
* **Assumes:** answers are JSON text with `Content-Type: text/javascript`; the body is always parsed with `JSON.parse` of the text (`lib/toon/client.js`).
* **Collect:** `contentType` and `bodyKind` of each endpoint in the probe file, for every Toon and for the water page.
* **Decision:** any answer that is not JSON on a healthy Toon (for example `result` spelled differently) is a bug to fix in the client.

### Q-15 Does the Toon restart by itself at night?  (03 T6, ADR-0005 constants)
* **Assumes:** one source says so; the device flips unavailable and back once a night at worst.
* **Experiment:** H.7.
* **Collect:** `watch.outcomeChanges` with times, Timeline.
* **Decision:** if the outage is longer than the rule (3 failed rounds spanning 90 s, `lib/engine/schedule.js:91`), the device flips every night: tune the constants (a longer window, or a quiet period) so that a known night reboot does not show.

### Q-16 Does Homey fire "Temperature state changed" itself?  (04-HW-06; `lib/features/core.js:69`)
* **Assumes:** Homey fires `<capability>_changed` for a custom capability when the value changes, so the app does not (`source: 'homey'`).
* **Experiment:** C.6 and F.2.
* **Collect:** runs per change.
* **Decision:** never fires: change `'homey'` to `'app'` in the rule (one word). Fires twice: something else is also firing it; find out which. Fires once: done.

### Q-17 What do the card arguments look like?  (04-HW-10)
* **Assumes:** dropdown arguments arrive as text or as `{id}` objects; the run listeners accept both (`normalizeDropdown`, `lib/flow/cards.js`).
* **Experiment:** F.7, F.8; look at the Dutch and English dropdown entries too: readable names (title) or ids (label)?
* **Decision:** if a dropdown shows blank entries, add the missing `title` or `label` (both are emitted today).

### Q-18 Do deprecated cards behave as documented?  (04-HW-07)
* **Assumes:** hidden from the card list, kept in existing Flows, tokens usable (`app.json` flow cards marked `deprecated`).
* **Experiment:** C.4, F.1, F.6, F.11.
* **Decision:** if an old Flow loses the card or its tokens, the deprecation was wrong: undo it (ADR-0007 says deprecation is a one-way door in the contract test: that test needs an exception entry for the change).

### Q-19 What does removing the water items do to Flows and Insights?  (FR-53, FR-54, D-1; 01-HW-05, 01-HW-06, 04-HW-08)
* **Assumes:** Flows that use removed items break; the Homey-side Insights history may be lost; the items return with the same ids when ToonWater is turned on again (`docs/adr/0006`, 0007; the hint text says all of it).
* **Experiment:** G.10, G.11.
* **Collect:** how Homey shows each Flow, whether it heals, whether the history is kept or restarts.
* **Decision:** history kept and Flows heal: soften the hint text (en/nl). History lost and Flows stay broken: the text is right; consider the parked "hide only" mode (D-6) if you receive complaints.

### Q-20 Which water cards does the Flow editor show?  (the owner's wish; `08` O-7; 01-HW-05, 04-HW-09)
* **Assumes:** with ToonWater off there is no water item and no water card; with it on, Homey's own cards for the three items appear; the app's own water cards are deprecated and hidden in both cases (ADR-0007).
* **Experiment:** G.1, G.3, G.5.
* **Collect:** the full lists with ToonWater off and on.
* **Decision:** if the cards you need when it is on are missing, undo the deprecation of `measure_water_changed` and `update_water` or add a new card (additive). If water cards show when it is off, find out which and why.

### Q-21 Do the settings behave the way the app assumes?  (FR-59, FR-82, FR-85; 01-HW-13)
* **Assumes:** a thrown error in `onSettings` rejects the save and shows its text; read-only `label` lines re-draw after `setSettings`; `setWarning` shows on the tile; a save with ToonWater on finishes within about 8 seconds (`docs/sdlc/05-architecture.md` section 6.3, 6.5).
* **Experiment:** I.1 to I.5, G.7, G.9.
* **Decision:** if a rejected save keeps the wrong text in the field, or the status lines do not redraw, move the status into the warning text (the fallback named in section 6.3 of document 05).

### Q-22 Are the defaults of new settings present on upgraded devices?  (04-HW-04, U3)
* **Assumes:** none of the code depends on it (empty means 30, `toonwater_enabled` is decided from the capabilities, never from the default).
* **Experiment:** C.3.
* **Decision:** informational. If the interval shows empty, nothing breaks; record it.

### Q-23 Do added capabilities get their titles and options on old devices?  (04-HW-03, U1, U2)
* **Assumes:** `burner_state`, the hot-water flag and, when switched on, the water and export items get their manifest titles and options after `addCapability` (the app also sets the options itself when they differ).
* **Experiment:** C.3 (titles in both languages), G.4, E.9.
* **Decision:** wrong or English-only titles on upgraded devices: set the options explicitly in the migration.

### Q-24 Does the picker of an upgraded device offer Vacation?  (04-HW-05)
* **Experiment:** C.3, E.3.
* **Decision:** if not, the enum definition does not reach old devices: handle it in the migration or document that the device must be re-added (against FR-110, so find another way first).

### Q-25 What does Homey Energy do with the Toon?  (FR-90, FR-63; ADR-0016; 01-HW-11, 04-HW-11)
* **Assumes:** nothing: FR-90 is deferred. The manifest keeps the old `energy.cumulative` block, which makes Homey read the gas and (if present) water meter.
* **Experiment:** E.11.
* **Decision:** if gas shows and nothing is counted twice, leave it. If kWh is missing and you want it, FR-90 (an imported-energy item) is the next step, with the safeguards of `04` C-EN-1.

### Q-26 Install over the same version, and what an install keeps  (04-HW-02, U9, U12)
* **Experiment:** C.1, C.7.
* **Decision:** if same-version installs are refused, the release notes must say that every test build needs a new version number.

### Q-27 The step from whole numbers to three decimals  (FR-114)
* **Experiment:** C.5, C.6.
* **Decision:** more than one trigger run for that step, or a visible dip in Insights: add a note to the changelog or smooth the first value.

### Q-28 Toon 1 and Toon 2 differences  (audit section 5)
* **Experiment:** K.2.
* **Collect:** the thermostat field lists of both, the meter nodes, the pairing readings.
* **Decision:** any field that exists on only one generation and that the app reads is a risk; note it in the README.

### Q-29 The message for a duplicate id  (FR-04 AC2; 01-HW-01)
* **Experiment:** D.9. **Decision:** if Homey's message is unclear, add an app-side check with a clearer sentence.

### Q-30 What does Homey block on an unavailable device?  (FR-73 AC3; 04-HW-12)
* **Experiment:** F.12, H.3. **Decision:** informational for the README; if Flows get stuck, consider a shorter window before the device is marked unavailable.

### Q-31 How long does recovery take?  (`08` O-1; FR-81 AC3)
* **Experiment:** H.4. **Decision:** a recovery slower than 5 minutes means the back-off cap is too high; faster than 2 minutes is fine.

### Q-32 Can the old SDK 2 builds be installed at all?  (04-HW-14)
* **Assumes:** nothing. Validation passes with CLI 4.6.3 for `380e999` and `426e2c2`.
* **Experiment:** B.4, C.8. **Decision:** if the Homey refuses SDK 2 apps, the eras 1 and 2 can be tested only on devices that already exist; say so in the report.

### Q-33 What exactly is the hot water flag?  (audit open question 9; FR-31)
* **Assumes:** `alarm_water.hotwater` is true when `burnerInfo` is 2 (the boiler is making tap water), and it stays that way for compatibility although it is shown to Homey as a water alarm.
* **Experiment:** E.7 and Q-04: does it also turn on when no tap is open (pre-heat of the boiler, circulation)? What does Homey put on the Timeline?
* **Decision:** if it is true without a tap, the title "Hot water dispensing" is misleading: reword the title (a title change is safe) and the README. The id stays.

### Q-34 The questions of the audit that are not about hardware  (`00` section 6)

| Audit item | Where it is answered |
|---|---|
| 1 converge with the community "toonWater" app (OQ-01) | owner decision; K.3 gives the practical facts |
| 2 hardware | this plan |
| 3 distribution (OQ-02), 10 branches | owner decision |
| 4 compatibility floor 12.9.0 (OQ-04) | A.1 (your Homey firmware) and K.4 |
| 5 meter mapping | Q-01 |
| 6 `resume_program` | Q-02 |
| 7 vacation | Q-03 |
| 8 water items on Toons without the add-on | settled by the opt-in; G.1, G.2 |
| 9 `alarm_water.hotwater` | Q-33 |
| 11 default interval 30 s | Q-06 |
| OQ-03 (pairing checkbox), OQ-09 (token), OQ-11, OQ-13, OQ-15 | design questions: D.7, D.11 give the pairing experience; the rest is not hardware |
| OQ-10 (what is installed on your Homey) | B.1 |
| OQ-12 (an id derived from the Toon) | Q-35 |
| OQ-14 (stale water data) | Q-05 |

### Q-35 Does a Toon answer carry a stable id of its own?  (OQ-12)
* **Assumes:** the device id is whatever you type at pairing (an immutable `data.id`).
* **Experiment:** read the probe files: the masked fields show which field names hold a text (`"<redacted>"`) and `redaction.counts`. Fields whose names say id, name or serial are the candidates.
* **Decision:** a stable id exists in a read-only answer: it could prefill the id field at pairing (not replace the scheme: changing `data.id` for existing devices is excluded by the stability contract). Otherwise nothing changes.

## Annex 1 - Evidence, the probe and the log

### Annex 1.1 Folder for the evidence (outside the repository)

```
~/open-toon-test/
  probe/        toon-probe-<UTC time>.json     (one per probe run; the label inside says what it was)
  snapshots/    A7-*.json  B6-*.json  C1-*.json  C3-*.json   (Homey devices, Flows, Insights; private)
  screens/      HT-D.6-pair-result.png  HT-G.10-flow-broken.png  ...   (step id first)
  report.md     Annex 3
```

### Annex 1.2 The probe: commands

```
node scripts/toon-probe.js <ip>                                   one look: four GET requests, one file
node scripts/toon-probe.js <ip> --label "heating on" --out ~/open-toon-test/probe/
node scripts/toon-probe.js <ip> --no-water                        do not ask for the ToonWater page
node scripts/toon-probe.js <ip> --samples 120 --every 60          two hours, one look a minute (summary of changes and answer times)
node scripts/toon-probe.js <ip> --stdout                          print instead of writing a file
node scripts/toon-probe.js --help
```

* Needs Node.js 22 or newer and nothing else; the one file `scripts/toon-probe.js` can be copied to any computer on the Toon's network. It is not part of the Homey app (`.homeyignore` excludes `scripts/`; `npm run pack:check` fails if it ever ends up in the package).
* **Read only by construction:** a fixed table of four requests (the same paths and queries as the app: thermostat status, current power, meter totals, the ToonWater page), always GET, one at a time, a 5-second limit each (`--timeout`), redirects are not followed, answers larger than 2 MiB are dropped. There is no option to send anything else. If the Toon does not answer the first question, the rest is not asked.
* Exit code 0 when the thermostat answered, 1 when it did not, 2 for a wrong command line or a file that cannot be written. The file is created with permission for you alone and an existing file is never overwritten (every file name carries the UTC time).
* `--samples n` (up to 5000, at least 10 seconds apart) keeps the first look in full, the last look in full, and a summary: answer times per endpoint (`outcomes`, `medianMs`, `p95Ms`, `maxMs`), every change of the fields `activeState`, `programState`, `burnerInfo`, `errorFound`, `currentSetpoint` with its time, the lowest and highest values of a few numbers, and every moment an endpoint changed from answering to failing or back. Ctrl+C stops early and still writes the file.
* Every look **adds load** on the Toon (the same four requests the app makes). Do not leave it running by accident, and remember it when you measure the load (phase L).

### Annex 1.3 What the probe masks, and what you check before you share a file

Masked: the address you typed (also inside any text); every text that is not a plain number, `NaN`, `true`/`false`, or the value of a field called `type` or `result` (so names and free text become `<redacted>`); the value of any field whose name contains a word such as name, uuid, serial, mac, ssid, password, e-mail, address, host, owner, phone, location; IP addresses, MAC addresses, UUIDs, e-mail addresses and `.local` host names anywhere, also inside field names (`dev_<uuid>`); error pages are cut to one scrubbed line.

Kept on purpose: **numbers** (temperatures, meter readings, flows, timestamps of the Toon) and the structure (field names), because they are what is compared with the screens. A meter reading of one moment is a small piece of your household's habits: do not post files that you do not want to publish.

Before sharing, open the file in a text editor and check: (1) search for your own name, street, e-mail, your router's name and the first three groups of your IP address: none must appear; (2) look at `redaction.counts` and at the `label` you gave (you wrote it: it is not checked for names beyond IP and e-mail patterns); (3) look at anything that is not `<redacted>` and that you did not expect. The tool cannot know what is personal in a field it has never seen. If in doubt, replace the value by `x` by hand.

### Annex 1.4 Which part of the probe file answers which question

| Part of the file | Answers |
|---|---|
| `summary.outcomes`, `summary.toonWater` | is the Toon reachable; ToonWater `detected`, `not_found`, `unexpected`, `unreachable` (G.7: the real status code is in `endpoints[water].status`) |
| `endpoints[thermostat].body` | `activeState`, `programState`, `burnerInfo`, `currentSetpoint`, `nextTime`, `nextState` (Q-02, Q-03, Q-04, Q-07, Q-08, Q-09) |
| `endpoints[power].body` | `powerUsage`, `powerProduction`, `gasUsage` (Q-10, Q-11) |
| `metersAnalysis` | node keys, `type` strings, quantity kinds, which legacy keys exist (Q-01, Q-28) |
| `endpoints[water]` | status code, `contentType`, the real payload (Q-05, Q-14) |
| `endpoints[*].ms`, `contentType`, `contentEncoding`, `connection`, `server`, `bodyKind` | answer time, headers and shape (Q-06, Q-13, Q-14) |
| `watch.latency` | answer-time summary and outcomes (Q-06, H.4) |
| `watch.fieldChanges` | the changes of the enumerations with times (Q-04, Q-07, Q-03) |
| `watch.ranges` | was production or water flow ever above zero |
| `watch.outcomeChanges` | when the Toon stopped and started answering (Q-15, G.14) |
| `redaction` | what was masked |

## Annex 2 - The Flows to build

Each Flow ends in a notification (the Notifications app: "Create a notification") with a text that names the card and shows the tokens. For conditions use both THEN and ELSE: one notification says "TRUE", the other "FALSE". Start condition and action Flows by hand (a button of your choice or the test button of the Flow editor). Name the Flows `OT-...` so you can find them.

### Annex 2.1 The legacy set (cards of the old build; build it on the baseline, phase B)

| Flow | Card | Notes |
|---|---|---|
| OT-T1 | WHEN "The gas meter changed" | text: `gas {{meter_gas}}` |
| OT-T2 | WHEN "The power meter changed" | `power {{meter_power}}` |
| OT-T3 | WHEN "The water flow changed" | `water {{measure_water}}` (only where water exists) |
| OT-T4 | WHEN "Temperature state changed" | `state {{temperature_state}}` |
| OT-T5 | WHEN "The hot water dispensing is changed" | the token is called "alarm_water.hotwater" or its title; show it |
| OT-C1 | AND "Current temperature state is Home" (also Comfort, Sleep, Away) | TRUE/FALSE notifications |
| OT-C2 | AND "Hot water is dispensing" | TRUE/FALSE |
| OT-A1 | THEN "Set temperature state to Sleep" | in the old build the second choice is not visible in the title; note what you see |
| OT-A2 | THEN "Enable program" | |
| OT-A3 | THEN "Disable program" | |
| OT-A4 | THEN "Update status" | |
| OT-A5 | THEN "Update power usage", "Update meter totals", "Update water" | the refresh Flow of B.5 on a timer |

### Annex 2.2 The new set (add after the upgrade; phase F)

Everything of B.1 that still applies (in the new build "Update status" is "Update now"), plus:

| Flow | Card | Notes |
|---|---|---|
| OT-T6 | WHEN "Burner state changed to any state" | `burner {{burner_state}}` |
| OT-T7 | WHEN "Burner state changed to Heating" | |
| OT-C3 | AND "Burner state is Heating" (also Off, Hot water, Pre-heating) | TRUE/FALSE |
| OT-C4 | AND "Current temperature state is Vacation" | TRUE/FALSE |
| OT-A1a | THEN "Set temperature state to Sleep, Resume program afterwards" | Q-02 |
| OT-A1b | THEN "Set temperature state to Sleep, Disable program" | Q-02 |
| OT-W1 | WHEN Homey's card "The water flow changed" (only with ToonWater on) | G.10 |
| OT-W2 | any Flow that uses the tag "Water meter total" in a notification | G.10 |

## Annex 3 - Report template

```
Open-Toon 2.0.0 hardware test report
Date:                      Tester:
Homey model / firmware:
Toons (model, software, tariff, gas, solar, ToonWater add-on and version):
Build tested:             git commit / "working tree of redesign/sdk3 on <date>"
Baseline era(s) tested (phase B/C):
Node / Homey tool version:

Summary:  steps done N, PASS N, FAIL N (BLOCKER n, MAJOR n, MINOR n), INFO n, N/A n

FAILs (one line each): step id, severity, what happened, evidence file
Answers to the questions (one line each; "not tested" is an answer):
  Q-01 ...   Q-02 ...   (all Q-nn of section 15)
Things that were different from this plan:
Files attached (probe files only after reading them):
```

## Annex 4 - Where the older hardware lists went

Documents 01 (section 11) and 04 (section 10) both number their hardware checks `HW-01...`; the test report (`08`, O-9) asked for them to be reconciled. This plan replaces both lists.

| Older id | What it was | Now |
|---|---|---|
| 01-HW-01 | pair end to end, light/dark, nl/en | D.1 to D.14 |
| 01-HW-02 | capture payloads of every Toon | A.6, E.4, E.6, K.2, Q-01 |
| 01-HW-03 | change the setpoint | E.2, Q-09 |
| 01-HW-04 | `resume_program`, `activeState`, `programState` | E.3, F.8, F.9, Q-02, Q-03, Q-07, Q-08 |
| 01-HW-05 | editor cards, `removeCapability` | F.1, G.1, G.5, G.10, G.11, Q-19, Q-20 |
| 01-HW-06 | Insights history of a removed item | G.10, G.11, Q-19 |
| 01-HW-07 | the real `/water.html` | G.4, G.6, G.7, G.14, Q-05 |
| 01-HW-08 | `burnerInfo` over a day | E.8, F.5, L.4, Q-04 |
| 01-HW-09 | unplug and re-plug | H.2 to H.5, Q-30, Q-31 |
| 01-HW-10 | 24 hours at 10/30/60 s | L.1 to L.3, H.7, Q-06 |
| 01-HW-11 | Homey Energy | E.11, Q-25 |
| 01-HW-12 | upgrade over the baseline | B, C |
| 01-HW-13 | settings UX | I.1 to I.5, Q-21 |
| 01-HW-14 | several Toons, the other app | K.1, K.3 |
| 01-HW-15 | model matrix | K.4 |
| 04-HW-01 | snapshot | A.7, B.6, C.1 |
| 04-HW-02 | install over keeps devices and Flows | C.1, C.7, Q-26 |
| 04-HW-03 | titles and options after `addCapability` | C.3, G.4, Q-23 |
| 04-HW-04 | defaults of new settings | C.3, Q-22 |
| 04-HW-05 | enum refresh (Vacation) | C.3, E.3, Q-24 |
| 04-HW-06 | Homey fires `temperature_state_changed` | C.6, F.2, Q-16 |
| 04-HW-07 | deprecated cards | C.4, F.1, F.6, F.11, Q-18 |
| 04-HW-08 | `removeCapability` effects | G.10, G.11, Q-19 |
| 04-HW-09 | is the `capabilities=` filter dynamic | not applicable: ADR-0007 removed the filter; replaced by G.1, G.5, Q-20 |
| 04-HW-10 | argument types, dropdown rendering | F.7, F.8, Q-17 |
| 04-HW-11 | Energy and `meter_water` | E.11, Q-25 |
| 04-HW-12 | unavailable device blocks cards | F.12, H.3, Q-30 |
| 04-HW-13 | real payloads | A.6, G.4, G.7, Q-01, Q-05 |
| 04-HW-14 | old eras | B, C.8, Q-32 |

## Annex 5 - When something goes wrong

| Symptom | What to do |
|---|---|
| `npx homey ...` says it needs a newer Node | install Node.js 24 or newer (A.2) |
| `npx` wants to download `homey` | you are in a folder without `node_modules/homey`: use `$HOMEY` (A.2) or `cd` into the project folder |
| `homey app install` says the app does not validate | for the baseline: the patch of B.2 is missing. For the new build: run `npm run validate` and report the output |
| `Cannot copy ... to a subdirectory of itself` | run the command from inside the app folder, not with `-p` from another folder; keep the baseline folder outside this repository |
| no Homey is selected / not found | `npx homey select`, then `npx homey api diagnose` |
| `homey app run` complains about Docker | start Docker Desktop, or add `--remote` (A.9) |
| a probe file was not written | read the sentence: the file exists (use `--out`), or the folder cannot be written |
| the probe says `network` for the thermostat | the Toon is off, the address is wrong, or the Toon's firewall is closed; test the address in a browser |
| the device is unavailable and the Toon is fine | open the settings: is the IP address right? read the "Last problem" line; restart the app (C.7) |
| a device or Flow of yours disappeared | stop (section 1.3, rule 7), keep the snapshots, report it as a BLOCKER |
| you ran `homey app run` and pressed Ctrl+C | the app and its devices are gone from that Homey: that is what it does; install again with `homey app install` and add the devices |
