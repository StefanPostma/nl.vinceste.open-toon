# ADR-0010: Marker-gated, additive, offline migration for every device era

* Status: accepted (2026-11-12); **revised rev 2 (2026-11-12)** after the compat review (issues 2, 4, 6, 7) and R-16: M-2 writes `store.toonwaterDecidedBy`, M-4 reconciles options for present-but-unlisted capabilities, plain `meter_power` is frozen, a later valid address starts the poller. Revision log: `docs/sdlc/archive/05b-design-revision-log.md`
* Related: `05-architecture.md` §9; FR-110..113, FR-56; `04` §2, §5 (M-1..M-7), Appendix B, R-01, R-02, R-05, R-25, R-29, R-30, R-32; HS-30, HS-31, HS-34; ADR-0014, ADR-0018

## Context

Four eras of paired devices exist (04 §2): era 0 with a plain `meter_power`; era 1 with `meter_power.peak/offPeak`; era 2 with the water trio; era 3 with `alarm_water.hotwater`. Three of them share `manifest.version 1.0.0`, so the version cannot identify the era. The baseline migrates only `alarm_water.hotwater` (`device.js:33-38`). The audit's "add every manifest capability" would put water on every device (R-01). It is not documented whether Homey injects defaults of new setting keys into paired devices (U3), nor that `addCapability` copies manifest options (U2).

## Decision

Runs in `Device#onInit`, before any network call, under the device's serial queue:

| Step | Rule |
|---|---|
| M-1 | `store.migrationVersion` absent = legacy. Present and `>= 1`: skip M-2. A future schema bump re-runs M-3..M-5 only. |
| M-2 | Legacy only: `toonwater_enabled = legacyIf(getCapabilities())` (any of the three water ids); `export_enabled = false`; persist with `setSettings` (does not call `onSettings`) and write `store.toonwaterDecidedBy = 'migration'` (ADR-0018: governs `update_water`, the tile warning and the FR-62 hint for these devices). The setting's manifest default is never read. |
| M-3 | `desired = CORE ∪ capabilitiesFor(featureState)`; `CORE = [target_temperature, measure_temperature, temperature_state, meter_power.peak, meter_power.offPeak, measure_power, meter_gas, alarm_water.hotwater, burner_state]`. |
| M-4 | `addCapability` each missing id in manifest order, guarded by `hasCapability`. Then **options reconciliation, once (marker-gated)**: for every capability the device now has that has an entry in `manifest.capabilitiesOptions`, call `setCapabilityOptions(id, entry)` when `getCapabilityOptions(id)` deep-differs from it. This covers both the ids just added (C-CAP-4) and the water trio already present on era-2/3 devices, whose ids are no longer in `driver.capabilities` and whose titles ("Water today", "Water meter total", `app.json:128-139`) live only in `capabilitiesOptions`; whether Core keeps applying options to such a capability is unverified (HW-03 extension), so the migration does not rely on it. Each call is guarded (`try/catch`, logged, never fatal). |
| M-5 | Keep extras: era-0 `meter_power` and any unknown id. The migration never removes. |
| M-6 | Write `store.migrationVersion = 1` last. On error: log, continue, no marker (retry next start); never `setUnavailable` for a migration problem. |
| M-7 | Steady state calls neither `addCapability` nor `removeCapability`. |

Per era: 0 adds `meter_power.peak`, `meter_power.offPeak`, `alarm_water.hotwater`, `burner_state` (water off); 1 adds `alarm_water.hotwater`, `burner_state` (off); 2 adds `alarm_water.hotwater`, `burner_state` (water on, nothing removed); 3 adds `burner_state` (on). New pairs carry the marker from pairing.

Settings a legacy device lacks are resolved on read, never persisted: `poll_interval` -> `Number(x) || 30` clamped; `address` normalised on read, never rewritten; `0.0.0.0`/empty -> `setUnavailable(__('address_missing'))` and no poller (the only mechanism; no warning slot, ADR-0006). When the user later saves a valid address, `planSettingsChange` returns `startPoller: true`, the poller is started and its first success calls `setAvailable()`, so a legacy `0.0.0.0` device fixed through settings comes alive without a restart (L2 scenario). `data.id`, name, zone, class and `energy` are never touched. Plain `meter_power` is **kept but never written** (ADR-0014: the baseline wrote today's usage into a cumulative slot; the capability and its Insights log stay, frozen).

## Consequences

* No re-pair for any era; Insights history and Flows keep their ids; the upgrade is additive only.
* The era matrix (Appendix B of 04 plus L2018 = era 0) is an executable test (CT-02/CT-03) with zero unhandled rejections and zero `Invalid Capability` as pass criteria.
* Hardware: upgrade over a real patched baseline per era (HW-12 of 01 / HW-14 of 04), new-setting defaults on paired devices (HW-04 of 04), options after `addCapability` (HW-03 of 04).
