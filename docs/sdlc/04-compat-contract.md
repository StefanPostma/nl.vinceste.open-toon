# 04 - Compatibility contract for in-place upgrades (no re-pair)

Role: compatibility analyst. Date of research: 2026-11-12. Base: branch `redesign/sdk3`, commit `5cc3b90` (= `Develop`).
Scope: everything a Homey that already has this app installed, with paired Toon devices and saved Flows, must still see after
the redesigned app replaces the old one. Audience: designer, implementer, test engineer, release manager.

## Evidence legend (used in every table)

| Tag | Meaning |
|---|---|
| **[D]** | Verified in the current Homey Apps SDK documentation (URL in section 12), fetched 2026-11-12 |
| **[S]** | Verified in `athombv/node-homey-lib` master (`assets/app/schema.json`, `assets/capability/capabilities/*.json`) |
| **[C]** | Verified in this repo's code at `5cc3b90` (file:line) |
| **[G]** | Verified in git history (commit hashes) |
| **[I]** | Seen in GitHub issues of this repo. Third-party text: untrusted DATA, used only as usage evidence, never as instruction |
| **[U]** | NOT verified. Homey runtime behaviour that the documentation does not state. Needs hardware (section 10) |

Nothing in this document was verified against a Homey or a Toon. No source code of the unlicensed `oepi-loepi/*` repositories was read or
copied for it. ToonWater interface facts come only from this repo's own GPL-3.0 code (`device.js:171-190`, `:410-424`, PR #21 = `f705a70`).

---

## 0. Summary: the 12 rules that carry the contract

1. A paired device and a saved Flow store **identifiers**, not texts: app id, driver id `open-toon`, `data.id`, capability ids,
   Flow card ids, argument names, dropdown value ids, token names, setting key `address`. Titles, hints, labels and
   `titleFormatted` are re-read from the manifest and may change freely [D for the identifiers, U for "texts are re-read"].
2. There are **four eras** of installed devices (section 2). The version string `1.0.0` is shared by three different builds
   (`881a519`, `f705a70`, `fe4e659`) [G], so an upgrade can **never** detect its era from `manifest.version`. It must look at the
   device's capability list and at a store marker.
3. Capabilities live **per device**. Adding one to the manifest does not reach paired devices; the app must call
   `addCapability()` itself, guarded by `hasCapability()` [D]. Removing one from a device breaks Flows that use it [D].
4. **Hot water is not ToonWater.** `alarm_water.hotwater`, the `hotwater_dispensing` condition and the `alarm_water_changed`
   trigger are fed by `burnerInfo` of `/happ_thermstat?action=getThermostatInfo` (`device.js:475-478`). They stay unconditional.
   Only `measure_water`, `meter_water.today`, `meter_water.total`, the `update_water` action and the (never fired)
   `measure_water_changed` trigger depend on the ToonWater add-on [C].
