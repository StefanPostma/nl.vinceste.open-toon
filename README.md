# Open-Toon® for Homey

Let Homey control your Toon® over your local network. Read English below, Nederlands staat verderop.

* [English](#english)
* [Nederlands](#nederlands)

---

## English

Open-Toon® connects a Toon thermostat that runs the open (rooted) software to Homey. Homey asks the Toon for its data over your home network, so nothing goes through a cloud, and the app talks to nothing but the address of your Toon. This is version 2.0.0, a rebuild for Homey SDK 3; what changed is in [docs/sdlc/09-release-notes-and-migration.md](docs/sdlc/09-release-notes-and-migration.md).

* [What you get](#what-you-get)
* [What you need](#what-you-need)
* [Install](#install)
* [Add a Toon](#add-a-toon)
* [Settings](#settings)
* [ToonWater (optional)](#toonwater-optional)
* [Flow cards](#flow-cards)
* [Upgrading from an earlier version](#upgrading-from-an-earlier-version)
* [Troubleshooting](#troubleshooting)
* [Reporting problems](#reporting-problems)
* [Development](#development)
* [Credits and licence](#credits-and-licence)

### What you get

* The room temperature and the target temperature, and you can set the target temperature.
* The temperature state (Comfort, Home, Sleep, Away; Vacation is shown but can only be set on the Toon itself) and the weekly program, which you can switch on and off from Flows.
* Electricity use now, the electricity meter totals (peak and off-peak), the gas meter total and the hot water flag of the boiler, all ready for Insights.
* The state of the boiler burner (off, heating, hot water, pre-heating) as a device item and as Flow cards.
* Optional per device: ToonWater (water use) and power export (the production figure your Toon reports, for example from solar panels).

The app reads the Toon by itself, so you do not need a Flow to refresh the values. Homey Energy keeps seeing the Toon as a whole-home meter, as before; this version does not change that. Showing the electricity total in the Energy tab is not part of this release, because it would change the Energy accounting of every upgraded device at once and has to be checked on a real Homey first.

### What you need

* A Toon that runs the open software, with its firewall opened so that Homey can reach it. This app does not work with a Toon as it comes out of the box. The first and the second generation of the Toon (Toon 1 and Toon 2) are the intended targets. They report their meters in different layouts and the app knows the layouts it has seen described, but no real Toon has been tried with this version yet, so every Toon model counts as untested until the hardware report says otherwise.
* A fixed IP address for the Toon (give it one in your router).
* A Homey Pro (Early 2023), Homey Pro (2016-2019), Homey Pro mini or Homey Self-Hosted Server with firmware 12.9.0 or newer. Homey Cloud and Homey Bridge cannot reach a device on your network and are not supported.
* A computer with Node.js 24 or newer to install the app with the Homey command line tool.

Disclaimer: you use this app at your own risk. Opening your Toon is up to you; this project does not help with that.

The Toon talks plain, unauthenticated http on your network. Anyone on that network can read the Toon and change its settings, with or without this app. Keep the Toon on a network you trust.

### Install

This app is not in the Homey App Store. Install it from a computer with the Homey command line tool, which is part of the development tools of this repository:

```
git clone https://github.com/StefanPostma/nl.vinceste.open-toon.git
cd nl.vinceste.open-toon
npm ci --ignore-scripts
npx homey login
npx homey select
npx homey app install
```

`login` and `select` are needed once: log in with your Athom account and choose your Homey. To update later, run `npx homey app install` again from the newer source. Never add `--clean` to `homey app install` or `homey app run`: it purges the settings and data that the app has stored on your Homey. And do not use `homey app run` on the Homey that holds your devices: stopping it with Ctrl+C removes the app again, and your devices with it.

This version was built and tested against a simulated Toon. It has also run on a **Homey Self-Hosted Server** (Homey firmware 13.5.4, Node.js 24; Homey command line tool 4.6.3): installing, pairing, polling every 30 seconds, changing the temperature state and the "cannot be reached" and recovery behaviour were checked there, with a simulated Toon (details in `docs/sdlc/13-self-hosted-test-report.md`). It has **not** been tried with a real Toon or on a Homey Pro or Homey Pro mini, so those count as untested until the hardware report says otherwise.

### Add a Toon

1. In Homey, add a device and choose Open Toon®.
2. Enter the IP address of your Toon and a short id that is different for every Toon (for example its hostname); you cannot change the id later. Give it a name if you like; without a name the device is called after the id.
3. Press Test connection. Homey shows what the Toon reports: temperature, setpoint, program and active state. If ToonWater is found on this Toon, a tick box lets you add the water items right away.
4. Press Connect.

Add every Toon once. Two devices for the same Toon double the number of requests the Toon has to answer, and that setup is not supported. The same goes for another Homey app that also reads the same Toon.

### Settings

* **IP Address**: the address of the Toon. If it changes, enter the new one here; the device picks it up without being added again.
* **Update interval**: how often Homey reads the Toon, in seconds, from 10 to 3600 (30 is the default). A lower value gives faster updates and puts more load on the Toon. At every update the app asks the Toon for the thermostat, the power use and the meter totals one after the other, never at the same time.
* **Status**: when the Toon was last read, and the last problem. Homey marks the device as unavailable after the Toon has stayed silent for a while (about two minutes at the default interval), and brings it back by itself when the Toon answers again; this can take a few minutes after the Toon is back.
* **ToonWater** and **Power export**: see below.

You do not need Flows with an "Update ..." card any more. The app reads the Toon by itself at the update interval. The cards still exist so that your old Flows keep working; "Update now" refreshes everything at once, and the older "Update power usage", "Update meter totals" and "Update water" cards are hidden from the card list but still run.

### ToonWater (optional)

ToonWater is a separate community add-on that you install on the Toon itself. With a water sensor it makes your water use available on the Toon, at a page called `/water.html`. Open-Toon® only reads that page.

**You do not need to do anything if you do not use ToonWater.** The setting is off by default. While it is off, the device has no water items, the app never asks the Toon for water data (so there are no failed requests for a page that is not there), and there are no water entries in the Flow editor.

**To use it**, install ToonWater on the Toon first (version 1.1.16 or newer). Then open the settings of the device in Homey and tick **Enable ToonWater water meter** in the group "ToonWater (optional add-on)". Homey checks that ToonWater answers and tells you what it found. The device now gets Water flow, Water today and Water meter total, and Homey adds its own cards and tags for those items to the Flow editor (what exactly the editor shows has not been checked on a real Homey yet). The older "Update water" card stays hidden; "Update now" refreshes the water readings too. You can also tick the box while adding the device, when ToonWater is found.

The line **ToonWater status** in the settings says what the app saw last:

* **Off**: ToonWater is switched off for this device.
* **Detected**: ToonWater answers and the water items are filled.
* **Not found on this Toon (HTTP 404)**: the Toon has no ToonWater page. The items stay on the device but stay empty until the add-on runs. The app then asks only every 15 minutes.
* **Toon not reachable**: the Toon did not answer, so nothing can be said about ToonWater.
* **Unexpected response**: the Toon answered, but not the way ToonWater does. If you see "this looks like the address of the ToonWater sensor module", you entered the address of the sensor module instead of the address of the Toon.

What happens to my Flows and Insights when I switch ToonWater off? Turning ToonWater off removes the water items again: Flows that use them will break and their Insights history may be lost. After turning it back on, the items return under the same names, so a Flow that used them may work again; whether Homey repairs such a Flow by itself, and whether the Insights history comes back, has not been confirmed on a real Homey yet. Check your Flows after every change. The app never changes your Flows and never switches ToonWater off by itself: a Toon that is rebooting or an add-on that is not installed yet only gives a status, never a removal.

Power export works the same way: **Show power export** in the group "Power export (optional)" adds the production figure your Toon reports, in watts (whether it equals what you feed back into the grid is not confirmed yet), and switching it off removes it again with the same consequences for Flows and Insights. It is read from the answer that the app already asks for, so it costs no extra request, but it has not been seen on the Toon of a household that feeds back yet.

### Flow cards

The cards of the device, as they appear in the Flow editor:

| Kind | Card | What it does |
|---|---|---|
| When | Temperature state changed | Runs when the temperature state changes. Token: the new state. |
| When | Burner state changed | Choose a state (any, off, heating, hot water, pre-heating). Token: the new state. |
| When | The hot water dispensing is changed | Runs when hot water starts or stops being dispensed. Token: yes or no. |
| When | The power meter changed | Runs when a meter total changes. Token: peak and off-peak together, in kWh. |
| And | Temperature state is / isn't | Comfort, Home, Sleep, Away, No state or Vacation. |
| And | Burner state is / isn't | Off, heating, hot water or pre-heating. |
| And | Hot water is / isn't dispensing | The hot water flag of the boiler. |
| Then | Set temperature state | Comfort, Home, Sleep or Away, and what to do with the program: resume it afterwards, or disable it. Vacation cannot be set from Homey. |
| Then | Enable program / Disable program | Switches the weekly program on or off. |
| Then | Update now | Reads the Toon right now. It fails when the Toon cannot be reached. |

Homey adds its own cards for the items of the device, such as the target temperature and the room temperature; their wording is Homey's. The cards "Update power usage", "Update meter totals", "Update water", the gas meter trigger and the water flow trigger of the app are hidden from the card list because Homey's own cards and "Update now" replace them; Flows that already use them keep working.

### Upgrading from an earlier version

The full story, per kind of device, is in [docs/sdlc/09-release-notes-and-migration.md](docs/sdlc/09-release-notes-and-migration.md). The short version:

* Your devices stay as they are: no need to add them again. Names, zones, Insights history and the Flows that you built on the old cards keep working.
* If your device already had water items, ToonWater is switched on for it (nothing is lost); if it had none, ToonWater is switched off. You can change that in the settings at any time. If the upgrade switched ToonWater on and the add-on is not found on your Toon for 24 hours, Homey shows you one notification that says where to switch it off.
* The update cards now report an error when the Toon cannot be reached; before, they quietly did nothing.
* Flow triggers that never fired before now fire when their value changes (the gas meter, power meter, water flow and hot water triggers); check Flows that you built on them.
* Gas and electricity totals now have three decimals instead of whole numbers.
* On devices that were added with the very first version (0.0.1), the old single electricity total (`meter_power`) stays on the device but is no longer updated; it held the use of one day, not a meter total. Use the peak and off-peak totals.
* One odd Energy interval can show up after you replace a meter: the app does not accept a lower meter reading until three readings in a row show it, to keep a Toon that briefly reports a wrong value out of your Energy data, so Homey Energy may show a single odd interval around the replacement.
* Homey firmware older than 12.9.0 keeps the old build; this version needs 12.9.0 or newer.

### Troubleshooting

| What you see | Likely cause | What to do |
|---|---|---|
| "The Toon did not answer in time" or "Homey cannot reach the Toon"; the device is unavailable | The Toon is off, is not on the network of your Homey, has a different address, or its firewall is closed | Check the power and the network, and the address in the device settings. From a computer on the same network, open `http://<IP address of your Toon>/happ_thermstat?action=getThermostatInfo` in a browser: you should see text with temperatures. The device recovers by itself once the Toon answers. |
| "Set the IP address of your Toon in the device settings" | The device came from an old version whose address was never filled in | Enter the address in the settings; the device starts without a restart. |
| "Remove https:// from the address", "IPv6 addresses are not supported" or "This is not a valid address" | The address has a form the Toon cannot use | Enter the IPv4 address, for example 192.168.1.50. |
| "This does not look like an open Toon", "The Toon sent an answer that this app cannot read" or "The Toon answered with an error" | The address belongs to something else, or to a Toon without the open software | Check the address and that your Toon runs the open software. |
| The water items stay empty | ToonWater is not installed or not running on the Toon | Read the ToonWater status in the settings. If you do not use ToonWater, switch it off there. |
| Status "Unexpected response: this looks like the address of the ToonWater sensor module" | You entered the address of the water sensor module | Use the IP address of the Toon itself. |
| There are no water cards in the Flow editor | ToonWater is off, or you are looking for the old app cards, which are hidden | Switch ToonWater on; use Homey's own cards for the water items and "Update now". |
| The gas or electricity total stays empty | Your Toon reports its meters under names this version does not know | Report it, with the answer of your Toon (see Reporting problems). |
| Only "Power meter peak (total)" is filled | You have a single-tariff meter | Nothing: off-peak stays empty on such a meter. |
| A Flow with an "Update" card now stops with an error | The Toon cannot be reached, and these cards now say so | Fix the connection. Flows that only refresh the values can be removed. |
| Choosing Vacation on the tile gives a message | Vacation can only be set on the Toon itself | Set it on the Toon. |
| The devices are gone after you installed the app | The app was started with `homey app run`, or installed with `--clean` | Add the Toons again; next time use `homey app install` without `--clean`. |
| The Toon feels slow | The update interval is short | Raise the update interval in the settings. |

### Reporting problems

Open an issue at https://github.com/StefanPostma/nl.vinceste.open-toon/issues and tell us your Toon, your Homey model and firmware, the app version, and what you did. If a meter total (gas or electricity) stays empty, add the answer of your Toon to `http://<IP address of your Toon>/hdrv_zwave?action=getDevices.json`: open that address in a browser, copy the text and check it for personal details (names, addresses, serial numbers) before you post it. The app logs which meter nodes it could not choose between; that line helps too. Instead of copying by hand you can run `node scripts/toon-probe.js <IP address of your Toon>` from a copy of this repository (Node.js 22 or newer, nothing to install): it only reads, asks the Toon the same questions as the app, leaves out names, addresses and other personal text, and writes one file `toon-probe-<time>.json` that you can attach to the issue. Read that file before you share it.

### Development

* Use Node.js 22 for the app and its tests (`.nvmrc`); that is what every Homey from firmware 12.9.0 runs. The Homey command line tool needs Node.js 24 or newer for `validate` and `build`; CI runs both.
* `npm ci --ignore-scripts` installs the tooling. The app itself has no runtime dependencies, and `node_modules` is not part of the repository.
* The checks, which CI runs on every push and pull request:

  | Command | What it does |
  |---|---|
  | `npm run lint` | ESLint with the Athom config; a warning fails it |
  | `npm test` | all tests, offline, in under a minute |
  | `npm run test:coverage` | the same, with at least 90 % of the lines of `lib/` covered |
  | `npm run validate` | `homey app validate --level publish`; fails when `app.json` or `locales/` differ from what the CLI composed |
  | `npm run pack:check` | builds the app and fails when anything but the app's own files ends up in the package |
  | `npm run check:requirements` | every requirement that a mock can verify is named by a test title |

* The tests run against a mock Toon and a strict fake Homey on a fake clock; no Toon, Homey or network is needed. What only real hardware can show is listed in section 10 of [docs/sdlc/08-test-report.md](docs/sdlc/08-test-report.md).
* The manifest is generated: edit `.homeycompose/` and the `drivers/open-toon/*.compose.json` files, never `app.json`, then run `npm run validate` and keep the regenerated `app.json`.
* Set `OPEN_TOON_DEBUG` to `1` in an `env.json` file (not committed) to log the raw answers of the Toon during `homey app run`.
* How the app is built: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), the decisions in [docs/adr/](docs/adr/), the requirements and the research in [docs/sdlc/](docs/sdlc/). `CONTRIBUTING.md` explains how to contribute and how to release.

### Credits and licence

Open-Toon® started as an app by Vinceste IT (Stefan Postma). Thanks to oepi-loepi (the water support), to Paul Heeringa, and to Dennis Moes (moezie) for the move to Homey SDK 3 and the hot water flag. Toon® is a trademark of its owner; this project is not affiliated with it. ToonWater is a separate project by oepi-loepi: this app only reads the page that ToonWater provides and contains no code of it; it was written from a description of that page (its address and field names), not from the source of the add-on.

Licence: GPL-3.0, see `LICENSE`.

### Support the project

If this app saves you time, thank you for using it. A coffee is always appreciated: [buymeacoffee.com/stefanpostma](https://buymeacoffee.com/stefanpostma). The app stays free and open source either way.

---

## Nederlands

Open-Toon® koppelt een Toon-thermostaat met de open (geroote) software aan Homey. Homey vraagt de Toon over je thuisnetwerk om zijn gegevens, dus er loopt niets via een cloud en de app praat alleen met het adres van je Toon. Dit is versie 2.0.0, een herbouw voor Homey SDK 3; wat er veranderd is staat in [docs/sdlc/09-release-notes-and-migration.md](docs/sdlc/09-release-notes-and-migration.md) (in het Engels).

* [Wat je krijgt](#wat-je-krijgt)
* [Wat je nodig hebt](#wat-je-nodig-hebt)
* [Installeren](#installeren)
* [Een Toon toevoegen](#een-toon-toevoegen)
* [Instellingen](#instellingen)
* [ToonWater (optioneel)](#toonwater-optioneel)
* [Flow-kaarten](#flow-kaarten)
* [Upgraden vanaf een eerdere versie](#upgraden-vanaf-een-eerdere-versie)
* [Problemen oplossen](#problemen-oplossen)
* [Problemen melden](#problemen-melden)
* [Ontwikkelen](#ontwikkelen)
* [Dank en licentie](#dank-en-licentie)

### Wat je krijgt

* De kamertemperatuur en de ingestelde temperatuur, en je kunt de ingestelde temperatuur wijzigen.
* De temperatuurstand (Comfort, Thuis, Slapen, Weg; Vakantie wordt getoond maar kan alleen op de Toon zelf worden ingesteld) en het weekprogramma, dat je met Flows aan en uit kunt zetten.
* Het stroomverbruik nu, de meterstanden van elektriciteit (piek en dal), de gasmeterstand en de warmwatervlag van de ketel, allemaal klaar voor Insights.
* De toestand van de brander van de ketel (uit, verwarmen, warm water, voorverwarmen) als onderdeel van het apparaat en als Flow-kaarten.
* Optioneel per apparaat: ToonWater (waterverbruik) en teruglevering (het opwekcijfer dat je Toon meldt, bijvoorbeeld van zonnepanelen).

De app leest de Toon zelf uit, dus je hebt geen Flow nodig om de waarden te verversen. Homey Energy blijft de Toon zien als meter voor het hele huis, zoals voorheen; deze versie verandert dat niet. De elektriciteitsstand in het tabblad Energy tonen hoort niet bij deze uitgave, want dat verandert de Energy-berekening van alle geüpgradede apparaten in één keer en moet eerst op een echte Homey worden gecontroleerd.

### Wat je nodig hebt

* Een Toon met de open software, waarvan de firewall open staat zodat Homey erbij kan. Deze app werkt niet met een Toon zoals hij uit de doos komt. De eerste en de tweede generatie van de Toon (Toon 1 en Toon 2) zijn de beoogde doelen. Ze melden hun meters in verschillende indelingen en de app kent de indelingen die beschreven zijn, maar met deze versie is nog geen echte Toon geprobeerd, dus elk Toon-model geldt als ongetest totdat het hardwarerapport anders zegt.
* Een vast IP-adres voor de Toon (geef hem dat in je router).
* Een Homey Pro (Early 2023), Homey Pro (2016-2019), Homey Pro mini of Homey Self-Hosted Server met firmware 12.9.0 of nieuwer. Homey Cloud en Homey Bridge kunnen een apparaat op je netwerk niet bereiken en worden niet ondersteund.
* Een computer met Node.js 24 of nieuwer om de app met het Homey-opdrachtregelprogramma te installeren.

Disclaimer: gebruik van deze app is op eigen risico. Je Toon openzetten moet je zelf doen; dit project helpt daar niet bij.

De Toon praat gewoon, onbeveiligd http op je netwerk. Iedereen op dat netwerk kan de Toon uitlezen en zijn instellingen wijzigen, met of zonder deze app. Houd de Toon op een netwerk dat je vertrouwt.

### Installeren

Deze app staat niet in de Homey App Store. Installeer hem vanaf een computer met het Homey-opdrachtregelprogramma, dat bij de ontwikkelhulpmiddelen van deze repository hoort:

```
git clone https://github.com/StefanPostma/nl.vinceste.open-toon.git
cd nl.vinceste.open-toon
npm ci --ignore-scripts
npx homey login
npx homey select
npx homey app install
```

`login` en `select` heb je één keer nodig: log in met je Athom-account en kies je Homey. Om later te updaten voer je `npx homey app install` opnieuw uit vanuit de nieuwere broncode. Gebruik nooit `--clean` bij `homey app install` of `homey app run`: dat wist de instellingen en gegevens die de app op je Homey heeft opgeslagen. En gebruik `homey app run` niet op de Homey waar je apparaten op staan: stop je het met Ctrl+C, dan verdwijnt de app weer, en je apparaten ermee.

Deze versie is gebouwd en getest met een gesimuleerde Toon. Ze heeft ook gedraaid op een **Homey Self-Hosted Server** (Homey-firmware 13.5.4, Node.js 24; Homey-opdrachtregelprogramma 4.6.3): installeren, koppelen, elke 30 seconden uitlezen, de temperatuurstand wijzigen en het gedrag bij "niet bereikbaar" en herstel zijn daar gecontroleerd, met een gesimuleerde Toon (details in `docs/sdlc/13-self-hosted-test-report.md`). Ze is **niet** geprobeerd met een echte Toon of op een Homey Pro of Homey Pro mini; die gelden als ongetest totdat het hardwarerapport anders zegt.

### Een Toon toevoegen

1. Voeg in Homey een apparaat toe en kies Open Toon®.
2. Vul het IP-adres van je Toon in en een korte id die voor elke Toon anders is (bijvoorbeeld de hostnaam); de id kun je later niet meer wijzigen. Geef het apparaat een naam als je wilt; zonder naam heet het apparaat naar de id.
3. Druk op Verbinding testen. Homey toont wat de Toon meldt: temperatuur, ingestelde temperatuur, programma en actieve stand. Als ToonWater op deze Toon wordt gevonden, kun je met een vinkje meteen de wateronderdelen toevoegen.
4. Druk op Verbinden.

Voeg elke Toon één keer toe. Twee apparaten voor dezelfde Toon verdubbelen het aantal verzoeken dat de Toon moet beantwoorden, en die opzet wordt niet ondersteund. Hetzelfde geldt voor een andere Homey-app die dezelfde Toon ook uitleest.

### Instellingen

* **IP-adres**: het adres van de Toon. Verandert het, vul dan hier het nieuwe in; het apparaat pakt dat op zonder dat je het opnieuw toevoegt.
* **Update-interval**: hoe vaak Homey de Toon uitleest, in seconden, van 10 tot 3600 (standaard 30). Een lagere waarde geeft snellere updates en belast de Toon meer. Bij elke update vraagt de app de Toon na elkaar om de thermostaat, het stroomverbruik en de meterstanden, nooit tegelijk.
* **Status**: wanneer de Toon voor het laatst is uitgelezen, en het laatste probleem. Homey zet het apparaat op niet beschikbaar als de Toon een tijd zwijgt (bij het standaardinterval ongeveer twee minuten), en haalt het er vanzelf weer uit als de Toon weer antwoordt; dat kan een paar minuten duren nadat de Toon weer terug is.
* **ToonWater** en **Teruglevering**: zie hieronder.

Je hebt geen Flows met een "Update ..."-kaart meer nodig. De app leest de Toon zelf uit op het update-interval. De kaarten bestaan nog zodat je oude Flows blijven werken; "Update nu" ververst alles in één keer, en de oudere kaarten "Update stroomgebruik", "Update meterstanden" en "Update water" zijn verborgen in de kaartenlijst maar werken nog.

### ToonWater (optioneel)

ToonWater is een aparte add-on uit de community die je op de Toon zelf installeert. Met een watersensor maakt hij je waterverbruik beschikbaar op de Toon, op een pagina die `/water.html` heet. Open-Toon® leest alleen die pagina.

**Gebruik je ToonWater niet, dan hoef je niets te doen.** De instelling staat standaard uit. Zolang hij uit staat, heeft het apparaat geen wateronderdelen, vraagt de app de Toon nooit om watergegevens (dus er zijn geen mislukte verzoeken om een pagina die er niet is) en staan er geen waterkaarten in de Flow-editor.

**Om het te gebruiken** installeer je eerst ToonWater op de Toon (versie 1.1.16 of nieuwer). Open daarna de instellingen van het apparaat in Homey en vink **ToonWater-watermeter inschakelen** aan in de groep "ToonWater (optionele add-on)". Homey controleert of ToonWater antwoordt en meldt wat het gevonden heeft. Het apparaat krijgt dan de actuele waterstroom, Water vandaag en Water meter totaal, en Homey zet zijn eigen kaarten en tags voor die onderdelen in de Flow-editor (wat de editor precies toont is nog niet op een echte Homey gecontroleerd). De oudere kaart "Update water" blijft verborgen; "Update nu" ververst de watergegevens ook. Je kunt het vakje ook aanvinken tijdens het toevoegen van het apparaat als ToonWater wordt gevonden.

De regel **ToonWater-status** in de instellingen zegt wat de app het laatst zag:

* **Uit**: ToonWater staat uit voor dit apparaat.
* **Gevonden**: ToonWater antwoordt en de wateronderdelen worden gevuld.
* **Niet gevonden op deze Toon (HTTP 404)**: de Toon heeft geen ToonWater-pagina. De onderdelen blijven op het apparaat staan maar blijven leeg totdat de add-on draait. De app vraagt dan nog maar elk kwartier.
* **Toon niet bereikbaar**: de Toon antwoordde niet, dus er is niets over ToonWater te zeggen.
* **Onverwacht antwoord**: de Toon antwoordde, maar niet zoals ToonWater dat doet. Zie je "dit lijkt het adres van de ToonWater-sensormodule", dan heb je het adres van de sensormodule ingevuld in plaats van het adres van de Toon.

Wat gebeurt er met mijn Flows en Insights als ik ToonWater uitzet? ToonWater uitzetten verwijdert de wateronderdelen weer: Flows die ze gebruiken gaan kapot en hun Insights-geschiedenis kan verloren gaan. Na het opnieuw aanzetten komen de onderdelen terug onder dezelfde namen, dus een Flow die ze gebruikte kan weer werken; of Homey zo'n Flow zelf herstelt, en of de Insights-geschiedenis terugkomt, is nog niet op een echte Homey bevestigd. Controleer je Flows na elke wijziging. De app past je Flows nooit aan en zet ToonWater nooit zelf uit: een Toon die opnieuw opstart of een add-on die nog niet is geïnstalleerd geeft alleen een status, nooit een verwijdering.

Teruglevering werkt op dezelfde manier: **Teruglevering tonen** in de groep "Teruglevering (optioneel)" voegt het opwekcijfer toe dat je Toon meldt, in watt (of het gelijk is aan wat je aan het net teruglevert is nog niet bevestigd), en uitzetten verwijdert het weer met dezelfde gevolgen voor Flows en Insights. Het wordt gelezen uit het antwoord dat de app al opvraagt, dus het kost geen extra verzoek, maar het is nog niet gezien op de Toon van een huishouden dat teruglevert.

### Flow-kaarten

De kaarten van het apparaat, zoals ze in de Flow-editor staan:

| Soort | Kaart | Wat hij doet |
|---|---|---|
| Wanneer | Temperatuurstand is veranderd | Gaat af als de temperatuurstand verandert. Token: de nieuwe stand. |
| Wanneer | Brander-stand is veranderd | Kies een stand (elke stand, uit, verwarmen, warm water, voorverwarmen). Token: de nieuwe stand. |
| Wanneer | De warm water afgifte is veranderd | Gaat af als de afgifte van warm water begint of stopt. Token: ja of nee. |
| Wanneer | De energiemeter is veranderd | Gaat af als een meterstand verandert. Token: piek en dal samen, in kWh. |
| En | Temperatuurstand is / is niet | Comfort, Thuis, Slapen, Weg, Geen stand of Vakantie. |
| En | Brander-stand is / is niet | Uit, verwarmen, warm water of voorverwarmen. |
| En | Warm water wordt wel / niet afgegeven | De warmwatervlag van de ketel. |
| Dan | Stel temperatuurstand in | Comfort, Thuis, Slapen of Weg, en wat er met het programma moet gebeuren: daarna hervatten of uitschakelen. Vakantie kun je niet vanuit Homey instellen. |
| Dan | Zet programma aan / Zet programma uit | Zet het weekprogramma aan of uit. |
| Dan | Update nu | Leest de Toon nu uit. De kaart geeft een fout als de Toon niet bereikbaar is. |

Homey voegt zelf kaarten toe voor de onderdelen van het apparaat, zoals de ingestelde temperatuur en de kamertemperatuur; hun formulering is die van Homey. De kaarten "Update stroomgebruik", "Update meterstanden", "Update water", de gasmeter-trigger en de waterflow-trigger van de app zijn verborgen in de kaartenlijst omdat de eigen kaarten van Homey en "Update nu" ze vervangen; Flows die ze al gebruiken blijven werken.

### Upgraden vanaf een eerdere versie

Het volledige verhaal, per soort apparaat, staat in [docs/sdlc/09-release-notes-and-migration.md](docs/sdlc/09-release-notes-and-migration.md) (in het Engels). In het kort:

* Je apparaten blijven zoals ze zijn: je hoeft ze niet opnieuw toe te voegen. Namen, zones, Insights-geschiedenis en de Flows die je op de oude kaarten bouwde blijven werken.
* Had je apparaat al wateronderdelen, dan staat ToonWater ervoor aan (er gaat niets verloren); had het die niet, dan staat ToonWater uit. Je kunt dat altijd wijzigen in de instellingen. Heeft de upgrade ToonWater aangezet en wordt de add-on 24 uur lang niet gevonden op je Toon, dan toont Homey je één melding die zegt waar je het kunt uitzetten.
* De update-kaarten geven nu een fout als de Toon niet bereikbaar is; eerder deden ze dan stilletjes niets.
* Flow-triggers die vroeger nooit afgingen, gaan nu af als hun waarde verandert (de triggers voor gasmeter, energiemeter, waterflow en warm water); controleer Flows die je daarop bouwde.
* Gas- en elektriciteitsstanden hebben nu drie decimalen in plaats van hele getallen.
* Op apparaten die met de allereerste versie (0.0.1) zijn toegevoegd blijft de oude losse elektriciteitsstand (`meter_power`) op het apparaat staan maar wordt niet meer bijgewerkt; er stond het verbruik van één dag in, geen meterstand. Gebruik de standen voor piek en dal.
* Na het vervangen van een meter kan er één vreemd Energy-interval verschijnen: de app accepteert geen lagere meterstand totdat drie metingen achter elkaar die lagere stand laten zien, om een Toon die kort een foute waarde meldt uit je Energy-gegevens te houden, dus Homey Energy kan rond de vervanging één vreemd interval tonen.
* Homey-firmware ouder dan 12.9.0 houdt de oude versie; deze versie heeft 12.9.0 of nieuwer nodig.

### Problemen oplossen

| Wat je ziet | Waarschijnlijke oorzaak | Wat je kunt doen |
|---|---|---|
| "De Toon antwoordde niet op tijd" of "Homey kan de Toon niet bereiken"; het apparaat is niet beschikbaar | De Toon staat uit, zit niet op het netwerk van je Homey, heeft een ander adres, of zijn firewall is dicht | Controleer de stroom, het netwerk en het adres in de apparaatinstellingen. Open vanaf een computer op hetzelfde netwerk `http://<IP-adres van je Toon>/happ_thermstat?action=getThermostatInfo` in een browser: je ziet dan tekst met temperaturen. Het apparaat herstelt vanzelf zodra de Toon antwoordt. |
| "Stel het IP-adres van je Toon in bij de apparaatinstellingen" | Het apparaat komt uit een oude versie waarvan het adres nooit is ingevuld | Vul het adres in bij de instellingen; het apparaat start zonder herstart. |
| "Verwijder https:// uit het adres", "IPv6-adressen worden niet ondersteund" of "Dit is geen geldig adres" | Het adres heeft een vorm die de Toon niet kan gebruiken | Vul het IPv4-adres in, bijvoorbeeld 192.168.1.50. |
| "Dit lijkt geen open Toon te zijn", "De Toon stuurde een antwoord dat deze app niet kan lezen" of "De Toon antwoordde met een fout" | Het adres hoort bij iets anders, of bij een Toon zonder de open software | Controleer het adres en of je Toon de open software draait. |
| De wateronderdelen blijven leeg | ToonWater is niet geïnstalleerd of draait niet op de Toon | Lees de ToonWater-status in de instellingen. Gebruik je ToonWater niet, zet het daar dan uit. |
| Status "Onverwacht antwoord: dit lijkt het adres van de ToonWater-sensormodule" | Je hebt het adres van de watersensormodule ingevuld | Gebruik het IP-adres van de Toon zelf. |
| Er staan geen waterkaarten in de Flow-editor | ToonWater staat uit, of je zoekt de oude kaarten van de app, die verborgen zijn | Zet ToonWater aan; gebruik de eigen kaarten van Homey voor de wateronderdelen en "Update nu". |
| De gas- of elektriciteitsstand blijft leeg | Je Toon meldt zijn meters onder namen die deze versie niet kent | Meld het, met het antwoord van je Toon (zie Problemen melden). |
| Alleen "Stroom meterstand piek" is gevuld | Je hebt een enkeltariefmeter | Niets: het dal blijft leeg bij zo'n meter. |
| Een Flow met een "Update"-kaart stopt nu met een fout | De Toon is niet bereikbaar en deze kaarten melden dat nu | Herstel de verbinding. Flows die alleen de waarden verversen kun je weghalen. |
| Vakantie kiezen op de tegel geeft een melding | Vakantie kan alleen op de Toon zelf worden ingesteld | Stel het in op de Toon. |
| Je apparaten zijn weg na het installeren van de app | De app is gestart met `homey app run`, of geïnstalleerd met `--clean` | Voeg de Toons opnieuw toe; gebruik de volgende keer `homey app install` zonder `--clean`. |
| De Toon voelt traag | Het update-interval is kort | Verhoog het update-interval in de instellingen. |

### Problemen melden

Maak een melding aan op https://github.com/StefanPostma/nl.vinceste.open-toon/issues en vermeld je Toon, je Homey-model en firmware, de appversie en wat je deed. Blijft een meterstand (gas of elektriciteit) leeg, voeg dan het antwoord van je Toon op `http://<IP-adres van je Toon>/hdrv_zwave?action=getDevices.json` toe: open dat adres in een browser, kopieer de tekst en controleer die op persoonlijke gegevens (namen, adressen, serienummers) voordat je hem plaatst. De app logt ook welke meterknooppunten hij niet kon kiezen; die regel helpt ook. In plaats van met de hand kopiëren kun je `node scripts/toon-probe.js <IP-adres van je Toon>` draaien vanuit een kopie van deze repository (Node.js 22 of nieuwer, niets te installeren): het leest alleen, stelt de Toon dezelfde vragen als de app, laat namen, adressen en andere persoonlijke tekst weg en schrijft één bestand `toon-probe-<tijd>.json` dat je aan de melding kunt toevoegen. Lees dat bestand voordat je het deelt.

### Ontwikkelen

* Gebruik Node.js 22 voor de app en zijn tests (`.nvmrc`); dat draait elke Homey vanaf firmware 12.9.0. Het Homey-opdrachtregelprogramma heeft Node.js 24 of nieuwer nodig voor `validate` en `build`; CI draait beide.
* `npm ci --ignore-scripts` installeert de hulpmiddelen. De app zelf heeft geen runtime-afhankelijkheden, en `node_modules` hoort niet bij de repository.
* De controles, die CI bij elke push en pull request draait:

  | Opdracht | Wat het doet |
  |---|---|
  | `npm run lint` | ESLint met de Athom-configuratie; een waarschuwing laat het mislukken |
  | `npm test` | alle tests, offline, in minder dan een minuut |
  | `npm run test:coverage` | hetzelfde, waarbij minstens 90 % van de regels van `lib/` gedekt is |
  | `npm run validate` | `homey app validate --level publish`; mislukt als `app.json` of `locales/` afwijken van wat het opdrachtregelprogramma samenstelde |
  | `npm run pack:check` | bouwt de app en mislukt als er iets anders dan de eigen bestanden van de app in het pakket komt |
  | `npm run check:requirements` | elke eis die een mock kan controleren wordt genoemd in de titel van een test |

* De tests draaien tegen een mock-Toon en een strikte nagebootste Homey op een nagebootste klok; er is geen Toon, Homey of netwerk nodig. Wat alleen echte apparatuur kan laten zien staat in sectie 10 van [docs/sdlc/08-test-report.md](docs/sdlc/08-test-report.md).
* Het manifest wordt gegenereerd: bewerk `.homeycompose/` en de bestanden `drivers/open-toon/*.compose.json`, nooit `app.json`, draai daarna `npm run validate` en bewaar de opnieuw gegenereerde `app.json`.
* Zet `OPEN_TOON_DEBUG` op `1` in een `env.json`-bestand (niet in git) om de ruwe antwoorden van de Toon te loggen tijdens `homey app run`.
* Hoe de app is gebouwd: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), de besluiten in [docs/adr/](docs/adr/), de eisen en het onderzoek in [docs/sdlc/](docs/sdlc/). `CONTRIBUTING.md` legt uit hoe je bijdraagt en hoe je een uitgave maakt.

### Dank en licentie

Open-Toon® begon als app van Vinceste IT (Stefan Postma). Dank aan oepi-loepi (de ondersteuning voor water), aan Paul Heeringa en aan Dennis Moes (moezie) voor de overstap naar Homey SDK 3 en de warmwatervlag. Toon® is een merk van zijn eigenaar; dit project is niet aan hem gelieerd. ToonWater is een apart project van oepi-loepi: deze app leest alleen de pagina die ToonWater levert en bevat er geen code van; hij is geschreven vanuit een beschrijving van die pagina (het adres en de veldnamen), niet vanuit de broncode van de add-on.

Licentie: GPL-3.0, zie `LICENSE`.

### Steun het project

Bespaart deze app je tijd? Fijn dat je hem gebruikt. Een kop koffie wordt altijd gewaardeerd: [buymeacoffee.com/stefanpostma](https://buymeacoffee.com/stefanpostma). De app blijft in beide gevallen gratis en open source.
