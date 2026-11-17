# ADR-0001: Base the redesign on candidate C (declarative feature registry), with grafts from A and B

* Status: accepted (2026-11-12)
* Deciders: chief architect; owner to confirm
* Related: `docs/sdlc/05-architecture.md` §1, candidates `docs/sdlc/archive/design-candidates/{A,B,C}*.md`

## Context

Three candidate designs were produced for the SDK v3 redesign of `nl.vinceste.open-toon`. All three satisfy the 51 MUST requirements of `01-requirements.md` on paper. They differ in module structure (A: logic in `device.js` with four helpers and a hand-edited flat `app.json`; B: four layers, ~35 files, one injected `services` object; C: a ~250-line feature-agnostic engine plus one plain-object file per feature) and in a few contract-relevant details (B's new trigger id `burner_state_changed` is the id Homey auto-runs for a custom enum capability, HS-42). The owner's second intent is a *mechanism* ("ToonWater should be a feature that you can enable if wanted"), and the requirements already name a second opt-in feature for the same release (FR-25 power export, OQ-06) and a third that "must follow the opt-in pattern" (FR-33).

## Decision

Candidate **C** is the base. Grafted from **B**: injected timers in the HTTP client, write priority on the per-device lane (rev 2: priority in the queue, no abort of an in-flight request, ADR-0005), `newSettings`-only `onSettings` (rev 2: `planSettingsChange(newSettings, changedKeys)`), the layering grep test, the strict fake-Homey conventions, the in-process `fetch` adapter (contract in ADR-0013). Grafted from **A**: the small file budget (16 files under `lib/`), read-only status labels (`last_update`, `last_problem`), the one-time timeline hint for migrated devices (FR-62), the `burner_state_changed_to` card id, "no network before the migration marker".

Rejected: A's flat hand-maintained `app.json` (HS-10/11; owner intent "latest standards"); B's `ClientPool` and `this.homey.app.services` composition root (weight without a requirement); B's `burner_state_changed` id.

Scores (1-5; MUST, SHOULD, standards, contract, testability, simplicity, extensibility, risk): A 5/3/2/5/4/5/2/3 = 29, B 5/4/5/3/5/1/4/3 = 30, C 5/4/5/5/4/3/5/3 = 34. The sum is information; the decision rests on the extensibility and standards columns, where C is the only candidate that both follows Compose and writes the opt-in lifecycle once.

## Consequences

* One lifecycle (setting, capabilities, poll group, probe, status, legacy default, pairing checkbox, guarded cards, trigger rules) lives in `lib/engine/*`; each feature is a plain object in `lib/features/*`; a synthetic fourth feature in a test proves the engine needs no edit.
* Kill criterion kept from C: if the owner drops FR-25, `lib/features/` collapses to `core.js` + `toonwater.js`; the engine is unchanged.
* Indirection cost for a part-time maintainer is bounded: no generator, no plugin loader, no DI container, no event bus, no TypeScript.
