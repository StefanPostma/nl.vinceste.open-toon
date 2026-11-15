# 12 - What the ToonSoftwareCollective repositories say about the local Toon HTTP interface

Read-only research, 2026-11-15. Scope: the public org `ToonSoftwareCollective` (83 repos). Question: which of our assumptions about the Toon HTTP interface
(`docs/sdlc/00` section 5, `03` section 4, `10` Q-xx, ADR-0003/0014/0015) do these repos confirm, contradict or add to. Facts only: no code was copied or closely
paraphrased, and nothing from the repos was executed.

Verdicts: CONFIRMED, CONTRADICTED, NEW (not in our docs yet), UNKNOWN. Confidence: high = 3+ independent org sources or primary source plus a consumer;
med = 1-2 org sources or a simulator; low = inference. "Simulator" (toonsim) is a community model of the Toon, not the device.

## Evidence legend (permalinks: `https://github.com/ToonSoftwareCollective/<repo>/blob/<sha>/<path>#L<n>`)

| Tag | repo @ sha | path |
|---|---|---|
| MOB | mobile @ cb0e171671 | `javascript/mobile.js` (the file `index.html` loads); `lang_en.js`, `lang_nl.js`, `lighttpd.conf` (LTD), `index.html` |
| MQD / MQA / MQS / MQT | toonmqtt @ 17c14c58f4 | `daemon/main.go` / `docs/ARCHITECTURE.md` / `docs/SENSORS_AND_CONTROL.md` / `docs/TOPICS.md` |
| SIM | toonsim @ ebbbe26308 | `sim/devices/<daemon>.js`, `sim/devices/Devices.qml`; SRC `src/localweb.cpp`; TSH `sim/tsc/tsc.device.sh`; TSR `README.md`; TSM `docs/MANUAL.md` |
| TPL | thermostatPlus @ 034205f849 | `ThermostatPlusApp.qml` (also `WSS.qml`) |
| BOI | boilerstatus @ d75cf42ee4 | `BoilerstatusApp.qml` |
| TWA | toonWater @ 7e515ea87b | `ToonWaterApp.qml`, `WaterTile.qml`, `Changelog.txt` |
| MBR | matterbridge @ f98f646854 | `service/toon-plugin/dist/module.js` |
| ZWR / SPN / ARB | zwaveRepair @ c43b9a6b4e / solarPanel @ 75ee554f79 / AutoReboot @ 3260900746 | `ZwaveRepairApp.qml` / `SolarGeneralProc.js` / `AutoRebootApp.qml` |
| RET / REP / UPD | ReToon @ 27add8492d / toonstore_AppRepository @ b4508862d1 / update-rooted @ f05cbb38e4 | `README.md` / `ToonRepo.xml` / `toonversions` (version list only) |

Where the answer lives: toonmqtt (`daemon/main.go`) and matterbridge run **on** a Toon 2 and read `http://127.0.0.1/...` (port 80), so they are real consumers of the
HTTP interface (not of the BXT bus for these reads). `homey` and `homeassistant` are Toon-side clients of Homey / Home Assistant: no Toon endpoint in them (checked, nothing to learn).
`thermostat.awk` lives in ReToon and converts the stock thermostat config file; it is not about HTTP and ReToon was only read at README level (rule 2).

## A. Thermostat read: `GET /happ_thermstat?action=getThermostatInfo`

