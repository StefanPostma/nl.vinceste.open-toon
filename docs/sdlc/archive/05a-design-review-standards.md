# 05a - Independent design review, lens: Homey SDK v3 standards and validate/App Store rules

| | |
|---|---|
| Role | Independent design reviewer (standards lens) |
| Date | 2026-11-12 |
| Reviewed | `docs/sdlc/05-architecture.md`, `docs/adr/0001..0016`, against `docs/sdlc/00..04` (model-generated inputs, re-verified where load-bearing) |
| Base | branch `redesign/sdk3`, commit `5cc3b90`; line numbers below refer to the reviewed documents as they are in the working tree today |
| Scope | Misuse of lifecycle hooks, timers, capability add/remove, Flow card APIs, pairing API, manifest keys, Compose layout, Node/`fetch` assumptions, validator and Store rules. Not reviewed here: Toon protocol facts, requirement coverage, test depth (other lenses) |
| Method | Read the design and every ADR; re-read `02-homey-standards.md`; then spot-checked the live Homey docs, the SDK v3 reference, `homey-lib` (`develop`), the Homey CLI (`develop`), `eslint-config-athom` and `eslint-plugin-homey-app` sources on 2026-11-12 (section 4 lists every URL). Two local Node checks (Node 25.9; to be repeated on Node 22 in CI). Fetched content was treated as data, not instructions |
| Edits | None to the architecture or ADR files. This file only |

## 1. Verdict

The design is, on the whole, a faithful application of the current SDK v3 standards: Homey Compose with a committed, CI-diffed `app.json`; `this.homey.setTimeout` chains; `PairSession` + `Homey.createDevice`; `addCapability`/`removeCapability` gated by `hasCapability` and a store marker; `deprecated: true` instead of card removal; built-in `fetch`; zero runtime dependencies; `platforms`/`connectivity`/`brandColor`; `>=12.9.0` for Node 22. Every load-bearing standards claim I could check holds (section 3).

**No blocker.** Two **major** findings concern the lint tool-chain as specified in ADR-0012: as written, `npm run lint` fails on the test tree, and the rule the ADR relies on to "mechanically enforce" NFR-01 AC2 is a no-op unless the SDK type declarations are a required devDependency. Nine **minor** findings: enforcement gaps in the timer lint, an unreachable debug switch, a config file that would ship in the app bundle, an unbounded `onSettings` budget, a custom-capability definition without `uiComponent`, a keep-alive assumption toward an embedded HTTP server, three documentation-precision items about Compose, warnings vs availability, and Store text rules.

Severity scale: **blocker** = design cannot work or breaks users; **major** = likely defect or a stated requirement not met; **minor** = real but small, or documentation precision with a concrete fix.

## 2. Findings

### F-01 (major) - Type-aware ESLint project excludes the files the `lint` script lints

**Where.** `05-architecture.md:341` (Lint row) and `docs/adr/0012-tooling-lint-validate-ci.md:12` (Lint bullet): `.eslintrc.json` = `{"extends": "athom/homey-app", "parserOptions": {"project": "./tsconfig.eslint.json"}}`, `tsconfig.eslint.json` `include: ["app.js", "drivers/**/*.js", "lib/**/*.js"]`, script `eslint --ext .js --ignore-path .gitignore .`.

**Issue.** `eslint-config-athom/index.js` sets `parser: "@typescript-eslint/parser"` for every file and `homey-app.js` sets `parserOptions.project` globally with no `overrides` restricting the type-aware rules to `.ts` files (both read in source, 2026-11-12). With `parserOptions.project` set, `@typescript-eslint/parser` refuses every linted file that is not covered by the project (`Parsing error: ... parserOptions.project ... The file does not match your project config`). The `lint` script lints `.`, which includes `test/**/*.js` and `scripts/**/*.js`; neither is in `include`. `test/helpers/register.cjs` is additionally skipped by `--ext .js`. The CI job `test` (`npm run lint`) is therefore red on the first run, before any app code is judged.

