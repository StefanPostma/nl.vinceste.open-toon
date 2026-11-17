# Contributing to Open-Toon®

Thanks for helping. This is a small project for people who run a Toon with the open software; a good change is a small one that comes with a test. The app is licensed GPL-3.0, and so is everything you contribute.

## Set up

* Node.js 22 for the app and the tests (`nvm use` reads `.nvmrc`). The Homey command line tool, a development dependency, needs Node.js 24 or newer for `npm run validate` and `npm run pack:check`; CI runs those on Node 24.
* `npm ci --ignore-scripts` installs the tooling. The app itself has no runtime dependencies and must not get any: a new one needs an accepted decision record in `docs/adr/`.
* No global installs, no `sudo`.
* `node_modules/` is never committed. `.gitignore` lists it, and Dependabot only updates the tooling (`package.json`, the lockfile and the GitHub workflow). Do not add a dependency by copying its files into the repository either.

## The development loop

1. Create a branch from `Develop`.
2. Make the change, and write or change its test first when you can. A test file sits next to the layer it proves: `test/unit` (pure functions, the client), `test/scenario` (a whole device or driver against the mock Toon), `test/static` (the manifest, the texts, the layering rules).
3. Run the test you are working on while you work, for example `node --require ./test/helpers/register.cjs --test test/unit/parse.test.js`, then `npm test` and `npm run lint`.
4. When you touched the manifest or a text: `npm run validate`. The first run may rewrite `app.json` or `locales/`; run it a second time, review the diff and commit the result.
5. Try it on a Homey only when the change needs it. `npx homey app run` runs the app on the Homey you selected with `npx homey select`; stopping it with Ctrl+C uninstalls the app, and with it the devices. Use a test Homey, or `npx homey app install` for a lasting install, and never add `--clean` on a Homey whose devices you want to keep. Put `OPEN_TOON_DEBUG` set to `1` in an `env.json` file (not committed) to log the raw answers of the Toon.
6. Before you open a pull request, run all the checks below.

## Checks

| Command | What it does |
|---|---|
| `npm run lint` | ESLint with the Athom config; a warning fails it |
| `npm test` | all tests, offline, in under a minute |
| `npm run test:coverage` | the same, and at least 90 % of the lines of `lib/` must be covered |
| `npm run validate` | `homey app validate --level publish`; fails when `app.json` or `locales/` differ from what the CLI composed |
| `npm run pack:check` | builds the app and fails when anything but the app's own files ends up in the package |
| `npm run check:requirements` | every requirement that mocks can verify is named by a test title |

CI runs all of them for every push and pull request.

## Tests

* Everything runs offline against a mock Toon (`test/helpers/mock-toon.js`), a strict fake Homey (`test/helpers/fake-homey/`) and a fake clock. There is no Toon and no Homey in the loop, and no test touches the network.
* Test titles start with the id of the requirement they prove (for example `FR-52 AC1: ...`), and `npm run check:requirements` fails when a requirement has no test. A test that depends on how a real Toon or Homey behaves says so with its hardware id (`[HW-07]`); the open hardware items are listed in section 10 of `docs/sdlc/08-test-report.md`.
* The Toon answers in `test/fixtures/toon/` are derived from descriptions, not captured, and say so in their `source` field. If you have a real answer, add it as a new fixture with the personal details removed (names, addresses, serial numbers), and say which Toon it came from.
* A new feature is data in `lib/features/`, not a change of the engine. A test registers a synthetic feature to prove that the engine needs no edit; keep it passing.
* The tests of the fake Homey encode our reading of the Homey documentation. When real hardware disagrees, fix the fake and the code together and note it in the hardware report.

## Where things are

