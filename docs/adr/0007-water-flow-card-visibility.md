# ADR-0007: Water Flow cards - deprecate the app cards, rely on Homey's system cards, no `capabilities=` filter

* Status: accepted (2026-11-12); amends FR-54 AC1, FR-52 AC5, FR-53 AC5 of `01-requirements.md`; **revised rev 2 (2026-11-12)**: `update_water` on a migration-decided device resolves as a no-op (ADR-0018 amends FR-54 AC2); Insights clause in the hint/save message (ADR-0006). Revision log: `docs/sdlc/archive/05b-design-revision-log.md`
* Related: `05-architecture.md` §6.7; `04` §7.3 (option C), CD-1, R-06, R-07, R-08; HS-35, HS-44, HS-46; FR-71, FR-74, FR-75

## Context

The owner wants no water cards in the Flow editor when ToonWater is off and all of them when it is on. Manifest Flow cards are static. The documented `capabilities=` device filter "does not update" on `addCapability`/`removeCapability` ([D] flow.md, HS-44), so a filtered card would stay hidden for exactly the users who enable ToonWater later through the setting, and stay visible for those who disabled it (R-06). `deprecated: true` is global, hides a card from "Add card" and keeps existing Flows running (HS-46). Capability-generated **system** cards (`measure_water_changed`) and Flow tags follow the device's current capability list ([D]); sub-capabilities get no system cards (HS-35). Doc 01 D-5 chose the filter with a hardware check; doc 04 made option C the fallback.

## Decision

* `update_water` and the app's `measure_water_changed` trigger get `"deprecated": true`. Their run listeners stay registered. No `capabilities=` filter is added to any card; the device argument filter stays byte-identical `driver_id=open-toon`.
* Visibility when **on** comes from Homey: the system `measure_water_changed` trigger and the three tags appear with the capabilities. When **off** they vanish with the capabilities; the deprecated app cards are hidden for new Flows anyway.
* `update_water` on a device with ToonWater off: when the off state was decided **by the user** (`store.toonwaterDecidedBy === 'user'`) it rejects with the FR-59 text "ToonWater is not enabled for this device" and sends nothing (`onDisabled: 'reject'`); when it was decided **by the migration** (eras 0/1, `'migration'`) it **resolves as a no-op** with one debug line, so a legacy Flow that chained the card (the #5/#25 workaround) keeps running exactly as it did under the baseline, where `getWater()` swallowed every error (`device.js:171-190`). ADR-0018 records this and amends FR-54 AC2; the one-word fallback `'noop'` for everyone (CD-2) stays available. With ToonWater on it refreshes the water group; a 404 never rejects it.
* "Refresh now" for new Flows is `update_status` ("Update now" / "Update nu"), which refreshes every enabled group.
* The hot-water items (`alarm_water.hotwater`, `hotwater_dispensing`, `alarm_water_changed`) are never deprecated, filtered or guarded.
* What happens to a user's Flows on disable: Homey marks Flows that depend on a removed capability as broken ([D] Device.html) and the Homey-side Insights history of the three logs may be deleted (`04` U5); the app edits no Flow; re-enable restores the same ids. The hint, the save message and a README section say **both** (Flows break, history may be lost; check the Flows after re-enabling - texts in ADR-0006 item 2); HW-05/HW-08 (04) record the exact editor behaviour and whether Insights history survives, and the clause is dropped if it does.

## Consequences

* The owner's wish is met through Homey's own, documented mechanism rather than an undocumented filter behaviour; there is no non-deprecated *app* water card any more.
* Deprecation is a one-way door: the contract check (CT-01) fails on un-deprecation.
* If HW-09 (04) ever proves the device-argument filter dynamic, a new filtered "Update water" card can be added under a new id (additive); nothing in this decision blocks it.
* Rejected: option A (filter + guard, undocumented behaviour, hides cards for the wrong users); option B (cards visible for everyone, contradicts the owner's wording).