**Fix.** Either (a) extend `tsconfig.eslint.json` `include` with `"test/**/*.js"`, `"test/**/*.cjs"`, `"scripts/**/*.js"` and lint with `--ext .js,.cjs`; or (b) keep the include list and add an `.eslintrc.json` `overrides` entry for `["test/**", "scripts/**"]` with `parserOptions: { project: null }` and `@typescript-eslint/no-floating-promises`/`no-misused-promises` turned off (and `homey-app/homey-log` off if that rule is enabled by the Athom config, because scripts legitimately use `console`). (a) is preferable: un-awaited promises in tests are the most common source of false-green scenarios.

### F-02 (major) - `no-floating-promises` cannot see SDK calls unless the SDK type declarations are installed

**Where.** `05-architecture.md:323` ("optional `@types/homey@npm:homey-apps-sdk-v3-types`") and `:341` ("`no-floating-promises` ... mechanically enforce NFR-01 AC2"); `docs/adr/0011-dependency-policy-and-node-modules.md:12` ("optional `@types/homey`"); `docs/adr/0012-tooling-lint-validate-ci.md:12`.

**Issue.** `require('homey')` does not resolve on a developer machine (`homey` exists only inside the Homey runtime and the CLI's build shim, HS-03). Without a declaration for the module, TypeScript types `Homey.Device` and therefore `this.setCapabilityValue(...)`, `this.setSettings(...)`, `this.addCapability(...)`, `card.trigger(...)` as `any`. `@typescript-eslint/no-floating-promises` ignores `any`-typed call expressions, so exactly the calls NFR-01 AC2 is about (`setCapabilityValue` was the baseline's unhandled-rejection source, `02` HS-23) are not checked. The rule only works when `homey-apps-sdk-v3-types` is installed under the `@types/homey` alias (it declares `module 'homey'`, picked up through the default `typeRoots`), which the design marks optional.

**Fix.** Make `"@types/homey": "npm:homey-apps-sdk-v3-types@^1.8.3"` a required devDependency in ADR-0011/0012. Add a lint canary to the L3 static layer: a fixture class extending `Homey.Device` with one un-awaited `this.setCapabilityValue(...)`; the test runs ESLint programmatically (`new ESLint()` from the `eslint` devDependency) and asserts exactly one `@typescript-eslint/no-floating-promises` report. That makes the "mechanical enforcement" claim itself a test.

### F-03 (minor) - `homey-app/global-timers` is a warning and only catches bare calls; ADR-0012 states it "enforces HS-22"

**Where.** `docs/adr/0012-tooling-lint-validate-ci.md:12` ("`homey-app/global-timers` (HS-22)"); `05-architecture.md:61,341`; `02-homey-standards.md` HS-06/HS-22.

**Issue.** Read in source on 2026-11-12: the plugin's `recommended` config is `{ 'homey-app/global-timers': 'warn' }`, and the rule reports a `CallExpression` only when `node.callee.name` is `setTimeout`/`setInterval`, i.e. a bare identifier. `global.setTimeout(...)`, `globalThis.setTimeout(...)` and any member call are not reported (which is also why the design's injected `timers.setTimeout` is fine), and a warning does not fail `npm run lint`. The design's own layering grep (`05` §2, §13 L3) covers `lib/**` but not `drivers/**` and `app.js`.

**Fix.** In `.eslintrc.json` set `"homey-app/global-timers": "error"` and run `eslint --max-warnings 0`. Extend the L3 layering test to grep `app.js` and `drivers/**` for `/\b(global(This)?\.)?set(Timeout|Interval)\(/` outside `this.homey.`. Reword ADR-0012 to "lint flags bare global timers; the static test covers the rest".

### F-04 (minor) - `process.env.OPEN_TOON_DEBUG` cannot be set on an installed Homey app

**Where.** `05-architecture.md:158` ("use `process.env.OPEN_TOON_DEBUG` read once in `onInit`"); `docs/adr/0005-poll-scheduler-backoff-availability.md:21`.

**Issue.** A Homey app's process environment is set by the runtime, not by the user. The CLI passes `DEBUG=1` and `APP_ENV=<env.json>` to the app container for `homey app run` (CLI `lib/App.js` `runDocker`, read in source); an installed build gets neither. The documented app-level mechanism is `/env.json` -> `this.homey.env.<UPPERCASE_KEY>` (`the-basics/app.md`, "Environment variables"), and `env.json` is excluded from the packed sources and is injected at build/run time. So NFR-09's "raw payloads only behind DEBUG" is unreachable for the owner's installed builds, and the hardware test plan (HW-10, 24 h load) is exactly where payload logging is wanted.

