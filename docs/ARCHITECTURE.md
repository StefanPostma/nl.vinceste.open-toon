# Architecture of Open-Toon®

This page is the short version. The full design, with the scoring of the candidates, the sequence of every race and the traceability of every requirement, is [docs/sdlc/05-architecture.md](sdlc/05-architecture.md); each decision has its own record in [docs/adr/](adr/). Where this page and the code disagree, the code wins; where the code and an accepted ADR disagree, that is a bug in one of them, so say so in an issue.

## In one picture

```
 Homey (SDK 3, Node.js 22)                                  Toon (your network, plain http)
 +--------------------------------------------+            +------------------------------+
 | app.js              ToonApp (log only)     |            | /happ_thermstat   thermostat |
 | drivers/open-toon/                         |   fetch    | /happ_pwrusage    power now  |
 |   driver.js   pairing, Flow cards          | ---------> | /hdrv_zwave       meters     |
 |   device.js   one Toon: poller, settings   |            | /water.html       ToonWater  |
 +--------------------------------------------+            |                 (only if on) |
 | lib/engine    poller, scheduling, apply,   |            +------------------------------+
 |               capabilities, optional       |
 |               features, pairing            |
 | lib/features  core, toonwater, export      |
 | lib/toon      client, address, commands,   |
 |               parse, errors                |
 | lib/flow      Flow card table              |
 +--------------------------------------------+
```

Dependencies point downwards: `drivers/` uses `lib/engine`, which uses `lib/features`, which uses `lib/toon`. Only `app.js` and `drivers/` talk to Homey, only `driver.js` touches `fetch`, and nothing under `lib/` starts a global timer; `test/static/layering.test.js` checks all three. `lib/` has at most 16 files of at most 250 lines each.

## The ideas that carry the design

* **A feature is data.** `lib/features/` holds one plain object per feature: its capabilities, the pages of the Toon it needs (poll groups), how its answer is parsed, the Flow cards and the trigger rules it owns, and, for an optional feature, its setting, status and probe. `core` is the thermostat, the meters, the hot water flag and the burner; `toonwater` and `export` are the two optional ones. The engine in `lib/engine/` never names a feature, and a test registers a made-up fourth one to prove it. ([ADR-0001](adr/0001-base-candidate-declarative-feature-registry.md))
* **ToonWater is an opt-in, per device.** A checkbox setting adds or removes the three water capabilities while the app runs, starts or stops the polling of `/water.html`, and shows a status. The default for a device that exists already is decided once, from the capabilities it has, and never from the network; nothing is removed except by the user's own switch. The Flow cards of the app that concern water are deprecated, and Homey's own cards for the capabilities take their place. ([ADR-0006](adr/0006-toonwater-opt-in-mechanism.md), [ADR-0007](adr/0007-water-flow-card-visibility.md), [ADR-0018](adr/0018-toonwater-decided-by-migration-flag.md))
* **One request at a time per Toon.** Each device has a lane that runs a single request at a time, with writes before refreshes before polls, and a poller that reads the groups of the features that are on, backs off while the Toon is silent and sets the device unavailable only after a while. ([ADR-0005](adr/0005-poll-scheduler-backoff-availability.md))
* **The HTTP client is the built-in `fetch`.** There are no runtime dependencies; every failure becomes a `ToonError` with a kind that maps to a text in English and Dutch. ([ADR-0003](adr/0003-http-client-fetch-no-runtime-deps.md), [ADR-0011](adr/0011-dependency-policy-and-node-modules.md))
* **Upgrades do not need a re-pair.** On the first start of a device the migration looks at the capabilities it has, not at the app version, adds what is missing, keeps everything else and writes a marker in the device store; it needs no network. ([ADR-0010](adr/0010-device-migration-per-era.md))
* **The manifest is generated.** `.homeycompose/` and the `drivers/open-toon/*.compose.json` files are the source; `app.json` is committed output, and `npm run validate` fails when the two differ. ([ADR-0002](adr/0002-homey-compose-and-module-layout.md))
* **Everything that can be tested without hardware is.** Pure parsers, the client against a real local HTTP server, whole-device scenarios against a mock Toon and a strict fake Homey on a fake clock, and static checks of the manifest, the texts and the contract with existing users. What only a real Toon or Homey can show is listed, not hidden. ([ADR-0013](adr/0013-test-architecture.md), [docs/sdlc/08-test-report.md](sdlc/08-test-report.md))

