# ADR-0002: Adopt Homey Compose and the `lib/{toon,features,engine,flow}` layout

* Status: accepted (2026-11-12); **revised rev 2 (2026-11-12)** after the standards review (F-05, F-09, F-11, R-21): what `homey app compose` does and does not write, no `.homeycompose/locales/`, `tsconfig.eslint.json` in `.homeyignore`, `description`/`tags`, outbound-module rule. Revision log: `docs/sdlc/archive/05b-design-revision-log.md`
* Related: `05-architecture.md` §2-3; `02-homey-standards.md` HS-10, HS-11, HS-12, HS-04, HS-05, HS-13, HS-18; `04-compat-contract.md` R-33; ADR-0012, ADR-0017

## Context

The repo is flat: a hand-written `app.json` (542 lines), no `.homeycompose/`, no `.gitignore`, no `.homeyignore`. Homey documents Compose as the layout and says `app.json` "should never be manually edited" (HS-11). The CLI's `homey app compose` migrates mechanically and keeps Flow card ids; Compose re-adds the `device` argument with `driver_id=open-toon` (HS-12). Candidate A deferred Compose; B and C adopted it.

## Decision

1. Run `homey app compose` once. Verified in the CLI source (`lib/App.js` `migrateToCompose`, standards review 2026-11-12): it writes `.homeycompose/app.json`, `.homeycompose/capabilities/<id>.json`, `.homeycompose/flow/<type>/<id>.json`, `drivers/<id>/driver.compose.json` and `driver.flow.compose.json` (device-arg cards moved there and the `device` arg stripped, which Compose re-adds). It does **not** write `driver.settings.compose.json`, `driver.pair.compose.json` or `.homeycompose/locales/`. Then, **by hand**: move the driver `settings` block to `drivers/open-toon/driver.settings.compose.json` (a file name Compose reads, `HomeyCompose.js`), add `.homeycompose/capabilities/burner_state.json` and the `vacation` value, and maintain only the compose sources from then on. **Never create `.homeycompose/locales/`**: when it exists, Compose deep-merges it into `/locales/<lang>.json` on every `validate`/`build` with the compose side winning, which would turn the hand-maintained locale files (and the L3 unused-key check) into generated files; when absent, `/locales` is left untouched (`HomeyCompose.js` `_composeLocales`). An L3 test asserts the directory does not exist and CI runs `git diff --exit-code locales/` after `validate`.
2. The generated `app.json` is committed; CI runs `homey app validate` and then `git diff --exit-code app.json locales/`.
3. Driver `capabilities` = the 9 `CORE` ids; `capabilitiesOptions` stays the superset (core + water + export titles) so titles survive a later `addCapability` (02 W9; the validator checks option values only - re-verified by the CI validate run). The three water ids leaving the list is a recorded contract exception (ADR-0017).
4. `.homeycompose/app.json` carries, besides id/version/compatibility/sdk/platforms/brandColor/permissions/category/images/author/contributors/support/source/bugs/homepage, a one-line `description` in en + nl that is **not** the name (the baseline's "Open - Toon®" repeats the name, a documented Store rejection reason, HS-13) and `tags` (en + nl). L3 checks `description !== name` and non-empty `tags` (ADR-0012).
5. Code layout: `drivers/open-toon/{driver,device}.js` are thin hooks; `lib/toon/*` (Toon interface: client, errors, address, parse, meters, commands), `lib/features/*` (data per feature), `lib/engine/*` (capabilities, poller, apply, pairing), `lib/flow/cards.js`, `lib/messages.js`. Only `app.js` and `drivers/**` may `require('homey')`; only `driver.js` references `globalThis.fetch`; no module under `lib/**` or `drivers/**` requires `http`, `https`, `net`, `dns`, `undici`, `child_process`, `dgram` or `tls` (nor their `node:` forms); no global timers in `app.js`, `drivers/**` or `lib/**` (bare or member form).
6. Add `.gitignore` (`node_modules/`, `.homeybuild/`, `env.json`), `.homeyignore` (`docs/`, `test/`, `scripts/`, `*.md`, `.github/`, **`tsconfig.eslint.json`** - the CLI's default ignore list covers `tsconfig.json` but not this deliberately non-standard name, so without the entry it would be packed into the installed app), `.homeychangelog.json`, `README.txt`, `README.nl.txt`.

## Consequences

* Manifest edits are small, reviewable files; validator feedback is immediate in CI.
* Tests can read `app.json` without the CLI.
* The layering rule is machine-checked (test/static/layering.test.js), so the Toon interface, the engine and the Homey glue cannot grow back into one 600-line file, and no outbound path other than the injected `fetch` can appear (NFR-15).
* The shipped bundle is listed after `homey app build` in CI and must contain only `app.js`, `app.json`, `drivers/`, `lib/`, `locales/`, `assets/`, `package.json`, `package-lock.json`, `LICENSE`, `README*.txt` (ADR-0012).
* Alternative rejected: keep the flat `app.json` and adopt Compose "later" (candidate A): a second migration of the same files, and a documented standards deviation in the meantime.