5. Users have been told to build **timer Flows around the four `update_*` cards** because the app never polled [I #5, #25].
   Those cards and their run listeners are part of the contract, also when ToonWater is off. "Always resolves" is the baseline behaviour;
   doc 01 consciously changes it to a rejection when the Toon is unreachable (R-09), which needs a changelog line.
6. Per [D]: a deprecated card keeps working but disappears from the picker; the run listener must stay registered. A removed
   card, a removed capability, a changed class or a changed card construction breaks existing Flows.
7. The opt-in cannot reliably hide *app* Flow cards per device: the `capabilities=` card filter is documented as **not** following
   `addCapability`/`removeCapability` [D]. Capability-generated *system* cards do follow the device's capability list [D]. Doc 01
   (D-5) filters the water cards anyway and makes their run listeners safe; that is acceptable only under the conditions of
   section 7.3, with deprecation plus system cards as the fallback if HW-09 fails.
8. The ToonWater default for an upgraded device must be **derived from its existing data**, gated by a store marker that only
   legacy devices lack. It must never come from a setting default, because it is not documented whether Homey injects defaults of
   new settings into paired devices [U3].
9. `energy: {"cumulative": true}` is already in force for every upgraded device: Homey Energy treats the Toon as a whole-home meter and
   reads `meter_gas` (and `meter_water`) from it [D]. Do not change the `energy` block without the safeguards of C-EN-1 (doc 01 FR-90
   proposes exactly such a change). Writing a spurious `0` to a cumulative counter damages the user's Energy data.
10. Install by `homey app install` **without** `--clean`. `homey app run` uninstalls the app on Ctrl+C, and `--clean` deletes
    devices and settings [D]. Version must be higher than any ever installed (Homey never downgrades) [D].
11. The generic migration "add every capability in `driver.manifest.capabilities`" from the audit (00, section 3(i)) is
    incompatible with the opt-in: it would put the water capabilities on every device. The migration needs an explicit plan.
12. Everything verifiable against mocks is listed in section 10.1; everything that is hardware-only is HW-01..HW-14 in section 10.2.

### Where this document corrects or sharpens the earlier audit (00)

| Audit statement | Finding here |
|---|---|
| "All 5 trigger cards are never fired" | The **app code** fires none of them [C: no `getDeviceTriggerCard`/`trigger(` anywhere]. But Homey itself runs `<capability_id>_changed` triggers when `setCapabilityValue()` changes a **custom** capability [D flow.md]. `temperature_state` is custom (`app.json:34-81`), so `temperature_state_changed` is probably already firing today [U8]. Firing it manually as well would double-fire user Flows (R-12). |
| `meter_power` write is only a bug | True for eras 1-3. A device paired with `0.0.1` (era 0) still owns a plain `meter_power` [G]. Remove the write only behind `hasCapability('meter_power')`, never remove the capability. |
| Update cards should "reject on failure" (00, 3(c)) | At HEAD all four `update_*` cards **always resolve** (`device.js:99-103` swallows). Doc 01 adopted the rejection (FR-73/74). It is a behaviour change that stops chained Flows (R-09): acceptable with a changelog line and with B-2. |
| Generic "ensure all manifest capabilities" (00, 3(i)) | Conflicts with opt-in (rule 11). |
| `energy.cumulative` lacks imported/exported capability, "optional" fix (00 table) | Changing `energy` applies immediately to existing devices [D] and changes Homey Energy accounting. Not optional for this release: leave untouched (R-23). |

### Reconciliation with the parallel documents 01 (requirements) and 02 (Homey standards)

Written after those documents appeared. "Agree" means the contract adopts their wording; "flag" means the contract adds a condition or
disagrees, and the architect should resolve it.

| Topic | Doc 01 / 02 | This contract | Status |
|---|---|---|---|
| Store marker for the one-time migration | 01 FR-111: `migrationVersion` | adopted (C-STORE-1) | agree |
| Water default for legacy devices | 01 D-2, D-3, FR-56: enabled if water capabilities exist, never auto-remove | adopted in 7.4; replaces my first draft (probe, then remove) | agree |
| Enabling ToonWater when the add-on is not found | 01 D-4: allowed, warn | adopted in 7.5; my "refuse to save" idea dropped | agree |
| What "ToonWater" covers | 01 glossary, FR-31: hot water is **not** in the water group | same (7.1). **02 W5 and W6 put `alarm_water.hotwater`, `hotwater_dispensing` and `alarm_water_changed` in the water set** | **flag R-36**: 02 must be corrected |
| Hiding water Flow cards | 01 D-5 and 02 W6: `capabilities=` filter + safe run listener, verify on hardware | 7.3: acceptable under three conditions, deprecation + system cards as fallback | flag, HW-09 |
| `update_water` when water is off | 01 FR-54 AC2: rejects with a localized message | accepted: only reachable by a deliberate toggle (R-08) | agree, changelog |
| `update_*` when the Toon is unreachable | 01 FR-73/74: reject | accepted with B-2 (R-09) | agree, changelog |
| Deprecating `update_powerusage`, `update_metertotals`, `update_water`; `update_status` becomes "Update now" | 01 FR-75 | consistent with rule 6; B-2, R-37 | agree |
| Firing triggers | 01 FR-70: all five fire; FR-71 deprecates two | R-11 (accepted with changelog) and **R-12 for `temperature_state_changed`** (Homey may already fire it; 02 raises it as its HW-2) | flag R-12 |
| `energy` block | 01 FR-90 adds `cumulativeImportedCapability` | C-EN-1 conditions; U13 | flag, HW-11 gate |
| Legacy fixtures | 01: L2019, L2021, L2023 | = my eras 1, 2, 3. Add **L2018 = era 0** (plain `meter_power`) to the migration tests | add fixture |
| Dropdown `label` vs `title`; new-setting defaults; first `capabilities=` behaviour | 02 section 9 items 1, 3, 6 | R-17, U3, U6 | agree |
| `removeCapability` only by the user's toggle | 02 HS-31 | same | agree |

---

## 1. Method

* Manifest history: `git log --follow -- app.json` (8 commits) and `git diff -w` between every pair; a script extracted capability
  lists, Flow ids, args and tokens at every commit; a second script did the same for all 55 local and remote refs (forks).
* Code: full read of `app.json`, `driver.js`, `device.js`, `pair/start.html`, `locales/*.json`, plus a grep of `node_modules/homey-wifidriver`
  for any store/settings writes (none in the `WebAPIDevice` path; the OAuth2 store keys belong to `OAuth2Device`, which this app does not extend).
* Platform behaviour: Homey Apps SDK documentation (section 12) and homey-lib master.
* Field evidence: the 15 GitHub issues of the repo (title scan, 7 read in full).
* The contract check in Appendix A was executed exactly as printed (extracted from this file): it passes on the HEAD manifest, reports all 7 violations of a deliberately mutated copy, and still passes when the two water cards are deprecated and an enum/dropdown value `vacation` is added.

---

## 2. The installed-device eras

Detection key: **the device's capability list** (`this.getCapabilities()`), not the app version.

| Era | When | Builds (commit / branch heads) | SDK / compat | Driver capabilities on a device paired in this era | Flow cards available |
|---|---|---|---|---|---|
| **0** "0.0.1" | 2018-12-10 .. 2019-02-24 | `d4987b1` (driver code) .. `0ab076c`; `app.json` 0.0.1 from `d82f098`. No fork head is at this state | SDK 2, `>=1.5.0` | `target_temperature`, `measure_temperature`, `temperature_state`, **`meter_power`** (plain), `measure_power`, `meter_gas` (6) | T: `meter_gas_changed`, `meter_power_changed`, `temperature_state_changed`; C: `temperature_state_is`; A: `set_temperature_state`, `enable_program`, `disable_program`, `update_status` |
| **1** "0.0.2 .. 1.0.0 (SDK 2)" | 2019-02-25 .. 2021-06-28 | `2b1848e`/`f38d65f` (0.0.2) .. `881a519` (1.0.0). Heads: `origin/Stable` (`380e999`), `master` (0.0.2), the `Stable` branch of 9 forks (`HansieNL/Stable` sits on 0.0.2), `HansieNL/Develop` (0.0.3) | SDK 2, `>=1.5.0`, from `881a519` `>=2.0.0` | era 0 minus `meter_power`, plus **`meter_power.peak`**, **`meter_power.offPeak`** (7) | era 0 + A: `update_powerusage`, `update_metertotals` (`2b1848e`). `energy.cumulative` added in `881a519` (2019-09-16); `mobile` block removed there |
| **2** "water" | 2021-06-29 .. 2023-03 | `f705a70` (PR #21, oepi-loepi). Heads: `Inversion-NL/Develop`, `oepi-loepi/Develop`, `quentinsch/Develop` (`426e2c2`) | SDK 2, `>=2.0.0`, still `1.0.0` | era 1 + **`measure_water`**, **`meter_water.today`**, **`meter_water.total`** (10) | era 1 + T: `measure_water_changed`; A: `update_water` |
| **3** "hot water, SDK 3" | 2023-03-18 (moezie fork `af2947f`, `d190fc4`, `44f9f2b`) / 2023-12-07 (`fe4e659`, PR #28) | HEAD `5cc3b90`; `origin/Develop`, `moezie/Develop` | SDK 3, `>=5.0.0`, still `1.0.0` | era 2 + **`alarm_water.hotwater`** (11) | era 2 + T: `alarm_water_changed`; C: `hotwater_dispensing`; `titleFormatted` on `temperature_state_is` and `set_temperature_state` |

Notes
* There is no usage data (the app is not on the App Store, issue #17 [I]; the audit checked the store URLs). Fork-head scan
  only shows where code sits, not who runs it. Branch `Stable` (era 1) exists in origin and in 9 forks. Assume
  **all four eras exist**, era 1 being the most likely majority on Homey Pro 2016-2019 and era 3 on Homey Pro Early 2023 (the
  SDK 3 bump was made to run there, commit message of `fe4e659` [G]).
* Era 0 is "paper only" (lasted 2.5 months, no fork head), but supporting it costs one `hasCapability` guard (section 5).
* No fork head carries any capability or card outside these four manifests (scan of 55 refs) [G]. The migration must still be
  **additive only and tolerate unknown extra capabilities** (a user may have sideloaded an unpublished build).
* Users who edited `device.js` to change `dev_2.x` to `dev_4.x` exist [I #9, #10]. Their `meter_gas`/`meter_power.*` values come
  from another meter node than the stock code reads (R-22).

Doc 01 names the legacy fixtures L2019 (= era 1), L2021 (= era 2) and L2023 (= era 3). Era 0 has no fixture there: add **L2018**. Fixture capability sets for tests: Appendix B.

---

## 3. What Homey persists per device vs. what it re-reads from the manifest

| Item | Persisted on the device? | Evidence | Consequence for the upgrade |
|---|---|---|---|
| Capability id list | **Yes**, fixed at pairing; pairing may override the manifest list | [D] breaking-changes.md "devices that have already been paired do not automatically receive the new capability"; pairing.md device object | `addCapability()` required for every capability a device lacks |
| Capability options (titles, min, max, step, enum values) | Per device (pairing can override; `setCapabilityOptions()` exists, "expensive") | [D] pairing.md, Device.html | **[U1]** whether a manifest change reaches paired devices; **[U2]** whether `addCapability()` copies the manifest options. Plan: after every add, call `setCapabilityOptions(id, manifestOptions)` explicitly |
| Capability values | Yes (stored by Homey). `getCapabilityValue()` returns `null` when unknown [D]. That they survive an app update is the normal behaviour but not stated: [U12] | [D] Device.html | Used as the "has this device ever received water data?" signal (section 7.4). If values did not survive, every device would fall into the probe row, which is still safe |
| Custom capability definition (`temperature_state`) | App level (manifest) | [D] capabilities.md "Custom capabilities" defined in the app manifest | Adding an enum value is additive. Removing one strands devices holding it. [U] picker refresh on update |
| `class` | Per device; `setClass()` exists and "any Flow that depends on this class will become broken" | [D] Device.html, breaking-changes.md | Keep `thermostat` |
| `energy` | Taken from the manifest and **applied directly to existing devices**, unless the app called `setEnergy()` | [D] energy.md | Any `energy` edit is an instant, global change (R-23). The app does not call `setEnergy` [C: grep] |
| Settings | Per device, key/value | [D] settings.md | Only `address` exists today [C: `getSetting` calls, `device.js:94-297`]. **[U3]** whether new keys get their default on paired devices |
| Store | Per device | [D] devices.md "Store" | **Empty today** [C: no `setStoreValue`/`getStoreValue` in `drivers/` or `app.js`; none in the `WebAPIDevice` path of `homey-wifidriver`] |
| `data` | Per device, immutable, identity = driver id + `data` | [D] devices.md "Device identifier" | `data.id` free text, see 4.1 |
| App settings (`homey.settings`) | App level | - | None used [C: grep] |
| Zone, name, icon, user-chosen Insights/indicator choices | User owned | - | Never touch |

---

## 4. The contract

### 4.1 Identity (change = every device orphaned)

| ID | Item | Value today | Evidence | Rule |
|---|---|---|---|---|
| C-ID-1 | App id | `nl.vinceste.open-toon` | `app.json:2` | Immutable. A different id is a different app: no device or Flow carries over |
| C-ID-2 | Driver id | `open-toon` (folder `drivers/open-toon`) | `app.json:84` | Immutable. Homey identifies a device by driver id + `data` [D] |
| C-ID-3 | `data` shape | `{ "id": "<free text typed by the user in the "Toon Hostname" field>" }`, placeholder `ENECO-001-12391` | `pair/start.html:37-39,107-108`; label key `pair.name` "Choose an unique name!" | New pairs keep `{id: string}`. **No code may read, parse or require a format of `data.id`** (nothing reads it today, grep `getData`). It is not necessarily a hostname. Do not add required fields to `data`: legacy devices lack them |
| C-ID-4 | Device `name` at pairing | literal `ToonDevice` | `pair/start.html:44` | Devices that were never renamed are literally called `ToonDevice`. Never rename an existing device. A better default for *new* pairs is allowed |
| C-ID-5 | Class | `thermostat` | `app.json:93` | Immutable (Flows that depend on class break [D]) |
| C-ID-6 | Pair view id | `start` | `app.json:147-151` | Not persisted. Free to change |

### 4.2 Settings and store

| ID | Key | Type / default / label | Rule |
|---|---|---|---|
| C-SET-1 | `address` (inside a `group`, `app.json:152-171`) | `text`, default `"0.0.0.0"`, en "IP Address" / nl "IP Adres"; no hint, no pattern | The only source of the Toon host, in every era. Stored values are what the user typed: bare IP/hostname, maybe with a port or stray spaces (the code builds `'http://' + address + path`, so a value with `http://` never worked). Normalise **on read**, never rewrite the stored value. Treat `0.0.0.0`/empty as "not configured" (unavailable with a message), not as a host |
| C-SET-2 | (new, agreed with doc 01 FR-59) `toonwater_enabled` | `checkbox` | Per device. Absent/`undefined` on a legacy device must mean "undecided", not `false` (rule 8) |
| C-SET-3 | (new, doc 01 FR-80/112) `poll_interval` | `number` | Read defensively: `Number(x) \|\| default` |
| C-STORE-1 | (new, doc 01 FR-111) `migrationVersion` (number) | - | Written at the end of a successful migration and by the new pairing. **Its absence is the only reliable "legacy device" signal.** `manifest.version` cannot be used |

### 4.3 Capabilities (the 11 ids + 1 legacy)

Source mapping and scaling are part of the contract because Insights history and Energy continuity depend on units and magnitude.

| Capability | Type / unit | Written from (code) | Era | ToonWater? | System Flow cards Homey generates [S][D] | Insights log (auto) [S] | Rule |
|---|---|---|---|---|---|---|---|
| `target_temperature` | number, degC | `currentSetpoint/100`, round 0.1 (`device.js:466-469`); settable, listener `:48`, rounded to 0.5 (`:65-68`). Options `step 0.5, min 6, max 30` (`app.json:111-115`) | 0-3 | no | trigger `target_temperature_changed`, action `target_temperature_set` | yes (stepLine) | Keep options |
| `measure_temperature` | number, degC | `currentTemp/100`, round 0.1 (`:462-465`) | 0-3 | no | trigger `measure_temperature_changed` | yes | - |
| `temperature_state` | custom enum `comfort\|home\|sleep\|away\|none` (`app.json:34-81`), getable+setable | `activeState`: 0 comfort, 1 home, 2 sleep, 3 away, -1 none (`device.js:7-13,470-474`); listener `:47` | 0-3 | no | none generated; Homey auto-runs `temperature_state_changed` [D][U8] | no `insights` flag | **Never write a value outside the enum** (HEAD writes `undefined` for `activeState` 4 = vacation, `:472`). New values (e.g. `vacation`) are additive; none may be removed |
| `meter_power` (plain) | number, kWh | **era 0 only.** `(dayUsage+dayLowUsage)/1000` (`:374-378`): a *daily* figure, not cumulative | 0 | no | trigger `meter_power_changed` | yes | Keep on devices that have it; write only if `hasCapability('meter_power')`; never add, never remove |
| `meter_power.peak` | number, kWh (`Math.trunc(Wh/1000)`) | `dev_2.4.CurrentElectricityQuantity`; if that is `"NaN"` then `dev_2.2` (`:381-392`). Title en "Power meter peak (total)" / nl "Stroom meterstand piek" (`app.json:116-121`) | 1-3 | no | **none** (sub-capability) [D] | yes (base `meter_power` is `insights: true`; sub-capability inheritance [U]) | Keep source semantics ("high tariff, or the single-tariff total"). Decimals may increase; magnitude and monotonicity must not change |
| `meter_power.offPeak` | number, kWh | `dev_2.6.CurrentElectricityQuantity` only when not `"NaN"` (`:395-402`). Title "Power meter off-peak (total)" / "Stroom meterstand dal" | 1-3 | no | none | yes | Same; left untouched (null) on single-tariff meters |
| `measure_power` | number, W | `powerUsage.value` (`:368-371`) | 0-3 | no | trigger `measure_power_changed` | yes | With `energy.cumulative` this is the whole-home power figure [D]; never write `0`/`NaN` because a fetch failed |
| `meter_gas` | number, m3 (`Math.trunc(L/1000)`) | `dev_2.1.CurrentGasQuantity` (`:332-335,442-445`) | 0-3 | no | trigger `meter_gas_changed` | yes | Homey Energy reads it as the home's gas meter (cumulative) [D]. Must be non-decreasing; never write `0`/`NaN` |
| `measure_water` | number, L/min | `water.flow` unscaled (`:415,423`) | 2-3 | **yes** | trigger `measure_water_changed` (system) | yes | See section 7 |
| `meter_water.today` | number, m3 | `water.value/1000` (`:416,421`) litres consumed today. Title "Water today" / "Water vandaag" (`app.json:128-133`) | 2-3 | **yes** | none (sub-capability) | yes | See section 7. Not cumulative (resets daily) |
| `meter_water.total` | number, m3 | `water.total/1000` (`:417,422`). Title "Water meter total" / "Water meter totaal" | 2-3 | **yes** | none | yes | See section 7. The add-on payload may lack `total` on old add-on versions (NaN rejected today, audit 00) |
| `alarm_water.hotwater` | boolean | `parseInt(burnerInfo) === 2` from the **thermostat** endpoint (`:475-478`). Title "Hot water dispensing" / "Warm water afgifte" (`app.json:140-145`) | 3 | **no** | none (sub-capability) | yes. Timeline titles are the *system* `insightsTitleTrue/False` "Water alarm turned on/off" because only `title` is overridden [S] | Keep id and semantics. Known quirk: `alarm_*` true flashes red on the tile [D capabilities.md "Sensor"] and Homey sees a "water alarm". Improving Timeline wording through `insightsTitleTrue/False` options is allowed but optional |

Rules that apply to the whole table
* **C-CAP-1** No capability id is renamed, repurposed or removed from the driver's `capabilities` array. (Removing from the manifest only
  is documented as non-breaking [D], but nothing is gained and the validator and the migration plan read this array as the superset.)
* **C-CAP-2** Do not add `preventInsights` or `preventTag` to any existing capability (unknown effect on existing logs and tags).
* **C-CAP-3** Do not add plain `meter_power` or plain `meter_water` to any driver or device: Homey Energy would start counting them [D] (R-24).
* **C-CAP-4** After `addCapability(id)` apply `driver.manifest.capabilitiesOptions[id]` with `setCapabilityOptions` (U2). Applying options is
  only needed for `meter_power.peak/offPeak`, `meter_water.today/total`, `alarm_water.hotwater` and `target_temperature`.
* **C-CAP-5** `registerCapabilityListener` for `temperature_state` and `target_temperature` stays (tile controls). Do not drop a
  listener for a capability that devices can still hold [D breaking-changes.md].
* **C-CAP-6** A parse/fetch failure leaves the capability value untouched (stays `null` or the last value). It never writes `0`, `NaN`,
  `undefined` or an out-of-enum string.

Insights logs implied (Homey creates them automatically; none is created by app code, none is suppressed by options today):
`target_temperature`, `measure_temperature`, `measure_power`, `meter_gas`, `meter_power.peak`, `meter_power.offPeak` (eras 1-3);
`meter_power` (era 0); `measure_water`, `meter_water.today`, `meter_water.total` (eras 2-3); `alarm_water.hotwater` (era 3).
That is up to 10 logs per device. A log is bound to device + capability id, so **the capability id is the history's identity**.
Whether `removeCapability()` deletes or keeps a log is not documented [U5] (HW-08).

### 4.4 Class and energy

| ID | Item | Today | Rule |
|---|---|---|---|
| C-EN-1 | `energy` | `{"cumulative": true}` (`app.json:107-109`), since `881a519` (2019-09-16); applied to every existing device through the manifest [D] | **Unchanged unless doc 01 FR-90 passes its hardware gate (HW-11).** If FR-90 ships, these conditions hold: (1) `cumulative` stays `true`; (2) the new `cumulativeImportedCapability` points at a **new additive** capability (`meter_power.imported`), the existing `peak`/`offPeak` stay; (3) it is written only when both tariff counters are valid (no half sums), is non-decreasing, and its first value (`null` to N) must not be booked as consumption (U13, HW-11); (4) **never** map `meter_power.offPeak` as the exported capability (it is the second *import* tariff); (5) no `setEnergy()`; (6) the change is announced in the changelog because it takes effect on all upgraded devices at once [D]. If HW-11 fails, FR-90 is dropped, not patched |
| C-EN-2 | Effect of `cumulative` | The Toon is a whole-home meter; "all power-consuming devices are subtracted from the total ... the remainder is shown as other"; Homey reads `meter_gas` and `meter_water` | [D] energy.md. Whether Homey also picks the sub-capabilities `meter_water.today/total` as "meter_water" is unknown [U10] (HW-11) |

### 4.5 Flow cards (14). All 14 have exactly one `device` argument: `{name: "device", type: "device", filter: "driver_id=open-toon"}`

| Kind | Card id | Era | Further args (name:type, dropdown ids) | Tokens (name:type) | Run listener today (`driver.js`) | Fired today? | ToonWater? | Rule |
|---|---|---|---|---|---|---|---|---|
| trigger | `meter_gas_changed` | 0 | - | `meter_gas`:number (m3, ex 25) | none | **No** (nothing fires it) [C] | no | Keep id/arg/token. Doc 01 FR-71 deprecates it and FR-70 fires it: dormant Flows will start to run, changelog (R-11). Duplicates the system card `meter_gas_changed` [S] |
| trigger | `meter_power_changed` | 0 | - | `meter_power`:number, titled "Wh" (the unit is kWh) | none | No | no | Keep. Title fix "Wh" to "kWh" is title-only and safe (doc 01 FR-70 AC5 fires it with peak+off-peak as kWh). Era 1-3 devices have no base `meter_power`, so the system twin does not exist for them either |
| trigger | `measure_water_changed` | 2 | - | `measure_water`:number (l/min, ex 75) | none | No | **yes** | Keep; deprecated by doc 01 FR-71; fires only while ToonWater is on. The *system* card of the same id appears per device with `measure_water` [S] |
| trigger | `temperature_state_changed` | 0 | - | `temperature_state`:string | none | **Probably yes, by Homey** [D][U8] | no | Keep. **Conflict:** doc 01 FR-70 AC1 fires it from app code, which would double-fire if Homey auto-runs it. Do not call `trigger()` for it until HW-06 has run (R-12) |
| trigger | `alarm_water_changed` | 3 | - | **`alarm_water.hotwater`**:boolean (token name contains a dot) | none | No | **no** | Keep id and the exact token name/type. Firing it is the intended behaviour (issue #26 [I]) but is a change: dormant Flows start to run (R-13) |
| condition | `temperature_state_is` | 0 | `state`:dropdown `comfort\|home\|sleep\|away\|none` | - | `getCapabilityValue('temperature_state') === args.state` (`:31`) | - | no | Value ids immutable (`none` included). Compare defensively: accept a string or `{id}` [U7] |
| condition | `hotwater_dispensing` | 3 | - | - | returns `alarm_water.hotwater` (`:34`) | - | **no** | Keep. The listener returns the plain boolean; the `!{{wel\|niet}}` form is the negation Homey applies |
| action | `set_temperature_state` | 0 | `state`:dropdown `comfort\|home\|sleep\|away`; `resume_program`:dropdown `yes\|no` | - | `onCapabilityTemperatureState(args.state, args.resume_program)` (`:37`) | - | no | Keep both args and all value ids. Since `fe4e659`/`44f9f2b` `titleFormatted` omits `[[resume_program]]`, so **Flows created since 2023 have `resume_program` unset** [U]: treat `undefined` as `yes`. The arg is ignored by the device today (URL always `state=2`, `device.js:209`) so changing its meaning is a behaviour change (HW) |
| action | `enable_program` | 0 | - | - | `enableProgram()` (`:40`), URL `state=1` | - | no | Rejects on HTTP failure today (`device.js:276-281`) |
| action | `disable_program` | 0 | - | - | `disableProgram()` (`:43`), URL `state=0` | - | no | Same |
| action | `update_status` | 0 | - | - | `getStatusUpdate()` = thermostat endpoint only (`:46`) | - | no | **Always resolves today** (errors swallowed, `device.js:99-103`). Doc 01 FR-74 AC2 turns an unreachable Toon into a rejection (R-09); FR-75 keeps this card visible as "Update now". A failure of a part the Flow did not ask for (water 404) must not reject it |
| action | `update_powerusage` | 1 | - | - | `getStatusUpdatePowerUsage()` = `GetCurrentUsage` (`:49`) | - | no | Always resolves today |
| action | `update_metertotals` | 1 | - | - | `getStatusUpdateTotals()` = `getDevices.json` (`:59`) | - | no | Always resolves today |
| action | `update_water` | 2 | - | - | `getWater()` = `/water.html` (`:56`) | - | **yes** | Always resolves today, also on the 404 of a Toon without add-on (logs only). Doc 01 FR-74/54 AC2: deprecate (FR-75); reject with a localized message when ToonWater is off. Accepted only because that state is reachable solely by a deliberate user toggle; migrated devices with water are `enabled` (D-2). Must never fail with a `TypeError` or an English-only text |

Titles, dropdown labels and token titles (en / nl) are in Appendix C. They are **not** contract and may be corrected.

System-generated cards and tags that user Flows on a Toon device may already contain (these live outside the manifest; they exist
because the capability exists on the device) [S][D]:
`target_temperature_changed`, `target_temperature_set`, `measure_temperature_changed`, `measure_power_changed`, `meter_gas_changed`,
`measure_water_changed` (only with ToonWater data), era 0 only `meter_power_changed`; plus one Flow tag per capability
(`preventTag` is unused, so every capability has tags). Sub-capabilities get no cards [D]. The thermostat class defines no cards [S].

### 4.6 Behaviour contract (what the run listeners and capability writes must keep doing)

| ID | Behaviour | Why it is part of the contract |
|---|---|---|
| B-1 | The four `update_*` cards resolve after a **fresh** fetch of *their* endpoint (or after the in-flight one, when the poller is already fetching it). Baseline: they also resolve when the Toon is unreachable. **Doc 01 FR-74 AC2 changes that to a localized rejection**: a deliberate behaviour change, see R-09 | Existing timer Flows chain them (issues #5, #25). A rejection stops the Flow at that card, so cards behind it never run. Accept only with a changelog line |
| B-2 | `update_status` refreshes at least the thermostat endpoint (doc 01 FR-75 widens it to every enabled endpoint: a superset, acceptable); the other three refresh only their own part. A failing endpoint that was not part of the request never fails the card | A Flow that calls one card must not suddenly fail or rewrite more than before |
| B-3 | A timer Flow at 60 s plus the new native poller must not double the load on the Toon. Coalesce concurrent fetches per endpoint | The Toon is a small embedded device; the issues show users polling every minute |
| B-4 | `set_temperature_state` maps `comfort/home/sleep/away/none` to `0/1/2/3/-1` and sends `temperatureState=<id>` | `device.js:7-13,209` |
| B-5 | `target_temperature` writes round to 0.5 and are optimistic (value set before the HTTP call) | `device.js:67,243` |
| B-6 | `enable_program`/`disable_program`/`set_temperature_state`/setpoint writes **reject** on failure today | A failing write must keep failing visibly |
| B-7 | `temperature_state_is` compares the capability value with the card's dropdown id; `none` is a valid choice | `driver.js:31` |
| B-8 | Cumulative counters (`meter_gas`, `meter_power.*`) are never decreased or zeroed by a failed or partial payload (single-tariff `"NaN"`, missing nodes, `GetCurrentUsage` without `dev_2.x`) | Energy takes differences of these values [D]. HEAD already trips on this payload shape (audit 00) |
| B-9 | Unit and magnitude of every capability (table 4.3) is unchanged. Only decimals may increase (HEAD truncates gas and kWh to integers) | Insights continuity; an increase of precision is monotonic and safe |
| B-10 | No code path writes a capability the device does not have (HEAD raises `Invalid Capability` for `meter_power` and, on era 1, for the water trio) | Unhandled rejections crash apps on Homey Cloud and are "coming to Homey Pro in the near future" [D guides/homey-cloud.md, "Unhandled Promise rejections"] |

---

## 5. What the upgrade must do, per era

All steps run in `onInit` of each device, **without waiting for the network** (HEAD awaits four HTTP calls without timeout,
`device.js:51-54`). Each step is idempotent and re-checks state, because `addCapability()` is expensive and must be guarded [D].

| # | Step | Detail |
|---|---|---|
| M-1 | Read `store.migrationVersion` | **Absent = legacy device** (paired by any build before the redesign). Present = created or migrated by the redesign: skip M-2. A marker lower than the current schema (a later release) re-runs M-3..M-5 only |
| M-2 | Legacy only: decide ToonWater | Decision table in section 7.4 (looks only at which of the three water capabilities exist). Persist with `setSettings({toonwater_enabled})`, which does not call `onSettings` [D], so the migration must itself reconcile capabilities (M-3, M-4). The setting value found on the device is ignored here |
| M-3 | Compute the plan | `desired = ALWAYS ∪ (toonwater_enabled ? WATER : ∅)` with `ALWAYS = [target_temperature, measure_temperature, temperature_state, meter_power.peak, meter_power.offPeak, measure_power, meter_gas, alarm_water.hotwater]` and `WATER = [measure_water, meter_water.today, meter_water.total]`. **Not** "all of `driver.manifest.capabilities`" |
| M-4 | Add what is missing, in manifest order, each guarded by `hasCapability` | Then `setCapabilityOptions` from `driver.manifest.capabilitiesOptions` (U2). A late-added capability sits at the end of the tile: cosmetic, accepted |
| M-5 | Keep what is extra | `meter_power` (era 0) and any capability this version does not know. The migration never removes anything; removal happens only through the user's own toggle |
| M-6 | Write `store.migrationVersion` last | If anything above throws, log and continue, and do not write the marker, so the next start retries. A migration problem never makes the device unavailable |
| M-7 | Never call `addCapability`/`removeCapability` on every start | [D] |

What each era needs

| Era | Has | Must add (always) | Water trio | Also |
|---|---|---|---|---|
| 0 | 6 (with `meter_power`) | `meter_power.peak`, `meter_power.offPeak`, `alarm_water.hotwater` | absent, so ToonWater = off, nothing to do | keep `meter_power`, keep writing it only if present |
| 1 | 7 | `alarm_water.hotwater` (HEAD adds only this one: `device.js:33-38`) | absent, ToonWater = off. User may enable it later | - |
| 2 | 10 | `alarm_water.hotwater` | present, decision table 7.4 | - |
| 3 | 11 | none | present, decision table 7.4 | - |
| new pair | 8 (+3 if the user ticks ToonWater at pairing) | via the pairing `capabilities` override [D pairing.md] | per checkbox | `store.migrationVersion` set at pairing |

---

## 6. What Homey does with renamed, deprecated and removed items

| Change | Effect on already-paired devices / saved Flows | Evidence |
|---|---|---|
| Add a capability to the driver manifest | Nothing on paired devices until the app calls `addCapability()` | [D] breaking-changes.md |
| Remove a capability from the driver manifest only | "nothing will break ... UI components and Flow cards will remain working", not added to new pairs; keep its listener | [D] breaking-changes.md |
| `Device#removeCapability()` | "Any Flow that depends on this capability will become broken"; its Flow cards are removed | [D] Device.html, breaking-changes.md |
| Rename a capability id | = remove + add: Flows break, Insights history is not carried over | derived from the two rows above [U5 for history] |
| Remove or restructure a Flow card | Listed as a breaking change. How a broken Flow is shown/disabled is not documented | [D] breaking-changes.md [U4] |
| Add or remove an argument of an existing card | Docs say: deprecate it and create a new card | [D] breaking-changes.md "Deprecating Flow cards" |
| `"deprecated": true` on a card | Still works, hidden from the "Add Card" list; "do not remove or change the Flow card run listener" | [D] flow.md, breaking-changes.md. Schema: `deprecated` is boolean `true` only [S] |
| Change the device class | "Any Flow that depends on this class will become broken" | [D] Device.html |
| Deprecate the driver | Paired devices keep working, no new pairs | [D] breaking-changes.md |
| Change driver id or `data` | Device identity lost; `data` cannot change after pairing | [D] devices.md |
| Edit `energy` in the manifest | Applied immediately to existing devices (unless `setEnergy()` was used) | [D] energy.md |
| Sub-capabilities | No Flow cards are generated automatically | [D] capabilities.md |
| Custom capability value changes | Homey auto-runs triggers `<id>_changed` (number/enum/string) or `<id>_true/_false` (boolean), also for sub-capabilities | [D] flow.md "Custom capability changed" |
| `capabilities=` in a card `$filter` | "calls to `addCapability` and `removeCapability` don't update this filter" | [D] flow.md "Flow Card Device filters". The same filter inside a `device` **argument** is documented with an example (arguments.md) but without a statement about dynamic changes: [U6] |
| Device unavailable | "all capabilities and Flow actions will be prevented" | [D] devices.md "Availability" |
| `setSettings()` | Does not call `onSettings` | [D] Device.html |
| `onSettings` throws | The error is shown and the new settings are not stored | [D] settings.md |
| Edit card/capability titles, hints, `titleFormatted`, dropdown labels, token titles | Not documented as breaking; Flows reference ids | Assumed, [U] (zero risk expected) |
| Change a dropdown value id, token name or token type | Stored selections/references no longer match. Not documented in detail | Treat as breaking [U] |
| Raise `compatibility` | Homeys below the floor cannot take the new version and stay on the old one | [D] manifest.md + Node table (app.md) |
| Re-use the same version number | "Homey will never downgrade apps"; a higher version is needed to be delivered | [D] app-store/updates.md. For sideload: [U9] |
| `homey app run` | "Quitting (Ctrl+C) uninstalls the app from Homey" | [D] homey-cli.md |
| `homey app install --clean` / `run --clean` | "Delete all userdata, paired devices, and settings" | [D] homey-cli.md |

---

## 7. ToonWater as an opt-in: the specific compatibility effects

### 7.1 What is and is not ToonWater

| Part | Depends on the add-on? | Evidence |
|---|---|---|
| `/water.html` fetch, `measure_water`, `meter_water.today`, `meter_water.total` | **Yes** | `device.js:173-190,410-424` |
| `update_water`, trigger `measure_water_changed` | **Yes** (both only concern the above) | `driver.js:55-56`, `app.json:227-250,513-525` |
| `alarm_water.hotwater`, `hotwater_dispensing`, `alarm_water_changed` | **No.** Source is `burnerInfo === 2` of the thermostat endpoint | `device.js:475-478`, `driver.js:33-34` |

The word "water" in the unconditional hot water items is a trap for implementers. The opt-in must not touch them.

### 7.2 Capability set by mode

| Mode | Device capabilities |
|---|---|
| ToonWater off | the 8 `ALWAYS` capabilities (+ legacy extras) |
| ToonWater on | the 8 + `measure_water`, `meter_water.today`, `meter_water.total` |

`/water.html` is polled only in mode "on". In mode "off" there is no request, so there is no 404 noise [C: today a 404 is logged on every
update, `device.js:182-185`].

### 7.3 Flow cards by mode (hiding the water cards)

Facts: (a) manifest cards are static; (b) the `capabilities=` card filter ignores add/removeCapability [D]; (c) system cards follow
the device's current capabilities [D]; (d) sub-capabilities get no system cards [D].

| Option | Works for new devices | Works for upgraded devices | Verdict |
|---|---|---|---|
| A. Keep `update_water` and `measure_water_changed` and add `capabilities=measure_water` to their device filter | probably (pair-time list) | **No**: a legacy era-1 device that later enables ToonWater gets the capability via `addCapability`, which the filter ignores, so the cards would stay hidden for exactly the users who enabled the feature; a device that disables it would keep showing them | **Chosen in doc 01 D-5 and doc 02 W6.** Acceptable only under the conditions listed below the table |
| B. Keep the cards visible for every Toon, guard in the run listener | yes | yes | Violates the wish "no water cards in the Flow editor when off", but is the safest for Flows |
| C. **Deprecate** `update_water` and the app's `measure_water_changed` (hidden for new Flows, old Flows keep running), rely on the capability-generated **system** card `measure_water_changed` for "when water flow changes" (appears and disappears with the capability), and add one generic non-water refresh card if a "refresh now" card is wanted | yes | yes | **Fallback** if HW-09 shows the filter is static. Meets the wish through Homey's own mechanism. Cost: `update_water` stops being offered for *new* Flows; ToonWater data are refreshed by the poller and by the generic card |

Conditions for keeping option A (doc 01 D-5):
1. The filter must apply **only to the ToonWater cards** (`update_water`, `measure_water_changed`). Doc 02 W6 lists `hotwater_dispensing` and
   `alarm_water_changed` among the "water" cards; they are **not** ToonWater (7.1, doc 01 FR-31 AC2) and must never be filtered, rejected or hidden.
2. Whatever the editor shows, the run listener of every water card must be safe on any Toon device: no `TypeError`, a localized message
   (doc 01 FR-54 AC2 rejects `update_water` when water is off; accepted because the state is only reachable by a deliberate user
   action, see D-2/D-3 in 01 and CD-2 here).
3. HW-09 must record what the editor does after `addCapability` (device that enabled water later: are the cards offered?) and after
   `removeCapability` (device that disabled it: are they still offered?). The filter text is `driver_id=open-toon&capabilities=meter_water.total`.
   If the editor follows the pair-time list, a legacy era-1 device that enables ToonWater later will **not** get the cards: that is the
   failure to look for. Then switch to option C.

Under C the following must still hold (all from rule 6): the `update_water` and app `measure_water_changed` cards stay in the
manifest with `deprecated: true`; the `update_water` run listener stays registered and is safe on any device.

### 7.4 Upgrade decision for a legacy device (store marker absent)

Aligned with doc 01 (D-2, D-3, FR-56). Never use the setting default. The only inputs are the device's own **ToonWater capabilities**
(`measure_water`, `meter_water.today`, `meter_water.total`). `alarm_water.hotwater` must **not** be part of this test (doc 02 W5 lists it
among the detection capabilities; it exists on every era-3 device and on every new device with ToonWater off). No network is needed.

| Device state at first start after upgrade | Decision | Water capabilities | Data / Flows |
|---|---|---|---|
| None of the three water capabilities (eras 0, 1) | `toonwater_enabled = false` | none added | nothing lost, nothing changes, zero `/water.html` requests |
| All three present (eras 2, 3), with values **or all `null`** | `toonwater_enabled = true` (preserve) | kept, no removal | values, Insights history, system cards, tags and Flows all survive. A device with no add-on gets the 404 handling of doc 01 FR-55/57 (warning, back-off), not a removal |
| Only some of the three present (a half-migrated or hand-edited device) | `toonwater_enabled = true` | the missing ones are added (doc 01 FR-56 AC2) | additive only |

Rejected alternative (my first draft): "all values `null` + one probe of `/water.html` + HTTP 404 => `false` and remove the trio".
It would clean up the empty tiles of persona P1 (no add-on) automatically, but it is the only place where the upgrade itself would
remove capabilities, which can break a Flow that references them (pre-built cards) and may delete Insights history [U5]. Doc 01 D-3
forbids automatic removal. Cost of the chosen policy: P1 users keep their empty water tiles until they untick the setting. That is
the safest reading of "existing users must not lose water data or Flows they already have".

### 7.5 What toggling does (user action in device settings)

| Direction | Capabilities | Insights / tags / system cards | Flows | Notes |
|---|---|---|---|---|
| **Off -> On** | `addCapability` x3, then options (titles) | New logs start; new tags; the system trigger `measure_water_changed` appears | Nothing breaks. Whether Flows that were broken by an earlier "off" recover is unknown [U4] | Allowed even when the add-on is not found (doc 01 D-4): save, add the capabilities, show a warning/status. Do **not** throw from `onSettings` for a 404: the add-on writes its page only when values change, so a fresh add-on may legitimately 404 for a while (doc 01, inference). First values arrive with the next poll |
| **On -> Off** | `removeCapability` x3 | Tags and the system trigger `measure_water_changed` disappear; **Insights history of the three logs may be deleted** [U5] | "Any Flow that depends on this capability will become broken" [D] | Return a message from `onSettings` (documented: it is displayed) that says exactly this. Water source data are not lost: `today` and `total` live in the add-on and come back on re-enable; only the Homey-side history is at risk |
| **Transient failure while On** (Toon rebooting, add-on stopped, 404) | **No change**, never auto-remove | keep last values | none | Use `setWarning()` [D] for "ToonWater not reachable", clear it on the next success. Back off the water request; do not make the whole device unavailable (the thermostat still works) and do not spam logs |

### 7.6 Pairing

* New devices get `store.migrationVersion` and either 8 or 11 capabilities through the pairing `capabilities` override [D pairing.md].
* Pairing must keep creating `data: {id}` and `settings: {address}`; add `settings.toonwater_enabled` and `capabilities`.
* The pair view's test step should probe `/water.html` only when the box is ticked, and show "found / not found" without blocking the pair.

### 7.7 Other implicit consumers of the water capabilities

* Homey Energy: `energy.cumulative` + `meter_water` [D]. Do not add a plain `meter_water` (C-CAP-3). Whether `meter_water.today` is
  mistaken for the home's water meter is unknown [U10] (HW-11). If it is, the toggle changes the user's Energy water tab.
* Flow tags, widgets/dashboards showing a water capability, and Insights dashboards of the user: all vanish on "off" (R-04).

---

## 8. Change -> risk -> mitigation

Severity: **H** user data/Flows lost or silently wrong, **M** visible regression, **L** cosmetic. "Test" refers to section 10.

| ID | Change | Risk | Sev | Mitigation | Test |
|---|---|---|---|---|---|
| R-01 | Water capabilities become conditional, implemented as "add all manifest capabilities" | Every device gets water tiles (breaks the opt-in), or legacy devices are pruned | H | Explicit plan `ALWAYS ∪ WATER?` (M-3); never prune unknown capabilities | CT-02, CT-03 |
| R-02 | Legacy device with water data is switched off by the upgrade | Loses tile values, system trigger, tags, possibly Insights history; breaks Flows | H | Decision table 7.4: any water capability present => preserve and `toonwater_enabled = true`. No removal | CT-03, HW-08 |
| R-03 | (Rejected alternative) the upgrade removes the water trio from a device with no data and a 404 | Pre-built Flows on those capabilities show as broken | M | Not done: doc 01 D-3 and section 7.4 preserve instead. Cost: persona P1 keeps empty tiles until it unticks | CT-03 |
| R-04 | User turns ToonWater off | Flows using water system cards/tags break; Homey-side Insights history of 3 logs may be deleted | M | Warning text in the setting `hint` and in the `onSettings` return message; never auto-off | HW-08 |
| R-05 | Setting default `false` is injected into legacy devices (U3) and is mistaken for a user choice | Silent loss of water for everyone upgraded | H | Gate on absent `store.migrationVersion`, ignore the setting value during the one-time decision (M-1, M-2) | CT-03, HW-04 |
| R-06 | Water app cards hidden through the `capabilities=` filter | Static filter: cards hidden for devices that enabled water, shown for devices that disabled it | M | Option C (7.3): deprecate app water cards, rely on system cards; only revisit if HW-09 proves the argument filter dynamic | HW-09 |
| R-07 | `update_water` removed or its listener not registered | Existing timer Flows error every cycle; chained Flows stop | H | Keep card (deprecated), keep listener | CT-04 |
| R-08 | `update_water` rejects when ToonWater is off (doc 01 FR-54 AC2) | A legacy Flow that chained it stops at this card | M | Reachable only after a deliberate user toggle (migrated devices are `enabled`); localized message names the setting; changelog. A 404 while enabled never rejects (warning + back-off). Fallback: resolve as a no-op (CD-2) | CT-04 |
| R-09 | `update_*` start rejecting when the Toon is unreachable (doc 01 FR-73/74 AC2) | Behaviour change: a Flow that chained several updates now stops at the first failure | M | Decided in doc 01; compat requires the changelog line and that only the *requested* part can fail the card (B-2). Alternative: keep resolving (CD-2) | CT-04 |
| R-10 | Native polling marks the device unavailable after N failures | Homey then blocks Flow **actions** [D], so timer Flows' update cards and `set_temperature_state` fail while the Toon is down | M | Threshold (>= 3 failed cycles), keep polling while unavailable, recover in the poller (not through an action card) | CT-06 |
| R-11 | App fires `meter_gas_changed`, `meter_power_changed`, `measure_water_changed` for the first time (doc 01 FR-70) | Dormant user Flows start to run; a user with a system-card Flow and an app-card Flow gets both | L-M | Accepted: the card titles promise exactly this. Changelog entry; fire only on real change, not on the first value (FR-70 AC4); deprecate the two duplicates (FR-71) | CT-05 |
| R-12 | App fires `temperature_state_changed` manually (doc 01 FR-70 AC1 requires it) | Double-firing if Homey already auto-runs it for custom capabilities [D][U8] (doc 02 raises the same as its HW-2) | M | HW-06 first. Default until proven otherwise: only call `setCapabilityValue` and let Homey fire it; amend FR-70 AC1 for this one card | HW-06 |
| R-13 | App starts firing `alarm_water_changed` | Flows created since 2023 that never ran now run (intended; issue #26) | L | Changelog entry; fire only on real value change, not on first read | CT-05 |
| R-14 | Cards removed instead of deprecated | Flows break [D] | H | Contract check (Appendix A) in CI; deprecate only | CT-01 |
| R-15 | Args added to / removed from existing cards | Docs: construction changes require deprecate-and-replace | M | No arg changes. A new optional arg needs `required: false` and `undefined` handling, otherwise a new card | CT-01, CT-04 |
| R-16 | Token renamed or retyped (for example `alarm_water.hotwater`) | Downstream tag references break | H | Names and types frozen; titles/examples editable ("Wh" -> "kWh" is title-only) | CT-01 |
| R-17 | Dropdown value ids changed, or `label` replaced by `title` | Stored selections stop matching; labels possibly blank | H | Ids frozen. Emit **both** `title` and `label` per value (schema allows extra keys [S]) until HW-10 shows which one Homey renders | CT-01, HW-10 |
| R-18 | `[[resume_program]]` added to `titleFormatted` (required to validate) | The arg becomes visible again; Flows made since 2023 have it unset | M | Treat `undefined` as `yes`; keep ignoring/forwarding exactly as today until hardware settles semantics | CT-04 |
| R-19 | New enum value `vacation` | None for stored Flows (additive). HEAD writes `undefined` for it today | L | Add value; never write outside the enum; `temperature_state_is` may gain the value id | CT-05 |
| R-20 | Precision of gas/kWh raised from integers to 3 decimals | Insights graph steps once; Energy gets finer data | L | Allowed (B-9); never lower the value | CT-05 |
| R-21 | Failed or partial payload writes `0`/`NaN` to a cumulative counter | Energy "data loss or invalid interpretations" [D] | H | C-CAP-6, B-8; parsers return only finite values | CT-05 |
| R-22 | Meter nodes found by `type` instead of `dev_2.x` | Users who patched `dev_4.x` [I #9, #10] see their meter flip to another node or to null | M | Legacy mapping stays first; discovery only fills gaps; real `getDevices.json` dumps needed | HW-13 |
| R-23 | `energy` block edited: doc 01 FR-90 adds `cumulativeImportedCapability` | Applies instantly to all existing devices [D]; the Toon starts to deliver whole-home kWh to Homey Energy, possibly double counting against another cumulative device the user has; the first value (`null` to N) could be booked as consumption; `offPeak` must never be mapped as export | H | Conditions in C-EN-1; HW-11 is a release gate; changelog; drop FR-90 if HW-11 fails | CT-01, HW-11 |
| R-24 | Plain `meter_power`/`meter_water` added to the driver | Homey Energy starts using them [D] | M | Forbidden (C-CAP-3) | CT-01 |
| R-25 | `meter_power` write removed unconditionally | Era 0 devices freeze their `meter_power` | L | Guard with `hasCapability('meter_power')` | CT-02 |
| R-26 | `compatibility` raised to `>=12.9.0`, code uses `fetch`/`AbortSignal.timeout` | Homeys on older firmware cannot install the upgrade and stay on the old build. Homey Pro 2016-2019 below 12.9.0 runs Node 12/16 (no stable `fetch`), Early 2023 and mini run Node 18 [D app.md] | M | Decide deliberately (ADR) and say so in the changelog; or use the `http` module and keep `>=5.0.0` | - |
| R-27 | Removing `homey-wifidriver`, `request-promise-native`, `homey-log` | Persisted state in the library? None in the `WebAPIDevice` path | L | Verified by grep (section 1) | CT-02 |
| R-28 | Pairing rewrite changes the shape of `data` or `settings.address` | New devices incompatible with the migration and with Flows that expect nothing but the id | M | Keep `{id}` and `address`; add `store.migrationVersion` | CT-02 |
| R-29 | New settings (`poll_interval`, `toonwater_enabled`) read as `undefined` on legacy devices (U3) | `NaN` timers; wrong water decision | M | `Number(x) \|\| default`; ToonWater via marker (R-05) | CT-03 |
| R-30 | `address` normalised and written back | A value that worked is corrupted | M | Normalise on read only | CT-02 |
| R-31 | Install by `homey app run` or with `--clean`, or an old version number | Run: Ctrl+C uninstalls the app (devices removed). `--clean`: devices and settings deleted. Lower/same version: not delivered [D] | H | Release notes: `homey app install`, no `--clean`; version `>= 2.0.0`; snapshot Flows/devices first (HW-01) | HW-01, HW-02 |
| R-32 | `onInit` waits for the network (HEAD does) or the migration needs the Toon | App start hangs on an unreachable Toon, migration never runs | M | Migration is offline-first: M-1..M-6 never touch the network | CT-07 |
| R-33 | Flow cards move into `driver.flow.compose.json` by Homey Compose | None expected: ids and the device arg are re-added unchanged (audit 00 section 1, from CLI source, not re-verified here) | L | Run the Appendix A check on the **built** manifest (`.homeybuild/app.json`) | CT-01 |
| R-34 | Late-added capabilities appear at the end of the tile | Cosmetic reorder on upgraded devices | L | Accept | - |
| R-35 | Timeline wording of `alarm_water.hotwater` ("Water alarm turned on") changed through `insightsTitleTrue/False` options | Only text of future entries | L | Optional improvement, apply once via `setCapabilityOptions` | HW-03 |
| R-36 | Hot water items treated as ToonWater (doc 02 W5 uses `alarm_water.hotwater` as a detection capability; W6 lists `hotwater_dispensing` and `alarm_water_changed` as water cards to filter/guard) | Hot water stops working or is rejected on every device without ToonWater, contradicting doc 01 FR-31 AC2; era-3 detection becomes meaningless | H | Detection and filters use only `measure_water`, `meter_water.today`, `meter_water.total`, `update_water`, `measure_water_changed` (7.1). Test: ToonWater off => `hotwater_dispensing`, `alarm_water_changed`, `alarm_water.hotwater` all work | CT-03, CT-04 |
| R-37 | `update_status` widened to refresh every enabled endpoint (doc 01 FR-75) | A Flow that only wanted the thermostat now also waits for / fails on power, meters, water | L-M | B-2: only the requested part can fail the card; per-endpoint timeout 5 s so the Flow is not held long | CT-04, CT-08 |
| R-38 | A new capability (`meter_power.imported`, burner state, export counter) is added to all legacy devices by the migration | New Insights logs and tags start at upgrade; nothing existing changes | L | Additive only (M-4); options applied; listed in the changelog | CT-02 |

---

## 9. Compatibility floor, distribution, version

* `compatibility`: eras 0-2 are SDK 2 (`>=1.5.0` / `>=2.0.0`); era 3 and HEAD say `>=5.0.0`. Every Node.js fact is in [D] app.md (table).
  Raising to `>=12.9.0` guarantees Node 22 on every platform and the stable `fetch`, but cuts off Homeys on older firmware (R-26).
* Install path today is sideload only (issue #17, store 404 per audit) [I]. Existing users upgrade with the CLI. The release note must say:
  `homey app install` (no `--clean`, not `homey app run`) on the Homey that holds the devices.
* Next version `>= 2.0.0` (anything of `1.0.0` exists in three different builds). Do not reuse `1.0.0`.
* App id is shared with every fork. A user may therefore have a fork build installed; the migration is additive and marker-gated for that reason.

---

## 10. Verification

### 10.1 Verifiable now against mocks (to be built by the test engineer inside the repo)

| ID | Test | Pass criterion |
|---|---|---|
| CT-01 | Manifest contract check (Appendix A, run on the source and on the built manifest) | exit 0 against baseline `git show 5cc3b90:app.json`: no id/arg/token/dropdown-value/setting/enum removed, `energy` equal, class equal, no card un-deprecated |
| CT-02 | Era-migration simulation with a strict fake `homey` device initialised with each fixture of Appendix B | After `onInit`: capability list equals the plan of section 5; unknown extras kept; `meter_power` kept on era 0; zero `Invalid Capability`; zero unhandled rejections; `store.migrationVersion` set; data/settings/class unchanged; no network call made before the marker is written |
| CT-03 | Table-driven ToonWater decision (section 7.4): eras {0,1,2,3} + partial water set x {values present, all `null`} x {setting absent, `false`, `true`} x {marker absent, present} | Exactly the outcomes of the table; the setting value is ignored while the marker is absent; no capability is ever removed by the migration; zero `/water.html` requests unless the result is `true`; a device migrated once and then switched off by the user stays off after restart |
| CT-04 | Run-listener contract: each of the 14 cards invoked with legacy arg shapes (`state` as string and as `{id}`, `resume_program` as `yes`, `no`, `undefined`, `true`), against a mock Toon that is up, down, and has no `/water.html` | With the Toon up every `update_*` resolves after fresh data; with the Toon down they reject with a localized message (doc 01 FR-74, R-09) and a failing part that was not requested never rejects the card (B-2); `update_water` on a device without water rejects with the "enable ToonWater" message, never a `TypeError`, and `hotwater_dispensing`/`alarm_water_changed` work with ToonWater off; writes reject on failure; the condition handles both arg shapes; deprecated cards still have listeners |
| CT-05 | Parser invariants with the fixtures from the Toon mock: `"NaN"` meters, missing `dev_2.x`, `GetCurrentUsage` payload, `activeState` `"4"`/`"-1"`/`4`, water without `total`, malformed JSON, `{"result":"error"}` | Cumulative caps never decrease or become 0/NaN; `temperature_state` always within the enum; unchanged values fire no triggers |
| CT-06 | Poller plus availability with fake timers | Unavailable only after >= 3 failed cycles; recovery by the poller itself. (Homey blocks Flow actions on unavailable devices [D]; a mock cannot assert that, see HW-12) |
| CT-07 | Migration with the Toon unreachable | `onInit` returns quickly; capabilities migrated; marker written; no network call was needed |
| CT-08 | Update card vs poller concurrency | One HTTP request per endpoint at a time; card resolves with fresh data |

### 10.2 Hardware only (owner has a Homey Pro and several Toons)

Safety first: the owner's real Homey holds real Flows. **HW-01 is mandatory before anything else.** Prefer fixture devices: pair extra
"Open Toon" devices (any free `data.id`, same Toon IP) instead of touching production devices.

| ID | Question | Method | Settles |
|---|---|---|---|
| HW-01 | Baseline snapshot | `homey api raw --path /api/manager/devices/device`, `/api/manager/flow/flow`, `/api/manager/flow/advancedflow`, `/api/manager/insights/log` (paths to be confirmed with `homey api schema`), saved as JSON before and after every step | all |
| HW-02 | Does `homey app install` over the installed old build keep devices, Flows, settings and capability values (also with the same version number)? | install new build, diff HW-01 snapshots | U9, U12, R-31 |
| HW-03 | After `addCapability()`, do titles/options from the manifest appear? Does a manifest `capabilitiesOptions` change reach paired devices? | era-3 fixture: add a throwaway title change, restart; add a capability to a fixture; pair one device with ToonWater ticked and one without, and check `target_temperature` (step 0.5, 6 to 30) and the meter titles (`createDevice` passes `capabilitiesOptions` for every capability the device holds; documented as "overwrites the defaults", merge or replace unverified) | U1, U2, C-CAP-4 |
| HW-04 | Are default values of NEW settings keys present on paired devices after an app update? | add a dummy setting with default, update, read device settings via API | U3, R-05, R-29 |
| HW-05 | Is the custom capability definition (enum) refreshed on existing devices (new `vacation` value in the tile picker)? | update app with extra enum value | R-19 |
| HW-06 | Does Homey auto-run the app's `temperature_state_changed` (device-argument trigger) on `setCapabilityValue`? Does a manual `trigger()` double-fire? | Flow with the trigger + log token; change the state from the Toon; then add manual trigger on a test build | U8, R-12 |
| HW-07 | Does a `deprecated` card (with `device` arg) still run in an existing Flow and vanish from the picker? Do its tokens stay usable? | deprecate `update_water`, run an old Flow | rule 6 |
| HW-08 | `removeCapability` effects: Flow using the system `measure_water_changed` card, tags, Insights log history; re-add and see what recovers | fixture with water data; remove, inspect Flow state and `/api/manager/insights/log`; re-add | U4, U5, R-02..R-04 |
| HW-09 | Is the `capabilities=` filter of a device **argument** dynamic after add/removeCapability? | card with `driver_id=open-toon&capabilities=meter_water.total` (the filter of doc 01 D-5); check a device paired with water, a device that enables it later through `addCapability`, a device that disables it, and a device that never had it; open the Flow editor each time | U6, R-06 |
| HW-10 | Type of `args.state` / `args.resume_program` in run listeners; do dropdown values with only `label`, only `title`, or both render? | log `typeof`/value from a test build; open the editor | U7, R-17 |
| HW-11 | Which value does Homey Energy take as "meter_water" with `cumulative: true` and sub-capabilities only? Is gas from `meter_gas` used? | Energy tab with and without water caps; with FR-90: add `meter_power.imported` and watch whether its first value is booked as consumption; compare with any other cumulative device | U10, U13, C-EN-2, R-23 |
| HW-12 | Unavailable device: which Flow cards are blocked, how a chained Flow ends | make the Toon unreachable under the new poller | R-10, R-09 |
| HW-13 | Real payloads: `getDevices.json` of each Toon (node ids), `/water.html` with and without the add-on (status code, body, `total` present?) | `curl` from a LAN machine, saved as fixtures (no secrets in them; check before committing) | U11, R-22 |
| HW-14 | Old-era behaviour: install the era-1 build (`git worktree add <dir> 380e999`, outside the main checkout) on a **spare** Homey or a clean state, pair a fixture, create test Flows, then install the new build | era 1 and 2 (`426e2c2`) and 3 (`5cc3b90`) | end-to-end per era; era 0 (`0ab076c`) optional |

### 10.3 Index of the unverified items

| ID | Not verified | Settled by |
|---|---|---|
| U1 | Manifest `capabilitiesOptions` changes reach already-paired devices | HW-03 |
| U2 | `addCapability()` applies the manifest options to the new capability | HW-03 |
| U3 | A default `value` of a NEW setting key is present on already-paired devices after an app update | HW-04 |
| U4 | How a Flow with a removed/unavailable card is shown, disabled and whether it recovers when the card returns | HW-08 |
| U5 | What `removeCapability()` does to the Insights logs and tags of that capability | HW-08 |
| U6 | The `capabilities=` filter inside a `device` **argument** follows add/removeCapability | HW-09 |
| U7 | Run-listener value of a dropdown argument (string or object); whether `label`-only values render | HW-10 |
| U8 | Homey auto-runs the app's `temperature_state_changed` (device-argument trigger) | HW-06 |
| U9 | `homey app install` over a sideloaded install of the same or a lower version keeps devices and Flows | HW-02 |
| U10 | Homey Energy treatment of the sub-capabilities `meter_water.today/total` under `cumulative` | HW-11 |
| U11 | Toon / ToonWater HTTP behaviour: 404 without the add-on, payload fields, meter node ids per Toon model | HW-13 |
| U12 | Capability values survive an app update | HW-02 |
| U13 | Homey Energy does not book the first value (`null` to N) of a newly added cumulative `meter_power.imported` as consumption, and does not double count against another cumulative device | HW-11 |

---

## 11. Open decisions for the architect (compat view; "CD" to avoid clashing with the D-1..D-6 of doc 01)

| ID | Decision | Options | Recommendation (compat view) |
|---|---|---|---|
| CD-1 | ToonWater Flow-card visibility | A filter + guard (doc 01 D-5), B guard only, C deprecate + system cards | A, **conditional on HW-09**; C as fallback; hot water cards excluded in every case (R-36) |
| CD-2 | `update_*` and `update_water` failure semantics | resolve (baseline) or reject (doc 01 FR-73/74/54) | reject is acceptable if the changelog says so and only the requested part can fail the card; resolve-as-no-op for `update_water` is the safer fallback |
| CD-3 | Legacy device with water capabilities and no data | preserve (doc 01 D-2/D-3) or probe-then-remove | preserve; the removal alternative is documented in 7.4 and rejected |
| CD-4 | Firing of the five trigger cards | doc 01 FR-70 fires all five | accept for four with a changelog; do not call `trigger()` for `temperature_state_changed` before HW-06 |
| CD-5 | `compatibility` floor and HTTP client | `>=12.9.0` + `fetch`, or `http` + lower floor | architect/ADR decision; state the consequence for firmware below 12.9.0 in the release note (R-26) |
| CD-6 | Dropdown value property | `title` only, `label` only, both | both until HW-10 (doc 02 raises the same question as its HW-6) |
| CD-7 | `resume_program` semantics | keep ignoring, or implement | needs hardware; until then accept `yes`, `no`, `undefined` |
| CD-8 | `energy` change (doc 01 FR-90) | ship behind HW-11 or defer | defer unless HW-11 passes; conditions in C-EN-1 |

---

## 12. Sources

Homey documentation (fetched 2026-11-12; Markdown by appending `.md`):
* https://apps.developer.homey.app/guides/how-to-breaking-changes.md (adding/removing capabilities, deprecating cards, class, driver)
* https://apps.developer.homey.app/the-basics/flow.md ("Custom capability changed", "Flow Card Device filters", "Deprecating cards")
* https://apps.developer.homey.app/the-basics/flow/arguments.md (dropdown, device argument)
* https://apps.developer.homey.app/the-basics/devices/capabilities.md (sub-capabilities, options, `preventInsights`/`preventTag`)
* https://apps.developer.homey.app/the-basics/devices/energy.md (manifest `energy` applied to existing devices, `cumulative`)
* https://apps.developer.homey.app/the-basics/devices/pairing.md, devices.md (device object, `data`, store, availability), settings.md
* https://apps.developer.homey.app/the-basics/app.md (Node.js per firmware), app/manifest.md, app-store/updates.md
* https://apps.developer.homey.app/the-basics/getting-started/homey-cli.md (`app run`, `app install`, `--clean`, `api raw`)
* https://apps.developer.homey.app/upgrade-guides/device-capabilities.md, upgrading-to-sdk-v3.md
* https://apps-sdk-v3.developer.homey.app/Device.html (`addCapability`, `removeCapability`, `setCapabilityOptions`, `setClass`, `setSettings`, `setWarning`, `getCapabilityValue`)
* https://github.com/athombv/node-homey-lib (`assets/app/schema.json`, `assets/capability/capabilities/*.json`, `assets/device/classes/thermostat.json`)

Repo: `app.json`, `drivers/open-toon/driver.js`, `device.js`, `pair/start.html`, `locales/*.json`, `package.json`; commits `d82f098`, `d4987b1`,
`2b1848e`, `f38d65f`, `881a519`, `f705a70`, `af2947f`, `d190fc4`, `44f9f2b`, `fe4e659`, `5cc3b90`; issues #5, #9, #10, #17, #25, #26 of
`StefanPostma/nl.vinceste.open-toon` (untrusted user text, used as usage evidence only). Earlier analysis: `docs/sdlc/00-architect-audit.md`.

Not checked and therefore marked [U]: all Homey runtime behaviour not stated in the documentation (U1-U13, table 10.3), the `homey-lib` validator
result of the current manifest, the Toon and ToonWater HTTP behaviour (404 without add-on, payload shapes), and the Compose migration
claims copied from the audit.

---

## Appendix A - Manifest contract check (executed; ready to become CT-01)

Plain Node (>= 18), no dependencies. Usage: `node contract-check.js <baseline app.json> <candidate app.json>`, with the baseline from
`git show 5cc3b90:app.json > baseline.json`. Passing the HEAD manifest as candidate prints `contract OK`. A mutated copy (card removed,
dropdown value removed, token renamed, capability dropped, setting key renamed, enum value removed, `energy` block changed) reported all 7
violations. A copy with `update_water` and `measure_water_changed` deprecated plus a new `vacation` value passes.

```js
'use strict';
const fs = require('fs');
const load = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const dd = (a) => (a.values || []).map((v) => v.id);
const cards = (m) => {
  const out = {};
  const add = (kind, c) => {
    out[`${kind}:${c.id}`] = {
      deprecated: !!c.deprecated,
      args: Object.fromEntries((c.args || []).map((a) => [a.name, { type: a.type, values: dd(a) }])),
      tokens: Object.fromEntries((c.tokens || []).map((t) => [t.name, t.type || 'string'])),
    };
  };
  const scan = (flow) => ['triggers', 'conditions', 'actions'].forEach((k) => (flow?.[k] || []).forEach((c) => add(k, c)));
  scan(m.flow);
  (m.drivers || []).forEach((d) => scan(d.flow));
  return out;
};
const contract = (m) => {
  const d = m.drivers.find((x) => x.id === 'open-toon');
  return { appId: m.id, caps: d.capabilities, class: d.class, energy: JSON.stringify(d.energy),
    settings: (d.settings || []).flatMap((s) => (s.children || [s]).map((c) => c.id)),
    appCaps: Object.fromEntries(Object.entries(m.capabilities || {}).map(([k, v]) => [k, (v.values || []).map((x) => x.id)])),
    cards: cards(m) };
};
const base = contract(load(process.argv[2]));
const cand = contract(load(process.argv[3]));
const problems = [];
if (base.appId !== cand.appId) problems.push(`app id ${base.appId} -> ${cand.appId}`);
if (base.class !== cand.class) problems.push(`driver class ${base.class} -> ${cand.class}`);
if (base.energy !== cand.energy) problems.push(`energy block changed: ${base.energy} -> ${cand.energy}`);
base.settings.forEach((s) => cand.settings.includes(s) || problems.push(`setting key removed: ${s}`));
Object.entries(base.appCaps).forEach(([k, vals]) => vals.forEach((v) =>
  (cand.appCaps[k] || []).includes(v) || problems.push(`custom capability ${k}: enum value removed: ${v}`)));
base.caps.forEach((c) => cand.caps.includes(c) || problems.push(`driver capability dropped from manifest: ${c}`));
Object.entries(base.cards).forEach(([key, b]) => {
  const c = cand.cards[key];
  if (!c) return problems.push(`flow card removed (keep it, deprecated): ${key}`);
  Object.entries(b.args).forEach(([n, a]) => {
    const ca = c.args[n];
    if (!ca) return problems.push(`${key}: argument removed: ${n}`);
    if (ca.type !== a.type) problems.push(`${key}: argument ${n} type ${a.type} -> ${ca.type}`);
    a.values.forEach((v) => ca.values.includes(v) || problems.push(`${key}: dropdown ${n} value removed: ${v}`));
  });
  Object.entries(b.tokens).forEach(([n, t]) => c.tokens[n] === t || problems.push(`${key}: token ${n} (${t}) removed or retyped`));
  if (b.deprecated && !c.deprecated) problems.push(`${key}: un-deprecated`);
});
console.log(problems.length ? problems.join('\n') : 'contract OK');
process.exit(problems.length ? 1 : 0);
```

## Appendix B - Era fixtures (capability lists and sample values for CT-02/CT-03)

```json
{
  "era0 (doc 01: add as L2018)": { "caps": ["target_temperature","measure_temperature","temperature_state","meter_power","measure_power","meter_gas"] },
  "era1 (= L2019)": { "caps": ["target_temperature","measure_temperature","temperature_state","meter_power.peak","meter_power.offPeak","measure_power","meter_gas"] },
  "era2 (= L2021)": { "caps": ["target_temperature","measure_temperature","temperature_state","meter_power.peak","meter_power.offPeak","measure_power","meter_gas","measure_water","meter_water.today","meter_water.total"] },
  "era3 (= L2023)": { "caps": ["target_temperature","measure_temperature","temperature_state","meter_power.peak","meter_power.offPeak","measure_power","meter_gas","measure_water","meter_water.today","meter_water.total","alarm_water.hotwater"] },
  "common": { "class": "thermostat", "data": { "id": "ENECO-001-12391" }, "settings": { "address": "192.168.1.50" }, "store": {} }
}
```

Value variants per fixture with water capabilities: (a) `measure_water: 0, meter_water.today: 0, meter_water.total: 12.345` (zero is a value, not null: preserve);
(b) all `null` (add-on never present); (c) only `meter_water.total` non-null. All three must yield `toonwater_enabled = true`, nothing added, nothing removed.
Other variants worth a case each: `address` `"0.0.0.0"`, `"192.168.1.50:80"`, `" 192.168.1.50 "`; `settings` with an unknown extra key; `capabilities` with an unknown extra id.

## Appendix C - Strings (en / nl). Not contract; for locale-lint and for keeping wording stable

Flow cards (`titleFormatted` where present)

| Kind | Id | Title | titleFormatted |
|---|---|---|---|
| trigger | `meter_gas_changed` | The gas meter changed / De gasmeter is veranderd | - |
| trigger | `meter_power_changed` | The power meter changed / De energiemeter is veranderd | - |
| trigger | `measure_water_changed` | The water flow changed / De waterflow is veranderd | - |
| trigger | `temperature_state_changed` | Temperature state changed / Temperatuurstand is veranderd | - |
| trigger | `alarm_water_changed` | The hot water dispensing is changed / De warm water afgifte is veranderd | - |
| condition | `temperature_state_is` | Temperature state !{{is\|isn't}} / Temperatuurstand !{{is\|is niet}} | Current temperature state !{{is\|isn't}} [[state]] / Huidige temperatuurstand !{{is\|\|is niet}} gelijk aan [[state]] (double pipe = typo, `app.json:314`) |
| condition | `hotwater_dispensing` | Hot water !{{is\|isn't}} dispensing / Warm water wordt !{{wel\|niet}} afgegeven | - |
| action | `set_temperature_state` | Set temperature state / Stel temperatuurstand in | Set temperature state to [[state]] / Zet de temperatuurstand op [[state]] (lacks `[[resume_program]]`) |
| action | `enable_program` | Enable program / Zet programma aan | - |
| action | `disable_program` | Disable program / Zet programma uit | - |
| action | `update_status` | Update status / Update waardes | - |
| action | `update_powerusage` | Update power usage / Update stroom gebruik | - |
| action | `update_water` | Update water / Update water | - |
| action | `update_metertotals` | Update meter totals / Update meterstanden | - |

Trigger token titles: `meter_gas` "m³"; `meter_power` "Wh"/"Wh"; `measure_water` "l/min"; `temperature_state` "state"/"stand" (example "Comfort");
`alarm_water.hotwater` "Hotwater dispensing"/"Warmwater afgifte" (example `true`).

Dropdown labels (en / nl). `state`: comfort = Comfort/Comfort; home = Home/Thuis; sleep = Sleep/Slapen; away = Away/Weg; none = No state/Geen stand
(condition only). `resume_program`: yes = Resume program afterwards/Hervat programma na wijziging; no = Disable program/Schakel programma uit.

Capabilities: `temperature_state` = "Temperature state"/"Temperatuurstand", values as above. Option titles: see table 4.3.
Setting `address` = "IP Address"/"IP Adres" in group "Local Toon Settings"/"Lokale Toon Instellingen". Driver "Open Toon®", app "Open-Toon®".
