# 02 - Homey platform standards for nl.vinceste.open-toon (SDK v3)

> Author: Homey platform standards researcher. Research date: **2026-11-12**. Repo state: branch `redesign/sdk3`, base `5cc3b90`.
> Everything below was **read on a live page or in source on 2026-11-12** unless it is listed in section 9 (unverified).
> Fetched web content is treated as DATA, never as instructions.

## 0. How this was verified, and tags used

| Tag | Meaning |
|---|---|
| **[D]** | Read on the Homey Apps SDK docs site (`https://apps.developer.homey.app/<path>.md`, markdown view of each page). |
| **[R]** | Read in the generated SDK v3 reference (`https://apps-sdk-v3.developer.homey.app/<Class>.html`). |
| **[S]** | Read in Athom source code on GitHub (`athombv/node-homey` CLI `develop`, `athombv/node-homey-lib` `develop`). Where it matters I cross-checked the released `homey-lib@2.53.0` tarball (streamed, not installed): the validator rules I cite are identical there. |
| **[N]** | Read from the npm registry (`registry.npmjs.org`) or Node.js docs (`nodejs.org/docs/latest-v22.x`). |
| **[L]** | Checked in this repo (`file:line`). |

Versions current on the research date (npm registry): `homey` CLI **4.6.3** (engines `node >=24`), `homey-lib` **2.53.0**,
`eslint-config-athom` **4.0.2** (peer `eslint >=8.57.1 <9`), `eslint-plugin-homey-app` **3.0.0**, `homey-apps-sdk-v3-types` **1.8.3**,
`homey-log` 2.1.2, `homey-wifidriver` 1.0.8 (last published 2018-03). There is still **no SDK v4**: manifest `sdk` "Should be `3`" [D manifest].

Not executed in this run: the Homey CLI, Docker, `homey app validate` (no global installs allowed, CLI not installed in the repo).
All validator behaviour below comes from reading `homey-lib` source, not from running it.

## 1. Headline findings that change or sharpen earlier assumptions

