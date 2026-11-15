# ADR-0009: Trigger firing policy, deprecations, update-card failure semantics, new burner cards

* Status: accepted (2026-11-12); amends FR-70 AC1 (one card) and FR-32 (ids); settles CD-2, CD-4, CD-6, OQ-09, OQ-11; **revised rev 2 (2026-11-12)**: refresh coalescing, `aborted` settlement, migration-decided `update_water`, no optimistic write (see ADR-0005, ADR-0018). Revision log: `docs/sdlc/archive/05b-design-revision-log.md`
* Related: `05-architecture.md` §8; FR-70..77; HS-40..46; `04` §4.5, R-09, R-11..R-18, B-1, B-2

## Context

Five triggers are declared (`app.json:175-303`) and none is fired (no `getDeviceTriggerCard` anywhere). `meter_gas_changed` and `measure_water_changed` reuse system capability trigger ids. Homey auto-runs `<id>_changed` for **custom** capabilities on `setCapabilityValue` (HS-42), so `temperature_state_changed` is probably already fired by Homey (U8). The four `update_*` actions resolve even when the Toon is unreachable (`device.js:99-103` swallows). `set_temperature_state.titleFormatted` lacks `[[resume_program]]` (`app.json:388-391`), which fails validation at every level (HS-17). Issue #26 asks for burner cards.

## Decision

* **Firing**: `Driver#onInit` fetches each `getDeviceTriggerCard(id)` once; `applyValues` yields `Change[]`; feature `rules` map changes to cards; `card.trigger(device, tokens, state).catch(this.error)`. Fire only when `prev !== null && prev !== next`.
* **Per card**: `meter_gas_changed` fires (deprecated); `meter_power_changed` fires once per cycle with token `meter_power` = peak + off-peak kWh, 3 decimals, token title "kWh"; `measure_water_changed` (app) fires while ToonWater is on (deprecated); `alarm_water_changed` fires on boolean change with token `alarm_water.hotwater`; `temperature_state_changed` is **not** fired by app code (`source: 'homey'`) until HW-06 (04) shows Homey does not fire it; then flip one word.
* **New**: capability `burner_state` with trigger `burner_state_changed_to` (arg `state`: any/off/heating/hot_water/preheating; run listener compares) and condition `burner_state_is`. The id avoids `burner_state_changed`, which Homey would auto-run for the custom enum.
* **Conditions** return strict booleans and accept `args.state` as string or `{id}`; `temperature_state_is` gains `vacation`.
* **Actions** await the Toon and check `result`, else reject localized. `resume_program` `undefined` -> `yes`. `update_status` becomes "Update now" / "Update nu", refreshes every enabled group and rejects only when `thermostat` fails; `update_powerusage`, `update_metertotals`, `update_water` refresh their own group and reject only on their own failure (water 404 excepted). Concurrent `update_*` cards for the same group **coalesce** into one request (ADR-0005; B-3), so a burst of legacy timer Flows costs one targeted cycle. `update_water` with ToonWater off: rejects after a user toggle, resolves as a no-op on a migration-decided device (rev 2, ADR-0018). A card still queued when the device is deleted or its address changes rejects with the localized `aborted` text (ADR-0005), never hangs. `target_temperature` and the state actions carry **no optimistic capability write**; Homey stores the value when the listener resolves (ADR-0005, amends `04` B-5).
* **Deprecated** (`deprecated: true`, listeners kept): `meter_gas_changed`, `measure_water_changed`, `update_powerusage`, `update_metertotals`, `update_water`. `update_status` stays visible.
* **Manifest text fixes**: `[[resume_program]]` in `set_temperature_state.titleFormatted` (en + nl); nl `!{{is|is niet}}`; `title` on every dropdown arg; dropdown values carry both `title` and `label` until HW-10 (04).
* **Changelog**: update cards now fail when the Toon is unreachable (R-09); dormant triggers start firing (R-11, R-13); gas/kWh gain decimals (R-20); `vacation` added; ToonWater is a per-device setting.

## Consequences

* Existing Flows keep their ids, args, tokens and dropdown values (CT-01 enforces); some dormant Flows start to run, which their titles promised.
* A Flow that chained several `update_*` cards stops at the first failing card when the Toon is down (deliberate, documented).
* Rejected: firing all five from app code (double-fire risk); renaming or removing any card.