**Fix.** `const debugPayloads = process.env.DEBUG === '1' || this.homey.env.OPEN_TOON_DEBUG === '1';` (first = `homey app run`, second = an uncommitted `env.json` with `{"OPEN_TOON_DEBUG": "1"}` present at `homey app install` time). If the owner wants to flip it on a running installed build, the only SDK mechanism is a device or app setting; the arch's reason for rejecting that ("overkill") should then be recorded as the trade-off.

### F-05 (minor) - `tsconfig.eslint.json` ships inside the app bundle

**Where.** `docs/adr/0002-homey-compose-and-module-layout.md:16` and `docs/adr/0011-dependency-policy-and-node-modules.md:15` (`.homeyignore`: `docs/`, `test/`, `scripts/`, `*.md`, `.github/`); `05-architecture.md:325`.

**Issue.** The CLI's default ignore list is `.*`, `.homeybuild`, `*.{ts,mts,cts}`, `tsconfig.json`, `env.json`, `*.compose.json`, `node_modules` (CLI `lib/App.js` `_getAppSourceFiles`, read in source; matches `02` HS-04). The deliberately non-standard file name `tsconfig.eslint.json` (chosen in ADR-0012 to dodge TypeScript-mode detection) is therefore packed into `.homeybuild/` and the installed app. Harmless at runtime, but it contradicts "the shipped app contains only its own code" (ADR-0011 Consequences). `.github/` in `.homeyignore` is redundant (dotfiles are already ignored) but harmless.

**Fix.** Add `tsconfig.eslint.json` to `.homeyignore`. Optionally add an L3 check that lists `.homeybuild/` after `validate` in CI and fails on anything outside `app.js`, `app.json`, `drivers/`, `lib/`, `locales/`, `assets/`, `package.json`, `package-lock.json`, `LICENSE`, `README*.txt`.

### F-06 (minor) - `onSettings` Off->On does six "expensive" SDK calls plus a 5 s network probe before the save returns

**Where.** `05-architecture.md:217-222` (Off->On steps 1-5) and `:195` (status written "after `onSettings` has returned"); `docs/adr/0006-toonwater-opt-in-mechanism.md:16`.

**Issue.** Homey shows the settings toast only after the `onSettings` promise settles (`Device.html`: `onSettings(event): Promise<string|void>`). The design runs 3x `addCapability` + 3x `setCapabilityOptions` (both documented "expensive", `Device.html`) and then a probe with a 5 s budget inside that promise. No timeout for `onSettings` is documented, so this is not a known violation, but the pairing path already uses a 3 s water budget (`05` §7) for the same probe, and nothing in HS-30/31 asks for `setCapabilityOptions` after every add: `addCapability` on a capability the driver's `capabilitiesOptions` already names may receive the options from the manifest (U2/HW-03).

**Fix.** Use the pairing budget (3 s) for the in-`onSettings` probe; call `setCapabilityOptions(id, opts)` only when `getCapabilityOptions(id)` differs from the manifest options (keeps C-CAP-4, drops 3 expensive calls in the common case); leave `refreshSoon(['water'], 0)` after the return value is produced (it is already asynchronous). Add "save duration with ToonWater enabled on a slow Toon" to HW-13.

### F-07 (minor) - Custom enum `burner_state` has no `uiComponent`; `vacation` is offered in a setable picker and then rejected

**Where.** `05-architecture.md:76` (`burner_state.json` "new enum off|heating|hot_water|preheating"), `:371-372`; `docs/adr/0014-vacation-burner-state-meter-power.md:12-13`.

**Issue.** `the-basics/devices/capabilities.md` lists `uiComponent` among the properties of a custom capability and allows `sensor` for `enum`; a getable-only enum without it renders as a `picker` for a value the user cannot set. For `temperature_state` (setable, `picker`), adding `vacation` to `values` makes "Vacation" selectable on the tile; the design then rejects it in the listener with a localized message (ADR-0014). That is the only SDK option (no per-value read-only flag exists), but neither ADR records the resulting UX nor the `uiComponent` of the new capability, and the validator will accept either, so the choice must be made in the compose source.