| Fact | Our assumption | Verdict | Evidence | Confidence |
|---|---|---|---|---|
| Answer is `{"result":"ok", ...}`; every value is a **string** (`currentTemp`, `currentSetpoint`, `programState`, `activeState`, `burnerInfo`, ...); temperatures in 1/100 degC | strings, centi-degrees | CONFIRMED | MQD:183-191 (struct types are `string`; a JSON number would not decode on the Toon 2 where it runs), MQD:1136-1137 (/100), SIM happ_thermstat.js:69-79 (comment: "sends every value as a string"), MOB:534-541, TPL:573-586 | high |
| Full HTTP field list: `currentTemp, currentSetpoint, currentInternalBoilerSetpoint (degC, not /100), programState, activeState, nextProgram, nextState, nextTime (epoch s), nextSetpoint, randomConfigId, errorFound, connection, burnerInfo, otCommError, currentModulationLevel (%)` | the same list (fixture `thermostat.json`) | CONFIRMED | SIM happ_thermstat.js:69-79 (field-for-field equal to our fixture), MQD:183-195, MQD:1137-1145 | med-high (simulator mirrors the firmware; matches the Go struct) |
| `realSetpoint`, `boilerModuleConnected`, `haveOTBoiler`, `hasBoilerFault`, `preheating`, `setByLoadShifting`, `currentDisplayTemp` exist only in the internal BXT dataset, **not** in the HTTP answer | n/a (audit lists them as possible) | NEW | SIM happ_thermstat.js:108-132 vs :69-79 (HTTP) | med; do not plan on them over HTTP |
| `activeState` 0 comfort, 1 home, 2 sleep, 3 away, 4 holiday | same | CONFIRMED | MOB:16-20 and `index.html`:254-274 (button ids = states); SIM happ_thermstat.js:20; MQD:1151 | high |
| `activeState` -1 = manual setpoint / none | -1 none | CONFIRMED (one source) / **conflict** | SIM happ_thermstat.js:20,87-95 says -1; MQD:1151 maps `6` to "manual" and has no -1. Two org sources disagree; our parse drops both safely (unknown code = note + keep old value) | low-med; Q-03/Q-08 must record whether a manual setpoint reads -1 or 6 |
| `burnerInfo` 0 off, 1 central heating (flame), 2 hot water (tap) | 0/1/2 | CONFIRMED | MOB:499-526 (1 = flame on, 2 = tap), MQD:1155, TPL:611 (`== 1` = burner on), SIM:75-76 | high |
| `burnerInfo` 3 = pre-heat | 3 pre-heating | CONFIRMED (single source) + NEW nuance | only MQD:1155,1163-1164, which counts 3 as **hot-water active** (tap pre-heat), not room pre-heat; the BXT dataset has a separate `preheating` flag (SIM:129) | low-med; Q-04/Q-33 stay open |
| `programState`: 0 manual (program off), 1 follows program, 2 temporary override | 0/1/2 | CONFIRMED | MOB:6-14, SIM happ_thermstat.js:9, TPL:748-758 | high |
| `programState` full table: 3 program override, 4 holiday, 5 manual holiday, 6 away-now, 7 day-off, 8 locked base ("Continu"/"Locked") | only 0/1/2 (4 "M") | NEW | MOB:6-14; UI grouping MOB:401-430 (0,4,5 no program; 1,2,3 program; 8 program + lock icon); strings `lang_nl.js`:11-15, `lang_en.js`:8-12 | med-high (vendor-derived constants; no raw capture) |
| `errorFound` 0 or 255 = no fault, anything else = boiler fault code; `otCommError` 1 = OpenTherm communication error | not read | NEW | MOB:499-516; SIM:76 (255, 0) | med; candidate alarm, not needed for 2.0.0 |
| Setpoint range 600-3000 (6-30 degC) | `SETPOINT_RANGE` 6-30 | CONFIRMED | MOB:615-618, TPL:782-784, MQT set/setpoint (TOPICS.md:93), MBR (min 6, max 30) | high |
| Toon UI steps 0.5 degC (setpoint printed as x,0 / x,5); another client (thermostatPlus) steps 0.1, so finer setpoints exist | round to 0.5 | CONFIRMED | MOB:354-361 and `index.html`:236,241 (`changeTemp(+-50)`); TPL:782-783 (+-10) | med |
| `currentTemp` for < 10 degC is a 3-digit string | numeric parse | CONFIRMED | MOB:375-377 handles 3 or 4 digits | low-med |

## B. Writes

