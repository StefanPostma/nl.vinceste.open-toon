# 05a - Independent design review: compatibility and migration lens

| | |
|---|---|
| Role | Independent design reviewer (lens: compat / migration) |
| Date | 2026-11-12 |
| Reviewed | `docs/sdlc/05-architecture.md`, `docs/adr/0001..0016`, against `docs/sdlc/00..04` |
| Base | branch `redesign/sdk3`, commit `5cc3b90`. Code line numbers refer to that commit. |
| Verdict | **No blocker.** 3 major, 6 minor. The migration itself is sound (additive, marker-gated, offline, never removes). The problems are at the edges: the stability-contract test as specified fails on the design's own manifest, one Flow break is reachable without a user action (eras 0/1), and the one deliberate data-destroying path (disable) under-informs the user. |

**Trust statement.** Documents 00-05 and the ADRs are model-generated. Every claim below that a finding rests on was re-read in the repo: `app.json:94-106` (driver `capabilities` incl. the water trio), `:116-139` (`capabilitiesOptions` incl. water titles), `:513-525` (`update_water`, filter `driver_id=open-toon`), `device.js:33-38` (only `alarm_water.hotwater` migrated), `:99-103` and `:171-190` (`getStatusUpdate*`/`getWater` swallow every error, so the update cards always resolve), `:374-378` (plain `meter_power` written from `dayUsage+dayLowUsage`), `:410-424` (water parse), `:475-477` (`burnerInfo === 2`); `locales/{en,nl}.json:4` (`offline`). The 04 Appendix A script was read line by line. Nothing was verified on a Toon or a Homey; items that only hardware can settle are marked **[HW]**.

---

## 1. Era walk-through on paper

Method: for each era of `04 §2`, run the design's `onInit` (ADR-0010 M-1..M-7, 05 §9), then the first poll cycles (ADR-0005), then every baseline Flow card of `04 §4.5`, and finally the user toggles of `05 §6.5`. "Baseline" = the behaviour of `5cc3b90` on that device.

| Era | Device before | What the design does at first start | Water | Baseline Flows after upgrade | Result |
|---|---|---|---|---|---|
| 0 (0.0.1) | 6 caps incl. plain `meter_power`; settings `{address}`; store `{}` | M-2 `legacyIf` = false -> `setSettings({toonwater_enabled:false, export_enabled:false})`; M-4 adds `meter_power.peak`, `meter_power.offPeak`, `alarm_water.hotwater`, `burner_state` (+ options); M-5 keeps `meter_power`; M-6 marker | off, zero `/water.html` | All ids resolve. `update_*` now reject when the Toon is down (R-09, changelog). **`update_water` rejects although the user never toggled anything** (issue 2). Plain `meter_power` still written if `dayUsage` fields exist (issue 7) | OK except issues 2, 7 |
| 1 (L2019, likely majority) | 7 caps | M-2 false; M-4 adds `alarm_water.hotwater`, `burner_state` | off | as era 0 (issue 2 applies) | OK except issue 2 |
| 2 (L2021) | 10 caps incl. water trio, no hot water | M-2 `legacyIf` = true -> `toonwater_enabled:true`; M-4 adds `alarm_water.hotwater`, `burner_state`; water trio untouched | on; polling continues; without the add-on: 404 -> `setWarning` + status + 15 min back-off + FR-62 notification after 24 h | All resolve. `update_water` resolves (404 excepted). System `measure_water_changed`, tags, Insights logs survive | OK; new tile warning for P1 users (issue 5); water titles rely on an unverified Core behaviour (issue 4) |
| 3 (L2023 = HEAD) | 11 caps | M-2 true; M-4 adds `burner_state` only | as era 2 | as era 2 | as era 2 |
| New pair | - | `createDevice` with explicit `capabilities`, `settings`, `store.migrationVersion:1`; marker skips M-2; M-3..M-5 no-op | per checkbox (shown only when probe = detected, unticked) | n/a | OK; `capabilitiesOptions` for a ticked trio not passed (issue 4) |
| Migrated, user toggles off -> restart | marker present | M-2 skipped; `featureState` reads stored `false`; desired excludes water; nothing re-added | off | Flows on water caps broken by Homey (documented); user was told | OK (FR-56 AC5) |
| Migrated, half-failed toggle | marker present, 1 of 3 water caps | M-3/M-4 re-add the missing two if setting `true`; if setting `false` the stray cap is kept forever by M-5 | - | - | self-heals when `true`; leaves a stray cap when `false` (issue 9) |