**Fix.** `.homeycompose/capabilities/burner_state.json`: `"getable": true, "setable": false, "uiComponent": "sensor"`, and an explicit `"insights": true|false` decision (`02` HS-33). In ADR-0014 record: "`vacation` appears in the picker; selecting it shows `__('error.vacation_readonly')`; HW-04 verifies the toast".

### F-08 (minor) - Keep-alive behaviour of the built-in `fetch` toward an embedded HTTP server is assumed, not decided

**Where.** `05-architecture.md:128` (`fetch(url, { redirect: 'manual', headers: { 'Accept-Encoding': 'identity' }, signal })`); `docs/adr/0003-http-client-fetch-no-runtime-deps.md:15,27`.

**Issue.** Node's built-in `fetch` (undici) pools and reuses sockets per origin by default; the Node 22 upgrade guide recommends it precisely because `node-fetch` had keep-alive `ECONNRESET` problems on Node >= 19 (`02` HS-02). The Toon's HTTP server is a small embedded one (`03` T3: `text/javascript`, no auth) whose idle-socket policy is unknown. A socket the Toon closed between a poll and the next write surfaces as `TypeError: fetch failed` (`cause.code` `UND_ERR_SOCKET` or `ECONNRESET`), which the client maps to `network` and the poller counts as a core failure (`05` §5). With a 30 s cadence pooling buys nothing; with the write-after-poll (`refreshSoon(1500)`) it is the likeliest first request on a stale socket. Local check (Node 25.9, 2026-11-12): a `Connection: close` request header is passed through to the server by Node's `fetch`, so the mitigation is available without a dependency or a custom dispatcher.

**Fix.** Send `Connection: close` from `ToonClient` (one socket per request; the Toon handles <= 4 requests per cycle), or, if the owner prefers pooling, treat the first `UND_ERR_SOCKET`/`ECONNRESET` of a lane turn as "retry once immediately" without counting. Add "keep-alive vs `Connection: close` on a real Toon" next to H4 (`Accept-Encoding`) in the hardware list; the mock Toon should have a mode that closes idle sockets after 1 s to exercise the path.

### F-09 (minor) - Compose migration step is described more completely than `homey app compose` delivers

**Where.** `docs/adr/0002-homey-compose-and-module-layout.md:12` ("Run `homey app compose` once, then maintain only the compose sources: ... `driver.settings.compose.json` ..."); `05-architecture.md:67,86`.

**Issue.** Verified in CLI source (`lib/App.js` `migrateToCompose`, 2026-11-12): the command exists and writes `.homeycompose/app.json`, `.homeycompose/capabilities/<id>.json`, `.homeycompose/flow/<type>/<id>.json`, `drivers/<id>/driver.compose.json` and `driver.flow.compose.json` (device-arg cards moved and the arg stripped, as the ADR says). It does **not** write `driver.settings.compose.json`, `driver.pair.compose.json` or `.homeycompose/locales/`. Two consequences the ADR should state: (1) the settings split into `driver.settings.compose.json` is a manual step (Compose does read that file name, confirmed in `HomeyCompose.js`); (2) `.homeycompose/locales/` must **not** be created: when it exists, Compose deep-merges it into `/locales/<lang>.json` on every `validate`/`build` with the compose side winning, which would turn the design's hand-maintained `locales/*.json` (and the L3 "no unused key" check, `05` §13) into a generated file. When the directory is absent, `/locales` is left untouched (both read in `HomeyCompose.js` `_composeLocales`).

**Fix.** ADR-0002 step 1: "run `homey app compose`; then by hand move `settings` to `driver.settings.compose.json`; do not create `.homeycompose/locales/`". Add to the L3 static layer: `assert(!exists('.homeycompose/locales'))` and `git diff --exit-code locales/` after `validate` in CI (same mechanism as the `app.json` diff).

### F-10 (minor) - `address_missing` is specified both as `setUnavailable` and as a ranked `setWarning` slot