| Fact | Our assumption | Verdict | Evidence | Confidence |
|---|---|---|---|---|
| `setSetpoint&Setpoint=<degC x100>` integer; `roomSetpoint` is the mobile site's alias | `setSetpoint`, x100 | CONFIRMED | SIM happ_thermstat.js:87-96, TPL:768-792, MOB:83,604 (alias, 600-3000 clamp) | high |
| **Conflict:** matterbridge sends `Setpoint = degC x 10` (21 degC -> 210) while reading `/100` | x100 | CONTRADICTED by one repo, outvoted by five | MBR:353 vs MBR:79. Looks like a defect or untested path in an experimental v0.2.1 | med that MBR is wrong |
| A manual setpoint during the program becomes a temporary override: `programState` 1 -> 2, `activeState` -1; it lasts until the next program block | "temporary, the Toon decides" (Q-09 open) | CONFIRMED (med) | TPL:777,786 (assumes 1 -> 2), SIM happ_thermstat.js:87-95 and 242-254 (override until next block), MQD:2018-2022 (toonmqtt writes a setpoint as state 2 + temperature), UI word "Tijdelijk"/"Now" (`lang_*.js`) | med (end-of-override timing is simulator + UI label only) |
| `changeSchemeState&state=<programState code>&temperatureState=<preset id>`; `state` uses the programState table above | state 0/1/2 | CONFIRMED + NEW (table) | MOB:593-597, SIM happ_thermstat.js:98-106 | high |
| `state=2` + preset = temporary override (clients use it when the program is on) | `RESUME.yes` | CONFIRMED | MOB:556-583 (first tap), MQD:2034-2038 | high |
| `state=1` program on, `state=0` program off (no preset) | `programOn`/`programOff` | CONFIRMED | TPL:748-758 (in production use on real Toons), MQD:2050, MOB constants | high |
| `state=0&temperatureState=<id>` keeps the program off and sets a preset | `RESUME.no` placeholder | UNKNOWN for a program that is **on** | Both org clients send it only when `programState` is already 0: MOB:564-566, MQD:2034-2038 (they choose `state` from a fresh read). Nobody sends it from program-on | med that it works when off; none when on |
| **NEW risk:** the two clients send `state=0` (not 2) when the program is off; `RESUME.yes` always sends 2 | always 2 | NEW | MOB:564-566, MQD:2018-2022,2034-2038 | med. R5 of Q-02 tests exactly this |
| Second way to "keep the preset": `state=8` = locked base (program stays on, preset locked; UI "Continu op X" / "Locked on X"); the web app sends it when the active preset is tapped again | not in ADR-0015 | NEW | MOB:570-574, MOB:424-430, `lang_nl.js`:12-13 | med (semantics inferred from UI); candidate B for Q-02 |
| `state=8&temperatureState=4` = vacation | mock-toon.js:338, ADR-0014, doc 03 I4/C3 | CONTRADICTED (by org naming) | state 8 is LOCKEDBASE (MOB:14); holiday is programState 4/5 + activeState 4 and is entered through the BXT request `Thermostat.SetHoliday` with periods (SIM happ_thermstat.js:184-185), not through changeSchemeState. No org client sets vacation over HTTP | med; our app never sends it, only the mock and docs claim it |
| What a preset change does during vacation | unknown | UNKNOWN | MOB:568-580 sends the ordinary state 2; effect on holiday unknown | - |

## C. Power: `GET /happ_pwrusage?action=GetCurrentUsage`

| Fact | Our assumption | Verdict | Evidence | Confidence |
|---|---|---|---|---|
| `powerUsage.value` (W) and `.avgValue` are JSON **numbers** (or null) | W, number | CONFIRMED | MQD:1204-1214 (decoded into float pointers), SIM happ_pwrusage.js:76-87, MOB:921-926, SPN:337-339, MQT:30 | high |
| HTTP answer has **no** `dayUsage`/`dayLowUsage`; those are BXT dataset fields | none (ADR-0014) | CONFIRMED | SIM happ_pwrusage.js:77-87 (HTTP) vs :97-100 (dataset); no org consumer reads them over HTTP (MQD, MOB, MBR, SPN) | med-high |
| `powerProduction.value` (W) exists in the same answer | export, W | CONFIRMED (field) | SIM:85, MQD:1204-1214, MBR:103, SPN:337, MQT:32 | high |
| Meaning of `powerProduction`: simulator models it as the **solar panel output**, with `powerUsage.value` staying the house's gross use; matterbridge computes net = usage - production; toonmqtt injects "returned power" into the same meter object | "export / feed-in (Q-11)" | NEW nuance, UNKNOWN | SIM happ_pwrusage.js:95-96,116, MBR:116, MQA:35, MQT:32 | low-med. With a solar meter `measure_power` may be gross use and `measure_power.export` panel yield; our title "Power export"/"Teruglevering" is then slightly off. HW (Q-11) |
| `gasUsage.value` is litres per hour, derived by the Toon from successive gas totals (so null/0 right after boot) | null on most Toons, ignored | CONFIRMED + NEW unit | SIM happ_pwrusage.js:86 and comment ("l/h"), MQA:41, MQT:34 (`gas_usage_lph`), MBR:104,118 | med; makes FR-29 (instant gas) plausible, Q-10 |
| Internal units: flow W, electricity quantity Wh, gas quantity litre (variable names `CurrentElectricityFlow`, `CurrentElectricityQuantity`, `CurrentGasQuantity`) | W / Wh / L | CONFIRMED | MQA:34-37 | med-high |
| Without a smart meter | unknown | UNKNOWN | MOB:665-678 (falsy value shown as 0), MBR:105 (non-finite = read failure), SPN:337 assumes the objects exist | - |

