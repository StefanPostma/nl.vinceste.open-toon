# 14 - Homey App Store readiness (Open-Toon 2.0.0)

| | |
|---|---|
| Date | 2026-11-17 |
| Question | Issue #3 (2019) asked for a listing in the Homey App Store; it was declined because the app was "almost the same as the original". Can 2.0.0 be listed? |
| Answer | In principle yes: the reason of 2019 no longer holds and the technical checks pass. **Do not submit for certification yet**: icons, image rights, the duplicate-app rule and real-Toon testing are open (section 3) |
| Sources | The App Store guidelines as shipped in the devDependency `homey-lib` (`lib/AIReviewer/data/guidelines.md`, synced 2026-06-29; canonical text at apps.developer.homey.app/app-store/guidelines), the publishing page apps.developer.homey.app/app-store/publishing, the store pages of the two other Toon apps, and the files of this repository |
| Status | Written by the assistant from those sources. Nothing was published or submitted |

---

## 1. What is in the store today (checked 2026-11-17)

| App | Developer | Version | Last update | What it is |
|---|---|---|---|---|
| **Toon** (`nl.eneco.toon`) | Athom B.V. | 3.2.0 | about 2 years ago | The official app: needs a Homey Bridge and the Toon cloud; thermostat, energy, gas. Homey Pro, Homey Cloud, mini and Self-Hosted Server |
| **toonWater** (`nl.toonwater.toonwater`) | Rob van Oostveen (oepi-loepi on GitHub) | 1.1.30 | about 3 years ago | Water meter via the ToonWater add-on, plus temperature drivers and a **toonThermostat** driver. Homey Pro, mini and Self-Hosted Server, not Homey Cloud |
| `nl.vinceste.open-toon` | - | - | - | Not in the store (the store page returns 404) |

Open-Toon is different from the official app in its approach (local network, a rooted Toon, no cloud), and it overlaps with toonWater (thermostat, water).

## 2. The reason of 2019 and why it no longer applies

Issue #3 was closed with: it is almost the same app as the original, and the fork should stay close to the original so that Athom's new features can be taken over. In 2.0.0 the app is a rewrite on SDK 3 with its own architecture (`docs/sdlc/05-architecture.md`), and the original repository `athombv/nl.eneco.toon` is no longer public (GitHub returns 404 for it; it may be deleted or private, and only `athombv/nl.eneco.toon-example` remains visible).

## 3. The guidelines against this repository

Status: **OK** passes today, **WARN** may be flagged, **BLOCKER** is likely to be rejected.