Identity, class, `energy`, `data.id`, `address`, all 14 card ids, args, dropdown ids, token names and types: unchanged in every row (checked against 05 §3, §8, ADR-0004, ADR-0009, ADR-0016). The migration never calls `removeCapability` (ADR-0010 M-5, 05 §6.4) and never reads the manifest default of `toonwater_enabled` (R-05). Marker absence is the only legacy signal (C-STORE-1). The hot-water items are in `core.js` and never guarded (R-36). These are the load-bearing compat properties and they hold.

## 2. Can the ToonWater opt-in silently destroy data or Flows?

| Path | Removes anything? | User told? | Finding |
|---|---|---|---|
| Upgrade (M-1..M-7) | never | n/a | safe |
| 404 / unreachable / garbage while on | never (D-3) | warning + status | safe |
| Address change while on | never; re-probe | message | safe |
| User unticks | `removeCapability` x3 (the only removal in the app) | hint + save message mention **Flows** only | **Insights history (U5) is not mentioned** - issue 3 |
| Rapid tick/untick/tick | serialised; `hasCapability` re-read each step | - | safe |
| Delete device | `unsetWarning`, teardown | - | safe |
| Pairing override ignored by Homey (U) | nothing; M-3/M-4 add the trio at first init when the setting is `true` | - | self-healing |
| `update_water` on a device the migration set to **off** | no removal, but the card now **rejects** | changelog only | **reachable without any user action for eras 0/1** - issue 2 |

## 3. MUST acceptance criteria against the design

All 51 MUST requirements are mapped in 05 §15. I re-walked each `[M]` AC. Met on paper unless listed here:

| Requirement / AC | Status | Note |
|---|---|---|
| FR-76 AC1 ("every baseline capability id ... still exist[s]") and AC2 (exception list) | **not met as specified** | FR-51 AC1 removes three ids from `driver.capabilities`; 04 Appendix A line 598 fails on that; no ADR exception recorded. Issue 1 |
| FR-54 AC1 | amended by ADR-0007 | recorded in 05 §15; owner sign-off still pending (ADR-0001 "owner to confirm") |
| FR-54 AC2 | met, but see issue 2 | the AC presumes the off state is a user choice; for eras 0/1 it is the migration's choice |
| FR-52 AC5, FR-53 AC5, FR-70 AC1 | amended by ADR-0007 / ADR-0009 | recorded; HW-05/HW-06 |
| FR-55 AC4 (<= 97 water requests / 24 h) | met only if a missing add-on really answers 404 | T8 is M confidence; issue 8 |
| FR-56 AC6 (warning on migrated P1 devices) | met | but see issue 5 (owner decision) |
| FR-59 (texts) | met verbatim | issue 3 proposes one additional clause (ADR-amended) |
| NFR-14 AC1 (exceptions listed in the FR-76 file) | not met until issue 1 is fixed | - |
| Everything else (FR-01..03, 10..14, 20..22, 24, 28, 31, 50..53, 55..58, 60, 70, 72..74, 80..82, 84, 100, 110..113, 120, NFR-01..08, 11, 15) | met on paper | the design element and the test layer are named in 05 §15; the `[HW]` halves are listed in 05 §17 |

---

## 4. Findings