## D. Meters: `GET /hdrv_zwave?action=getDevices.json`

| Fact | Our assumption | Verdict | Evidence | Confidence |
|---|---|---|---|---|
| Flat map `dev_<node>[.<n>]` -> object with `type`, `name`, `uuid`, `IsConnected` ("1"), per-device readings; plus a non-device key **`dev_settings_device`** that clients skip | flat map | CONFIRMED + NEW | MOB:706-720,812-840. Our `NODE_KEY` (`parse.js:61`) accepts the key, but it has no `type`, so it never matches a role (harmless) | med |
| `"NaN"` strings for unset flows (clients test with `isNaN`) | "NaN" strings | CONFIRMED | MOB:840 | med |
| Readings and units: `CurrentElectricityQuantity` Wh, `CurrentGasQuantity` litre, `CurrentElectricityFlow` W | same | CONFIRMED (names/units) | MQA:34-37; location inside getDevices.json is not shown by any org consumer | med |
| Which node is gas / delivered / produced; `dev_2.x` vs `dev_3/4/7`; type strings (`gas`, `elec_delivered_nt`, ...) | `METER_RULES` | UNKNOWN | no getDevices dump in the org; toonsim answers `{}` (SIM hdrv_zwave.js:10). Only: config of the Z-Wave driver holds meter adapters as `<type>HAE_METER_...` (ZWR:34) and plug types are `FGWPF102`, `ZMNHYD1`, ... (MOB:813) | - |
| Why node numbers differ: the Quby meter adapter is a **Z-Wave** device, so its node number is plausibly the Z-Wave node id given at inclusion | legacy `dev_2.x` first | NEW (inference) | RET:57-59 ("Z-Wave ... plugs, the Quby meter adapter"), ZWR:34 | low-med; supports type-based discovery, and a plug that owns node 2 would shadow the legacy keys (we read `dev_2.1`, `dev_2.2`, `dev_2.4`, `dev_2.6` before checking `type`) |
| Role-named alternative that needs no node id: RRD loggers `elec_quantity_nt`, `elec_quantity_lt`, `elec_quantity_nt_produ`, `elec_quantity_lt_produ`, `gas_quantity` via `/hcb_rrd?action=getRrdData&loggerName=...&rra=10yrdays&readableTime=1&nullForNaN=1&from=<dd-mm-yyyy>`; values Wh / litre; "_produ" exist only with a production meter | not used | NEW | MOB:49-63,1099,1235; SPN SolarGeneralProc.js:367; SIM hcb_rrd.js:6-9,31 (answer is a time->value map; unknown logger -> `result:error` in the simulator) | med; a cross-check and fallback for Q-01 and Q-11 |
| Single vs two tariff, delivered vs produced node, Toon 1 vs 2 layout | NaN rule | UNKNOWN | nothing in the org; RET:64-68 says ReToon cannot read the meter adapter yet | - |

## E. Water: `/water.html` (ToonWater add-on)