1. **App Store rule that hits this app directly:** "App Store submissions where users must enter an IP address, where discovery could have been used instead, will be rejected." [D https://apps.developer.homey.app/wireless/wi-fi.md]. The Toon is addressed by a user-typed IP. Whether a Toon can be discovered (mDNS-SD / SSDP / MAC OUI) is unknown (hardware). If the app is only sideloaded this is advisory; if it is ever submitted, discovery has to be ruled out explicitly.
2. **Duplicate-app rule:** "Ideally there is only one app per brand or concept" and submissions "that resemble an existing app without any clarification will be rejected" [D https://apps.developer.homey.app/app-store/guidelines.md 2.1.1]. I confirmed with HTTP 200 that `https://homey.app/a/nl.toonwater.toonwater` exists (page title "toonWater", tagline "Krijg volledig inzicht in je waterverbruik") and `nl.eneco.toon` exists, while `nl.vinceste.open-toon` returns 404 (not published).
3. **Flow-card capability filter does not follow dynamic capabilities.** The docs say about `$filter` `capabilities=`: "(note that calls to `addCapability` and `removeCapability` don't update this filter)" [D https://apps.developer.homey.app/the-basics/flow.md, "Flow Card Device filters"]. This is the central constraint for "ToonWater off => no water cards": see section 8.
4. **`removeCapability` deletes the Flow cards of that capability and breaks Flows that use them** [D https://apps.developer.homey.app/guides/how-to-breaking-changes.md]. The same page says the safe way to retire a capability is to remove it from the manifest only (already-paired devices keep it).
5. **Homey auto-fires triggers for custom capabilities**: "For custom capabilities with the type number, enum or string Homey will automatically run Flow triggers with ID `<capability_id>_changed`" (booleans: `_true`/`_false`) [D flow.md "Custom capability changed"]. The app's custom enum capability `temperature_state` already has a trigger `temperature_state_changed` (app.json:252). Firing it manually as well may double-fire. Needs a hardware check.
6. **The CLI needs Node >=24** (docs and npm `engines`), but apps run on **Node 22** since Homey v12.9.0. The dev machine has Node 25.9: tooling is fine, app code must stay Node-22-safe.
7. **TypeScript detection quirk:** the CLI source treats an app as TypeScript when `package.json` `devDependencies.typescript` exists (`lib/App.js usesTypeScript`), while the docs say a `tsconfig.json` triggers it. If `typescript` is added as a devDependency of this JS app, `homey app build/run` would call `tsc` and demand `outDir ./.homeybuild`. Do **not** add `typescript` to the app's own devDependencies.
8. **`homey app validate` needs no Docker for a JavaScript app** (source: `bin/cmds/app/validate.mjs` only copies production dependencies when the app is Python), although the CLI docs' troubleshooting list says validate requires Docker. `homey app run` and `homey app install` do need Docker (or `--remote`) on Homey Pro (Early 2023) and newer.
9. **The validator already rejects the current manifest at every level** because `titleFormatted` must contain every non-device argument exactly once, in every language (`homey-lib lib/App/index.js _checkTitleFormatted`, no level gate). This confirms the audit finding at `app.json:388-391` (missing `[[resume_program]]`).
10. **Dropdown value key in Flow args:** current docs and schema use `title` for `values[]` (`{ "id": "5", "title": {...} }`) [D arguments.md; S assets/app/schema.json], while the repo uses the older `label` (app.json:329, 336 ...). The same docs' older example in flow.md still shows `label`. Unknown whether the Homey UI still renders `label`: see section 9.

## 2. Toolchain, runtime, repository hygiene

**HS-01 Runtime is Node 22; CLI is Node >=24.** Since Homey v12.9.0 all platforms run apps on Node.js v22 [D https://apps.developer.homey.app/the-basics/app.md#nodejs]. The CLI requires "Node.js v24 or higher" and Docker for `run`/`install` [D https://apps.developer.homey.app/the-basics/getting-started.md; N https://registry.npmjs.org/homey/latest].
*Applies:* write CommonJS with only Node-22 features; CI must test on Node 22 (and may add 24). Dev machine is Node 25.9, so never rely on anything newer than 22. `package.json` should say `"engines": {"node": ">=22"}` for the app code.

**HS-02 Use built-in `fetch`.** "The built-in `fetch` is the preferred approach for new code"; node-fetch has keep-alive `ECONNRESET` problems on Node >=19 [D https://apps.developer.homey.app/upgrade-guides/node-22.md]. `fetch`, `AbortSignal.timeout(delay)` and `node:test` (Stability 2 Stable, with `mock.timers`) exist in Node 22 [N https://nodejs.org/docs/latest-v22.x/api/globals.html, https://nodejs.org/docs/latest-v22.x/api/test.html].
*Applies:* replace `request-promise-native` (not even declared in package.json, device.js:4) with `fetch(url, {signal: AbortSignal.timeout(5000)})`; test runner can be dependency-free `node --test`.

**HS-03 No native add-ons; keep runtime dependencies at zero.** "Using npm packages that contain native addons ... is discouraged" [D app.md#native-dependencies]. The CLI copies only **production** dependencies from the **local** `node_modules` (`npm ls` based) into `.homeybuild/` and overwrites `node_modules/homey` with a shim that re-exports the runtime module [S node-homey lib/App.js `_copyAppProductionDependencies`, assets/homey/index.js].
*Applies:* drop `homey-log` and `homey-wifidriver` (both pre-v3, 2018-era); after that `node_modules/` (1,880 tracked files [L `git ls-files`]) can be untracked. Unit tests must stub `require('homey')` because it only resolves inside the Homey runtime/CLI build.

**HS-04 `.homeyignore` and default pack rules.** The packer ignores `.*`, `.homeybuild`, `*.{ts,mts,cts}`, `tsconfig.json`, `env.json`, `*.compose.json`, `node_modules`; everything else in the app folder ships unless listed in `/.homeyignore` (gitignore syntax) [D app.md#homey-ignore; S lib/App.js `_getAppSourceFiles`].
*Applies:* `docs/`, `test/`, `*.md` research, mock servers and fixtures would be packed into the app; add a `.homeyignore` (e.g. `docs/`, `test/`, `scripts/`, `CONTRIBUTING.md`).

**HS-05 `.gitignore`.** The CLI scaffold writes `/env.json`, `/node_modules/`, `/.homeybuild/`; `homey app build/run/validate` adds `/.homeybuild/` automatically if a `.gitignore` exists [S lib/App.js `create`, `preprocess`]. Note `validate` also builds into `.homeybuild/`.
*Applies:* repo has no `.gitignore` [L]; add one before the first `validate` run, and exclude `.homeybuild/` from lint and tests.

**HS-06 Linting = ESLint 8 + eslint-config-athom (legacy eslintrc).** The CLI installs `eslint@~8.57.1` and `eslint-config-athom@~4.0.2`, writes `.eslintrc.json` = `{"extends":"athom/homey-app"}` and the script `eslint --ext .js,.ts --ignore-path .gitignore .` [S lib/App.js `create`]. The package has peer `eslint >=8.57.1 <9` and its `homey-app` config sets `parserOptions.project: ./tsconfig.json`, `@typescript-eslint/no-floating-promises: error`, `no-misused-promises: error`, plus `homey-app/global-timers` (use `this.homey.setTimeout`) and `homey-app/homey-log` (use `this.log`, not `console.*`) [N https://registry.npmjs.org/eslint-config-athom/latest; S https://raw.githubusercontent.com/athombv/eslint-config-athom/master/homey-app.js; https://raw.githubusercontent.com/athombv/eslint-plugin-homey-app/master/README.md].
*Applies:* use ESLint 8.57.x (not 9/10 flat config) as a devDependency, `@types/homey@npm:homey-apps-sdk-v3-types` and a `tsconfig.json` containing `{"compilerOptions":{"allowJs":true,"outDir":".homeybuild/"}}` (what `homey app add-types` writes [S]). The `no-floating-promises` rule enforces HS-34 mechanically. Install with `npm install --ignore-scripts` (repo rule). Do not add `typescript` yourself (finding 7).

**HS-07 CI = validate on every push/PR.** The CLI template workflow is `actions/checkout@v4` + `athombv/github-action-homey-app-validate@master` with `level: verified`; sibling templates `homey-app-version.yml` and `homey-app-publish.yml` need a `HOMEY_PAT` secret [S node-homey assets/templates/app/.github/workflows/*; D https://apps.developer.homey.app/app-store/publishing.md#automating-within-github-actions]. The action is a Docker action (`node:lts-alpine`, entrypoint `npx homey app validate --level $1`), last pushed 2024-08-15 [S https://raw.githubusercontent.com/athombv/github-action-homey-app-validate/master/Dockerfile].
*Applies:* replace the dead `codeql-analysis.yml`. Because the CLI now needs Node >=24 and the action image is `node:lts-alpine` (unverified which Node that resolves to today), prefer our own job: `actions/setup-node` (24), `npm ci --ignore-scripts`, `npx homey app validate --level publish`, `npm run lint`, `npm test`; keep the Athom action as an optional second job. `level: verified` is stricter than needed for sideloading but cheap to track.

**HS-08 Dependabot.** `package-ecosystem` must be a real value such as `npm` or `github-actions` [N https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/configuring-dependabot-version-updates, https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference]. Applies: `.github/dependabot.yml:8` has `""` and never ran [L].

## 3. Project layout, Homey Compose, manifest

**HS-10 Canonical layout.** `.homeycompose/app.json`, `assets/{icon.svg,images/{small,large,xlarge}.png}`, `drivers/<id>/{assets/,device.js,driver.js,driver.compose.json}`, `locales/{en,nl}.json`, `settings/index.html` (app settings, optional), `api.js`, `app.js`, generated `app.json`, `env.json` (never committed), `README.txt` [D https://apps.developer.homey.app/the-basics/app.md].
*Applies:* repo is flat (`app.json` hand-written, no `.homeycompose/`), no `README.txt`, no `xlarge` images [L].

**HS-11 `app.json` is generated; edit compose sources only.** "you should never manually edit [app.json]" [D app.md#app-manifest]. The CLI writes it with a `_comment` header on every `run/build/validate/publish` via `HomeyCompose.buildIfUsed` [S lib/HomeyCompose.js, lib/App.js `create`/`preprocess`]. The CLI scaffold's `.gitignore` does not exclude the generated `app.json`, so it is tracked in git.
*Applies:* migrate with `homey app compose` (existing files preserved [D homey-cli.md]) or by hand; commit the generated `app.json` so plain-node tools (tests, lint, mocks) can read the manifest without Docker.

**HS-12 Compose file map.** `.homeycompose/app.json`; `.homeycompose/capabilities/<id>.json`; `.homeycompose/flow/{triggers,conditions,actions}/<id>.json`; `.homeycompose/drivers/{templates,settings,flow}`; `.homeycompose/locales/<lang>.json`; per driver `driver.compose.json`, `driver.flow.compose.json` (object `{triggers,conditions,actions}`), `driver.settings.compose.json` (array), and `driver.pair.compose.json` (pair views); templates via `"$extends"` [D https://apps.developer.homey.app/advanced/homey-compose.md; S lib/HomeyCompose.js header and `_composeDrivers`].
*Applies:* the 14 Flow cards in `app.json` (5 triggers, 2 conditions, 7 actions) all carry `{type:device, name:device, filter:"driver_id=open-toon"}`; in compose they move into `drivers/open-toon/driver.flow.compose.json` where Compose **adds the device arg itself**: it unshifts `{type:'device', name: card.$deviceName||'device', filter:'driver_id=<driverId>[&<$filter>]'}` [S lib/HomeyCompose.js ~L424-436]. So the `device` arg must be **removed** from the source cards (otherwise it would be duplicated), and card IDs/arg names are unchanged. App-level (non-device) cards stay in `.homeycompose/flow/`. The settings array moves to `driver.settings.compose.json`; the custom capability `temperature_state` to `.homeycompose/capabilities/temperature_state.json`.

**HS-13 Manifest keys an app of this kind needs.** `id` (reverse-domain), `version` (semver, no pre-release), `compatibility`, `runtime: "nodejs"`, `platforms`, `sdk: 3`, `brandColor` (must not be too bright, icons render white), `name`, `description` (one-liner, translation objects), `category` (one of `lights video music appliances security climate tools internet localization energy`), `tags`, `images` (`small`,`large`, optional `xlarge`), `permissions`, `author.name` (required) [D https://apps.developer.homey.app/the-basics/app/manifest.md]. Optional: `contributors.{developers,translators}[].name`, `contributing.donate`, `bugs.url`, `homeyCommunityTopicId`, `source` (https), `homepage` (https), `support` (https or `mailto:`; mandatory for Verified Developers) [same page].
*Applies:* current manifest lacks `brandColor`, `runtime`, `platforms`, `tags`, `bugs/source/support`; description "Open - Toon®" repeats the name, which guideline 1.2 forbids [D guidelines.md 1.2]; `category: climate` is valid [L app.json:29]. Credit contributors in `contributors`, not in README (guideline 1.3.2).

**HS-14 `compatibility` is a deliberate decision.** Docs: "Use at least `>=5.0.0`". The CLI scaffold writes `>=12.4.0` [S lib/App.js `create`]. Feature gates enforced by the validator or documented: Node 22 runtime `>=12.9.0`; enum `capabilitiesOptions.values` `>=12.0.1`; `energy.cumulativeImportedCapability/ExportedCapability` `>=12.3.0`; `meterPowerImported/ExportedCapability` `>=12.4.5`; `Device#setLastSeenAt` `>=12.6.1`; multiselect arg `>=12.5.0`; `capabilitiesOptions.uiState` `>=13.5.0`; `titleShort` `>=13.2.1` [D capabilities.md, energy.md, Device.html; S lib/App/index.js L148-260].
*Applies:* choose `>=12.9.0` for the v3-native release (guarantees Node 22 and the energy keys); `>=5.0.0` keeps Node 12/16 runtimes alive and blocks `fetch`/`?.`-style code (audit item app.json:4).

**HS-15 `platforms` and `connectivity`.** `"platforms": ["local"]` on the app and driver; driver `"connectivity": ["lan"]`. Homey Cloud (Bridge) has no LAN access and the validator throws if a `cloud` driver lists `lan`/`rf868`/`matter` [D https://apps.developer.homey.app/guides/homey-cloud.md; S lib/App/index.js L576-580]. Cloud also needs Verified Developer status.
*Applies:* set both; Open-Toon can never target Homey Cloud.

**HS-16 Validation levels (exact rules).**

| Level | Rules (from `homey-lib` 2.53.0 source) |
|---|---|
| `debug` | manifest schema; Flow-card `titleFormatted` consistency (HS-17); reserved setting-id prefixes (S L999); compatibility gates; pair-view files and `navigation` targets exist. `images` (and their files), `brandColor`, `category` are optional. |
| `publish` | adds: `category`, app `images` (+ files, correct PNG/JPG magic, sizes), driver `images`, `brandColor` (not too bright). Required to publish to the Store. |
| `verified` | adds: app `platforms`, `support`, driver `platforms` and `connectivity`, `titleFormatted` on every Flow card that has non-device args, and `title` on every such arg. Applied automatically when the account is a Verified Developer. |

[D https://apps.developer.homey.app/app-store/publishing.md#requirements; S https://raw.githubusercontent.com/athombv/node-homey-lib/develop/lib/App/index.js L105-130, L290-296, L353, L540-553, L953-966, L1155-1215; confirmed in the 2.53.0 tarball]. Warnings (not errors): `energy.cumulative` without `cumulativeImportedCapability`/`cumulativeExportedCapability` when a `meter_power` capability exists; duplicate Flow card IDs; token without `type` [S L601-606, L878, L1155].
*Applies:* target `publish` in CI; track `verified` as a stretch because it is cheap (add arg `title`s, `platforms`, `connectivity`, `support`).

**HS-17 `titleFormatted` is validated at every level.** Every non-device argument must appear as `[[name]]` exactly once in every language of `titleFormatted`; `droptoken` counts as an argument named `droptoken`; the first device arg that has a `driver_id` filter is excluded [S lib/App/index.js `_checkTitleFormatted`, L1155-1215].
*Applies:* `set_temperature_state` misses `[[resume_program]]` (app.json:388-391) which breaks `debug`; `temperature_state_is` nl contains the invalid `!{{is||is niet}}` (app.json:314). `titleFormatted` for `!{{a|b}}` inversion uses single pipes [D flow.md].

**HS-18 Images and icons.** App images: 250x175, 500x350 (xlarge 1000x700); driver images: 75x75, 500x500 (xlarge 1000x1000); PNG or JPG; paths are checked case-sensitively [S lib/App/index.js L53-59, `_fileExistsCaseSensitive`; D guidelines.md 1.4]. Icons: `assets/icon.svg` and `drivers/<id>/assets/icon.svg`, 960x960 canvas, transparent background, vector line style; **do not reuse the app icon for a driver**; driver image on white background, not the app image [D guidelines.md 1.4-1.6].
*Applies:* sizes in the repo are correct [L `file`], but `assets/icon.svg` and `drivers/open-toon/assets/icon.svg` are byte-identical (`cmp`) and are Illustrator exports with a 538x346 viewBox: violates 1.5/1.6 if ever submitted. The app image `large.png` is RGB (not RGBA); fine.

**HS-19 Permissions.** Only request what the core feature needs; "Most Homey Apps don't need any permissions"; LAN access needs none [D https://apps.developer.homey.app/the-basics/app/permissions.md, wi-fi.md; guidelines 1.15].
*Applies:* `"permissions": []`. Never `homey:manager:api`.

## 4. Lifecycle, timers, errors, i18n

**HS-20 Init order (SDK v3).** `App#onInit` first, then for each driver `Driver#onInit` followed by its devices' `Device#onInit`. The App cannot call `this.homey.drivers.getDriver()` in `onInit` [D https://apps.developer.homey.app/upgrade-guides/upgrading-to-sdk-v3.md]. `Device#ready()` / `Driver#ready()` resolve after their `onInit` [R Device.html, Driver.html]. Constructors may not be overridden [R].
*Applies:* register Flow listeners in `Driver#onInit`; in `Device#onInit` start polling **without awaiting network** (a slow Toon must not delay init).

**HS-21 Hooks to implement.** Device: `onInit`, `onAdded`, `onSettings({oldSettings,newSettings,changedKeys})` (throw to reject; returned string is shown to the user), `onRenamed`, `onDeleted`, `onUninit`; Driver: `onInit`, `onPair(session)`, `onPairListDevices()`, `onRepair(session, device)`, `onUninit`; App: `onInit`, `onUninit` [R Device.html, Driver.html, App.html; D devices/settings.md]. `Device#setSettings()` does **not** call `onSettings` [R, D settings.md]. There is no `Driver#mapDeviceClass`; the real hook is `onMapDeviceClass(device)` and is only needed to pick a class [R Driver.html].
*Applies:* delete `mapDeviceClass()` (driver.js:69-71); `onDeleted` + `onUninit` must clear the poll timer; do not call `super.onDeleted()` of a removed library.

**HS-22 Timers via `this.homey`.** Use `this.homey.setTimeout/setInterval/clearTimeout/clearInterval`; they are disposed when the app is destroyed. `this.homey.on('unload', ...)` is the alternative [R Homey.html; D upgrade-guides/upgrading-to-sdk-v3.md "ManagerCron removal"; D guides/homey-cloud.md#clearing-timers]. Lint rule `homey-app/global-timers` enforces it (HS-06).
*Applies:* self-rescheduling `this.homey.setTimeout` chain with an in-flight guard (no `setInterval`); the existing global `setTimeout` in `debounce` (device.js:583) goes away.

**HS-23 Unhandled promise rejections must not exist.** "On Homey Cloud unhandled promise rejections will cause the app to crash ... also coming to Homey Pro in the near future." Add `.catch(this.error)` to every un-awaited promise such as `setCapabilityValue` [D https://apps.developer.homey.app/guides/homey-cloud.md#unhandled-promise-rejections].
*Applies:* device.js has ~15 un-awaited `setCapabilityValue` calls and one targeting a capability that is not in the driver (`meter_power`, device.js:377) [audit; L]. Test harness assertion: zero unhandled rejections per scenario.

**HS-24 Logging.** `this.log` / `this.error` exist on App, Driver, Device (and `Homey`); do not use `console.*` [R App.html, Homey.html; S eslint-plugin-homey-app]. `homey-log` (Sentry) v2 is SDK v3 only, needs `new Log({homey: this.homey})` and a Sentry URL in `env.json` [S https://raw.githubusercontent.com/athombv/node-homey-log/master/README.md].
*Applies:* app.js requires `homey-log` v1 and never uses it (app.js:4); remove. Do not log credentials; the Toon needs none.

**HS-25 Availability and warnings.** `setUnavailable(message?)` / `setAvailable()` (promises). "When a device is marked as unavailable, all capabilities and Flow actions will be prevented" [D https://apps.developer.homey.app/the-basics/devices.md#availability]. `setWarning(message|null)` shows a persistent, non-fatal warning; `unsetWarning()` clears it; `setLastSeenAt()` (Homey >=12.6.1) records liveness [R Device.html]. With Discovery, Homey manages availability itself [D wireless/wi-fi/discovery.md].
*Applies:* thermostat unreachable after N failed polls: `setUnavailable(this.homey.__('offline'))`, keep polling, `setAvailable()` on success. ToonWater add-on missing/404 while enabled: **warning**, never unavailable (the thermostat still works). Call `setLastSeenAt` only if compatibility is >=12.6.1.

**HS-26 i18n.** Strings live in `/locales/<lang>.json`; `this.homey.__('a.b', {name})` with `__name__` placeholders; fall back to `en`; manifest strings are translation objects (`{en, nl}`); in views use `Homey.__()` and `data-i18n`; `en` is mandatory; a partially translated app is a rejection reason (1.11); typos cause rejection [D https://apps.developer.homey.app/the-basics/app/internationalization.md; guidelines.md 1.11]. Supported codes: en nl de fr it sv no es da ru pl ko ar. README can be translated as `README.nl.txt`.
*Applies:* every user-visible string in en **and** nl including capability titles, settings labels/hints, Flow titles/hints/tokens, pair view, error messages. Current en.json has typos and Dutch text ("IP adres") [audit]. Temperature: always Celsius; units `"°C"` enable Fahrenheit conversion.

**HS-27 No module-level mutable state; timezone is UTC.** "define all variables as properties on your App, Driver or Device instances" and the default `TZ` is `UTC` in SDK v3; use `await this.homey.clock.getTimezone()` for local time [D upgrade-guides/upgrading-to-sdk-v3.md].
*Applies:* "water today" resets at the Toon's local midnight; never derive day boundaries from `new Date()` getters. Use the Toon's own `value`.

**HS-28 CPU/memory watchdog.** `Homey` emits `cpuwarn`/`memwarn`; "when the app does not behave within reasonable amount of time, the app is killed" [R Homey.html].
*Applies:* poll loop must not stack requests (in-flight guard), responses are tiny JSON; no unbounded buffers.

## 5. Capabilities, settings, energy

**HS-30 Adding a capability to paired devices.** Put it in the driver manifest **and** migrate existing devices with `if (!this.hasCapability(id)) await this.addCapability(id)`; "do not call addCapability on every init!"; `addCapability` is "expensive" [D https://apps.developer.homey.app/guides/how-to-breaking-changes.md; R Device.html].
*Applies:* audit B-finding: legacy devices lack the water capabilities and `alarm_water.hotwater`. Generic "ensure manifest capabilities" must be gated, and must **exclude water unless ToonWater is enabled** (section 8).

**HS-31 Removing a capability.** Preferred: remove it from the manifest only; `removeCapability` "is expensive", breaks Flows depending on it and removes its built-in Flow cards [D breaking-changes.md; R Device.html]. Never remove the listener of a retired capability [D same].
*Applies:* automatic removal on app update is forbidden by the stability contract. The only legitimate `removeCapability` call is the user switching ToonWater off in device settings, with a warning in the setting hint and in the `onSettings` return message.

**HS-32 Never rename or retype capability / Flow IDs.** "Publishing breaking changes is in general not allowed." Deprecate Flow cards with `"deprecated": true` (hidden from new Flows, still run); keep their run listeners; deprecate a driver only as a last resort [D breaking-changes.md; flow.md#deprecating-cards].
*Applies:* matches repo stability contract. Candidates for `deprecated: true`: custom `meter_gas_changed` and `measure_water_changed` (collide with system capability trigger IDs, audit).

**HS-33 Custom capabilities.** Defined in `.homeycompose/capabilities/<id>.json`: `type`, `title`, `getable`, `setable`, `uiComponent`, `units`, `min`/`max`/`step`/`decimals`, and for `enum` a `values: [{id, title}]` array; adding an enum value is additive [D capabilities.md#custom-capabilities].
*Applies:* add `vacation` to `temperature_state` as an additive value; keep `none`; capability listener must tolerate values it cannot map instead of writing `undefined` (audit H:S4).

**HS-34 Capability options live in the driver.** `capabilitiesOptions`: `title` (max 2-3 words), `preventInsights`, `preventTag`, number `units/decimals/min/max/step`, enum `values` (needs `>=12.0.1`); `Device#setCapabilityOptions` changes them at runtime (expensive) [D capabilities.md#capability-options; R Device.html]. Pairing data may override the driver's `capabilities`, `capabilitiesOptions`, `class`, `icon`, `store`, `settings` per device [D pairing.md#device-pairing-data].
*Applies:* `target_temperature` min 6 / max 30 / step 0.5 stays [L app.json:111-115]. Unknown: whether manifest-level `capabilitiesOptions` titles for sub-capabilities apply to capabilities that were added later with `addCapability` (section 9).

**HS-35 Sub-capabilities.** `cap.suffix` repeats a capability; "Flow Cards will not be automatically generated for sub-capabilities, you should create these cards yourself"; the thermostat tile pairs `target_temperature.x` with `measure_temperature.x` by suffix [D capabilities.md#sub-capabilities, #thermostat].
*Applies:* `meter_power.peak/offPeak`, `meter_water.today/total`, `alarm_water.hotwater` have no automatic cards, which is why the repo defines custom triggers.

**HS-36 System capability semantics and units (do not repurpose).** `meter_power` kWh (decimals 3), `measure_power` W, `meter_gas` m3 (decimals 3), `meter_water` m3 (decimals 3, min 0), `measure_water` L/min, `alarm_water` = "True when water has been detected", `target_temperature` min 4 / max 35 / 1 decimal, `measure_temperature` degC [S node-homey-lib assets/capability/capabilities/*.json].
*Applies:* the current code divides ToonWater litres by 1000 before writing `meter_water.*` (device.js:416-417, `/ 1000.000`), which matches the m3 definition: keep. `Math.trunc` on kWh/m3 makes Insights and Energy coarse (device.js:384,388,398,442): keep 3 decimals. `alarm_water.hotwater` abuses the leak alarm semantics; keep only for compatibility (Homey may show a leak-style alarm).

**HS-37 Device settings.** In `driver.settings.compose.json` (array). Every setting needs `id`, `type`, `label` (driver settings use `label`, app settings use `title`), `value` (initial value is required); types `text` (`pattern` regex), `password`, `textarea`, `number` (`min/max/step/units`), `checkbox` (boolean `value`), `dropdown` (`values[{id,label}]`), `group` (`children`), `label` (read-only); `hint` on any; `highlight: true` surfaces a setting during pairing. Reserved id prefixes: `homey:`, `zw_`, `zb_`, `mtr_`, `thread_`, `zone_`, `energy_`, `satellite_mode_`, `homekit_` [D https://apps.developer.homey.app/the-basics/devices/settings.md; S lib/App/index.js `RESERVED_SETTING_PREFIXES`, assets/app/schema.json driverSettings].
*Applies:* `address` currently has default `0.0.0.0`, no `hint`/`pattern` (app.json:161-168). Add `hint` + a conservative `pattern` (and still validate in `onSettings`, because the pattern is front-end only: unverified), `poll_interval` (`number`, min/max/step, `units`), and `toonwater_enabled` (`checkbox`). `toonwater_*` does not hit a reserved prefix. Keep key `address`.

**HS-38 Energy configuration.** `energy.cumulative: true` marks a whole-home meter; with `meter_power` present the validator warns unless `cumulativeImportedCapability` (and `cumulativeExportedCapability`) point to a `meter_power` instance (`>=12.3.0`); for gas/water meters `cumulative` makes Homey read plain `meter_gas` / `meter_water`; meters "should be positive and continuously increase"; Energy computes differences, so resets lose data [D https://apps.developer.homey.app/the-basics/devices/energy.md; S lib/App/index.js L601-636].
*Applies:* the driver (class `thermostat`) has `energy.cumulative: true` but only sub-capabilities `meter_power.peak/offPeak` and no plain `meter_water`, so Energy sees W and gas only (audit). Two tariffs vs one imported capability is a design decision that needs a real meter to validate.

## 6. Flow cards

**HS-40 Card definition style.** Required `id`, `title`; optional `titleFormatted`, `hint`, `tokens`, `args`, `highlight`, `advanced`, `deprecated`, `platforms`. Titles short, no device names, no "When/And/Then", no parentheses; use `!{{on|off}}` for condition inversion; use `titleFormatted` when args exist; `hint` when the function is not obvious [D https://apps.developer.homey.app/the-basics/flow.md; guidelines.md 1.9].
*Applies:* `hotwater_dispensing` has no `titleFormatted`/`hint` and its nl inversion `!{{wel|niet}}` should be re-read by a Dutch speaker; the `meter_power_changed` token is titled "Wh" while the value is kWh (app.json:212); card titles must not contain parentheses or device names.

**HS-41 Device trigger cards.** In `Driver#onInit`: `this._card = this.homey.flow.getDeviceTriggerCard(id)`; fire with `this._card.trigger(device, tokens, state).catch(this.error)`. Token names/types must match the card definition (`type` required in future) [D flow.md#flow-device-trigger-cards; R FlowCardTriggerDevice; S lib/App/index.js L1155].
*Applies:* none of the 5 triggers is ever fired (audit). Fire only on actual changes. See HS-42 for auto-fired ones. Device triggers must be declared in `driver.flow.compose.json` so they only appear for this driver.

**HS-42 Automatic `<capability>_changed` triggers for custom capabilities.** `setCapabilityValue` on a custom capability makes Homey run triggers with ID `<id>_changed` (number/enum/string) or `<id>_true` / `<id>_false` (boolean), also for sub-capabilities (`<id>.<sub>_changed`); the token with the capability's name receives the value [D flow.md#custom-capability-changed].
*Applies:* `temperature_state_changed` (custom enum) is therefore probably fired by Homey itself; a manual `trigger()` could double-fire. Decide in the design after a hardware observation (section 9, HW-2). System capabilities (`meter_gas`, `measure_water`, `meter_power`) already have built-in `*_changed` cards; the repo's same-ID custom cards duplicate them (audit).

**HS-43 Run listeners.** Conditions resolve `true`/`false` (rejecting stops the Flow); actions reject to report failure; a trigger needs a run listener only when it has arguments, and it receives `(args, state)` and returns whether this Flow should run [D flow.md#listening-for-events, arguments.md#flow-state]. All `registerRunListener` callbacks must be `async` and must not swallow errors.
*Applies:* the four "Update ..." actions resolve even when the Toon is offline (audit): reject with a localised error; keep them (existing Flows).

**HS-44 Flow-card device filters.** `"$filter"` (string or object) supports `class`, `capabilities` (comma = AND, pipe = OR) and `flags`; Compose merges it as `driver_id=<driver>&<filter>`. **Caveat:** "calls to `addCapability` and `removeCapability` don't update this filter" [D flow.md#flow-card-device-filters; S lib/HomeyCompose.js L424-436]. The `device` arg filter string also accepts `capabilities=` [D arguments.md#device].
*Applies:* cannot be relied on, by itself, to hide ToonWater cards after a runtime toggle. See section 8.

**HS-45 Arguments.** Types: `text`, `autocomplete`, `number`, `range`, `date`, `time`, `dropdown`, `multiselect` (`>=12.5.0`), `checkbox`, `color`, `droptoken`, `device`; args may set `required: false`; give every arg a `title` (needed at `verified`); dropdown `values` use `{id, title}` in current docs and schema, `label` is legacy; "Don't overuse arguments ... one or two arguments are the most popular" [D arguments.md; S assets/app/schema.json].
*Applies:* app.json args have no `title`, and use `label` for dropdown values (app.json:329 ...). Converting to `title` is a presentation change only; IDs and arg names stay.

**HS-46 Deprecation.** `"deprecated": true` on a Flow card hides it from the "Add card" list; existing Flows keep working; do not remove the run listener [D flow.md#deprecating-cards, breaking-changes.md].
*Applies:* deprecation is global (not per device), so it cannot implement per-device ToonWater visibility.

## 7. Pairing, repair, App Store listing

**HS-50 Pairing with a custom view uses `PairSession`.** `Driver#onPair(session)` with `session.setHandler(event, async handler)`, `session.showView/nextView/prevView/done/emit`. The front end has `Homey.emit(event, data): Promise`, `Homey.createDevice(device): Promise`, `Homey.done()`, `Homey.alert/confirm`, `Homey.showView/nextView/prevView`, `Homey.getOptions`, `Homey.setTitle/setSubtitle`, `Homey.showLoadingOverlay/hideLoadingOverlay`, `Homey.__()`, `Homey.setNavigationClose()` [D https://apps.developer.homey.app/advanced/custom-views/custom-pairing-views.md; R PairSession.html]. The `Homey` object is global; `Homey.addDevice` does not exist; callbacks survive "for now" but promises are advised [D upgrade-guides/upgrading-to-sdk-v3.md]. Views are `drivers/<id>/pair/<viewId>.html`; `pair` lists the views; the validator checks the file exists (case-sensitive) when no `template` is set and that `navigation.next/prev` point at existing views [S lib/App/index.js L456-500].
*Applies:* `driver.js:9` uses `socket.on` and `start.html:43` uses `Homey.addDevice` (both gone in v3), and the button `#test-connection` is missing from the markup (audit). Device `data` must be unique and immutable ("a MAC address is good, an IP address is bad"); `data.id` stays the user-chosen hostname for compatibility, the IP lives in `settings.address` (editable) [D devices.md#device-identifier].

**HS-51 Use the Homey Style Library in custom views.** Classes: `homey-header/-title/-subtitle`, `homey-form`, `homey-form-fieldset/-legend/-group/-label/-input/-select/-textarea`, `homey-form-checkbox*`, `homey-form-radio*`, `homey-button-primary(-full)`, `-primary-shadow(-full)`, `-secondary-shadow`, `-danger-shadow`, `-transparent`, `-small`, states `.is-disabled` / `.is-loading`; available on Homey Pro since v8.1.0; use logical CSS properties / `:dir(rtl)` for RTL [D https://apps.developer.homey.app/advanced/custom-views/html-and-css-styling.md]. Vanilla JS only; the docs never mention jQuery.
*Applies:* rewrite `start.html` (no jQuery, `Homey.__`, `data-i18n`, test button, ToonWater checkbox, live readings). The existing page uses `$`, `__()`, legacy CSS and Xiaomi copy-paste text (audit).

**HS-52 Repair flow.** A driver can declare `repair` views in the manifest and implement `Driver#onRepair(session, device)`; `Homey.createDevice` is unavailable while repairing [D https://apps.developer.homey.app/the-basics/devices/pairing.md#repairing]. `onRepair` is in the docs and in `homey-apps-sdk-v3-types@1.8.3 lib/Driver.d.ts:103` but is missing from the generated `Driver.html` reference.
*Applies:* nice-to-have to re-enter a changed IP without re-pairing; the Advanced settings page already edits `address`, so repair is optional.

**HS-53 Discovery is preferred over manual IP.** See finding 1. Manifest `discovery` strategies: `mdns-sd`, `ssdp`, `mac`; with a discovery strategy Homey also manages availability [D wireless/wi-fi/discovery.md].
*Applies:* needs a network capture of a Toon (hardware). Until then the IP field stays, with an ADR note.

**HS-54 App Store listing files.** `README.txt` = short plain-text (1-2 paragraphs, no Markdown, no URLs, no changelog, no feature list); translated copies `README.<lang>.txt`; `.homeychangelog.json` = `{"<version>": {"en": "...", "nl": "..."}}`, `publish` demands an `en` entry for the version being published; versions are semver, must be higher than Live, Homey never downgrades; changelog uses Added/Changed/Deprecated/Removed/Fixed/Security [D guidelines.md 1.3; app-store/updates.md; S lib/App.js `publish`].
*Applies:* the README currently holds a Markdown changelog and a disclaimer; replace with `README.txt` + `README.nl.txt`, move history to `.homeychangelog.json`. `homey app version patch|minor|major --changelog.en "..." --changelog.nl "..."` writes both [D homey-cli.md#update-a-homey-apps-version].

**HS-55 Other Store rules that apply if ever submitted.** App name = brand name, no "Homey/Athom", no protocol names, at most 4 words (1.1); free of charge (2.3); do not copy other developers' code without consent and credit them in the manifest (2.1.2); SDK v3 for new apps (1.14); test checklist: controls, advanced settings, custom Flow cards, and "manually adjust device state outside of Homey and verify Homey updates" (3.2); Test URL `https://homey.app/en-us/app/<id>/test/` [D guidelines.md]. `homey app review` runs an AI review against these guidelines using an OpenAI/Anthropic key [D homey-cli.md] (optional, key required, none used here).
*Applies:* the "external changes appear in Homey" check is precisely the missing polling. Code provenance rule dovetails with the repo licence rule for `oepi-loepi/*` (all rights reserved): implement from the interface description only.

## 8. What the standards imply for the opt-in ToonWater feature (constraints, not decisions)

| # | Constraint from the standards | Source |
|---|---|---|
| W1 | Opt-in switch = device setting `toonwater_enabled` (`checkbox`, `value` required, `hint` explains consequences). Also offer it as a checkbox in the custom pair view and pass it into `Homey.createDevice({settings})`. | HS-37, HS-50 |
| W2 | For a **new** device the per-device `capabilities` list in `createDevice` overrides the manifest, so the pair view can omit the water capabilities when ToonWater is off while the manifest keeps the full set. | pairing.md "Device pairing data" |
| W3 | Toggling later = `onSettings` calling `addCapability` / `removeCapability` (guarded by `hasCapability`; both "expensive"). `setSettings` does not call `onSettings`, so migrations that flip the setting programmatically must also reconcile capabilities themselves. | HS-30/31, HS-21 |
| W4 | Switching **off** removes the system-capability Flow cards and breaks Flows that use them (Homey-documented). The hint and the `onSettings` return message must say so. Switching off must be an explicit user action only. | breaking-changes.md |
| W5 | Existing users: never remove water capabilities on update; the migration detects devices that already have `measure_water` / `meter_water.*` / `alarm_water.hotwater` and sets `toonwater_enabled = true` once (store-key guard). New default for fresh pairing = off. | HS-30..32 |
| W6 | Custom water Flow cards (`update_water`, `hotwater_dispensing`, `alarm_water_changed`, `measure_water_changed`) **cannot** be reliably hidden with `$filter capabilities=` after a runtime toggle (docs caveat), and `deprecated` is global. Plan: attach a `capabilities=` filter anyway, but make every water run listener safe on a device where ToonWater is off (reject with a localised "enable ToonWater in device settings" error). Verify on hardware what the editor shows. | HS-44, HS-46 |
| W7 | No `/water.html` request at all when disabled (no 404 noise). When enabled and the add-on answers 404: `setWarning`, back off, never `setUnavailable`. | HS-25 |
| W8 | Keep litres->m3 conversion (system `meter_water` is m3); keep `measure_water` in L/min. | HS-36 |
| W9 | Sub-capability titles come from `capabilitiesOptions`; if water capabilities are removed from the manifest base list and added dynamically, titles may be lost, hence prefer keeping them in the manifest superset and, if needed, `setCapabilityOptions`. | HS-34, section 9 |
| W10 | Duplicate-app rule: a published `toonWater` app exists. Record the reasoning (Open-Toon controls thermostat + meters; ToonWater is an optional add-on reader inside it) if the app is ever submitted. | finding 2 |

## 9. Unverified (could not be confirmed on a live page, or needs hardware/tooling)

1. `$filter capabilities=...` evaluation after `addCapability`/`removeCapability` (docs caveat is one sentence; what the Flow editor shows is unknown). HW-1.
2. Whether Homey auto-fires `temperature_state_changed` (custom enum) and `alarm_water.hotwater_*` (sub-capability of a *system* capability) so that a manual `trigger()` duplicates it. HW-2.
3. Whether already-paired devices receive the `value` default of a **newly added** setting key after an app update (`getSetting` could be `null`). Treat `null` as "unset" until proven. HW-3.
4. Whether Insights history and Energy data survive `removeCapability` followed by `addCapability`. HW-4.
5. Whether manifest `capabilitiesOptions` (titles) apply to capabilities added later by `addCapability`. HW-5.
6. Whether the Homey UI still renders Flow dropdown `values[].label` (legacy) or needs `title`. HW-6.
7. Whether `pattern` on a `text` device setting is enforced in the Homey front end (docs: "make sure the user can only input letters") and how it reports violations; `onSettings` must validate anyway.
8. Whether a Toon can be discovered via mDNS-SD / SSDP / MAC OUI (needed for the "IP entry rejected" rule). HW-7.
9. CLI behaviour was read from `athombv/node-homey` `develop` (latest release tag v4.6.3, 2026-11-09), not executed. Docs say `validate`/`build` need Docker; source says only for Python apps. TypeScript detection: docs (tsconfig.json) vs source (`devDependencies.typescript`). Treat the source as likely but confirm by running the CLI once it is installed as a devDependency.
10. Whether `athombv/github-action-homey-app-validate@master` (Docker image `node:lts-alpine`, last push 2024-08-15) still works with a CLI that requires Node >=24.
11. `Driver#onRepair`: documented in pairing.md and present in types 1.8.3, but absent from the generated `Driver.html` reference.
12. Runtime behaviour of the Homey Pro on `homey app run` against a mock Toon on the LAN (Docker network mode `host` may be needed for LAN access from the container [D homey-cli.md `--network`]). HW-8.
13. Whether the Store would accept the name "Open-Toon®" (brand/trademark question, guideline 1.1) and the SVG icons (1.5/1.6). Not determinable offline.
14. `homey app review` output quality: not run (needs an API key).
15. Whether `.homeychangelog.json` and `README.txt` are packed by default although dotfiles are ignored (`.*` rule): the CLI reads the changelog at publish; packing behaviour for `.homeychangelog.json` not confirmed.

### Hardware-only checks to feed the test plan (referenced above)

HW-1 water card visibility with ToonWater on/off (Flow editor, per device). HW-2 trigger double-fire on `temperature_state` change. HW-3 default of a new setting key on an upgraded device. HW-4 Insights/Energy continuity across remove/add. HW-5 sub-capability titles after dynamic add. HW-6 dropdown `label` vs `title` rendering. HW-7 Toon discovery by mDNS/SSDP/MAC. HW-8 `homey app run` against the mock Toon (Docker `--network host`) and then against a real Toon. Anything not listed here (parsers, poll loop, error handling, availability logic, manifest validity, i18n completeness, `onSettings` flow) can and must be verified against mocks and `homey-lib` validation.

## 10. Sources actually read (2026-11-12)

Docs (`.md` views): `https://apps.developer.homey.app/` + `readme`, `llms.txt`, `the-basics/getting-started`, `the-basics/getting-started/homey-cli`, `the-basics/app`, `the-basics/app/manifest`, `the-basics/app/internationalization`, `the-basics/app/permissions`, `the-basics/devices`, `the-basics/devices/pairing`, `the-basics/devices/capabilities`, `the-basics/devices/energy`, `the-basics/devices/settings`, `the-basics/flow`, `the-basics/flow/arguments`, `advanced/homey-compose`, `advanced/custom-views/custom-pairing-views`, `advanced/custom-views/html-and-css-styling`, `advanced/custom-views/app-settings`, `wireless/wi-fi`, `wireless/wi-fi/discovery`, `guides/homey-cloud`, `guides/how-to-breaking-changes`, `guides/tools`, `guides/tools/typescript`, `upgrade-guides/node-22`, `upgrade-guides/upgrading-to-sdk-v3`, `app-store/guidelines`, `app-store/publishing`, `app-store/updates`.
SDK reference: `https://apps-sdk-v3.developer.homey.app/{Device,Driver,App,Homey,ManagerFlow,FlowCardTriggerDevice,PairSession}.html`.
Source: `athombv/node-homey` (`lib/App.js`, `lib/HomeyCompose.js`, `bin/cmds/app/validate.mjs`, `assets/templates/app/**`, `assets/homey/**`), `athombv/node-homey-lib` (`lib/App/index.js`, `assets/app/schema.json`, `assets/capability/capabilities/*.json`, `assets/device/classes/thermostat.json`), `athombv/eslint-config-athom`, `athombv/eslint-plugin-homey-app`, `athombv/github-action-homey-app-validate`, `athombv/node-homey-log`; npm tarballs `homey-lib@2.53.0`, `homey-apps-sdk-v3-types@1.8.3` (streamed, not extracted).
Other: `https://nodejs.org/docs/latest-v22.x/api/{globals,test}.html`, GitHub Dependabot docs (two pages), `https://homey.app/a/{nl.toonwater.toonwater,nl.vinceste.open-toon,nl.eneco.toon}`.
Nothing from `oepi-loepi/*` was read for this document.