## Where to read more

| You want to know | Read |
|---|---|
| What the app must do, and why | [docs/sdlc/01-requirements.md](sdlc/01-requirements.md) |
| What Homey requires of an SDK 3 app | [docs/sdlc/02-homey-standards.md](sdlc/02-homey-standards.md) |
| What was reused, and where each piece of knowledge comes from | [docs/sdlc/03-reuse-inventory.md](sdlc/03-reuse-inventory.md) |
| What must not change for people who already use the app | [docs/sdlc/04-compat-contract.md](sdlc/04-compat-contract.md) |
| The complete design | [docs/sdlc/05-architecture.md](sdlc/05-architecture.md) |
| How the work was planned | [docs/sdlc/06-implementation-plan.md](sdlc/06-implementation-plan.md) |
| What was tested, and what is left for hardware | [docs/sdlc/08-test-report.md](sdlc/08-test-report.md) |
| What changed for existing users, and what happens on upgrade | [docs/sdlc/09-release-notes-and-migration.md](sdlc/09-release-notes-and-migration.md) |
| How to contribute and release | [CONTRIBUTING.md](../CONTRIBUTING.md) |

The documents in `docs/sdlc/` were written during the redesign and, apart from the ADRs they point to, are not kept in step with later changes; the ADRs are the normative record. File names inside `05-architecture.md` may differ in detail from the final layout above.

## The decisions

| ADR | Decision |
|---|---|
| [0001](adr/0001-base-candidate-declarative-feature-registry.md) | A declarative feature registry as the base of the design |
| [0002](adr/0002-homey-compose-and-module-layout.md) | Homey Compose and the `lib/{toon,features,engine,flow}` layout |
| [0003](adr/0003-http-client-fetch-no-runtime-deps.md) | HTTP client on built-in `fetch`, no runtime dependencies |
| [0004](adr/0004-compatibility-floor-and-version.md) | Homey firmware 12.9.0 or newer, version 2.0.0 |
| [0005](adr/0005-poll-scheduler-backoff-availability.md) | Poll scheduler, request lane, back-off and availability |
| [0006](adr/0006-toonwater-opt-in-mechanism.md) | The ToonWater opt-in: setting, capabilities, default, races, detection |
| [0007](adr/0007-water-flow-card-visibility.md) | Water Flow cards: deprecate the app cards, rely on Homey's cards |
| [0008](adr/0008-pairing-on-pairsession.md) | Pairing on `PairSession` with a live connection test |
| [0009](adr/0009-flow-trigger-firing-and-deprecations.md) | When triggers fire, which cards are deprecated, how update cards fail |
| [0010](adr/0010-device-migration-per-era.md) | Migration of existing devices, per era, additive and offline |
| [0011](adr/0011-dependency-policy-and-node-modules.md) | No runtime dependencies; `node_modules` is not committed |
| [0012](adr/0012-tooling-lint-validate-ci.md) | Lint, validate and CI on Node 22 and Node 24 |
| [0013](adr/0013-test-architecture.md) | Test architecture without hardware |
| [0014](adr/0014-vacation-burner-state-meter-power.md) | Vacation state, burner state, meter precision and the meter counter policy |
| [0015](adr/0015-resume-program-semantics.md) | What "resume program" sends to the Toon (pending hardware) |
| [0016](adr/0016-power-export-feature-and-energy-deferral.md) | Power export as the second optional feature; Homey Energy changes deferred |
| [0017](adr/0017-contract-exception-water-ids-and-ct01-revision.md) | The one recorded exception to the contract with existing users |
| [0018](adr/0018-toonwater-decided-by-migration-flag.md) | Who decided ToonWater for a device: the migration or the user |