| Fact | Our assumption | Verdict | Evidence | Confidence |
|---|---|---|---|---|
| Payload `{"result":"ok","water":{"flow":N,"total":N,"value":N,"avgValue":N}}`, all integers, written to the web root file `/qmf/www/water.html`; `total` since 1.1.16 | same | CONFIRMED | TWA:283-284 and 421-422 (the two write sites), TWA:107, Changelog 1.1.16 ("changed location of water data for mobile app"), MOB:1265-1277 (independent reader: uses `flow`, `value`, `avgValue`) | high |
| Units: `flow` l/min, `total` litres (tile shows /1000 as m3), `value` litres today | same | CONFIRMED | `WaterTile.qml`:49,76; `WaterNow.qml`:34 | high |
| The file is rewritten only when `flow` or today's value differs from the last written (both start at 0 in memory); the add-on polls its sensor every 10 s | same (D-4) | CONFIRMED | TWA:46-47,283-286,421-424,539 | high |
| After a Toon reboot the file normally still exists (web root is persistent: TSC installs the mobile site into it) but may be stale; no file until the first write (flow and today's value both 0 -> nothing written) | "may be 404 after reboot" | NEW nuance (inference) | TSH:185-189 (mobile installed under `/HCBv2/www`), TWA:46-47 | low-med; Q-05 |
| Sibling ESP payload (flat `waterflow`, `waterquantity`, `today`, ...) | `SENSOR_MODULE_MEMBERS` | CONFIRMED | TWA:232 (field names), :249-250 | high |
| Toon without the add-on answers 404 | 404 = absent | UNKNOWN (plausible) | no org consumer documents it (MOB ignores failures); the simulator's 404 is its own "not simulated" (SIM Devices.qml:110-113). The TSC lighttpd has the 404 handler commented out (LTD:156), so a plain 404 is expected | med |
| Content type of `/water.html` is `text/html` (static file, extension table), not `text/javascript`; gzip is enabled for `text/html` and `text/javascript` when a client asks | client ignores content type; sends `identity` | NEW (supports ADR-0003 header) | LTD:90,92,211-212 (mod_compress acts on static files: lighttpd documentation, inference) | med |
| How the add-on is detected: only by the file; no endpoint lists installed apps. Second signal: the web app shows its water tiles only when the RRD logger `water_flow` returns data | probe `/water.html` only | CONFIRMED + NEW | MOB:1240-1263; no list endpoint found | med |
| ToonStore lists ToonWater 1.1.25 for Toon 1 and 2 (`toon2only` no), firmware 5.0.00-9.9.99 | same | CONFIRMED | REP:237-250 | high |

## F. Miscellaneous

| Fact | Our assumption | Verdict | Evidence | Confidence |
|---|---|---|---|---|
| Plain http on port 80, **no authentication** on `happ_*`/`hdrv_*`; the TSC lighttpd requires basic auth only for `/mobile`; a second listener `:10080` serves the same web root; thermostatPlus reads and writes another Toon's endpoints over the LAN without credentials | port 80, no auth | CONFIRMED | LTD:45-47,150,259-263; TPL:565-571 (Mirror/Master mode); MQD/MBR use `http://127.0.0.1/` | high |
| This `lighttpd.conf` is TSC's **replacement** of the stock file (the stock one is saved as `.orig` and lighttpd restarted) | stock = TSC | NEW | TSH:197-203 | high; stock config unknown |
| Firewall: stock firewall blocks LAN access; TSC offers `flushfirewall` (`iptables -F`); apps open their own ports via `iptables.conf` | T5 | CONFIRMED | TSH:264-267; TPL WSS.qml:8-44; TSR (README, "/etc/default/iptables.conf") | med-high |
| Content type of the `happ_*` answers | `text/javascript` | UNKNOWN in the org | consumers ignore it (Go decoder MQD:980, Node `response.json()` MBR:79, jQuery/JSON.parse MOB/TPL). The simulator answers `application/json` by its own choice (SIM Devices.qml:104,117) | - (harmless: our client parses the text) |
| Keep-alive vs `Connection: close`, `Accept-Encoding` | `close` + `identity` | UNKNOWN | on-device clients use default keep-alive on loopback (MQD:970-981, MBR); the simulator sends `Connection: close` (SRC:105-109). No evidence either way | - |
| Cadence of real clients: web app polls each endpoint every 10 s (water flow 5 s) with 5+ requests in parallel; matterbridge every 5 s (2 endpoints, 2.5 s timeout); toonmqtt default 30 s, minimum 5 s, 4 s timeout; boilerstatus 60 s; no org report of the Toon locking up | 10 s minimum, 30 s default, 5 s timeout, one request at a time | CONFIRMED as plausible (low) | MOB:547,927,1276; MBR:22,73-76; MQD:280,391-395,970-971; BOI:178-186 | low-med (all on loopback or LAN, none measured); Q-06 stays hardware |
| Nightly reboot of the stock firmware | 03:00-04:00 | UNKNOWN | not found. Only the optional AutoReboot app: next restart two days after start at 03:30 (its description says weekly) | - |
| Firmware/version/model over HTTP | none | UNKNOWN (none found) | apps read opkg control files on the Toon: `base-nxt-*` = Toon 2, `base-qb2-*` = Toon 1 (TSH:208-217; SIM happ_scsync.js:42-49). Latest version in the TSC list 6.3.30, before it 5.49.19; ToonStore minimum 5.0.00 | high that no HTTP endpoint is used by TSC apps |
| Variants: TSC adds `/mobile`, `/tsc/sensors` (Toon 2 sensor values, a file written by the helper script), `/boilerstatus/boilervalues.txt` (symlink to a file the boilerstatus app writes); the daemons behind `happ_*` are the vendor's. **ReToon** replaces the OS: its README names MQTT/Home Assistant and its own web interface, says reading the meter adapter / P1 "is not yet" supported, and never mentions `happ_*` | stock + TSC | CONFIRMED / UNKNOWN (ReToon) | TSH:353-354,535-557; RET:36-47,64-68; REP (`toon2only`) | med; treat ReToon as unsupported |
| Toon 1 vs Toon 2: the same daemon set serves both in the simulator; boilerstatus and ToonWater are flagged for both generations; toonmqtt and `/tsc/sensors` are Toon 2 only | Q-28 | UNKNOWN (leaning same) | TSR:24 (`--size toon1`), REP:705-716 and 237-250 vs 133-146, MQR:6-8 | low-med |
| `printTableInfo` (OpenTherm table) answers **pseudo-JSON with single quotes**, not JSON; most boilers leave rows at `updated 0` | not used | NEW | MQD:983-985,1071,995-999; MQS:79-98 | high (shape), Q-12 |
| `/boilerstatus/boilervalues.txt` exists only with the TSC boilerstatus app; text file of JSON with `sampleTime, boilerSetpoint, roomTempSetpoint, boilerPressure, roomTemp, boilerOutTemp, boilerInTemp, boilerModulationLevel`, rewritten every 60 s from 5-minute-old RRD samples; a logger with no data yields the placeholder 0.1 | Q-12 | NEW | BOI:150-186 (writer), TSH:353-354 (symlink) | high (shape), low (value quality) |
| Error shape `{"result":"error"}`; clients only trust `result == "ok"` | reject `error` | CONFIRMED | SIM happ_thermstat.js:89, MOB:536, MQD:1135,1210 | med |

## G. toonsim as a stand-in Toon

| Fact | Verdict | Evidence | Confidence |
|---|---|---|---|
| Not a pure mock: C++/Qt 5.15 host that runs the Toon's own GUI (QML) with device daemons written as small JavaScript models; Python tools; Windows (bundled Qt) and Linux x64 (Ubuntu 22.04, WSL2). No macOS | NEW | TSR:3-18, TSM:4,14,191-197 | high |
| **Needs the proprietary firmware**: at first start it copies the GUI files over SSH from the user's own rooted Toon (Eneco's; "do not share"). Without it nothing starts | blocks CI and anyone without a rooted Toon | TSR:37-39,323-325; TSM:3-12,227-228; `firmware/README.txt` | high |
| Local web server `http://127.0.0.1:8888` (loopback only, `--web-port N`); remote-control port 127.0.0.1:5555; our address field accepts `host:port`, so `127.0.0.1:8888` would be a valid Toon address | usable only on the same machine | SRC:35-58 (`QHostAddress::LocalHost`), TSM:143-145, `lib/toon/address.js:13` | high |
| Endpoints answered: `happ_thermstat` (getThermostatInfo, getThermostatStates, setSetpoint, roomSetpoint, changeSchemeState), `happ_pwrusage` (GetCurrentUsage), `hcb_rrd` getRrdData, `hcb_config` (getLocale, getObjectConfigTree), `hdrv_zwave` (getDevices.json -> `{}`), `/tsc/sensors`, static files from `/HCBv2/www`; anything else 404 text/plain. A `water.html` dropped into the data folder's web root would be served | partial coverage | TSR:107-115, SIM Devices.qml:93-118, hdrv_zwave.js:10 | high |
| Fidelity limits: no meter nodes, no ToonWater, no boiler faults (`errorFound` 255, `otCommError` 0 fixed), no vacation over HTTP, no validation (any `Setpoint`, any `state`, unknown preset ignored), content type `application/json` with `Content-Length` and `Connection: close` (unknown for the real server), simulated house (5 s tick), no reboot or latency behaviour, its state machine is the author's model (state 8 stored raw) | limits | SIM happ_thermstat.js:87-106,163-185; SRC:105-109; TSR:302-310 | high |
| Realistic use: a **manual** end-to-end check by the owner on Linux/WSL with a rooted Toon (pairing, field shapes, `result` envelope, probe script). Not a CI double: our own `test/helpers/mock-toon.js` is more flexible. Its field list agrees with ours, which is mild corroboration. Its JS handlers are MIT and could be adapted, but they depend on Qt/QML hub objects | recommendation | as above; licence TSR:318-327 | med |

