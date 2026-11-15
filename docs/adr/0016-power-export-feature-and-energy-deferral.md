# ADR-0016: Power export as the second opt-in feature; Homey Energy manifest changes deferred behind hardware

* Status: accepted (2026-11-12); settles OQ-06 (gating), CD-8 (energy)
* Related: `05-architecture.md` §14; FR-25, FR-26, FR-27, FR-63, FR-90; `04` C-EN-1, C-EN-2, C-CAP-3, R-23, R-24, U10, U13, HW-11; `03` I6, C4; issue #23

## Context

Issue #23 (open since 2021) asks for power export. The `GetCurrentUsage` sample pasted in issue #11 contains `powerProduction.value` next to `powerUsage.value`, so instantaneous export costs no extra request (M confidence: user-pasted, no sample from an exporting household). The driver's `energy: {"cumulative": true}` already makes Homey Energy treat the Toon as the whole-home meter and applies instantly to every paired device; the validator warns that no `cumulativeImportedCapability` is set. Any `energy` edit, a plain `meter_power` or a plain `meter_water` would change the user's Energy accounting at once (C-EN-1, C-CAP-3). The node carrying cumulative production is unknown (no real `getDevices.json`).

## Decision

* **Export feature** `lib/features/export.js`: `optional: true`, setting `export_enabled` (checkbox, `value:false`, group "Power export (optional)" / "Teruglevering (optioneel)"), capability `measure_power.export` (W, title "Power export" / "Teruglevering", `capabilitiesOptions` in the manifest superset), **no poll group** (`parsePower` emits `measure_power.export` from `powerProduction.value`; the writer drops it when the capability is absent), no pairing checkbox, `legacyIf: () => false`. `measure_power` stays import-only and never negative (FR-27 WONT).
* **Energy block**: `{"cumulative": true}` stays byte-identical in 2.0.0 (CT-01 fails on any change). No plain `meter_power`, no plain `meter_water`, no `setEnergy()`.
* **Deferred** to a later minor, each behind its hardware gate: `meter_power.imported` (= peak + off-peak, only when both valid) with `cumulativeImportedCapability` (FR-90; HW-11 must show the first value is not booked as consumption and no double counting); plain `meter_water` for Energy (FR-63; U10); cumulative export counters (FR-26; needs a real dump with production).

## Consequences

* The registry has two real optional features in 2.0.0, which justifies the engine (ADR-0001) and delivers the oldest open request at zero LAN cost.
* Solar owners enable one checkbox; everyone else sees no 0 W item.
* Homey Energy behaviour for existing users is unchanged by the upgrade; FR-90's value (kWh in the Energy tab) waits for HW-11.
* Hardware: `powerProduction` on an exporting Toon (HW-02), Energy tab (HW-11).
