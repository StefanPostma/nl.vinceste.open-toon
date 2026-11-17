# ADR-0004: `compatibility >=12.9.0`, version 2.0.0, `platforms` and `connectivity`

* Status: accepted (2026-11-12); owner to confirm the floor (OQ-04)
* Related: `05-architecture.md` §11; HS-01, HS-14, HS-15; `04-compat-contract.md` §9, R-26, R-31; CD-5

## Context

`app.json:4` says `>=5.0.0`, which allows Node 12/16/18 runtimes (no stable `fetch`, no `AbortSignal.any`). From Homey v12.9.0 every platform (Pro 2016-2019, Pro Early 2023, Pro mini) runs apps on Node 22 (HS-01). The CLI scaffold writes `>=12.4.0`; the energy manifest keys need `>=12.3.0` (HS-14). The version string `1.0.0` is shared by three different builds (eras 1-3, 04 rule 2) and Homey never downgrades. Homey Cloud/Bridge has no LAN access (HS-15). The app is sideloaded (store URL 404).

## Decision

* `.homeycompose/app.json`: `"compatibility": ">=12.9.0"`, `"version": "2.0.0"`, `"sdk": 3`, `"platforms": ["local"]`, `"brandColor"` set, `"permissions": []`.
* Driver: `"platforms": ["local"]`, `"connectivity": ["lan"]`.
* `package.json` `engines.node >=22`; code uses no API newer than Node 22 (CI runs tests on Node 22).
* No separate "installable again" hotfix release at `>=5.0.0` (audit §4 plan): one release, 2.0.0.
* A one-line patched baseline (`[[resume_program]]` added) is tagged only as a **test artefact** for HW-12 (upgrade-over-baseline), never published (OQ-15).
* Release note: install with `homey app install` on the Homey that holds the devices, never `homey app run` (uninstalls on Ctrl+C) and never `--clean`; Homeys below 12.9.0 keep the old build.

## Consequences

* One runtime, built-in `fetch`, future energy keys available without a second floor bump.
* Users on firmware < 12.9.0 cannot take 2.0.0 (no evidence of any such user exists; stated in the changelog).
* Alternative rejected: `>=5.0.0` with `node:http` and Node-12-safe syntax (two runtimes to test, no `fetch`), or a two-release plan (double work for an unproven audience).
