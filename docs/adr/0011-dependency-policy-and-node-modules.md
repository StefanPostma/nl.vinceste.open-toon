# ADR-0011: Zero runtime dependencies, dev tooling only, untrack the committed `node_modules`

* Status: accepted (2026-11-12); **revised rev 2 (2026-11-12)** after the standards review (F-02, F-05): `@types/homey` required, `tsconfig.eslint.json` in `.homeyignore`, bundle listing in CI. Revision log: `docs/sdlc/archive/05b-design-revision-log.md`
* Related: `05-architecture.md` §10; NFR-01 AC2, NFR-05, NFR-13; HS-03, HS-04, HS-05, HS-06, HS-08; `03` §8, J8, J10, J11, J16, J17; issue #22, Dependabot PRs #31-#33; ADR-0012

## Context

`package.json` declares `homey-log ^1.0.6` (SDK v2 only, never instantiated) and `homey-wifidriver ^1.0.8` (2018; nothing of it is used; its `onDeleted` throws). `request-promise-native` is used but undeclared. 1,880 of ~1,900 tracked files are `node_modules`; there is no `.gitignore` or `.homeyignore`; the lockfile is v1; `dependabot.yml` has an invalid empty `package-ecosystem`; every open Dependabot PR touches packages that hang off `homey-wifidriver`. The Homey CLI copies production dependencies from the local `node_modules` and never runs `npm install` (HS-03). Native add-ons are discouraged.

## Decision

* `dependencies: {}`. A runtime dependency may be added only by an accepted ADR. No native add-ons.
* `devDependencies` (installed with `npm install --ignore-scripts` / `npm ci --ignore-scripts`): `homey` (`~4.6.3`), `eslint` (`~8.57.1`), `eslint-config-athom` (`~4.0.2`), **`@types/homey` (`npm:homey-apps-sdk-v3-types@^1.8.3`, required - rev 2)** and `@types/node`. The SDK declarations are not optional: without them `require('homey')` has no type on a dev machine, `Homey.Device` methods are `any`, and `@typescript-eslint/no-floating-promises` silently ignores exactly the `setCapabilityValue`/`setSettings`/`addCapability`/`card.trigger` calls NFR-01 AC2 is about (ADR-0012; the L3 lint canary proves the rule is live). Never `typescript` directly (the CLI would switch the app to TypeScript mode; `eslint-config-athom` brings its own). No test framework or HTTP mocking library: `node:test`, `node:assert`, `node:http`.
* `package.json`: `name nl.vinceste.open-toon`, `version 2.0.0`, `license GPL-3.0`, `repository`/`bugs`/`homepage` -> `StefanPostma/nl.vinceste.open-toon`, `engines.node >=22`, scripts `lint`, `validate`, `test`, `check:*`.
* `.gitignore`: `node_modules/`, `.homeybuild/`, `env.json`. `.homeyignore`: `docs/`, `test/`, `scripts/`, `*.md`, `.github/`, `tsconfig.eslint.json` (rev 2: the CLI's default ignore list - `.*`, `.homeybuild`, `*.{ts,mts,cts}`, `tsconfig.json`, `env.json`, `*.compose.json`, `node_modules` - does not cover the non-standard name, so it would ship inside the app). CI lists the built bundle and fails on anything outside the app's own files (ADR-0012), so "the shipped app contains only its own code" is checked, not assumed.
* `node_modules/` is removed from tracking in the release commit (`git rm -r --cached node_modules`), performed by the owner when committing (this run makes no git operations). `package-lock.json` is regenerated (lockfile v3).
* `.github/dependabot.yml`: `package-ecosystem: npm` and `github-actions`, weekly. PRs #31-#33 are closed as obsolete after the release.

## Consequences

* The shipped app contains only its own code; `npm ls --omit=dev` lists nothing; `npm audit --omit=dev` is empty.
* The repo shrinks by ~1,880 files; contributors run `npm ci --ignore-scripts` once for tooling.
* Dev-tool licence mismatches (`homey-lib`, `eslint-plugin-homey-app`: ISC on npm, GPL-3.0 on GitHub) are noted; they are never shipped. `homey-api` (proprietary) is not used.
