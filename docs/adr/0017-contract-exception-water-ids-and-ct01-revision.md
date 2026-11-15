# ADR-0017: Stability-contract exception for the three water capability ids; CT-01 revised

* Status: accepted (2026-11-12, design revision rev 2); amends `04-compat-contract.md` C-CAP-1 and Appendix A; populates the FR-76 AC2 exception list
* Related: `05-architecture.md` §3, §13 (L3), §15; FR-51 AC1, FR-76 AC1/AC2, NFR-14 AC1; `04` §4.3 C-CAP-1, §6 row "Remove a capability from the driver manifest only", R-33, CT-01; ADR-0006, ADR-0007; design review `archive/05a-design-review-compat.md` issue 1

## Context

FR-51 AC1 (MUST) requires that a new device without ToonWater has no water capability, which the design meets by taking `measure_water`, `meter_water.today` and `meter_water.total` out of the driver's `capabilities` list and adding them per device (ADR-0006). `04` C-CAP-1 says "No capability id is renamed, repurposed or removed from the driver's `capabilities` array", and the executable check of `04` Appendix A (line 598: `base.caps.forEach((c) => cand.caps.includes(c) || problems.push('driver capability dropped from manifest: ...'))`) enforces exactly that. As specified, CT-01 therefore reports three violations on the design's own manifest, FR-76 AC2's "ADR-referenced exception list" is empty, and NFR-14 AC1 is not met. Homey documents that removing a capability from the manifest only "will not break" paired devices ("UI components and Flow cards will remain working", `04` §6 row 2, [D] breaking-changes.md), so users are unaffected: this is a specification and test defect, not a behaviour change. Side defect: `05` §3 claimed that CT-01 checks the `device` argument filter (R-33), but Appendix A never compares the filter string.

## Decision

1. **Exception recorded.** The three ids `measure_water`, `meter_water.today`, `meter_water.total` leave `driver.compose.json` `capabilities`. They stay (a) in `capabilitiesOptions` (titles, `app.json:128-139` of the baseline), (b) in `FEATURES[toonwater].capabilities`, and (c) on every paired device that has them today (the migration never removes, ADR-0010 M-5). No other baseline id may leave the list without a new ADR.
2. **CT-01 comparison widened.** For every baseline driver capability id, CT-01 passes when the id is in `capabilities` **or** in `keys(capabilitiesOptions)` **or** in `FEATURES[*].capabilities` of the candidate, **and**, when it is not in `capabilities`, the id is listed in `test/fixtures/contract-exceptions.json` with the ADR that allows it. An id that is absent from all three fails; an id absent from `capabilities` but not in the exception file fails ("undocumented manifest removal").
3. **Exception file.** `test/fixtures/contract-exceptions.json`: `{"driverCapabilitiesRemovedFromManifest": {"measure_water": "ADR-0017", "meter_water.today": "ADR-0017", "meter_water.total": "ADR-0017"}}`. The L3 test also asserts that every ADR named in the file exists under `docs/adr/`.
4. **R-33 added to CT-01.** For every baseline card, the `device` argument's `filter` string must be byte-identical (`driver_id=open-toon`). Compose generates it (HS-12); the check proves it.
5. **`04` amendments** (to be applied in the next revision of `04`; this ADR is the normative source until then): C-CAP-1 becomes "No capability id is renamed or repurposed; an id may leave the driver's `capabilities` array only when it stays in `capabilitiesOptions` and in a feature, is never removed from paired devices by the app itself, and is listed in `test/fixtures/contract-exceptions.json` with its ADR"; Appendix A line 598 is replaced by the rule in item 2.

## Consequences

* FR-76 AC1 and AC2 and NFR-14 AC1 are met as specified: the contract check runs green on the design's manifest and red on any further removal.
* The exception list is the single place a reviewer looks to see every deliberate contract deviation; the §15 deviations list of `05` references it.
* Rejected: keeping the water trio in `driver.capabilities` and removing it per device at pairing/first start (would make the app's first start the one place an update removes capabilities, contradicting D-3 and ADR-0010 M-5); weakening CT-01 to ignore `capabilities` altogether (would stop catching an accidental removal of a core id).