| Rule | Status | Finding | Action |
|---|---|---|---|
| 1.1 App name | WARN | `Open-Toon®` carries the registered-trademark sign of a mark that is not ours; "Toon" is a third-party brand. Length, protocol names and "Homey"/"Athom" are fine | Consider the name `Open Toon` without the sign (keep the disclaimer in the README); the owner decides |
| 1.2 Description | OK | One line, does not repeat the readme | - |
| 1.3 Readme | OK | `README.txt` is 184 words in 2 paragraphs (`README.nl.txt` 172), no links, no markdown, no changelog. **Buy Me a Coffee may not appear in the store text** | The README.md of GitHub keeps the button. For a donation link in the store use `contributing.donate` in the manifest, which supports only `githubSponsors`, `bunq`, `patreon` and `paypal` |
| 1.4 Images | WARN | Sizes are right (app 250x175 and 500x350, driver 75x75 and 500x500; the optional 1000 px versions are absent). **Both pictures show an Eneco-branded Toon screen (Eneco logo, Dutch interface)**, probably inherited from the original app. The driver image has a white background as the guidelines want | Confirm the right to use them, or replace them with neutral pictures |
| 1.5 App icon, 1.6 driver icon | **BLOCKER** | `assets/icon.svg` and `drivers/open-toon/assets/icon.svg` are the **same file**. It is a wide drawing (538 x 346, not the 960 x 960 canvas) with a "Toon®" wordmark inside. The guidelines say: do not re-use the app icon for drivers, use the full 960 x 960 canvas, transparent background | Make two separate icons (the app icon and a driver icon of the device seen from the right) on a 960 x 960 canvas |
| 1.7 Brand colour | OK | `#E5532D`, set by the assistant (not taken from an official source) | Check that the new icons are clearly visible on it; the owner confirms the colour |
| 1.8 URLs | OK | support, source, homepage and bugs are set | - |
| 1.9 Flow cards | OK | No parentheses, no device names, no When/And/Then in any title (checked in `app.json`) | - |
| 1.11 Language | OK | English and Dutch for everything; typo checks run in the tests | A spelling error is a rejection reason: proofread once more before submitting |
| 1.12 Dependencies | OK | Works standalone; ToonWater is optional | - |
| 1.13 Account | CHECK | The manifest author is "Vinceste IT" | The name of the Athom developer account must not contain emojis or special characters |
| 1.14 SDK, 1.15 Permissions | OK | SDK 3; `permissions` is empty | - |
| 2.1.1 Duplicate apps | **BLOCKER** until handled | toonWater has a thermostat driver and water readings; the official app covers Toon thermostats. The rule: check for similar apps, **contact the existing developer first and explore collaboration**; a submission that resembles an existing app without clarification is rejected | Reply to oepi-loepi (done 2026-11-17, section 5); in the submission explain the difference with both apps (local and rooted, no cloud, no Homey Bridge) |
| 2.1.2 Code | OK | No code was copied from unlicensed repositories (`docs/sdlc/03-reuse-inventory.md`, section 13; a test checks the provenance header); contributors are credited in `app.json` | Keep asking for consent where in doubt; oepi-loepi's answer on the feature name "ToonWater" is part of the reply |
| 2.3 Compensation | OK | Free of charge | - |
| 3.2 Testing | **BLOCKER** | The app ran on a Homey Self-Hosted Server with a **simulated** Toon (`13-self-hosted-test-report.md`), never on a real Toon. The guidelines expect thorough tests of controls, settings, Flows, pairing and error messages | Run `10-hardware-test-plan.md` on the owner's Toons first |
| 3.4 Removal | OK | Maintained (no update gap) | - |

Also passing: `homey app validate --level publish` and `--level verified`.

## 4. The publishing path (from the publishing page)

1. `homey app validate --level publish` (passes today; the verified level passes too).
2. `homey app publish` from the app folder, with the owner's Athom login: this creates a **draft** in the developer dashboard (tools.developer.homey.app, Apps SDK, My Apps).
3. Release the draft to the **Test** channel: available only through the private Test link of the dashboard. This is the place for real-Toon tests and for testers, for example the people of issue #3.
4. Submit for **certification by Athom** (the guidelines say up to 2 weeks; findings are expected to be implemented).
5. After approval the app is published to the App Store.

The publishing page does not say whether a developer account type or verified status is required, how LAN-only apps are treated, or what it costs; check in the dashboard.

## 5. Contact with the other developer

* **2026-11-17**: a reply was posted on issue #22 (in Dutch) to oepi-loepi's offer of 2023, and edited the same day: thanks and an apology for the delay, what 2.0.0 contains, that only field names and units were taken from his work and credits are given, that an App Store listing is only a possibility ("eventueel") and not a decision, that only a simulated Toon was used because the owner has no working Toon on the wall at the moment, and three questions: collaborate on one app or keep two apps with a clear split, whether the feature may be called "ToonWater", and whether he would test 2.0.0 against his own setup (a Toon with ToonWater; install with `homey app install`, optionally first the read-only `scripts/toon-probe.js`).
* No answer yet. A private mail (his address is in his public comment on that issue) is optional.

## 6. Decisions for the owner

1. The app name: with or without the registered-trademark sign.
2. Icons and pictures: who makes them, and the rights to Eneco-branded pictures.
3. A donation link in the store: PayPal, GitHub Sponsors, Patreon or bunq through `contributing.donate`, or none (Buy Me a Coffee is not supported there).
4. One shared app with oepi-loepi or two apps, depending on his answer.
5. Who tests on real Toons, and when (the Test channel can carry that).
