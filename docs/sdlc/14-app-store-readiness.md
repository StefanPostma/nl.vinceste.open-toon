# 14 - Homey App Store readiness (Open-Toon 2.0.0)

Date: 2026-11-17. Based on the App Store guidelines and the publishing page of the Homey developer documentation, and on the store pages of two other Toon apps.

**Answer:** issue #3 (2019) asked for a store listing and was declined because the app was "almost the same as the original". 2.0.0 is a rewrite (local, no cloud), so that reason no longer applies. It can go in, but it should **not** be submitted yet: the four points below would likely get it rejected.

Two Toon apps are already in the store: Athom's official **Toon** (cloud, needs a Homey Bridge) and **toonWater** (water meter plus a thermostat driver).

## Fix before submitting

1. **Icons (rules 1.5, 1.6).** The app icon and the driver icon are the same file, a wide drawing with a "Toon®" wordmark. They need to be two separate icons on a 960 x 960 transparent canvas.
2. **Images.** Both pictures show an Eneco-branded screen (logo, Dutch interface). Confirm the right to use them, or replace them.
3. **Duplicate apps (rule 2.1.1).** The store asks to contact the developer of a similar app first. toonWater overlaps (thermostat, water). A reply to its developer was posted on issue #22 on 2026-11-17; no answer yet.
4. **Testing (rule 3.2).** Only a simulated Toon was used so far, because the owner has no working Toon on the wall at the moment. Run `10-hardware-test-plan.md` on real Toons.

## Smaller points

* **Name:** `Open-Toon®` claims a registered trademark that is not ours. Consider `Open Toon`.
* **Donation link:** the store text may not contain links, so Buy Me a Coffee stays in `README.md` only. The manifest field `contributing.donate` supports only GitHub Sponsors, bunq, Patreon and PayPal.
* **Account:** the Athom developer account name must not contain emojis or special characters.

Everything else in the guidelines passes today (SDK 3, no permissions, brand colour, URLs, a two-paragraph readme without links, English and Dutch, Flow titles, validation at `publish` and `verified` level).

## Publishing path

`homey app publish` creates a draft. Release it to the **Test** channel (reachable only through a private link, which suits real-Toon testing), then submit it for certification by Athom (up to 2 weeks). After approval it goes live. Nothing has been published or submitted.

## Decisions for the owner

1. The app name, with or without the trademark sign.
2. Who makes the icons and pictures.
3. A donation link in the store (PayPal, GitHub Sponsors, Patreon or bunq), or none.
4. One shared app with the toonWater developer, or two apps, depending on his answer.
5. Who tests on real Toons, and when.
