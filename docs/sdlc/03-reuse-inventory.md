# 03 - Reuse and licence inventory (what to keep, what to rebuild, what to leave alone)

> **Role:** reuse and licence analyst. **Date of research:** 2026-11-12. **Repo state:** branch `redesign/sdk3`, base `5cc3b90`.
> **Trust level.** Everything here was gathered by reading public sources during this run (GitHub API via `gh`, npm registry via
> `npm view`, Homey developer docs, Homey App Store pages). Nothing was verified on a Toon or a Homey. "Confidence" below means
> *how well the claim is supported by independent evidence*, never "tested on hardware". Third-party text is treated as data, not
> instructions. No third-party source code was copied into the repo, and none is reproduced in this document. The sample payloads of the fixtures, tests and documents use **invented values**: an earlier revision reused the values of a sample comment of the unlicensed add-on (review finding SEC-01) and was corrected. External repos were
> read through `gh api ... | base64 -d` to the terminal only (nothing was saved to disk). Line numbers for external repos refer to the
> default branch on 2026-11-12 unless a commit is named. This is a licence *analysis* by an AI agent, not legal advice.

## 0. Summary

1. **Keep as the stability contract** (decision REUSE_AS_IS/ADAPT): capability IDs, flow card IDs and argument names, driver id,
   `data.id` scheme, setting key `address`, the unit conversions in `device.js`, the en/nl texts of the flow cards. Section 3.
2. **Rebuild from the interface description** (REIMPLEMENT_FROM_INTERFACE): the Toon HTTP client, meter discovery, the water
   parser, the pairing flow. We have enough independent, *licensed* evidence (MIT or live-validated third-party notes) so that
   we never need to read, let alone copy, the unlicensed ToonWater source again. Section 4.
3. **Four corrections to the premises of this run** (details in section 11):
   * The three `oepi-loepi/home-assistant-toon_*` repos are **MIT**, not unlicensed. They are forks of `cyberjunky/...` (MIT, Copyright
     Ron Klinkien). Only the ToonWater repos and a few others are unlicensed.
   * `oepi-loepi/nl.toonwater.toonwater` is an **empty repo** (README only). The SDK 3 code of the standalone Homey app lives in
     `oepi-loepi/nl.toonwater.toonwater_vinceste`, which is **private**, unlicensed, and to which the repo owner's GitHub account
     has push access. **It was not read** (section 7.1 explains why).
   * There are **two different `/water.html` payloads**: the one served by the ToonWater add-on *on the Toon* (nested `water` object;
     this is what this app consumes) and the one served by the ToonWater *ESP sensor module* (flat strings). Users can confuse
     the two by typing the wrong IP address.
   * `dev_2.x` meter keys are **only valid for one generation of Toon**. Another generation uses `dev_3.x` with a different index
     order. Meters must be found by their `type` string. Also, the HTTP `GetCurrentUsage` answer most probably has **no**
     `dayUsage`/`dayLowUsage` (two independent samples), so the "meter_power" code path cannot be triggered by real data.