Severity: **blocker** = design cannot work / breaks users; **major** = likely defect or MUST unmet; **minor** = should fix, low impact.

### Issue 1 - major - The stability-contract check (CT-01 / FR-76) fails on the design's own manifest and the deviation is unrecorded

* **Where**: 05 §3 line 67 ("Water capabilities leave the driver's `capabilities` list (FR-51 AC1)"), §13 line 358 ("CT-01 contract check (04 Appendix A) ... on the committed `app.json` (FR-76)"), §15 line 426, deviations list line 462; 04 §4.3 C-CAP-1 and Appendix A line 598 (`base.caps.forEach((c) => cand.caps.includes(c) || problems.push('driver capability dropped from manifest: ...'))`); ADR-0006, ADR-0007 (silent on it).
* **Issue**: 04 C-CAP-1 says "No capability id is ... removed from the driver's `capabilities` array" and its executable check enforces that. FR-51 AC1 (MUST) requires the opposite for `measure_water`, `meter_water.today`, `meter_water.total`. The design follows FR-51 and adopts the Appendix A check unchanged, so CT-01 reports three violations on day one; FR-76 AC2's "ADR-referenced exception list" is never populated; the §15 deviations list omits it; NFR-14 AC1 is therefore not met. (Dropping an id from the manifest list is documented as non-breaking for paired devices - 04 §6 row 2 - so users are not affected; this is a spec/test defect, but it sits on the one test that guards the contract.) Side note: 05 §3 line 114 claims "R-33 checked on the built manifest by CT-01", yet Appendix A never compares the `device` argument's `filter` string.
* **Fix**: record the exception explicitly - either in ADR-0006 or a new ADR-0017: "the three water ids leave `driver.capabilities` (non-breaking per breaking-changes.md), stay in `capabilitiesOptions` and in `FEATURES[].capabilities`". Change CT-01 to compare baseline capability ids against `capabilities ∪ keys(capabilitiesOptions) ∪ FEATURES[*].capabilities`, and create `test/fixtures/contract-exceptions.json` listing the three ids with the ADR reference (FR-76 AC2). Add the `device` argument `filter` string to the CT-01 comparison (R-33). Add the item to the §15 deviations list. Reword 04 C-CAP-1 in the next revision of 04.

### Issue 2 - major - `update_water` rejection is reachable without any user action on era-0/1 devices (R-08's premise is false)