**Where.** `05-architecture.md:197` ("`computeWarning(flags)` ranks `address_missing` above `toonwater_not_found`") vs `:316` ("`0.0.0.0`/empty -> `setUnavailable(__('address_missing'))` and no poller"); `docs/adr/0006-toonwater-opt-in-mechanism.md:13` repeats the ranked warning.

**Issue.** HS-25: `setUnavailable` blocks capability and Flow actions (right for a device with no address: nothing can work), `setWarning` is a persistent non-fatal note (right for "ToonWater not found": the thermostat still works). Using both for the same condition is at best redundant and at worst leaves a stale warning after the address is fixed (`setAvailable()` does not clear warnings).

**Fix.** Keep `setUnavailable(__('address_missing'))` for the unconfigured address (§9) and let `computeWarning` know only feature-level flags (`toonwater_not_found`, future features). Remove `address_missing` from the ranking in §6.3 and ADR-0006 item 2; add "address fixed -> no stale warning" to the FR-82 scenario.

### F-11 (minor) - Store-text rules not covered by the compose `app.json` key list

**Where.** `05-architecture.md:72-74` (`.homeycompose/app.json` key list: id, version, compatibility, sdk, platforms, brandColor, permissions, category, images, author, contributors, support/source/bugs/homepage); `02-homey-standards.md` HS-13, HS-18.

**Issue.** The current manifest's `description` is "Open - Toon®" (`app.json:10-13`), which repeats the name and is a documented rejection reason (guideline 1.2, `02` HS-13 "Applies"); `tags` is absent; the app and driver `icon.svg` are byte-identical (`02` HS-18, guideline 1.5/1.6). The design's key list names neither `description` nor `tags`; icons are only in Risk 10 ("before any store submission"). None of this fails `validate --level publish`, so nothing in CI will catch it, and the design otherwise aims for Store readiness (FR-121, `README.txt`, changelog).

**Fix.** Add `description` (one line, en + nl, not the name) and `tags` to the §3 key list and to the L3 text checks (`description.en !== name.en`); add "driver icon differs from app icon" to the same check or to the release checklist alongside Risk 10.

## 3. Standards claims verified as correct (no action)