* `lib/toon` talks to the Toon (client, parsers, commands, errors and their user texts), `lib/features` describes what a feature adds (data only), `lib/engine` runs polling, migration, pairing and the optional features, `lib/flow` holds the Flow cards. `drivers/open-toon` and `app.js` are thin glue to Homey. `lib/` has at most 16 files of at most 250 lines each; a test enforces that. `docs/ARCHITECTURE.md` explains the whole.
* The manifest comes from Homey Compose: edit `.homeycompose/` and the `drivers/open-toon/*.compose.json` files, never `app.json`, then run `npm run validate` and commit the regenerated `app.json`. Never create `.homeycompose/locales/`; `locales/*.json` are edited by hand.
* `docs/adr/` holds the decisions, `docs/sdlc/` the requirements, the research, the plans and the test and release reports (`docs/sdlc/archive/` keeps the rejected design candidates and the design reviews of the redesign).
* `scripts/toon-probe.js` is a read-only look at a real Toon (the same four requests as the app, personal data masked, one JSON file as result). It is a test-bench tool, not part of the app: `.homeyignore` leaves `scripts/` out of the package. `docs/sdlc/10-hardware-test-plan.md` is the plan for the checks that only a real Homey and Toon can settle, and says how to use the probe for them.

## Decisions (ADRs)

Write a decision record in `docs/adr/` when a change:

* adds a runtime dependency, changes the Node.js or Homey floor, or changes how the app is built or tested;
* changes anything an existing user relies on: a capability id, a Flow card id or argument name, the driver id, `data.id` or a setting key (see the next section);
* adds or changes an optional feature, the polling schedule or the way a device is migrated;
* departs from a requirement of `docs/sdlc/01-requirements.md`.

How: copy the shape of an existing record, number it with the next free number (`docs/adr/0019-short-title.md`), and use the headings Status (accepted or proposed, with the date), Related, Context, Decision and Consequences, with the alternatives you rejected. Add a row to the ADR index at the end of `docs/sdlc/05-architecture.md`. A decision that replaces an older one says so in its status line and the older one gets a pointer to it; do not rewrite history. A deliberate deviation from the contract with existing users also goes in `test/fixtures/contract-exceptions.json` with the number of its ADR; a test checks that the ADR exists.

## Rules

* Every text that a user can read exists in English and in Dutch (`locales/` and the manifest). Proofread both: the App Store rejects an app with typos.
* Existing users come first: capability ids, Flow card ids and argument names, the driver id, `data.id` and setting keys do not change without a decision record that also migrates them. `test/static/contract.test.js` checks this against the manifest of the release before the redesign (`test/fixtures/baseline-app.json`).
* Every promise is awaited or handled; use `this.homey.setTimeout`, never a global timer; log with `this.log` and `this.error`, never `console`.
* ToonWater is written from its interface (the page it serves, the field names and their units). Do not copy or closely paraphrase code from repositories that carry no licence, and read them, if at all, only to learn that interface; record where an interface description came from.
* Only the Toon's own address is ever contacted. No telemetry, no update check.

## Release

1. Choose the version: `npx homey app version <patch|minor|major> --changelog.en "..." --changelog.nl "..."` updates `.homeycompose/app.json` and `app.json` and writes `.homeychangelog.json`. It does not touch `package.json`: run `npm version <the same version> --no-git-tag-version --ignore-scripts` so that `package.json` and the lockfile agree (a test checks that). The version is plain `MAJOR.MINOR.PATCH` and higher than any build that was ever installed, because Homey never downgrades an app.
2. Check the texts of the release: `README.md` (both languages), `README.txt` and `README.nl.txt` (one or two paragraphs, plain text, no URL, no changelog), the changelog in both languages, and the release notes in `docs/sdlc/`.
3. Run the six checks above on Node 22 (lint and tests) and Node 24 (validate and pack).
4. Once, for the release that moves the project to this layout: take `node_modules/` out of git with `git rm -r --cached node_modules`. `.gitignore` already lists it, and the tooling comes back with `npm ci --ignore-scripts`. Close the Dependabot pull requests that only touch the old dependencies; they are obsolete.
5. Run the hardware test plan on a real Homey before you tag; the mocks cannot answer what only a real Toon or Homey can.
6. Install on the Homey that holds the devices with `npx homey app install`, never with `homey app run` or `--clean`.

## Issues and pull requests

Say what you wanted to do, what happened, which Toon and Homey (model, firmware) and which version of the app. For a meter that stays empty, attach the answer of `http://<IP address of your Toon>/hdrv_zwave?action=getDevices.json` with personal details removed. Keep a pull request to one change, rebased on `Develop`, with its tests and, where a user can see it, both languages.