## Impact on our code

1. **ADR-0015 / `lib/toon/commands.js:23-26,45-49` (resume_program).** Add the org evidence: both independent clients pick `state` from the current `programState` (0 when the program is off, 2 otherwise). Do not change the sequences before Q-02, but extend Q-02 with: (a) `state=0&temperatureState=<id>` from program-on (single request) versus `[state=0, then state=0&temperatureState=<id>]`; (b) candidate B `state=8&temperatureState=<id>` ("locked", program stays on) and its UI label; (c) R5 now has a stated expectation (a state-2 request while the program is off probably reports `programState` 2). If hardware shows a program-on `state=0&...` is ignored, use the two-request form; if neither holds the ADR fallback (make both options identical) stays.
2. **`lib/toon/parse.js:149-165` (`parseProgram`).** Evidence supports mapping `programState` 3 (program override) and 8 (locked base) to `'on'`; leave 4, 5, 6, 7 unreported. Update the doc comment (`:154-157`) with the nine-code table of section A. Add fixtures for 3 and 8.
3. **`lib/toon/parse.js:14-20`.** Keep `TEMPERATURE_STATES` and `BURNER_STATES`. Add a comment that `burnerInfo` 3 has one org source (counted there as hot water), and that `activeState` 6 is "manual" in toonmqtt while the simulator says -1. Do **not** add either mapping before Q-03/Q-04/Q-08 captures; the unknown-code path (note, keep old value) already protects the tile.
4. **`lib/toon/parse.js:61-72` (`NODE_KEY`, `discoverMeters`).** Skip `dev_settings_device` explicitly and add it plus two plug nodes (types `FGWPF102`, `ZMNHYD1`, `IsConnected`) to a getDevices fixture. Low priority hardening: when a legacy key holds a node whose `type` is a known plug/other role, do not use it (a Z-Wave plug on node 2 would shadow the legacy keys). Q-01 stays open: the org has no dump; ask for `getDevices.json` plus the five `hcb_rrd` meter loggers (section D) in the same probe run.
5. **`lib/toon/parse.js:114-122` (`parsePower`) and capability title `measure_power.export` (`app.json:738-743`).** Keep the parsing. The title "Power export"/"Teruglevering" assumes feed-in; the org simulator treats `powerProduction` as panel yield. Keep the title until Q-11, but do not describe it as grid export in the README.
6. **`test/helpers/mock-toon.js:338-339` and ADR-0014 line 12, `03` I4/C3.** `state=8&temperatureState=4` as the vacation entry is contradicted by the org naming (8 = locked base). Mark it "unverified, probably a locked preset". Optional: let the mock treat `state=8` as locked-base (`programState` 8, preset applied) so candidate B can be tested; keep vacation reachable only through the mock `vacation` option.
7. **`scripts/toon-probe.js:31-43` (`ENDPOINTS`).** Add read-only, optional probes: the five `hcb_rrd` meter loggers and `water_flow`, `/boilerstatus/boilervalues.txt` (Q-12), `/tsc/sensors` (variant detector), and `happ_thermstat?action=printTableInfo` as text. Record response headers (`Content-Type`, `Content-Encoding`, `Connection`, `Server`) for every endpoint (Q-13, Q-14).
8. **`lib/toon/client.js:17`.** Keep `Accept-Encoding: identity` (gzip for `text/html` is enabled in the TSC lighttpd, LTD:211-212). Keep `Connection: close` until Q-13: there is no org evidence for or against it. Note in ADR-0003 that real on-device clients use keep-alive on loopback without reported problems.
9. **`lib/features/toonwater.js:13-16` (provenance) and FR-55.** No code change. Add to the docs: the page is a static `text/html` file, exists only after the first write, persists across reboots (inference), and a second detection signal exists (`water_flow` logger). Q-05's 404 question remains hardware.
10. **`docs/sdlc/03-reuse-inventory.md`.** Correct the licence register: eight org repos carry MIT (see below), not only toonsim/toonmqtt. Add matterbridge (MIT, v0.2.1, Toon 2, polls `happ_thermstat` and `happ_pwrusage` every 5 s) and the x10 setpoint outlier. Add the programState table and the `dev_settings_device` key. Replace "T6 daily reboot 03:00-04:00" by "single non-org source; AutoReboot app uses 03:30".
11. **Hardware questions.** Narrowed, not settled: Q-02 (candidates A/B, expectation for R5), Q-04 (0/1/2 now three-source; 3 single-source), Q-07 (nine-code table known, captures still needed), Q-09 (temporary until next block, simulator/UI only), Q-10 (value is l/h, derived), Q-11 (semantics nuance, extra loggers), Q-12 (file shape and origin known), Q-13/Q-14 (TSC lighttpd facts, `happ_*` headers still unknown). Untouched: Q-01, Q-03 (vacation entry is BXT), Q-05 (404), Q-06, Q-15, Q-28. New capture item for Q-03/Q-08: does a manual setpoint read `activeState` -1 or 6.