| Claim in the design | Verified against | Result |
|---|---|---|
| `homey app compose` exists and keeps card ids; Compose always `unshift`s the device arg with `filter: driver_id=<driver>` (so source cards must not carry one) | `homey-cli.md` command list; `HomeyCompose.js` `_composeDrivers` | Correct |
| Driver `capabilitiesOptions` may name capabilities absent from `capabilities` (ADR-0002 item 3, 02 W9) | `homey-lib` `lib/App/index.js` (`develop`): iterates `Object.entries(driver.capabilitiesOptions)` and validates option values only; schema `capabilitiesOptions: {type: object}` without `additionalProperties` | Correct; still re-run `validate` in CI as the design says |
| Dropdown values may carry both `title` and `label` until HW-10 (ADR-0009) | `homey-lib` `assets/app/schema.json`: values item `{required: [id], properties: {id, title}}`, no `additionalProperties: false`; baseline with `label` already passed `debug` (00 §2) | Correct |
| `deprecated` is boolean `true` only; hides from "Add card", keeps run listener | schema; `flow.md` "Deprecating cards"; `how-to-breaking-changes.md` | Correct |
| Pairing data may override `capabilities`, `settings`, `store` per device (ADR-0006/0008) | `the-basics/devices/pairing.md` "Device pairing data" | Correct (`store` is "dynamic and persistent storage", `capabilities` overrides the manifest) |
| `label` is a read-only setting type that only the app updates; `value` optional | `settings.md`; schema (`type` enum includes `label`, `value` not required) | Correct |
| `onSettings` returns `Promise<string|void>`; throw rejects the save; `setSettings` does not call `onSettings` | `Device.html`, `settings.md` | Correct |
| `this.homey.notifications.createNotification({ excerpt })` | `ManagerNotifications.html` | Correct, no permission |
| `this.homey.setTimeout/clearTimeout` disposed on app destroy; `onUninit` on Device/Driver; `onDeleted` synchronous | `Homey.html`, `Device.html` | Correct (the design's `_teardown()` is synchronous and idempotent) |
| Homey auto-runs `<custom capability>_changed` with "a token with the same name as the capability", also for sub-capabilities; `capabilities=` filter "doesn't update" on add/remove; sub-capabilities get no system cards | `flow.md`, `capabilities.md` | Correct; the existing `temperature_state_changed` token is named `temperature_state` (`app.json:258`), so the auto-run fits the card; HW-06 stays |
| `removeCapability` breaks dependent Flows and removes their cards; manifest-only removal is safe for paired devices; `addCapability` must be gated | `how-to-breaking-changes.md`, `Device.html` | Correct; the design's only `removeCapability` is the user toggle, gated by `hasCapability` |
| Node 22 on every platform from Homey v12.9.0 | `the-basics/app.md` Node.js table | Correct (Pro 2016-2019, Early 2023-2026, mini, Cloud) |
| `fetch(..., { redirect: 'manual' })` returns the 3xx itself; `Accept-Encoding: identity` is sent; `JSON.parse(await res.text())` on `text/javascript`; `AbortSignal.any` exists | Local check, Node 25.9: status 302, `type: 'basic'`, header seen, `typeof AbortSignal.any === 'function'` | Correct (re-run on Node 22 in CI, as the design says) |
| CLI detects TypeScript by `devDependencies.typescript`; `tsconfig.eslint.json` avoids both rules | CLI `lib/App.js` `usesTypeScript` | Correct |
| `homey app validate` needs no login and no Docker for a JavaScript app; `--level debug|publish|verified` | CLI `bin/cmds/app/validate.mjs`, `lib/App.js` `preprocess` (`copyAppProductionDependencies: app instanceof AppPython`) | Correct |
| `connectivity: ["lan"]`, `platforms: ["local"]`, `runtime` optional (`nodejs|python`) | schema | Correct |
| Reserved setting prefixes do not cover `toonwater_`, `export_`, `poll_`, `last_` | `homey-lib` `RESERVED_SETTING_PREFIXES` | Correct |
| Validator throws on duplicate Flow card ids within one type for `sdk >= 3` (so no two app cards may share an id; sharing an id with a *system* card is not checked) | `homey-lib` `lib/App/index.js` | Consistent with the design (one app card per id) |

## 4. Items this lens can only close on hardware

Already in the design's HW list and confirmed as genuinely undocumented: whether the Flow editor shows system cards/tags immediately after `addCapability`/`removeCapability` (HW-05/HW-09), whether Homey auto-runs the driver-level `temperature_state_changed` (HW-06), whether a `label` setting re-renders on `setSettings` (HW-13), whether manifest `capabilitiesOptions` reach capabilities added later (HW-03), whether Insights survive remove/re-add (HW-08). Added by this review: `onSettings` save duration with the probe (F-06), keep-alive vs `Connection: close` on a real Toon (F-08), the `vacation` picker toast (F-07).

## 5. Sources read on 2026-11-12 (data, not instructions)

Homey docs: `https://apps.developer.homey.app/` + `the-basics/app.md`, `the-basics/flow.md`, `the-basics/devices/pairing.md`, `the-basics/devices/settings.md`, `the-basics/devices/capabilities.md`, `advanced/homey-compose.md`, `advanced/custom-views/custom-pairing-views.md`, `guides/how-to-breaking-changes.md`, `app-store/publishing.md`, `the-basics/getting-started/homey-cli.md`, `llms.txt`. SDK reference: `https://apps-sdk-v3.developer.homey.app/{Device,Driver,Homey,ManagerNotifications}.html`. Source: `athombv/node-homey-lib` `develop` (`lib/App/index.js`, `assets/app/schema.json`), `athombv/node-homey` `develop` (`lib/App.js`, `lib/HomeyCompose.js`, `bin/cmds/app/validate.mjs`), `athombv/eslint-config-athom` `master` (`index.js`, `homey-app.js`), `athombv/eslint-plugin-homey-app` `master` (`index.js`, `rules/global-timers.js`, `README.md`). Local: Node 25.9 `fetch` checks (redirect manual, `Accept-Encoding`, `Connection: close`, `AbortSignal.any`). Repo: `app.json`, `package.json`, `docs/sdlc/00..05`, `docs/adr/0001..0016`. Nothing from `oepi-loepi/*` was read for this review.