4. **Biggest licence/IP exposures for the owner** (full list in section 10): Eneco-branded photographs and device artwork shipped as app
   images; the registered "Toon" trademark used with a (R) sign; no licence on the ToonWater code and a collaboration
   offer from its author with no visible reply; the unclear ancestry of this repo (a fork of Athom's `nl.eneco.toon`, whose repo now returns 404).
5. **Tooling finding that affects the Node 22 target**: `homey` CLI releases from 4.4.1 on declare `engines.node >=24`. The newest CLI that
   still declares Node 22 support is **4.4.0**. `eslint-config-athom@4` (the config the Athom CLI scaffolds) pins ESLint to `>=8.57.1 <9`, an end-of-life major; see section 8 for the trade-off. Details in section 8.

Confidence scale used below: **H** = at least two independent sources, or a third party's live write/read cycle on a real Toon, or the
primary source's own code. **M** = one community source, or a simulator written by the community. **L** = inference or an
unverified single claim.

---

## 1. Rules applied

| Class of source | Rule | Where used |
|---|---|---|
| This repo (GPL-3.0, `LICENSE` added 2018-12-10, commit `d82f098`) | Free to reuse. Contributions by `oepi-loepi` (PR #21, commit `f705a70`) are GPL-3.0 as well: GitHub Terms of Service D.6 says "Whenever you add Content to a repository containing notice of a license, you license that Content under the same terms ..." (checked on docs.github.com, 2026-11-12). | section 3 |
| MIT repos (cyberjunky and its forks, toonsim, toon-exporter, toonmqtt) | Reusable with notice, and MIT is GPL-3.0-compatible. We nevertheless copy **no** code: it is Python/Go/QML and we need none of it. We use them as *evidence for facts*. If a future change copies a non-trivial portion (also a longer JSON sample from a README), add the MIT copyright and permission notice. | sections 4, 6 |
| No licence (GitHub API `license: null`, no LICENSE file) = all rights reserved | **Interface knowledge only** (paths, parameters, field names, units, behaviour). No code, no near-copies, no copied comments. Provenance is recorded here. | sections 5, 6, 7 |
| GPL-2.0 (`MadPatrick/domoticz_toon`) | GPL-2.0 cannot be combined into a GPL-3.0-only work if it is "only"; we did not check the file headers. Facts only. | section 6 |
| Proprietary (`homey-api`) | Not used. | section 8 |
| Private repo of a third party | Not read beyond the metadata GitHub shows to anybody with access. Never quoted. | section 7.1 |

---

## 2. Licence register (every upstream touched)

`gh api repos/<owner>/<repo> --jq .license` on 2026-11-12, plus the LICENSE file where one exists.

| Repo | Licence (GitHub) | Last push | What it is | Rule |
|---|---|---|---|---|
| StefanPostma/nl.vinceste.open-toon (this repo) | GPL-3.0 | 2026-04-02 | this app | reuse |
| oepi-loepi/toonWater | **none** | 2024-03-16 | the ToonWater add-on that runs on the Toon (QML), v1.1.25 | interface only |
| ToonSoftwareCollective/toonWater | **none** (fork of the above) | 2024-03-16 | the copy that ToonStore installs from | interface only |
| oepi-loepi/nl.toonwater.toonwater | **none**, size 0 (README only: "No code here but you can leave your issues in the repo") | 2023-02-17 | issue tracker stub of the published Homey app `nl.toonwater.toonwater` | nothing to reuse |
| oepi-loepi/nl.toonwater.toonwater_vinceste | **none**, **private** ("in private mode"), owner's account has pull+push | 2023-02-17 | SDK 3 source of the published Homey app (from the repo metadata only) | **not read** |
| oepi-loepi/water_ESP_part | none | 2021-08-22 | flashing notes and `.bin` for the ESP water sensor | interface only |
| oepi-loepi/home-assistant-toon_climate / _smartmeter / _boilerstatus | **MIT** (forks of cyberjunky/..., "Copyright (c) 2019-2021 Ron Klinkien") | 2025-12-08 | Home Assistant custom components for rooted Toons | facts; reuse allowed with notice |
| cyberjunky/home-assistant-toon_climate / _smartmeter / _boilerstatus | MIT | 2026-11-09 | upstream of the three above, most active | facts |
| ToonSoftwareCollective/toonsim | MIT (Copyright 2026 ToonzDev; fork of ToonzDev/toonsim) | 2026-10-30 | Toon GUI + daemons simulator for PC; needs firmware copied from the user's own Toon | facts; optional manual harness |
| smbl64/toon-exporter | MIT | 2026-11-11 | Prometheus exporter, `TOON.md` documents the API incl. a live write/read validation | facts |
| ToonSoftwareCollective/toonmqtt (fork of phoenix-blue/toonmqtt) | MIT | 2026-09-20 | on-Toon MQTT bridge | facts only; not HTTP |
| ToonSoftwareCollective/matterbridge | MIT | 2026-09-07 | Matter bridge for the Toon 2; polls `happ_thermstat` and `happ_pwrusage` every 5 s (read 2026-11-15, see `12-tsc-interface-findings.md`) | facts only |
| ToonSoftwareCollective/stralingsmonitor, bekendmakingen, nlalert, ToonRooter, ToonRecovery | MIT (GitHub licence endpoint, 2026-11-15) | 2021-2026 | unrelated Toon apps and rooting tools | not used |
| ToonSoftwareCollective/thermostatPlus, thermostatPlusBasic, homeassistant, homey | none | 2023-2026 | community apps | interface only (`thermostatPlus` read for the setpoint request, 12 section B) |
| ToonSoftwareCollective/mobile | none | 2023-03-23 | "Toon mobile" web app; consumes `/water.html` | interface only (corroboration) |
| ToonSoftwareCollective/boilerstatus, toonstore, toonstore_AppRepository, homey, ReToon, tscSettings | none (some MIT in the org, not these) | 2026 | community apps/store/helper | interface only |
| MadPatrick/domoticz_toon | GPL-2.0 | 2026-11-07 | Domoticz plugin | facts only |
| hansaplast26/domoticz-rooted-toon | none | 2021-01-17 | older Domoticz plugin | facts only |
| Ierlandfan/freetoon-lvgl | NOASSERTION | 2026-10-20 | open replacement GUI for the Toon | ecosystem watch |
| athombv/github-action-homey-app-validate / -publish / -version | none (no LICENSE file) | 2024-08 / 2025-11 / 2024-09 | GitHub Actions by Athom | use by reference only |
| athombv/node-homey-lib | GPL-3.0 on GitHub, **ISC on npm** | 2026-11-09 | validator, system capability JSON | dev tool; mismatch flagged |
| athombv/eslint-plugin-homey-app | GPL-3.0 on GitHub, **ISC on npm** | 2026-08-18 | lint rules | dev tool; mismatch flagged |
| athombv/nl.eneco.toon | **repo returns HTTP 404** | - | the ancestor of this app (package.json:2,15-24; issue #17 comment) | ancestry risk |

---

## 3. (a) Assets in this repo

Decision legend: REUSE_AS_IS, ADAPT, REIMPLEMENT_FROM_INTERFACE, REJECT. "Contract" = part of the stability contract of the task
(hard rule 5): do not change without an ADR + migration.

| Asset | Where | Decision | Reason / what to keep |
|---|---|---|---|
| Capability IDs (`target_temperature`, `measure_temperature`, `temperature_state`, `meter_power.peak`, `meter_power.offPeak`, `measure_power`, `meter_gas`, `measure_water`, `meter_water.today`, `meter_water.total`, `alarm_water.hotwater`) and their titles/options (`step 0.5`, `min 6`, `max 30`) | app.json:34-146 (custom capability `temperature_state` 35-81, driver capability list 94-106, options 110-146) | REUSE_AS_IS (contract) | Insights history and user Flows hang on these IDs. Additive changes only (e.g. `vacation` enum value, section 4.3 I2). |
| Custom capability `temperature_state` enum (comfort, home, sleep, away, none) | app.json:35-81 | ADAPT | Keep IDs; add `vacation` additively (activeState 4 is confirmed by three sources, section 4.3 I2). |
| Flow card definitions (5 triggers, 2 conditions, 7 actions): IDs, arg names (`device`, `state`, `resume_program`), tokens, en+nl titles | app.json:174-541 (triggers 175-304, conditions 305-380, actions 381-541; IDs at 177, 202, 227, 252, 280, 307, 367, 383, 457, 471, 485, 499, 513, 527) | ADAPT (contract) | Keep IDs and arg names. Fix: `[[resume_program]]` missing in `titleFormatted` (app.json:388-391, makes `homey app validate` fail), nl `!{{is\|\|is niet}}` typo (app.json:314), token title "Wh" for a kWh value (app.json:212). Fire the triggers that are never fired today. `meter_gas_changed` and `measure_water_changed` duplicate system trigger IDs: `deprecated: true`, do not rename. |
| Setting key `address` and `data.id` (user-chosen "Toon hostname" at pairing) | app.json:161; pair/start.html:37-38 (`data.id`), :44 (`name: 'ToonDevice'`) | REUSE_AS_IS (contract) | Needed to keep already-paired devices alive. Add a `port` setting only additively (HA clients expose port, default 80: cyberjunky `climate.py:102`). |
| Unit conversions: centi-degree strings `/100`, setpoint to Toon `x100`, gas L to m3 `/1000`, power Wh to kWh `/1000`, water L to m3 `/1000` | device.js:462-467, 442, 384-398, 415-417, 247 | ADAPT | Conversions are correct per the evidence in section 4. Fix precision (`Math.trunc` makes whole kWh/m3, device.js:384,398,442), keep 3 decimals. |
| Behaviour worth turning into tests (golden cases) | device.js:318-352, 361-402, 410-424, 452-480 | ADAPT into `node --test` fixtures | burnerInfo `2` means hot water dispensing (`alarm_water.hotwater`); `"NaN"` meter strings; single tariff fallback to the `elec` meter when the delivered-nt meter is `NaN`; target temperature rounded to 0.5 °C; water values divided by 1000; `activeState` parse as int. |
| Water handling by `oepi-loepi` (PR #21): URL `/water.html`, mapping `water.flow` to `measure_water`, `water.value/1000` to `meter_water.today`, `water.total/1000` to `meter_water.total` | device.js:173-186, 344-347, 410-424 | ADAPT (GPL-3.0 by contribution) | Semantics are right (section 5.3). Move behind the opt-in feature, guard `Number.isFinite`, fix the stale doc comment at device.js:171 (the `total` field exists, section 5.4). |
| Thermostat/power/gas/meter parsing | device.js:318-480 | ADAPT | Extract into pure functions `payload -> { capabilityId: value }`. Drop `hasOwnProperty` chains that throw (device.js:381). Meters by `type`, not by `dev_2.x` (section 4.3 I7). |
| HTTP transport via `request-promise-native` (undeclared dependency) | device.js:4, 85-190 | REJECT | Built-in `fetch` (Node 22). Evidence in section 8. |
| Write actions (setpoint, scheme state, program on/off) | device.js:198-310 | REIMPLEMENT_FROM_INTERFACE | URL shapes are right but semantics need hardware (section 4.3 I3-I4). |
| `TEMPERATURE_STATES` map | device.js:7-13 | ADAPT | add `vacation: 4`. |
| Driver flow-card listeners (v3 style `this.homey.flow.get...Card`) | driver.js:30-59 | ADAPT | Already v3-shaped. Add `getDeviceTriggerCard`, reject on failure. |
| `onPair` / `testConnection` | driver.js:8-23 | REJECT | v2 `socket.on`, and the test is a stub. Rewrite on `PairSession`. |
| `mapDeviceClass()` | driver.js:69-71 | REJECT | not an SDK hook. |
| Pair view | pair/start.html | REJECT (rewrite) | jQuery, `Homey.addDevice`, copy-paste from a Xiaomi app (bulb/dim level), missing buttons. Keep only the *intent*: IP + name fields. |
| Locales | locales/en.json, nl.json | ADAPT | Keep keys that stay in use (`offline`, `pair.*`). Fix typos ("Somethink bad happend", "succesfull", "IP adres" in en). Drop about 15 unused keys inherited from Athom's cloud app (`login`, `username`, `password`, `found_toon`, ...). The nl text mentions "Mi Home" and a "token" (copy-paste, nl.json:19) and must be rewritten. |
| Images `assets/images/{small,large}.png`, `drivers/open-toon/assets/images/{small,large}.png` | binary | **REJECT for publishing** | Both large images are a photograph/render of an **Eneco-branded Toon** (the Eneco logo and UI are visible on the screen; I viewed the two large files, not the small ones). Third-party copyright and trademark. Provenance unknown (added 2018-12-10, commits `d4987b1`, `7454ad4`). Replace with original artwork. Sizes are correct for Homey (app 250x175 and 500x350; driver 75x75 and 500x500). |
| `assets/icon.svg`, `drivers/open-toon/assets/icon.svg` (identical, 40 KB, "Adobe Illustrator 20.0.0" export of a Toon device outline) | binary | REJECT for publishing | Same concern: device art, origin unknown. Replace with an original, simple glyph. |
| `README.md` | repo root | ADAPT | Keep the prerequisite and disclaimer text ("only for a Toon whose firewall you opened", "use at own risk"). Move the changelog out, add `README.txt` (App Store long description) later. |
| `CONTRIBUTING.md` | repo root | REJECT as is | 100% Athom boilerplate ("Contributing to Athom and Homey", Athom Slack/forum/CLA). Replace with a short project-specific file. |
| `LICENSE` (GPL-3.0) | repo root | REUSE_AS_IS | Keep GPL-3.0. Fix `package.json` `"license": "ISC"` (package.json:22) to `GPL-3.0`. |
| `package.json` metadata (name `nl.eneco.toon`, athombv URLs) | package.json:2,15-24 | ADAPT | Rename and repoint to StefanPostma/nl.vinceste.open-toon. Remove both runtime deps. |
| `package-lock.json` + committed `node_modules` (1,880 tracked files) | repo | REJECT | After the runtime deps are removed, untrack. The Homey CLI copies production deps from the *local* `node_modules`, so an empty prod tree is fine. |
| `.github/dependabot.yml` | `.github/dependabot.yml:8` | ADAPT | `package-ecosystem: ""` is invalid. Use `npm` + `github-actions`. |
| `.github/workflows/codeql-analysis.yml` | | REJECT as is | uses retired `actions/checkout@v2`, `codeql-action@v1`, obsolete `HEAD^2` step. Replace. |
| `homey-wifidriver` (ISC, 2018) and `homey-log` ^1.0.6 | package.json:7-8 | REJECT | ToonDevice uses nothing from wifidriver (it never calls `super.onInit()`), and its `onDeleted` throws. `homey-log` is unused and v1 is SDK 2 only. |

---

## 4. (b) The Toon HTTP interface, with evidence

### 4.1 Evidence sources used (ranked)

| Tag | Source | Licence | Quality |
|---|---|---|---|
| **TE** | `smbl64/toon-exporter/TOON.md` (read endpoints with samples; write actions "live-validated" by a write/read-back cycle on a real rooted Toon, L139-173) | MIT | high-medium (third-party live test; author is not the Toon vendor. The repo also contains a `CLAUDE.md`, so the text may be AI-assisted and the live-validation claim is the author's own, not independently verified) |
| **HC** | `cyberjunky/home-assistant-toon_climate/custom_components/toon_climate/climate.py` (and the identical-purpose fork `oepi-loepi/...`) | MIT | high (long-running production integration) |
| **HS** | `.../toon_smartmeter/sensor.py` | MIT | high |
| **HB** | `.../toon_boilerstatus/sensor.py` | MIT | high |
| **TS** | `ToonSoftwareCollective/toonsim` (`README.md`, `sim/devices/*.js`, `src/localweb.cpp`) | MIT | medium (a simulator written from the real firmware; it is not the device) |
| **WA** | oepi-loepi/toonWater `ToonWaterApp.qml` (the add-on, v1.1.25 = commit `85af9f41`, plus history) | none | primary source for `/water.html`, **interface-only use** |
| **TM** | `ToonSoftwareCollective/mobile` `javascript/mobile.js` (independent consumer of `/water.html`, `/tsc/sensors`, etc.) | none | corroboration, interface-only |
| **DZ** | `MadPatrick/domoticz_toon` README + plugin, `hansaplast26/domoticz-rooted-toon` | GPL-2.0 / none | corroboration, facts only |
| **ST** | `ToonSoftwareCollective/toonstore_AppRepository/ToonRepo.xml:223-235`, tsc helper (copy inside toonsim `sim/tsc/tsc.device.sh`) | none / MIT | install mechanics |

### 4.2 Transport facts (apply to every endpoint)

| # | Fact | Evidence | Conf. |
|---|---|---|---|
| T1 | Plain `GET http://<host>:<port>/...`, no authentication, **port 80 by default** (HA clients expose a port option, default 80). | TE:3,143; HC `climate.py:87,102`; HS `sensor.py:35,203` | H |
| T2 | Numbers are very often **strings** (`"2034"`, `"NaN"`, `"8555590.00"`). Parse defensively. | TE:35,114; toonsim `happ_thermstat.js:78` ("the Toon sends every value as a string") | H |
| T3 | Daemon endpoints (`happ_*`, `hdrv_*`) answer with `Content-Type: text/javascript`; `boilervalues.txt` is `text/plain`. HA clients therefore pass an explicit content type to their JSON parser. Parse the **text** with `JSON.parse` (verified locally: `fetch().json()` ignores the content type on Node 25.9; re-check on Node 22 in CI). | HS `sensor.py:243`; HC `climate.py:170`; HB `sensor.py:175` | H |
| T4 | HA clients send `Accept-Encoding: identity`, use a **5 s timeout**, and poll at most every 10 s. The reason for `identity` is not documented. Node's `fetch` sends `gzip, deflate` by default and **can** be told to send `identity` (verified against a local server on Node 25.9). Recommend sending it, and test both on hardware. | HC `climate.py:166-170,12`; HS `sensor.py:39,239-241`; local test | M |
| T5 | The stock Toon firewall blocks LAN access; the user has to "open the IPTables" (this repo's README) which TSC does (`iptables -F` in its `flushfirewall` command). | README.md:11,13; toonsim `sim/tsc/tsc.device.sh:264-267` | M |
| T6 | A Toon may reboot daily, typically **03:00-04:00**; a poller should not alarm during that window. Only this one source says so; the Toon community's optional AutoReboot app reboots at 03:30 (12 section F). | DZ `MadPatrick/domoticz_toon` README.md:88-96 (GPL-2.0, fact only) | M (single source) |
| T7 | The web server is `lighttpd` (1.4.x per the simulator's `Server` header). A static file in the web root `/qmf/www` (= `/HCBv2/www`) is served at `/<file>`. This is how `/water.html` exists. | toonsim `README.md:150-152`, `src/localweb.cpp:109`; WA `ToonWaterApp.qml:107` | M |
| T8 | Missing add-on files give an **HTTP 404**, and healthy clients treat 404 as "feature absent", not as an error (the Domoticz plugin skips `boilervalues.txt` after 3 consecutive 404s and re-checks daily). | DZ `plugin.py:94-96`; TE:125 | M |
| T9 | The unauthenticated write surface means anyone on the LAN can command the Toon. Say so in the docs. | TE:177 | H |
| T10 | Newer open firmware replacing the Quby software (`ReToon`, `freetoon-lvgl`) may **not** expose these endpoints on port 80 (freetoon talks to `happ_thermstat` on `127.0.0.1:10080` and serves its own UI on `:10081`). The app targets the original software with an opened firewall. | `Ierlandfan/freetoon-lvgl` README.md:154-162; `ToonSoftwareCollective/ReToon` README.md:5-12 | L (not verified) |

### 4.3 Endpoint table (what `device.js` uses today, plus what else exists)

`cur.` = used by `device.js` today. Window of line numbers refers to evidence.

| # | Endpoint | Fields / semantics | Evidence | Conf. |
|---|---|---|---|---|
| **I1** | `GET /happ_thermstat?action=getThermostatInfo` (cur., device.js:94) | `{"result":"ok", currentTemp, currentSetpoint, activeState, programState, burnerInfo, currentModulationLevel, currentInternalBoilerSetpoint, otCommError, errorFound, connection, nextProgram, nextState, nextTime, nextSetpoint, randomConfigId}`. All values are strings. Temperatures in **1/100 degC**. `nextTime` is epoch seconds. | TE:37-51; HC `climate.py:203-210`; TS `happ_thermstat.js:69-79` | H |
| **I2** | meaning of the enums | `activeState`: 0 comfort, 1 home, 2 sleep, 3 away, **4 vacation/holiday**, -1 manual setpoint. `burnerInfo`: 0 off, 1 heating, 2 hot water, 3 pre-heating. `programState`: 0 manual (program off), 1 program running, 2 temporary override that follows the program afterwards, 4 holiday. The Toon community web app names nine codes: 0 manual, 1 follows the program, 2 temporary override, 3 program override, 4 holiday, 5 manual holiday, 6 away now, 7 day off, 8 locked base, and counts 1, 2, 3 and 8 as "program on" (12 section A). | TE:57-74 (no value 4 listed there); HC `climate.py:212-219,302-332`; TS `happ_thermstat.js:9,20` | H for 0-3/-1 and burner values; M for 4 and `programState` 2/4 |
| **I3** | `GET /happ_thermstat?action=setSetpoint&Setpoint=<degC*100>` (cur., device.js:247); alias `action=roomSetpoint` | Integer in 1/100 degC. Live read-back on a real Toon: 1975 in, `currentSetpoint=1975` out, `activeState` becomes -1, so **x100 confirmed** (an older community note said x10). In the simulator, in program mode the `programState` moves 1 to 2. Valid range 6-30 degC in HA. | TE:149,153-158,164-171; HC `climate.py:93-94,266,291`; TS `happ_thermstat.js:87-96`; TM `mobile.js` ("roomSetpoint") | H |
| **I4** | `GET /happ_thermstat?action=changeSchemeState&state=<n>&temperatureState=<m>` (cur., device.js:209,272,297) | `state=2` + `temperatureState` 0..3 = switch to a preset temporarily (live-accepted `{"result":"ok"}`, preset read-back matches `activeState`). `state=1` = program on. `state=0` = program off / manual; when currently in vacation HA sends `state=0&temperatureState=1`. **Vacation: `state=8&temperatureState=4`** (disputed: the Toon community web app names programState 8 "locked base" and holiday 4/5, so this may set a locked preset instead; unverified, Q-03, 12 section B). The meaning of `state` is "not fully pinned down" per the live test. | TE:150,154,168,180; HC `climate.py:346-360,404-410`; DZ `domoticz-rooted-toon/plugin.py:34,398,406` | H for `state=2`+preset; M for `0`,`1`; **M/L for `8` and for "disable program but set preset" (= `resume_program=no`)** -> hardware |
| **I5** | `GET /happ_thermstat?action=getThermostatStates` and `GET /hcb_config?action=getObjectConfigTree&package=happ_thermstat&internalAddress=thermostatStates` | The setpoint temperature stored for each preset id 0..4 (`tempValue`, 1/100 degC). Read-only candidate feature. | TS `happ_thermstat.js:81-85`; TM `mobile.js:46`; DZ `plugin.py:630,859` | M |
| **I6** | `GET /happ_pwrusage?action=GetCurrentUsage` (cur., device.js:122) | `{"result":"ok","powerUsage":{"value":<W>,"avgValue":<W>},"powerProduction":{"value":<W>,"avgValue":<W>},"gasUsage":{"value":null,"avgValue":null}}`. **No `dayUsage` / `dayLowUsage` in the HTTP answer** (they exist only in the on-Toon dataset). Gas flow is `null`; take gas from I7. | TE:9-25; TS `happ_pwrusage.js:77-87` (HTTP handler) vs `:97-100` (dataset) | M-H (two independent samples agree; **device.js:374-377 depends on keys that are most probably absent** -> hardware) |
| **I7** | `GET /hdrv_zwave?action=getDevices.json` (cur., device.js:151) | Flat map `dev_<node>[.<n>]` -> `{type, ...}`. Meter entries: `CurrentGasFlow` (L/h), `CurrentGasQuantity` (**litres**), `CurrentElectricityFlow` (W), `CurrentElectricityQuantity` (**Wh**), `CurrentHeatQuantity`, `CurrentWaterFlow` (l/min), `CurrentWaterQuantity` (L). Unset values are the string `"NaN"`. An empty map `{}` means no Z-Wave/P1 devices. See 4.4 for the layout and type table. | TE:80-115; HS `sensor.py:314-366,371-387,395-420`; TS `hdrv_zwave.js:10` | H (layout), M (heat/water) |
| **I8** | `GET /boilerstatus/boilervalues.txt` (not used) | JSON text (`text/plain`): `boilerSetpoint`, `boilerInTemp`, `boilerOutTemp` (degC), `boilerPressure` (bar), `boilerModulationLevel` (%), `roomTemp`, `roomTempSetpoint`, `sampleTime`. **Needs the TSC "boilerstatus" app**; 404 otherwise or without OpenTherm. | HB `sensor.py:51,57-65,175,231-246`; TE:119-125; ST `tsc.device.sh:350-355` | H |
| **I9** | `GET /water.html` (cur., device.js:177) | **ToonWater add-on**, see section 5. | WA, TM | H |
| **I10** | `GET /tsc/sensors` (not used) | `{"temperature":<degC,1dp>,"humidity":<%RH>,"tvoc":<ppb>,"eco2":<ppm>,"intensity":<raw IR count>}`; written by the TSC helper script on a Toon 2 (reads I2C sensors), `tvoc`/`eco2` stay 0 without the sensor process. | ST `sim/tsc/tsc.device.sh:536-557` (MIT copy of the TSC script); TM `mobile.js:65`; toonmqtt `docs/SENSORS_AND_CONTROL.md` ("raw count, not lux") | M |
| **I11** | `GET /hcb_rrd?action=getRrdData&loggerName=<name>&rra=<5min\|10yrhours\|10yrdays\|30days>&from=<epoch>&readableTime=1&nullForNaN=1` (not used) | The Toon's RRD history. Water loggers `water_flow` and `water_quantity` are written by the add-on. Candidate for one-off history import; unknown logger behaviour not verified. | TM `mobile.js:60-69`; TS `README.md:90-94`; WA `ToonWaterApp.qml:467,480` | M |
| **I12** | `GET /hdrv_zwave?action=basicCommand&uuid=<id>` | switches Z-Wave plugs paired to the Toon. Out of scope; mentioned for completeness. | TM `mobile.js:74` | L |

Added 2026-11-15 from `12-tsc-interface-findings.md`: the `getDevices.json` map also holds a key `dev_settings_device` that is not a node (clients skip it, and so does the parser). The `matterbridge` project sends the setpoint x10, an outlier against five sources, so I3 stays x100.

### 4.4 Meter discovery (I7 in detail): why `dev_2.x` is wrong for some Toons

Two independent community sources show **two layouts**:

| Layout | Evidence | gas | elec (combined, often NaN) | delivered normal (nt) | received normal (nt) | delivered low (lt) | received low (lt) |
|---|---|---|---|---|---|---|---|
| "dev_3" generation, `type` values are descriptive | TE:88-98 (real sample: parent `dev_3` with `type: HAE_METER_v2`) | `dev_3.1` `gas` | `dev_3.2` `elec` | `dev_3.3` `elec_delivered_nt` | `dev_3.4` `elec_received_nt` | `dev_3.5` `elec_delivered_lt` | `dev_3.6` `elec_received_lt` |
| "dev_2" generation (what `device.js` hard-codes: gas 2.1, peak 2.4, off-peak 2.6, fallback 2.2) | DZ `domoticz_toon` README.md:128-149: user supplies `Gas ; elec_delivered_normal ; elec_delivered_low ; elec_received_normal ; elec_received_low` and the example is **`2.1;2.4;2.6;2.5;2.7`**; README.md:137 "different Toons might use `dev_2.x` or `dev_3.x`" | `dev_2.1` | `dev_2.2` | `dev_2.4` | `dev_2.5` | `dev_2.6` | `dev_2.7` |

So `device.js:381-399` is plausible for the second layout and would read **export** counters on the first. HS shows how a long-lived
integration copes: it walks every entry and matches the `type` string:

| Meaning | `type` strings accepted by HS (`sensor.py:314-366`) |
|---|---|
| gas | `gas`, `HAE_METER_v2_1`, `HAE_METER_v3_1`, `HAE_METER_v4_1` |
| delivered normal tariff (nt) | `elec_delivered_nt`, `HAE_METER_v2_3`, `HAE_METER_v3_3`, `HAE_METER_v3_4`, `HAE_METER_v4_4`, `HAE_METER_HEAT_3` |
| delivered low tariff (lt) | `elec_delivered_lt`, `HAE_METER_v2_5`, `HAE_METER_v3_6`, `HAE_METER_v3_5`, `HAE_METER_v4_6`, `HAE_METER_HEAT_5` |
| received normal (feed-in) | `elec_received_nt`, `HAE_METER_v2_4`, `HAE_METER_v3_5`, `HAE_METER_v4_5` |
| received low (feed-in) | `elec_received_lt`, `HAE_METER_v2_6`, `HAE_METER_v3_7`, `HAE_METER_v4_7` |
| solar | `HAE_METER_v3_3`, `HAE_METER_v4_3` (also keys named `dev_<n>.export`, `sensor.py:409`) |
| heat | `HAE_METER_v3_8`, `HAE_METER_v4_8`, `HAE_METER_HEAT_1` (`CurrentHeatQuantity`) |
| water | `HAE_METER_v4_9` (`CurrentWaterQuantity`, `CurrentWaterFlow`) |

Notes. (1) The same type string appears in more than one row (`HAE_METER_v3_3` is both "delivered normal" and "solar"; `HAE_METER_v3_5` is both "delivered low" and "received normal"), so the mapping is ambiguous for those generations. A reimplementation must not copy the list blindly; it must be validated against real dumps. (2) Tariff naming:
Dutch "normaal tarief" (nt) is the peak/high rate, "laag tarief" (lt) the off-peak/low rate. `TE:112` contradicts itself on this
point and should not be relied on. The existing app maps nt to `meter_power.peak` and lt to `meter_power.offPeak` (device.js:381,395); keep that
(contract). (3) Confidence: layout **H**, exact type table **M**, tariff direction **M**. **Needs a real dump from each of the owner's
Toons** (section 12, H1).

### 4.5 A fixture-grade summary the mock Toon should implement (synthetic values)

These are our own synthetic examples built from the field lists above. They are not copied from any repo.

```jsonc
// GET /happ_thermstat?action=getThermostatInfo   (text/javascript; every value is a string)
{"result":"ok","currentTemp":"2034","currentSetpoint":"1850","activeState":"1","programState":"1",
 "burnerInfo":"0","currentModulationLevel":"0","currentInternalBoilerSetpoint":"6","otCommError":"0",
 "errorFound":"255","connection":"0","nextProgram":"1","nextState":"2","nextTime":"1789000000","nextSetpoint":"1500"}
// GET /happ_pwrusage?action=GetCurrentUsage
{"result":"ok","powerUsage":{"value":324,"avgValue":249.07},"powerProduction":{"value":0,"avgValue":0.0},"gasUsage":{"value":null,"avgValue":null}}
// GET /hdrv_zwave?action=getDevices.json  (layout A, "dev_2": gas 2.1, elec 2.2, delivered nt 2.4, received nt 2.5, delivered lt 2.6, received lt 2.7)
// and layout B ("dev_3": 3.1 gas, 3.2 elec, 3.3 delivered_nt, 3.4 received_nt, 3.5 delivered_lt, 3.6 received_lt), "type" string per entry,
// quantities as strings in L / Wh, "NaN" where unused, {} for no devices.
// GET /water.html -> section 5.3 (present, absent=404, old 1.1.15 shape without "total", ESP flat shape)
```

Fault modes the mock should offer: 404 for `/water.html`, `NaN` meters, single-tariff meter, empty `{}` device list, vacation state
(`activeState:"4"`), `{"result":"error"}`, malformed JSON, slow response (> 5 s), connection refused, daily 03:00-04:00 outage.

---

## 5. ToonWater (the add-on on the Toon): what we know

### 5.1 What it is, and how it is installed

* A **QML app that runs on the rooted Toon's own GUI** (author `oepi-loepi`, current version 1.1.25, `minversion.txt` = 1.1.1, changelog at
  `toonWater/Changelog.txt`). It is distributed through **ToonStore** (the TSC app store): the store entry is
  `<name>ToonWater</name><version>1.1.25</version><folder>toonWater</folder>`, description "Bekijk het waterverbruik op Toon (aparte sensor nodig)"
  (= "view water use on Toon, **separate sensor needed**"), `firmwareminimum 5.0.00`, `toon2only no` (Toon 1 and 2).
  Evidence: `ToonSoftwareCollective/toonstore_AppRepository/ToonRepo.xml:223-235`. **H**.
* Install mechanics (TSC helper): downloads the app tarball from GitHub (`ToonSoftwareCollective/<app>`), unpacks to `/qmf/qml/apps/<app>-<version>`, symlinks
  `/qmf/qml/apps/<app>`, restarts the GUI. Evidence: toonsim `sim/tsc/tsc.device.sh:335-346` (copy of the on-Toon script, MIT repo). **M**.
* **It is a bridge, not a meter.** It polls a water-pulse sensor every 10 s (`ToonWaterApp.qml:538-539`) and aggregates. Two sources, chosen on its config screen:
  * an **ESP8266 module** (Wemos D1 mini running an ESP-Easy-based firmware; the commercial "toonWater" module of toonwater.nl or the DIY variant of `water_ESP_part`; that the commercial module speaks the same flat interface is an inference from matching 1.4.x firmware version numbers, **M**),
    reached over HTTP at `http://<esp-ip>/water.html` (`ToonWaterApp.qml:226`); or
  * a **Domoticz** instance (two device IDX values; the UI itself calls this mode slow and discouraged, `WaterConfigScreen.qml:161-188`).
  **H** (primary source).
* On the Toon it feeds the Toon's own graphs (RRD loggers `water_flow` and `water_quantity` via `http://localhost/hcb_rrd?action=setRrdData...`,
  `ToonWaterApp.qml:467,480,497`) and **writes a file to the web root: `file:///qmf/www/water.html`** (`ToonWaterApp.qml:107`), which is
  what this Homey app reads and what the TSC mobile web app reads (`mobile.js:68,1265-1275`). **H** (two independent consumers).

### 5.2 How its presence can be detected over the network

The add-on itself exposes **no status endpoint, no version endpoint, and no list of installed apps over HTTP** (not found in any source read). The only
network-visible trace is the output file. Recommended, interface-level probe (to be implemented by the design role):

| Probe result of `GET /water.html` | Interpretation |
|---|---|
| 200, JSON, `result == "ok"`, object `water` with finite numbers `flow`, `value`, `total` | ToonWater present **and has received data**. |
| **404** | Not installed, **or** installed but not configured, **or** the sensor never delivered data yet (the file is created on the first successful poll; before that no file exists). Not an error. Do not log noise; probe again rarely (e.g. every 15 min) and only while the feature is enabled. |
| 200 but JSON keys `waterflow` / `waterquantity` (flat) | The user typed the **IP of the ESP sensor module**, not the Toon's. Show a specific message (candidate feature "direct sensor", section 7.3). |
| 200, `water` object missing `total` | Add-on older than 1.1.16 (section 5.4), tolerate (only `flow`, `value`). |
| timeout / refused | The Toon is unreachable: a transport problem, says nothing about the add-on. |
| 200 with other content | treat as invalid; one warning, no crash. |

Freshness cannot be derived from the content: **there is no timestamp**, and the add-on **rewrites the file only when `flow` or `today` changed**
(`ToonWaterApp.qml:283-287`), so an idle meter produces an unchanged file for hours, and a dead add-on leaves the last file in place. The HTTP
`Last-Modified` header of the static file would be the only hint (lighttpd normally sends it; **not verified on a Toon**, section 12 H3). **M**.

### 5.3 The `/water.html` payload (current add-on)

```json
{"result":"ok","water":{"flow":0,"total":7350214,"value":137,"avgValue":200}}
```

(Shape from the add-on's write statements at `ToonWaterApp.qml:284` and `:422`, v1.1.25. The values are **invented**; they are not those of the sample comments in the add-on's source, see section 13.) Served as a static file; **do not assume
`Content-Type: application/json`**. All four members are **integers** in the file (the add-on `parseInt`s them before writing).

| Field | Meaning | Unit | Evidence | Conf. |
|---|---|---|---|---|
| `water.flow` | current flow | **litres per minute** (integer) | the Toon tile prints it with "l/m" (`WaterTile.qml:49`) and "liter(s)/min." (`WaterNow.qml:34`); HA `toon_smartmeter` labels the native water flow `l/min` (`sensor.py:195`) | H |
| `water.total` | cumulative meter reading | **litres** (integer), e.g. `7350214` = 7350.214 m3. The tile shows `total/1000` m3 (`WaterTile.qml:76`). The Domoticz branch converts m3 with 3 decimals into litres (`ToonWaterApp.qml:388-398`) | H |
| `water.value` | **today's** use | **litres since local midnight** (integer). Computed as `total` minus the total saved at the day rollover. The rollover runs on the 5-minute timer and only in the window 00:00-00:04 (`ToonWaterApp.qml:449,506-534,556`), so it can lag up to ~5 minutes after midnight. The tile prints litres (`WaterTile.qml:63`). | H |
| `water.avgValue` | average day | litres per day. Default **200** until at least 4 positive daily values exist; mean of the last up to 5 days (`ToonWaterApp.qml:43,188,527`) | H (it is a derived value, not a measurement; do not turn it into a capability) |
| `result` | `"ok"` | - | all consumers check `result == "ok"` (`mobile.js:1268`) | H |

Mapping already used by this repo (and to keep): `flow` -> `measure_water` (L/min as delivered), `value/1000` -> `meter_water.today` (m3), `total/1000` -> `meter_water.total` (m3)
(device.js:415-423). Homey's system capability `meter_water` is in m3 with 3 decimals, `measure_water` in L/min (node-homey-lib `assets/capability/capabilities/meter_water.json`).

### 5.4 History of the payload (why the doc comment in device.js is stale)

| Add-on version | Commit | Date | File | `total` present? |
|---|---|---|---|---|
| 1.1.9, 1.1.11 - 1.1.14 (checked) | `f0f4356a`, `375ce13b`, `cc34a482`, `78679c8e`, `560aa221` | 2021-03 to 2021-05 | no file written (1.1.10 is not checked: its changelog says data was written for the mobile app, rolled back in 1.1.12) | - |
| **1.1.15** | `21dde32a` | 2021-06-19 | `/qmf/www/mobile/water_mobile.json` (URL `/mobile/water_mobile.json`) | **no** (`flow`, `value`, `avgValue`) |
| **1.1.16** | `5bc8e13d` | 2021-06-26 | **`/qmf/www/water.html`** | **yes** |
| 1.1.17 ... 1.1.25 | `436cf7d3` ... `85af9f41` | 2021-12 to 2024-03 | `/qmf/www/water.html` | yes |

So `/water.html` + `total` exist **since 1.1.16**. PR #21 of this repo (2021-06-26/29) landed on the day of the switch, which explains the comment
at device.js:171 showing a payload without `total`. Minimum supported add-on version for our feature: **1.1.16**. `water.html` from 1.1.15 is not
supported (a 2021 intermediate). Source: `gh api repos/oepi-loepi/toonWater/contents/ToonWaterApp.qml?ref=<sha>` for each commit (interface read only).

### 5.5 The sibling payload: the ESP sensor module also serves `/water.html`

The Toon-side add-on *reads* the ESP at `http://<esp>/water.html`. Its flat answer (a sample comment at `ToonWaterApp.qml:232` was read for the field names, which the code that
reads them at `:249-254` confirms; the values of that comment are not used in this repository) has the string fields **`waterflow`, `waterquantity`, `today`, `currentBatch`, `breakdetect`, `leakdetect`, `RSSI`, `version`, `update`, `pulselength`, `pulsetime`**.
The Toon-side app also calls `http://<esp>/setnew?<total>` to preset the meter reading (`WaterConfigScreen.qml:560`), and the module has a `/webupdate` page for firmware updates
(toonwater.nl). Firmware **>= 1.4.35** is required by the published Homey app. **M** (field names single source; units not stated, `waterquantity` is litres by the arithmetic at
`ToonWaterApp.qml:249-282`). This is what the **standalone Homey app talks to directly, without any Toon**.

### 5.6 Other ways to get water on a Toon (not ToonWater)

* A **native P1/M-Bus water meter** on some meter adapters: type `HAE_METER_v4_9` with `CurrentWaterQuantity` (L) and `CurrentWaterFlow` (l/min) inside `getDevices.json`
  (HS `sensor.py:363-366,386-387`, in the `oepi-loepi` fork and upstream). No add-on is involved. How common this is: unknown (**L**). It is a candidate second water source, section 7.3.
* The Toon's RRD loggers `water_flow`, `water_quantity` (I11): read-only history, exist only if the add-on pushed data.

### 5.7 Constraints this gives the opt-in design (inputs, not decisions)

* The feature switch must be **per device**, default **off for new devices**, and **on for existing devices that already carry the water capabilities** (otherwise users lose data/Flows).
* Disabling should stop polling `/water.html` completely. Removing capabilities may drop their Insights history (Homey behaviour to be tested, section 12 H10).
* The 404 from `/water.html` must not be treated like an error in the poll loop; log once at info level.
* The feature should be discoverable at pairing/repair time with a probe that explains the four outcomes in 5.2.

---

## 6. (c) Other public Toon integrations (interface knowledge only)

| Integration | Licence | What we learned (facts) | Decision |
|---|---|---|---|
| `cyberjunky/home-assistant-toon_climate` (and the `oepi-loepi` fork) | MIT | I1-I4: fields, enums, `setSetpoint`, `changeSchemeState` combinations incl. vacation `state=8&temperatureState=4`, HTTP details T1-T4,  | REIMPLEMENT_FROM_INTERFACE (Python, nothing to port) |
| `.../home-assistant-toon_smartmeter` | MIT | I7 layouts and the type table (4.4); native water type `HAE_METER_v4_9`; `NaN` handling (`sensor.py:285-292` turns NaN into 0 for some sensors; **do not copy that** - 0 would pollute Energy). | REIMPLEMENT_FROM_INTERFACE |
| `.../home-assistant-toon_boilerstatus` | MIT | I8 (`boilervalues.txt`); the TSC boilerstatus app is a prerequisite. | REIMPLEMENT_FROM_INTERFACE (candidate feature) |
| `smbl64/toon-exporter` (`TOON.md`) | MIT | independent samples for I1, I6, I7; the **live-validated** write cycle (I3, I4); `Setpoint` x100 settled. | REIMPLEMENT_FROM_INTERFACE; its samples guide our synthetic fixtures |
| `ToonSoftwareCollective/toonsim` | MIT | The simulator documents which `/happ_*`, `hcb_*`, `hdrv_*` URLs the Toon web server answers (README.md:107-115) and `programState`/`activeState` semantics (`happ_thermstat.js:9,20`). It also runs the **real ToonWater QML** on a PC: the page an app writes into `/qmf/www` appears at `http://127.0.0.1:8888/<page>` (README.md:150-152). | We build our own tiny Node mock (REIMPLEMENT_FROM_INTERFACE). toonsim is an **optional manual harness** for the owner (needs firmware copied from the owner's own Toon: never commit it). |
| `ToonSoftwareCollective/toonmqtt` (and its fork source) | MIT | On-Toon service speaking BoxTalk/`printTableInfo`, **not HTTP**. Useful list of data points (diagnostics, OpenTherm extras) and two design ideas: a monotonic guard for cumulative meters, and a "grace period" before a data point is declared unavailable (`docs/SENSORS_AND_CONTROL.md`, `docs/ARCHITECTURE.md`). | REJECT as a dependency; ideas only |
| `ToonSoftwareCollective/mobile` | none | An independent consumer of `/water.html` (reads `result`, `water.flow`, `water.value`, `water.avgValue`; `mobile.js:68,1265-1275`), of `/tsc/sensors` and of the hcb_rrd loggers (`:49-69`). Corroborates 5.1 and 5.3. | interface only |
| `MadPatrick/domoticz_toon` | GPL-2.0 | Meter address layouts (`2.1;2.4;2.6;2.5;2.7`), the `boilervalues.txt` 404 policy, the Toon's daily reboot window 03:00-04:00, the hcb_rrd boiler loggers (`thermstat_boilerTemp` etc. exist only on a patched Toon). | facts only, no code |
| `hansaplast26/domoticz-rooted-toon` | none | A list of further actions (`GetProfileInfo`, `printTableInfo`, Z-Wave `getContollerInfo`, `GetLinkQuality`) in comments; `changeSchemeState&state=<n>` for program states. | facts only |
| `ToonSoftwareCollective/ReToon`, `Ierlandfan/freetoon-lvgl` | none / NOASSERTION | Replacement software for the Toon. They change the HTTP surface (T10). | ecosystem watch; REJECT as input |
| `Geertvdc/ToonOpenAPIWindows` (2015), `RolfKoenders/Toon-JS`, `jasperla/go-toon`, `Inversion-NL/Toon-Android` (MIT) | none / MIT | These target the Eneco **cloud** API or are 5+ years old. | REJECT (not relevant to the local API) |
| Homey Community Store app `nl.wisefire.eneco-meteradapter` ("Toon P1", test version) | unknown | Reads the Toon meter adapter **directly over Z-Wave** without a Toon; blocked on electricity parsing in Homey. A different integration path. | REJECT (out of scope) |

---

## 7. The standalone ToonWater Homey app (`nl.toonwater.toonwater`), beyond water

### 7.1 What it is, what could be verified, what was deliberately not read

* **Public listing** (homey.app/a/nl.toonwater.toonwater, fetched 2026-11-12): v**1.1.30**, developer **Rob Van Oostveen**, category Energy, requires Homey >= 5.0.0, "Last updated 3 years ago",
  drivers **Temperatuur, Temperatuur en luchtvochtigheid, toonThermostat, toonWater**; support site `https://www.toonwater.nl/contact/`; contributors **"Vinceste IT (Stefan Postma), Paul Heeringa, J. van Zanten, Ralf van Dooren"**;
  description: mount a sensor on the water meter, configure WiFi on the toonWater device, the app connects over WiFi; "advises against using the 'use Homey' option when this app is active"; needs toonWater **device firmware >= 1.4.35**; changelog 1.1.30 "error solved with temperature readings from toon". (Whether Rob van Oostveen is the person behind the GitHub account `oepi-loepi` is **not verified**.)
* Community feedback: "Recently the toonWater app has added support for Toon (rooted)" (PhAnt0m, 2023-03-30); "Toon Water provides same info as Open Toon" (Homeyjoost, 2023-09-26); pairing on mobile reportedly fails and works from a PC (community.homey.app/t/toon-en-homey/629, page 7). So **the standalone app overlaps strongly with this app's thermostat features**.
* The repo that holds the code, `oepi-loepi/nl.toonwater.toonwater_vinceste`, exists, is **private**, unlicensed, created 2023-02-17 (four days after `oepi-loepi` wrote in issue #22 that he was rewriting the app for SDK 3 and offered to publish it from his account) and the authenticated account of this machine has push access to it.
  **It was not opened**, for three reasons: (1) the docs in this repo may be published, and a private repository's content must not leak into them; (2) the unlicensed rule still applies; (3) everything we need about the Toon interface is covered by licensed sources above. **The owner can ask `oepi-loepi` directly, section 10 item 1.**
* The feature names below come only from the public App Store listing and are therefore **L-M confidence**: names and rough scope, no interface detail.

### 7.2 Features of the standalone app compared with this repo

| Feature (as listed publicly) | In this repo today? | Interface behind it (this analysis) | Notes |
|---|---|---|---|
| Toon thermostat: target temperature, temperature state, program on/off, set temperature, set state | yes | I1, I3, I4 | the same |
| Triggers: temperature changed, target temperature changed, temperature state changed | `temperature_state_changed` is declared but **never fired** (app.json:252); Homey generates the temperature/target triggers for the standard capabilities itself | I1 | wire up `temperature_state_changed` |
| Triggers: **burner on/off**, **hot water tap on/off** | `alarm_water.hotwater` capability + trigger `alarm_water_changed` (never fired) + condition `hotwater_dispensing`; burner on/off is issue #26 | `burnerInfo` (I2) | add a `burner` boolean capability? design call |
| Conditions: burner / hot water status, temperature state | partly | I1 | |
| Triggers: power meter, gas meter, **pressure** changes | `meter_power_changed`, `meter_gas_changed` declared, never fired. No pressure. | I7, I8 (`boilerPressure` in bar needs the boilerstatus app) | `measure_pressure` exists as a system capability |
| **Water**: water meter changed, waterflow changed | yes (cap.+ triggers) | I9 | this task's opt-in |
| **Water alarm on/off, leak alarm, break detection** (conditions "Water alarm is on", "Breakdetection turned on", "Leakalarm is on") | no | **ESP module only**: flat fields `breakdetect`, `leakdetect` (5.5). The Toon-side `/water.html` has **no** alarm fields. | only possible in the "direct sensor" mode |
| **Temperature** and **Temperature + humidity** drivers | no | unclear: Toon 2 sensors via I10, **or** separate ESP temperature modules (oepi-loepi has an `toonTemp` Toon app and `toonTemp-ESP_part`). Not determinable from public sources. | **L** |
| Own driver "toonWater" for the ESP sensor without any Toon | no | 5.5 | |
| Platforms: lists Homey Cloud | n/a | A cloud app cannot reach a LAN device (architect doc section 1); not verified for the toonWater app | **flag**: do not copy the platform claim |

### 7.3 Candidate optional features (names and interface-level description only)

Ordered by value/cost for a design that already has an "enable a feature per device" mechanism. All of these would be additive and default **off** (except where the data comes from core endpoints and costs nothing).

| ID | Feature | Interface | Add-on needed on Toon? | Suggested capability IDs (system where possible) | Conf. |
|---|---|---|---|---|---|
| **C1** | **ToonWater** (water flow, today, total) - *the owner's request* | I9 | yes (ToonWater >= 1.1.16 + ESP/Domoticz source) | keep `measure_water`, `meter_water.today`, `meter_water.total` | H |
| C2 | **Burner / pre-heat / hot-water state and modulation** | I1 (`burnerInfo`, `currentModulationLevel`, `otCommError`) | no | existing `alarm_water.hotwater` (keep), new boolean for burner, `measure_...` modulation % | H |
| C3 | **Vacation state** | I1 `activeState 4`; set with `state=8&temperatureState=4` (disputed, see I4) | no | add `vacation` to `temperature_state` | M |
| C4 | **Energy export / solar counters** (issue #23) | I7 `elec_received_nt/lt`, I6 `powerProduction.value` | no | `meter_power.exported`-style sub-capabilities, negative `measure_power` is a design question | M |
| C5 | **Boiler status** (setpoint, in/out temperature, pressure, modulation) | I8 | yes (TSC `boilerstatus` app) | `measure_pressure` (system), `measure_temperature.*` | H |
| C6 | **Toon 2 room sensors** (temperature, humidity, TVOC, eCO2, light) | I10 | yes (TSC helper script writes the file) | `measure_humidity`, `measure_co2` (system); TVOC and the raw light count are custom (not lux) | M |
| C7 | **Native water meter from the meter adapter** | I7 type `HAE_METER_v4_9` | no (needs the right adapter) | same water capabilities as C1 (a second *source*) | L |
| C8 | **Heat meter** (`CurrentHeatQuantity`) | I7 types `HAE_METER_v3_8/v4_8/HEAT_1`; unit shown as GJ upstream (unverified) | no | custom | L |
| C9 | **Preset temperatures** (read the setpoint of comfort/home/sleep/away) | I5 | no | read-only settings or tokens | M |
| C10 | **ToonWater direct sensor mode** (ESP module, no Toon; adds leak and break alarms) | 5.5 | no Toon; needs the ESP module | water capabilities + `alarm_water` (true leak semantics) | M |
| C11 | **History import** of the Toon's RRD water/energy history | I11 | partially | none (Insights import is not available to apps; **L**) | L |
| C12 | **Toon Z-Wave plugs** as Homey devices | I7 + I12 | no | `onoff` | L |

---

## 8. (d) Homey / npm ecosystem components

All checks via `npm view <pkg> license version time.modified engines peerDependencies` on 2026-11-12. "Run time" = ships in the app; "dev" = devDependency only.

| Component | Licence | Version / last publish | Dependencies | Decision | Reason |
|---|---|---|---|---|---|
| Node 22 built-in **`fetch`** + `AbortSignal.timeout()` + `node:http` (mock server) + **`node:test`** / `node:assert` | MIT (Node) | Node 22 on Homey >= 12.9.0 | **0** | **REUSE_AS_IS** | Homey docs: "the built-in `fetch` is the preferred approach for new code" (apps.developer.homey.app/upgrade-guides/node-22, fetched today). Zero runtime deps, zero dev deps for tests and mock. |
| `homey` module (the SDK shim provided by Homey; CLI copies its own) | ISC | - | 0 | REUSE_AS_IS | `require('homey')`. Nothing to install. |
| **`homey` CLI** (npm `homey`) as a **devDependency** (`homey app validate/run/build/version`) | ISC | 4.6.3 (2026-11-09) | 27 | ADAPT: **pin `4.4.0`** if it must run on Node 22 | `engines.node`: 4.3.0, 4.3.1, 4.4.0 `>=22` (4.3.2 declares none), **4.4.1-4.6.3 `>=24`**. The dev machine has Node 25. If CI/dev stay on Node 22, pin <=4.4.0; otherwise run it with Node >= 24 and keep the **app** code Node-22-safe. Install only with `--ignore-scripts`. Dev tool, never shipped. |
| `homey-lib` (validator, system capability JSON) | **ISC on npm, GPL-3.0 on GitHub** (mismatch) | 2.53.0 (2026-10-29) | 6 | REUSE_AS_IS as a dev tool | already used by the CLI. Cite system capability IDs, do not copy JSON. Mismatch is flagged in section 10. |
| `eslint-plugin-homey-app` (rules `global-timers`, `homey-log`) | ISC on npm, GPL-3.0 on GitHub | 3.0.0 (2026-08-18) | peer `eslint >=8.40`, engines `^20.19 \|\| ^22.13 \|\| >=24` | ADAPT (dev) | Pulled in by `eslint-config-athom`; also offers a flat config (`configs['flat/recommended']`) as the migration path to ESLint 9. |
| `eslint-config-athom` + `eslint@~8.57.1` (what the CLI scaffold installs) | ISC | 4.0.2 (2026-09-09) | peer `eslint >=8.57.1 <9.0.0` | ADAPT (dev) | **Follow the Athom scaffold** (the task asks for "the latest standards from Homey"). Trade-off: ESLint 8 is end of life; the flat-config route via `eslint-plugin-homey-app` is the fallback when Athom's config moves. See also `02-homey-standards.md` HS-06. |
| `homey-apps-sdk-v3-types` | ISC | 1.8.3 (2026-10-27) | 0 | optional REUSE_AS_IS (dev) | TypeScript definitions for `// @ts-check` in editors. Not required. |
| `homey-log` | ISC | 2.1.2 | 1 (`github:athombv/raven-node` tarball) | **REJECT** | needs a Sentry DSN in `env.json`, `new Log({homey})`; value for a hobby app is nil; a git-URL dependency is poor hygiene. |
| `homey-api` | **proprietary**: "Package may be used freely with Homey products. Source code is proprietary to Athom B.V." (LICENSE, read via unpkg 2026-11-12) | 3.21.2 | 5 | **REJECT** | Not needed (no Homey Web API calls). Licence not GPL-3.0-compatible in spirit; ask a lawyer before any use. |
| `homey-wifidriver` | ISC | 1.0.8 (2018) | 6 | **REJECT** | unused, harmful (`onDeleted`). |
| `request`, `request-promise-native`, `node-fetch`, `axios`, `undici` (explicit) | ISC / MIT | `request-promise-native` last published 2022 | | **REJECT** | built-in fetch. |
| `mocha`, `jest`, `vitest`, `msw`, `nock` | MIT | | many | **REJECT** | `node:test` is enough; no new dependency tree. |
| `homey-oauth2app`, `homey-zigbeedriver`, `homey-zwavedriver` | ISC | | | **REJECT** | wrong protocols (no OAuth, no Zigbee, no Z-Wave). |
| **Homey Compose** (built into the CLI) | ISC | | 0 | REUSE_AS_IS | `homey app compose` keeps flow card IDs (architect doc, CLI `lib/App.js` `migrateToCompose`). |
| **Homey system capabilities** (IDs only): `measure_pressure`, `measure_humidity`, `measure_co2`, `measure_luminance`, `thermostat_mode`, `hot_water_mode`, `meter_water`, `measure_water`, `alarm_water`, `alarm_heat`, ... | JSON in GPL-3.0 `node-homey-lib` | | | REUSE_AS_IS by ID | listed in `athombv/node-homey-lib/assets/capability/capabilities/`. We reference IDs, we do not copy JSON. |
| **Homey Style Library** (`homey-form-*`, `homey-button-*` CSS in pair views, Homey Pro >= 8.1.0) | platform | | 0 | REUSE_AS_IS | replaces jQuery/own CSS in the pair view. |
| `athombv/github-action-homey-app-validate` (docker action, input `level: debug\|publish\|verified`, default `publish`) | **no licence file** | 2024-08 | - | ADAPT | use **by reference** in our own workflow, pin to a commit SHA rather than `@master`. Do not copy Athom's template text beyond a `uses:` line. |
| `athombv/github-action-homey-app-publish`, `-version` | no licence file | 2025-11 / 2024-09 | - | optional ADAPT | later release automation. |
| `actions/checkout@v4`, `github/codeql-action@v3`, `actions/setup-node@v4` | MIT | | | REUSE_AS_IS | replaces the retired v1/v2 actions. |

---

## 9. Master decision register (62 assets)

Counts: **REUSE_AS_IS 11, ADAPT 16, REIMPLEMENT_FROM_INTERFACE 12, REJECT 23.** Reasons are in sections 3, 4, 6, 7, 8. The same list is returned as the structured result of this task.

| # | Asset | Origin | Licence | Decision |
|---|---|---|---|---|
| R1 | Capability IDs and options (app.json:34-146) | this repo | GPL-3.0 | REUSE_AS_IS |
| R2 | `address` setting key, driver id `open-toon`, `data.id` scheme | this repo | GPL-3.0 | REUSE_AS_IS |
| R3 | LICENSE (GPL-3.0) | this repo | GPL-3.0 | REUSE_AS_IS |
| R4 | Node 22 built-ins (`fetch`, `AbortSignal.timeout`, `node:http`, `node:test`, `node:assert`) | Node.js | MIT | REUSE_AS_IS |
| R5 | `homey` SDK module (`require('homey')`) | Athom (provided by Homey) | ISC | REUSE_AS_IS |
| R6 | `homey-lib` validator (dev) | Athom | ISC npm / GPL-3.0 GitHub | REUSE_AS_IS |
| R7 | Homey Compose | Athom CLI | ISC | REUSE_AS_IS |
| R8 | Homey system capability IDs (`measure_pressure`, `thermostat_mode`, ...) | Athom node-homey-lib | GPL-3.0 | REUSE_AS_IS |
| R9 | Homey Style Library (`homey-form-*`) | Homey platform | platform | REUSE_AS_IS |
| R10 | `actions/checkout@v4`, `github/codeql-action@v3`, `actions/setup-node@v4` | GitHub | MIT | REUSE_AS_IS |
| R11 | `homey-apps-sdk-v3-types` (optional dev) | Athom | ISC | REUSE_AS_IS |
| A1 | Flow card definitions (app.json:174-541) | this repo | GPL-3.0 | ADAPT |
| A2 | `temperature_state` capability definition (+ `vacation`) | this repo | GPL-3.0 | ADAPT |
| A3 | Unit conversions in device.js | this repo | GPL-3.0 | ADAPT |
| A4 | Water handling (PR #21 by oepi-loepi, device.js:173-186,344-347,410-424) | this repo | GPL-3.0 by contribution (GitHub ToS D.6) | ADAPT |
| A5 | Thermostat/power/gas parsing (device.js:318-480) as pure functions | this repo | GPL-3.0 | ADAPT |
| A6 | `TEMPERATURE_STATES` map | this repo | GPL-3.0 | ADAPT |
| A7 | driver.js flow listeners (v3 style) | this repo | GPL-3.0 | ADAPT |
| A8 | locales en/nl | this repo | GPL-3.0 | ADAPT |
| A9 | README.md content | this repo | GPL-3.0 | ADAPT |
| A10 | package.json metadata | this repo | GPL-3.0 (field says ISC) | ADAPT |
| A11 | .github/dependabot.yml | this repo | GPL-3.0 | ADAPT |
| A12 | `homey` CLI as devDependency, pinned 4.4.0 for Node 22 | Athom | ISC | ADAPT |
| A13 | `eslint-config-athom` + `eslint@~8.57.1` (Athom scaffold; includes `eslint-plugin-homey-app`) | Athom | ISC (plugin: ISC npm / GPL-3.0 GitHub) | ADAPT |
| A14 | `athombv/github-action-homey-app-validate` by reference (SHA pinned) | Athom | none | ADAPT |
| A15 | `athombv/github-action-homey-app-publish` / `-version` | Athom | none | ADAPT |
| A16 | Test-worthy behaviours of device.js as fixtures/tests | this repo | GPL-3.0 | ADAPT |
| I1 | Toon HTTP client for core endpoints (thermostat, usage, meters, writes) | TE, HC, HS, TS (MIT) + live validation | MIT | REIMPLEMENT_FROM_INTERFACE |
| I2 | Meter discovery by `type` string | cyberjunky/oepi `toon_smartmeter`; Domoticz plugin facts | MIT / GPL-2.0 (facts) | REIMPLEMENT_FROM_INTERFACE |
| I3 | ToonWater `/water.html` parser and presence probe | oepi-loepi/toonWater, corroborated by TSC `mobile` | none | REIMPLEMENT_FROM_INTERFACE |
| I4 | Write action semantics (`setSetpoint`, `changeSchemeState`) | TE, HC, TS, device.js:198-310 | MIT | REIMPLEMENT_FROM_INTERFACE |
| I5 | cyberjunky/oepi `home-assistant-toon_climate`, `_smartmeter`, `_boilerstatus` | cyberjunky, forked by oepi-loepi | MIT | REIMPLEMENT_FROM_INTERFACE |
| I6 | `smbl64/toon-exporter` TOON.md | smbl64 | MIT | REIMPLEMENT_FROM_INTERFACE |
| I7 | `toonsim` (own Node mock instead; toonsim optional manual harness) | ToonzDev / TSC | MIT | REIMPLEMENT_FROM_INTERFACE |
| I8 | Domoticz plugins (`MadPatrick/domoticz_toon`, `hansaplast26/domoticz-rooted-toon`) | community | GPL-2.0 / none | REIMPLEMENT_FROM_INTERFACE (facts only) |
| I9 | Boiler status endpoint `/boilerstatus/boilervalues.txt` (candidate C5) | TSC boilerstatus app | none | REIMPLEMENT_FROM_INTERFACE |
| I10 | `/tsc/sensors` Toon 2 sensors (candidate C6) | TSC helper script | none | REIMPLEMENT_FROM_INTERFACE |
| I11 | ESP sensor module flat `/water.html` payload (candidate C10) | toonWater add-on source, toonwater.nl | none | REIMPLEMENT_FROM_INTERFACE |
| I12 | Feature catalogue of the standalone toonWater Homey app (public listing only) | homey.app listing | n/a | REIMPLEMENT_FROM_INTERFACE (ideas only) |
| J1 | `request-promise-native` HTTP transport in device.js | this repo | ISC dep | REJECT |
| J2 | driver.js `onPair` / `testConnection` | this repo | GPL-3.0 | REJECT |
| J3 | driver.js `mapDeviceClass()` | this repo | GPL-3.0 | REJECT |
| J4 | pair/start.html | this repo | GPL-3.0 | REJECT |
| J5 | PNG images (app and driver, large and small) with Eneco branding | unknown, likely Eneco | not GPL material | REJECT |
| J6 | icon.svg (x2, identical) | unknown, device art | unknown | REJECT |
| J7 | CONTRIBUTING.md (Athom boilerplate) | Athom | unknown | REJECT |
| J8 | package-lock.json + committed node_modules (1,880 files) | this repo | various | REJECT |
| J9 | .github/workflows/codeql-analysis.yml | this repo | GPL-3.0 | REJECT |
| J10 | `homey-wifidriver` | Athom | ISC | REJECT |
| J11 | `homey-log` (v1 in repo, v2 offered) | Athom | ISC | REJECT |
| J12 | `oepi-loepi/nl.toonwater.toonwater_vinceste` (private, not read) | oepi-loepi | none (private) | REJECT |
| J13 | `oepi-loepi/nl.toonwater.toonwater` (empty issue-tracker repo) | oepi-loepi | none | REJECT |
| J14 | ESLint 9/10 flat config today, instead of Athom's ESLint 8 scaffold | ESLint | MIT | REJECT (revisit when Athom updates) |
| J15 | `homey-api` | Athom | proprietary | REJECT |
| J16 | `request`, `node-fetch`, `axios`, explicit `undici` | npm | ISC / MIT | REJECT |
| J17 | `mocha`, `jest`, `vitest`, `msw`, `nock` | npm | MIT | REJECT |
| J18 | `homey-oauth2app`, `homey-zigbeedriver`, `homey-zwavedriver` | Athom | ISC | REJECT |
| J19 | `toonmqtt` as a dependency (ideas only) | phoenix-blue / TSC | MIT | REJECT |
| J20 | ReToon, freetoon-lvgl (replacement firmware) | community | none / NOASSERTION | REJECT |
| J21 | Cloud-API era repos (`Geertvdc/ToonOpenAPIWindows`, `Toon-JS`, `go-toon`, `Toon-Android`) | community | none / MIT | REJECT |
| J22 | Homey app "Toon P1" (`nl.wisefire.eneco-meteradapter`) | Wisefire | unknown | REJECT |
| J23 | `athombv/nl.eneco.toon` (ancestor, HTTP 404) | Athom | unknown | REJECT |

---

## 10. Licensing and IP risks the owner should resolve

1. **Ask `oepi-loepi` for explicit permission and a licence.** The `toonWater` Toon app, `nl.toonwater.toonwater` and `nl.toonwater.toonwater_vinceste` carry no licence (all rights reserved), and the last is private. He offered an SDK 3 rewrite in issue #22 (2023-02-13, translated from Dutch: he is rewriting the app for SDK 3, can also publish it under his own App Store account, and asks to be contacted by message) and no reply from the repo owner is visible in the issue (a third person answered that this sounds like good news). Concretely ask him: (a) to add GPL-3.0 (or MIT) to `toonWater`, (b) whether he wants to contribute the ToonWater module to this repo by pull request (GPL-3.0 applies to his contribution by GitHub ToS D.6), (c) whether the two Homey apps should converge, (d) consent to be credited and to use the name "ToonWater" in our UI. We designed around not needing his code (section 5), so this is about trust and credit, not a blocker.
2. **Reverse flow of GPL-3.0.** The published app lists "Vinceste IT (Stefan Postma), Paul Heeringa" as contributors, so its `toonThermostat` driver may derive from this GPL-3.0 repo. If it does, GPL-3.0 would apply to that derived code as well (and the private repo could not stay private for a distributed app). We did not compare code, so this is a conversation topic, not a claim.
3. **Eneco/Quby artwork and the Toon trademark.** The two large PNGs (the only ones viewed; the small ones are presumably downscaled copies) show an Eneco-branded Toon with the Eneco logo on its screen; the SVG is device art. They are not GPL material. The app name is written "Open-Toon(R)" (app.json:7 and 86-87), which claims a registered mark. The owner already noted in issue #15 (2020-11-16) "The Toon device has a registered trade mark" and in issue #17 (2024-03-25) that the Homey Store route was blocked by the shared package name and old libraries. Replace the images with original art, drop the (R), use a descriptive "for Toon thermostats" wording, and keep the "not affiliated" disclaimer. Legal advice recommended before an App Store submission.
4. **Ancestry.** `package.json` still names `athombv/nl.eneco.toon` (package.json:2,15-24) and the issue #17 comment says this app is a fork of the original Toon app. `athombv/nl.eneco.toon` now returns 404, so its licence cannot be re-checked. Keep upstream copyright notices, record the origin, and decide whether the redesign should be advertised as a new app.
5. **`package.json` says `ISC`, `LICENSE` says GPL-3.0.** Fix to GPL-3.0 and make sure the final dependency set stays compatible (it will be empty at run time).
6. **MIT notices.** If any MIT-sourced text or code (cyberjunky/oepi HA forks, toonsim, toon-exporter, toonmqtt) is later copied, including a long JSON sample from a README, add the copyright and permission notice. The HA forks' LICENSE shows only Ron Klinkien's copyright, with no separate line for `oepi-loepi`'s modifications.
7. **GPL-2.0 plugin** (`MadPatrick/domoticz_toon`): do not copy; we recorded facts only.
8. **Dev-tool licence mismatches.** `homey-lib` and `eslint-plugin-homey-app` are ISC on npm but GPL-3.0 on GitHub. They are never shipped, so the risk is low; `homey-api` is proprietary and must not be added.
9. **Firmware and screenshots.** toonsim runs the Quby/Eneco GUI taken from the owner's own Toon. Never commit firmware (`.rcc`), screenshots of it, or `data/` folders.
10. **Contributor credits.** `app.json` lists `oepi-loepi` and `Paul Heeringa`; git authors also include `PaulNL89` (5 commits, 2019-02-25), `moezie` (PR #28, SDK 3 bump) and the issue #7 "Version 1.0.0" PR (`Inversion-NL`). Credit them in README/app.json; check that `PaulNL89` and `Paul Heeringa` are the same person (unknown).
11. **Interface facts are not licensed code**, but be careful not to publish *copied* snippets, comments or screenshots from unlicensed repos in docs or tests. This document contains only field names, units and URL shapes (functional interface facts); whether that is permissible in every jurisdiction is a legal question we did not research.
12. **ToonStore/TSC forks are unlicensed too.** `ToonSoftwareCollective/toonWater` is a fork with no licence; forking does not grant a licence. Running the add-on in toonsim for tests is personal use, not redistribution.
13. **Name collisions.** "ToonWater" is also a commercial hardware module (toonwater.nl). Using the name for a feature in our UI could imply affiliation; ask (item 1) or use "Water add-on (ToonWater)".

---

## 11. Corrections to earlier statements (architect doc `00-...` and the run's task text)

| Earlier statement | Finding |
|---|---|
| "oepi-loepi/* repos ... carry NO licence" (task, hard rule 4) | True for toonWater and the Homey repos; **false for `home-assistant-toon_*`**, which are MIT forks of cyberjunky's. |
| "nl.toonwater.toonwater ... ships a `toonThermostat` driver" (architect 0, "not verified") | The public **store app** lists that driver (verified on homey.app). The **GitHub repo of the same name is empty**; the code is in a private repo (`..._vinceste`). |
| "`water.html` payload ... `total`/`value` in litres" (architect 1) | Confirmed, and refined: all four values are integers; `total` exists only from add-on 1.1.16; `flow` is L/min; `avgValue` default 200. |
| "doc comment at device.js:171 is stale" (architect 2) | Confirmed by history: the comment shows the 1.1.15 shape. |
| "`meter_power` raises `Invalid Capability` every power update" (architect 0/2, harness S1) | Only if `GetCurrentUsage` contains `dayUsage` and `dayLowUsage`. Two independent samples (TE:15-22, toonsim `happ_pwrusage.js:84-86`) show it does **not**. The mock must not assume those keys. The capability is still missing from the driver, so the code is still wrong. Hardware check H2. |
| "`dev_2.x` hard-coded" (architect 2, C) | Correct for one Toon generation, **wrong for `dev_3.x`** generation; type-based discovery is a must (section 4.4). |
| "HA integration resolves nodes by type and checks dev_3/4/7" (architect 2) | Confirmed (`sensor.py:314-366,395-420`). |
| "Toon serves `text/javascript`" (architect 5) | Confirmed for daemon endpoints; `boilervalues.txt` is `text/plain`; `water.html` content type unknown. |
| "`resume_program` semantics need hardware" (architect 6) | Partially narrowed: `state=2` + preset is the temporary override (live-validated, TE:168), `state=0` = program off, `state=1` = program on, `state=8&temperatureState=4` = vacation (HC). "Disable program" most likely means `state=0` combined with the preset. Still hardware (H5). |
| "homey CLI 4.6.3 ... Node" (architect 1) | The CLI needs **Node >= 24** from 4.4.1. For Node 22 use `homey@4.4.0`. |

---

## 12. What can only be verified on hardware (feeds the hardware test plan)

| # | Check | Why it matters | Needs |
|---|---|---|---|
| H1 | Dump `/hdrv_zwave?action=getDevices.json` from **each** Toon (Toon 1 and Toon 2, tariff and single-tariff homes, with/without solar). Record `dev_2.*` vs `dev_3.*`, the `type` strings, `NaN` fields; compare nt/lt with the Toon display (piek/dal). | confirms 4.4, fixtures, export counters, the nt = peak assumption | Toon |
| H2 | Dump `GetCurrentUsage` and confirm whether `dayUsage`/`dayLowUsage` exist in the HTTP answer. | decides whether `meter_power` can exist at all | Toon |
| H3 | With ToonWater running: save `/water.html`, `curl -i` for headers (`Content-Type`, `Last-Modified`, `ETag`, `Cache-Control`); behaviour before the first sensor poll (expect 404); behaviour after the ESP is unplugged (stale?); time of the daily `value` reset; add-on version (>= 1.1.16). | the presence/staleness design (5.2) | Toon + ESP or Domoticz |
| H4 | Does the Toon's web server cope with `Accept-Encoding: gzip, deflate` (default fetch) or does it need `identity`? | T4 | Toon |
| H5 | `changeSchemeState` semantics: `state=0` alone, `state=0&temperatureState=N`, `state=1`, `state=2&temperatureState=N`, `state=8&temperatureState=4`; observe `programState`/`activeState` after each, and what "resume program afterwards" means. | `resume_program`, vacation | Toon |
| H6 | Polling tolerance: 10 s vs 30 s vs 60 s; response time under load; behaviour in the 03:00-04:00 reboot window; time to come back. | defaults for `poll_interval` and the offline policy | Toon |
| H7 | Port and firewall: is port 80 the only port; behaviour of ReToon/freetoon variants. | T1, T10 | Toon |
| H8 | `HAE_METER_v4_9` native water on any adapter. | candidate C7 | Toon (maybe none) |
| H9 | Optional "semi-hardware": run `toonsim` with the owner's Toon firmware and install ToonWater in it; point a fake ESP (our Node mock serving the flat payload) at it; capture the real `/water.html` the real add-on writes. | exact bytes of the payload without touching the real Toon | PC + firmware copy |
| H10 | **Homey side**: what happens to Insights history when a capability is removed and added again; whether a flow card with `filter: driver_id=open-toon&capabilities=measure_water` hides when no device has it; behaviour of `addCapability` on an existing device with Flows. | the opt-in switch must not lose data or Flows | Homey Pro |

---

## 13. Provenance log (what was read, to demonstrate rule 4)

* **Unlicensed sources read for interface facts only, nothing copied or saved:** `oepi-loepi/toonWater` (`ToonWaterApp.qml` @ v1.1.25 and 12 historic commits for one write statement each; `WaterConfigScreen.qml`, tile files for units; `Changelog.txt`, `minversion.txt`, `version.txt`, `usageInfo.txt`, `billingInfo.txt`), `oepi-loepi/water_ESP_part` README, `oepi-loepi/nl.toonwater.toonwater` README, `ToonSoftwareCollective/mobile` `mobile.js` (grep for endpoints and the water handler), `ToonSoftwareCollective/toonstore_AppRepository/ToonRepo.xml` (one entry), `hansaplast26/domoticz-rooted-toon` (grep).
* **GPL-2.0, facts only:** `MadPatrick/domoticz_toon` (README sections and grep of `plugin.py`).
* **MIT, read in full or in part, facts only:** cyberjunky/oepi `home-assistant-toon_*` (three components), `smbl64/toon-exporter/TOON.md`, `ToonSoftwareCollective/toonsim` (README, `happ_thermstat.js`, `happ_pwrusage.js`, `hdrv_zwave.js`, `localweb.cpp`, part of `tsc.device.sh`, `docs/MANUAL.md` head), `ToonSoftwareCollective/toonmqtt` docs.
* **Not read:** `oepi-loepi/nl.toonwater.toonwater_vinceste` (private), `toonHomey` (QML, irrelevant), anything on domoticaforum.eu (HTTP 403 for the fetch tool).
* **Web:** homey.app listing of `nl.toonwater.toonwater`, community.homey.app thread "Toon en Homey" (page 7), community post "Toon P1", toonwater.nl front page, docs.github.com Terms of Service D.3/D.6, apps.developer.homey.app Node 22 and manifest pages, unpkg `homey-api/LICENSE`.
* **Local experiments (Node 25.9, to be re-run on Node 22 in CI):** `fetch` sends `accept-encoding: gzip, deflate` by default and can be set to `identity`; `res.json()` ignores `text/javascript`; `AbortSignal.timeout()` is accepted.
* **Sample values (SEC-01).** The sample comments of `ToonWaterApp.qml` (`:232` ESP answer, `:284` Toon answer) were read for the shape and the member names. An earlier revision of the fixtures, the tests and the requirements carried the values of the `:232` sample (the meter reading and today's litres) and the same key order; the claim "nothing was copied" did not hold for those two numbers. They are replaced everywhere by invented values (total 7350214, today 137, own key order and own values for the other fields of the ESP answer).
* No file other than this document was created or changed. No git operation was run.
