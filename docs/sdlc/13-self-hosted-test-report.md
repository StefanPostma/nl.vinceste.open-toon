# 13 - Test report: Open-Toon on a Homey Self-Hosted Server, with a simulated Toon

| | |
|---|---|
| Dates | 2026-11-15 (first runs) and 2026-11-17 (final install and checks) |
| App under test | `nl.vinceste.open-toon` **2.0.0**, branch `redesign/sdk3`. The final install was built from commit `351f764`; the runs of 2026-11-15 used earlier commits of the same branch |
| Homey | **Homey Self-Hosted Server**, Homey firmware **13.5.4**, Node.js **v24.22.2** on the Homey |
| Toon | **none**: a simulated Toon (`test/helpers/mock-toon.js`). Its answers are derived from descriptions, not captured from a real Toon |
| Who did what | The assistant installed the app, read the Homey API and the mock's request log and injected failures. The owner paired the device and changed the temperature state in the Homey phone app |
| Result | The app installs, starts, pairs, polls, writes and reports an unreachable Toon as designed on this one Homey model. **No real Toon and no other Homey model were involved** |

This report records observations. It does not replace the hardware test plan (`10-hardware-test-plan.md`); it covers part of it for one Homey.

---

## 1. Versions and set-up

| Part | Version / detail |
|---|---|
| App | 2.0.0, SDK 3, `compatibility >=12.9.0`; installed as a development app with `homey app install` (the Homey reports `origin: devkit_install`) |
| Homey | Homey Self-Hosted Server: firmware 13.5.4, platform `local`, platform version 2, API version 3, model id `shs`, Node.js v24.22.2, language `en`, mDNS name `homey-shs.local` |
| Homey host app | "Homey Self-Hosted Server" for macOS 13.5.4 (bundle `app.homey.shs.Homey-Self-Hosted-Server`, signed by Athom B.V., notarized, needs macOS 26.0 or newer). It runs the Homey in a virtual machine that is bridged onto the Mac's Wi-Fi interface and gets its own address from the router |
| Host Mac | Apple Silicon (arm64), macOS 26.6.2, 24 GB memory, on Wi-Fi (`en0`), on battery during the long tests |
| Homey CLI | 4.6.3 (the devDependency `homey ~4.6.3`), run with Node.js v25.9.0 |
| Docker | Colima (Docker 29.x), only for `homey app run` on 2026-11-15 (image `ghcr.io/athombv/homey-app-runner:latest`); not needed for `homey app install` |
| Simulated Toon | `test/helpers/mock-toon.js` over real HTTP, with a TCP forwarder on `0.0.0.0:18080` so that the Homey VM could reach it, and a loopback control port to inject faults. Not part of the repository; it was started inline |
| Phone | the Homey mobile app, used to set up the Self-Hosted Homey, to add the device and to change its state (app version not recorded) |

## 2. What was observed

