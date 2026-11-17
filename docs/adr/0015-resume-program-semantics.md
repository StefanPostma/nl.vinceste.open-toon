# ADR-0015: `resume_program` request table (`yes` verified by a third party, `no` placeholder pending hardware)

* Status: accepted with a hardware gate (2026-11-12); settles CD-7 provisionally
* Related: `05-architecture.md` §14; FR-13, FR-14; `03` I3, I4, §11; `04` R-18, B-4, B-6; HW-04 (01), H5 (03)

## Context

`set_temperature_state` has a `resume_program` dropdown (`yes` = "Resume program afterwards", `no` = "Disable program"), but `device.js:198-226` ignores it and always sends `changeSchemeState&state=2&temperatureState=<id>`. Since the 2023 builds `titleFormatted` omitted `[[resume_program]]`, so Flows created since then have the argument unset. Licensed third-party evidence (03 I4): `state=2` + preset is the temporary override (live-validated read-back), `state=1` = program on, `state=0` = program off, `state=0&temperatureState=<n>` is used by a long-running integration to leave vacation. "Disable program but keep the preset" is not pinned down (M/L).

## Decision

* One table `RESUME` in `lib/toon/commands.js` returns the request list for a state change:
  * `yes` -> `[{action: 'changeSchemeState', state: 2, temperatureState: <id>}]` (today's behaviour, baseline `device.js:209`).
  * `no` -> `[{action: 'changeSchemeState', state: 0, temperatureState: <id>}]` - **placeholder**, marked `unverified` in code and in the README.
  * `undefined` -> `yes`.
* The capability picker on the tile behaves like `yes`.
* `enable_program` -> `state=1`, `disable_program` -> `state=0` (unchanged).
* Enum and numeric arguments are validated before any request is built; `vacation` and unknown ids are rejected.
* Release gate: HW-04 exercises both options on a real Toon and records `programState`/`activeState` after each. If `no` does not behave as "program disabled", the table is corrected; if no sequence achieves it, `no` is made identical to `yes` and the dropdown label is adjusted (R-18 fallback). **Evidence added 2026-11-15** (`docs/sdlc/12-tsc-interface-findings.md` section B): the Toon community's web app and MQTT bridge both choose `state` from the current `programState` (0 when the program is off, otherwise 2 with the preset), and neither sends `state=0&temperatureState=<id>` while the program is on. The table is unchanged until hardware answers; Q-02 also tries the two-request form and `state=8` ("locked", program stays on).

## Consequences

* FR-13 AC1/AC2 are testable now against the mock's request log (the sequences differ); AC5 is hardware.
* The Flow argument becomes visible again (`[[resume_program]]` is required for validation); Flows made since 2023 keep working because `undefined` means `yes`.
