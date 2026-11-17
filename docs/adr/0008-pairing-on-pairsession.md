# ADR-0008: Pairing on `PairSession` with a live connection test and a detected-only ToonWater checkbox

* Status: accepted (2026-11-12); answers OQ-03, OQ-12; **revised rev 3 (2026-11-13)**: `capabilitiesOptions` passed for every capability the new device holds, not only for a ticked trio (review finding C-03); rev 2 (2026-11-12): `capabilitiesOptions` passed for a ticked trio (compat issue 4), `store.toonwaterDecidedBy: 'user'` (ADR-0018), input hardening and `textContent` in the view (R-11). Revision log: `docs/sdlc/archive/05b-design-revision-log.md`
* Related: `05-architecture.md` §7; FR-01..05, FR-61; HS-50, HS-51, HS-53; `04` C-ID-3, C-ID-4, R-28, §7.6

## Context

`driver.js:8-23` uses the SDK v2 `socket.on` API and `testConnection` is a stub (shadows `data` with `"test toon"`, real call commented out). `pair/start.html` depends on jQuery, calls the non-existent `Homey.addDevice` (`:43`), lacks the `#test-connection` button and contains Xiaomi copy-paste text. New devices must keep `data: {id: <user-typed string>}` and `settings.address` (C-ID-3). Pairing data may override the driver's `capabilities`, `settings` and `store` per device ([D] pairing.md "Device pairing data"). The App Store rejects manual IP entry where discovery could have been used (02 finding 1); whether a Toon is discoverable is unknown.

## Decision

* `Driver#onPair(session)` registers `testConnection({address})` and `buildDevice({name, id, address, features})` via `session.setHandler`.
* `testConnection`: `normalizeAddress` (localized error, no request on empty/invalid) -> thermostat endpoint (5 s) -> requires `currentTemp` and `currentSetpoint` (else `error.not_toon`; HTTP 404/500 -> `error.http` with the status; timeout -> `error.timeout` within 6 s) -> each optional feature's `probe` with its own budget (a probe failure never fails the test). Returns `{host, readings: {currentTemp, currentSetpoint, programState, activeState}, features: {toonwater: 'detected'|'not_found'|'unknown'}}`.
* Both handlers `typeof`-check every field first (`address`, `id`, `name` must be strings, `features` an object) and reject with a localized error otherwise; the view can send non-strings and `id.trim()` on a number would throw.
* `buildDevice` -> pure `buildNewDevice()`: `{name: name || id, data: {id: id.trim()}, settings: {address: host, poll_interval: 30, toonwater_enabled, export_enabled: false}, store: {migrationVersion: 1, toonwaterDecidedBy: 'user'}, capabilities: capabilitiesFor(state), capabilitiesOptions: <the manifest options of every optional capability in that list>}`; empty id rejected. Passing `capabilitiesOptions` is the documented pairing override (HS-34) and gives a ticked water trio its titles ("Water today", "Water meter total") without relying on Core resolving options for a capability that is no longer in `driver.capabilities` (HW-03 extension).
* `start.html`: vanilla JS, Homey Style Library classes, `Homey.__`/`data-i18n`, promise forms of `Homey.emit` and `Homey.createDevice`, `Homey.done`. Fields: address, Toon id, name (default = id), Test button, readings panel (Toon-supplied strings written with `textContent`, never `innerHTML`), and an **unticked** "Enable ToonWater" checkbox shown only when the probe returned `detected` (a 404 shows nothing). Connect is disabled until a test passed and again when the address changes. `createDevice` errors (duplicate id) are shown inline. `https://` and IPv6 addresses get their own messages (ADR-0003).
* Not done: mDNS/SSDP discovery (needs a network capture, HW-7 of 02; sideload only today) and a `repair` view (`address` is editable in settings).

## Consequences

* Pairing works on SDK v3 and is testable: the two handlers are plain async functions exercised in L2 scenarios with the mock Toon; the view is statically checked for the allowed `Homey.*` API.
* New devices start with the right capability set and the migration marker, so `onInit` reconciliation is a no-op.
* Hardware: end-to-end in web and mobile, duplicate-id message, light/dark rendering (HW-01).