| # | Check | Result | How it was seen |
|---|---|---|---|
| 1 | The app starts in a real Homey runtime | **Yes.** `[ToonApp] Open-Toon started` and `[Driver:open-toon] Open-Toon driver started` | `homey app run` (Docker), 2026-11-15; the run ended after about 20 minutes when the CLI link to the Homey dropped (section 4) |
| 2 | Installation and staying up | **Yes.** `homey api apps get-app`: version 2.0.0, `enabled: true`, `state: running`, `crashed: false`; still running 8 hours later | `homey app install`, 2026-11-17 |
| 3 | Pairing (PairSession view with connection test) | **Yes**, with the owner's report "works great". The device exists with the entered address in its settings. A first attempt failed with "Toon did not answer in time" because the Mac's address had changed overnight (`192.168.1.85` to `192.168.1.157`); the app named the unreachable address as designed | the owner's phone, then `homey api devices get-devices` |
| 4 | Capabilities and values | `target_temperature`, `measure_temperature`, `temperature_state`, `meter_power.peak`, `meter_power.offPeak`, `measure_power`, `meter_gas`, `alarm_water.hotwater`, `burner_state`, with the values of the simulated Toon. **No** water capabilities and **no** power-export capability | `homey api devices get-devices` |
| 5 | Polling | Default interval 30 s. The mock's request log shows repeating cycles: thermostat, then current power, then meter totals. **No `/water.html` request** while ToonWater is off | mock request log, two snapshots 70 s apart |
| 6 | A write reaches the Toon | **Yes.** The owner chose "Sleep" on the tile: the mock logged `changeSchemeState&state=2&temperatureState=2`, and the tile read back 16.5 degrees C (the mock's Sleep preset) | mock request log, device values |
| 7 | ToonWater is off for a new device | **Yes** (`toonwater_enabled: false`, status "-", no water capabilities, no requests for the page). Export is off too | device settings, mock request log |
| 8 | A long failure makes the device unavailable | **Yes.** With the mock refusing connections the device became unavailable with "Your Toon cannot be reached" after about **2 min 8 s** (the design: after three failed cycles spanning at least 90 s) | availability watcher, 2026-11-17 |
| 9 | A short failure does not | **Yes.** Five refused requests did not make the device unavailable; `last_problem` was recorded | same |
| 10 | Recovery without help | **Yes, it recovered by itself** once the mock answered again. **How long it took is not known**: the Mac went to sleep during the tests (it was on battery, lid closed), which froze the mock and the watcher, so the durations measured (up to 39 minutes) are artefacts. The design says at most about 5 minutes | availability watcher |
| 11 | Status labels | `last_problem` and `last_update` are written and `last_update` advances. They show the Homey's own time zone, which differs from the Mac's, so the clock times look shifted | device settings |

## 3. Not observed

These were **not checked** in this run. The owner may have tried some in the Homey app; if so, add them here from the hardware report.

* **A real Toon**, of either generation. Every answer was simulated, so the field names, units, meter layouts, `programState`/`activeState`/`burnerInfo` meanings, `/water.html` and `resume_program` are as unproven as before (`10` section 15).
* **Other Homey models**: Homey Pro (Early 2023), Homey Pro mini and the owner's Homey Pro (2016-2019), which was offline with firmware 12.7.1 (below the 12.9.0 that this app needs; its Node.js is 16 until 12.9.0, 22 from then on).
* **Node.js 22 on a Homey.** This Self-Hosted Homey runs Node.js 24. Node.js 22 is only exercised in CI (GitHub Actions, Node 22.23.4) and in the test suite.
* **ToonWater switched on and off** on a real Homey (adding and removing the three capabilities, what happens to Flows and Insights), and a device that was **upgraded** from an older build.
* The **Flow editor**: which cards are offered, deprecated cards, trigger tokens, "Update now".
* Power export, the vacation state, deleting the device, restarting the app or the Homey with a paired device, several Toons, the pairing screen in light and dark mode on web and mobile, and endurance over 24 hours.
* Whether the sideloaded app behaves the same as an App Store install.

## 4. Set-up notes for repeating this

* The Self-Hosted Homey is a virtual machine bridged onto the Mac's Wi-Fi. **The Mac cannot reliably reach its own VM** (the ARP entry goes "incomplete"; the community reports the same). `homey app run` keeps a permanent connection and dropped three times (after roughly 20 minutes, after a few minutes, and after less than 17 minutes). `homey app install` needs the connection only while uploading and keeps running on the Homey afterwards; it worked once the link was up. A cloud-routed install failed with HTTP 400.
* Restarting the Self-Hosted app gives the VM a **new address** (`.53` to `.54`); ask the Homey (`homey api system get-info`, field `address`). A router reservation for the VM and for the Mac prevents this.
* The Mac's own address changed overnight; when pairing says "did not answer in time", check `ipconfig getifaddr en0` first.
* The Mac slept on battery even with `caffeinate -i`: time-based tests need the Mac plugged in, awake and with the lid open.
* Docker here is Colima: pass `--docker-socket-path ~/.colima/default/docker.sock` to `homey app run`.
* A forum user mentions a free first month for the Self-Hosted Server; Homey's installation article names no price. Check the account.

## 5. Where this fits in the hardware plan

Parts of Phase D (pairing), Phase E (the tile: values and the temperature state), Phase G (ToonWater is off by default) and Phase H (offline and recovery) ran on this Homey with a simulated Toon. They do not settle a single question in `10` section 15: all of those need a real Toon. The Homey-only items (Flow editor, ToonWater toggling on a runtime, upgrade, other models) remain open.