* **Where**: 05 §6.7 line 246 and §8 line 284 (`update_water` with ToonWater off rejects, `onDisabled: 'reject'`); ADR-0007 bullet 3; ADR-0006 item 1; 04 R-08 ("Reachable only after a deliberate user toggle (migrated devices are `enabled`)") and 7.3 condition 2; 01 FR-54 AC2.
* **Issue**: The baseline offers `update_water` to **every** `open-toon` device (filter `driver_id=open-toon`, `app.json:513-525`) and `getWater()` swallows every error (`device.js:171-190`): on an era-0/1 device the `Invalid Capability` thrown by `_processWaterData` lands in the `.catch`, whose `if (err.error)` even hides the log line. So under HEAD the card silently *resolved* on devices without water. Users of eras 0/1 who built the "timer Flow with all the update cards" workaround (#5, #25) may well have `update_water` chained in it. The migration sets those devices to **off** (M-2, no user action), after which that card rejects and the Flow stops at it - a Flow break caused by the upgrade alone, the class of change the contract (04 rule 5, R-07/R-09) only accepts behind a user action. 04 R-08 accepted the rejection because "migrated devices are `enabled`", which is true only for eras 2/3.
* **Fix**: one word in the feature object plus one store flag: M-2 writes `store.toonwaterDecidedBy = 'migration'` (cleared by any user toggle; also needed for issues 5 and 6). `update_water` with ToonWater off **resolves as a no-op** (no request, one debug line) when `toonwaterDecidedBy === 'migration'`, and rejects with the FR-59 text only after a user toggle (the case FR-54 AC2 actually describes). Record the amendment of FR-54 AC2 in ADR-0007; add a CT-04 case "era-1 fixture, `update_water` resolves, zero `/water.html` requests"; correct R-08's premise in the next revision of 04. (Alternative with less logic: CD-2 fallback `onDisabled: 'noop'` globally.)

### Issue 3 - major - Disabling may delete Insights history (U5) and the user is not told

* **Where**: 05 §6.3 (hint, save messages), §6.5 On->Off step 3, §6.7 last paragraph; ADR-0006 item 2 and consequence 2; ADR-0007 bullet 6; 01 FR-59 table (hint: "Flows that use them will stop working until you turn it back on"; disabled message: "Flows that used them need to be updated"); 04 §7.5 On->Off ("Insights history of the three logs may be deleted [U5]") and R-04 (mitigation "Warning text in the setting hint and in the onSettings return message").
* **Issue**: The only `removeCapability` in the app is the deliberate disable, and the design relies on informed consent (D-1). But the hint and the save message mention only Flows; the one irreversible loss - Homey-side Insights history of `measure_water`, `meter_water.today`, `meter_water.total`, possibly years of it on era-2 devices - is not mentioned anywhere the user sees it, although 04 R-04 lists exactly that as the mitigation. The hint also promises recovery ("until you turn it back on") that U4/HW-05 has not confirmed for broken Flows. This is the one path where the opt-in can destroy user data with the user uninformed.
* **Fix**: until HW-08 (04) settles U5, add one clause to the hint and to the "disabled" save message in en and nl, e.g. en "... Flows that use them will break and their Insights history may be lost; after turning it back on, check those Flows." / nl "... Flows die ze gebruiken gaan kapot en hun Insights-geschiedenis kan verloren gaan; controleer die Flows na het opnieuw inschakelen." Put the same sentence in the README "what happens to my Flows" section (FR-122). Record the FR-59 text amendment in ADR-0006 (FR-59 allows polishing only if "semantically equal", so this needs the ADR). If HW-08 shows history survives, drop the clause.

### Issue 4 - minor - Water titles on already-migrated era-2/3 devices and on ticked new pairs rest on an unverified Core behaviour

* **Where**: 05 §3 line 67 (titles stay in `capabilitiesOptions` "the superset"), §9 M-4 (options applied only to capabilities the migration **adds**), §7 `buildNewDevice()` (passes `capabilities`, `settings`, `store`, not `capabilitiesOptions`); ADR-0002 item 3; 02 W9 ("titles may be lost"), HS-34 ("Pairing data may override ... `capabilitiesOptions`"); 04 U1/U2, HW-03.
* **Issue**: For era-2/3 devices the trio is already present, so M-4 never calls `setCapabilityOptions` for them, and the ids are no longer in `driver.capabilities`. Whether Homey Core keeps applying `capabilitiesOptions[id]` to a device capability whose id is absent from the driver's `capabilities` list is not covered by U1 (manifest change reaching devices) or U2 (options after `addCapability`), and no HW item tests this exact case. If Core resolves options through the `capabilities` list, every upgraded era-2/3 device shows "Water meter" twice instead of "Water today"/"Water meter total" (`app.json:128-139`). The same gap exists for a new pair with the checkbox ticked: the trio comes via the pairing override, options are not passed.
* **Fix**: in M-4, marker-gated (once), also call `setCapabilityOptions(id, manifest.capabilitiesOptions[id])` for every capability the device **has** that has an options entry but is not in `driver.capabilities`. In `buildNewDevice()`, include `capabilitiesOptions` for the trio when ticked (documented pairing override, HS-34). Extend HW-03 (04) with "capability present on the device, id absent from `driver.capabilities`, title only in `capabilitiesOptions`".

### Issue 5 - minor - Every P1 era-2/3 tile gets a persistent warning because of the upgrade itself (owner decision)

* **Where**: 05 §6.3 Device warning, §6.6 ("on entering `not_found` ... set the warning"), ADR-0006 item 2 and consequence 1; 01 FR-56 AC6; 04 §7.4 ("Cost ... P1 users keep their empty water tiles").
* **Issue**: Every device paired since PR #21 carries the water trio, with or without the add-on (04 ADR-0006 context). After the upgrade the migration sets them to **on**, the first 404 sets `setWarning('ToonWater is enabled but was not found on this Toon')`, which Homey renders as a persistent banner/triangle on the device - new, update-caused noise for the probably large P1 group, in tension with the owner's "no 404 noise". FR-62 already informs the same users once via the timeline. The requirement (FR-56 AC6) asks for the warning, so this is a conscious choice, but 05 does not surface it as an owner decision.
* **Fix**: owner decision, recommended: for devices with `store.toonwaterDecidedBy === 'migration'` (issue 2) **and** all three water values `null`, show the status label and send the FR-62 notification, but do not `setWarning`; `setWarning` only after a user toggle or when any water value was ever non-null (the add-on existed, so a 404 is a real fault). Amend FR-56 AC6 in ADR-0006 if adopted; add the case to the L2 water-mode scenarios.

### Issue 6 - minor - FR-62 "enabled by migration" and "404 for 24 h" are not persisted, so the hint is not restart-safe

* **Where**: 05 §6.2 `hintAfter404Ms`, §6.6 FR-62 paragraph (`store.waterHintSent` only); ADR-0006 item 7; 01 FR-62 AC1 ("a store flag prevents repeats across restarts").
* **Issue**: The design stores only `waterHintSent`. Whether the device was enabled by migration or by the user, and when the 404 streak began, live in memory; an app or Homey restart inside the 24 h window (likely: the install itself restarts the app) loses both, so the hint fires late, never, or for the wrong device class.
* **Fix**: M-2 writes `store.toonwaterDecidedBy = 'migration'`; the water group writes `store.waterFirst404At` on entering `not_found` and deletes it on any success or toggle; FR-62 fires when `decidedBy === 'migration' && now - waterFirst404At >= 24 h && !waterHintSent`. Shares the flag with issues 2 and 5.

### Issue 7 - minor - Plain `meter_power` on era-0 is still written, with a daily value into a cumulative slot

* **Where**: 05 §9 era-0 row ("`meter_power` kept and written only if `hasCapability` and the payload has `dayUsage`+`dayLowUsage`"), §14 ("effectively frozen"); ADR-0014 bullet 3; baseline `device.js:374-378` (`(dayUsage+dayLowUsage)/1000`); 04 B-8, R-21, C-EN-2.
* **Issue**: The value is "today's" consumption, which resets at midnight, written to a cumulative capability on a driver with `energy: {cumulative: true}` (since `881a519`). If the fields ever appear (03 I6: probably not), the write violates B-8 (cumulative counters never decrease); and the design's own monotonic guard would then pin the value at the day's maximum - wrong either way. Preserving a probably-dead but harmful baseline path has no compat value: the capability (id, Insights log) is what users keep, not the write.
* **Fix**: never write plain `meter_power`; keep the capability (M-5) and state in ADR-0014 and the changelog that it is frozen on era-0 devices. Drop the `dayUsage` branch from `parsePower`.

### Issue 8 - minor - FR-55 AC4 (<= 97 water requests / 24 h) holds only if a missing add-on answers exactly 404

* **Where**: 05 §5 ("Water 404: 15 min ... Water timeout/garbage: 5 min"), §6.2 (`absentOn404` 15 min, `failBackoffMs` 5 min), §6.6; ADR-0005, ADR-0006 item 6; 03 T8 (404 for missing add-on files, **M** confidence), 01 FR-55 AC7 / HW-07.
* **Issue**: If the Toon's web server answers a missing `/water.html` with 200 + HTML, 403 or 500 (not observed; T8 is M), the design classifies `unexpected`/`http` and backs off 5 min -> ~288 requests/24 h and status "Unexpected response" on every P1 device, i.e. the exact noise the opt-in exists to remove, until HW-07 prompts a code change.
* **Fix**: make the "absent" back-off (15 min) apply after N consecutive non-success water results of **any** kind (e.g. N = 3), keeping the status text per kind; then HW-07 can only change wording, not load. Note the FR-55 AC4 count accordingly in the test.

### Issue 9 - minor - A half-failed Off->On leaves a stray water capability that M-5 keeps forever

* **Where**: 05 §6.5 Off->On step 2 (`addCapability` x3), §9 M-5 ("Keep extras ... any unknown capability"); ADR-0010 M-5; 04 §6 row "onSettings throws" (new settings not stored).
* **Issue**: If the second `addCapability` throws (e.g. Homey refusing an id not in `driver.capabilities` - unverified, or a transient Core error), `onSettings` rejects, Homey keeps `toonwater_enabled = false`, and one water capability stays on the device. M-3 excludes it from `desired`, M-5 keeps it as an "extra": an unpolled, permanently stale water item on a device with ToonWater off, with a system card and tag.
* **Fix**: wrap the Off->On capability step: on failure, `removeCapability` the ids added in the same step (guarded), then rethrow; add an L2 scenario "second `addCapability` rejects".

---

## 5. Checked and found sound (no action)

* Identity: app id, driver id `open-toon`, `data: {id}` untouched and unparsed, class `thermostat`, pair view id (ADR-0004, ADR-0008, 05 §7).
* Era detection by capability list + store marker, never by version; marker written last; migration offline and additive (ADR-0010).
* Setting defaults never trusted (U3): `toonwater_enabled` decided from the capability list, `poll_interval`/`address` resolved on read, `address` never rewritten (R-05, R-29, R-30).
* Hot water items (`alarm_water.hotwater`, `hotwater_dispensing`, `alarm_water_changed`) in `core.js`, never guarded (R-36, FR-31).
* `energy` byte-identical; no plain `meter_water`/`meter_power` added; FR-90 deferred (ADR-0016, C-EN-1).
* Cards: 14 ids, args, dropdown ids, tokens kept; only additive deprecations; `burner_state_changed_to` avoids the HS-42 auto-run collision; `temperature_state_changed` left to Homey (documented behaviour, HW-06 fallback); `title`+`label` on dropdown values (R-17); `resume_program` `undefined` -> `yes` (R-18).
* Toggle races: serial queue, `featureGen` bumped before abort, `hasCapability` re-read per step (FR-52 AC4, FR-53 AC3).
* Behaviour changes with changelog lines: update cards reject when unreachable (R-09), dormant triggers fire (R-11, R-13), 3 decimals (R-20), device may go unavailable (R-10).
* Compatibility floor `>=12.9.0` and version 2.0.0: consequences stated (R-26, R-31); owner confirmation pending (OQ-04) - a decision, not a defect.

## 6. What only hardware can settle for this lens

Already in 05 §17 / 04 §10.2: HW-02 (install over old build keeps devices/Flows/values), HW-03 (options after `addCapability`; extend per issue 4), HW-04 (new-setting defaults), HW-05/HW-09 (Flow editor on remove/re-add and the device-arg filter), HW-07 (`removeCapability` vs Insights, deprecated card behaviour), HW-08 (04) (Insights after remove/re-add - decides issue 3's clause), HW-12/HW-14 (upgrade over a patched baseline per era), HW-07 (01) (real status for a missing `/water.html` - decides issue 8's wording). New from this review: the "present-but-unlisted capability keeps its title" case (issue 4), and a CT-04 era-1 `update_water` case (issue 2) which is mock-verifiable.