## Licensing and provenance

* Brief said every repo has no licence. Correction: GitHub reports **MIT for 8 repos**: `toonmqtt`, `toonsim`, `matterbridge`, `stralingsmonitor`, `bekendmakingen`, `nlalert`, `ToonRooter`, `ToonRecovery`. Of these only `toonmqtt`, `toonsim` and `matterbridge` were used here (copyright lines: "Toon MQTT contributors", ToonzDev, djvanleest). MIT would allow reuse with the notice; nothing was reused.
* No licence (all rights reserved, GitHub `license: null`), facts only: `mobile` (incl. `lighttpd.conf`), `boilerstatus`, `thermostatPlus`, `toonWater`, `solarPanel`, `zwaveRepair`, `AutoReboot`, `toonstore_AppRepository`, `ReToon` (README only), `update-rooted` (version list file only), `tscSettings` and `freetoon` (README / grep only), `homey`, `homeassistant`, `toonTemp`, `toonHomeWizard` (read for relevance, nothing used).
* Excluded by rule 2 and not read beyond README: `ToonRooter`, `Root-A-Toon*`, `ToonRecovery`, `resourcefiles`, `ReToon-images` (README only), `tsc-images`, `ReToon` code (so `thermostat.awk` was not read).
* No code was copied or closely paraphrased. Each fact is recorded as a path, a field name, a unit or a behaviour in my own words, with at most one short identifier as evidence. Downloaded text lived in `/tmp` (outside this project), was only read with `grep`/`sed`, and nothing was run. Used about 60 GitHub API calls and one code search.
* Git: nothing committed or changed except this file.

## Not found / could not verify

* A real `getDevices.json` dump (node ids, meter `type` strings, tariff layout, produced counters): none in the org; toonsim returns `{}`.
* Any statement of the real `Content-Type`, keep-alive or compression behaviour of the `happ_*` endpoints, and of the stock (non-TSC) lighttpd configuration.
* The stock firmware's reboot schedule; any rate limit or crash threshold; behaviour of `powerUsage` without a smart meter.
* What `state=0&temperatureState=<id>` does from program-on, what `state=8` does at the next program block, how a preset change ends vacation.
* The 404 answer of `/water.html` on a real Toon; whether the web root file survives a reboot.
* ReToon interface (docs under `ReToon-images/docs` were not read on purpose) and FreeToon's service behaviour.
* `activeState` 5 and 6, `burnerInfo` above 3 on real hardware.
