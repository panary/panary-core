---
type: ADR
title: Geräte-API-Keys befristen und still rotieren — Karenz statt Fallbeil
description: Ein Geräte-Schlüssel läuft nach 180 Tagen ab, wird aber ab 60 Tagen Restlaufzeit im Handshake still ausgetauscht und nach Ablauf noch 90 Tage weiter akzeptiert; das einzige harte Nein bleibt `active: false`.
tags: [api-edge, apikeys, devices, security, pos-client, print-server]
status: stable
decision: accepted
generated: { by: claude-code/opus-5, at: 2026-09-17T14:10:00.000Z }
---

# Geräte-Schlüssel: Rotation mit Karenz

## Problem

Ein gepairtes POS-Gerät blieb **dauerhaft** gekoppelt. Das Geräte-Credential ist ein
`randomUUID` (serverseitig SHA-256-gehasht, Show-Once); es lief nie ab, wurde nie rotiert,
und geprüft wurde es nur auf `active`.

Das Feld dafür existierte bereits vollständig — und wurde nirgends gelesen.
`apikeys.validUntil` stand im Schema, in der Migration und in der Admin-UI (die „UNLIMITED"
anzeigte, wenn es leer war). Beide Auth-Pfade prüften ausschließlich `entry.active`:

- `apps/api-edge/src/channels.ts` — WS-Handshake, einmal pro Socket-Verbindung
- `apps/api-edge/src/print-server/auth.middleware.ts` — HTTP `X-Api-Key`, **pro Request**

Beim Pairing wurde `validUntil` nicht gesetzt, und der Patch-Resolver verwarf es bei jedem
PATCH — ein bestehender Schlüssel ließ sich also auch intern nicht verlängern.

Zum Vergleich, dieselbe Codebasis: Das Edge↔Cloud-Token hat 24-h-TTL, Rotation bei 12 h
Restlaufzeit, Expiry-Prüfung pro Request, harten Status-Filter und einen Reconciler, der
abgelaufene Sockets trennt. Das Gerät auf der Theke, das jeder anfassen kann, hatte nichts
davon.

**Die Einschränkung, die alles andere bestimmt:** Ein abgelehnter Handshake macht das Terminal
praktisch unreparierbar. `login.component.ts` bricht bei `deviceAuthRejection()` sofort ab, und
der Entkopplungs-Dialog braucht selbst einen Server-Roundtrip (`verifyPin` über den Socket).
Der verbleibende Weg ist Neuaufsetzen — und das löscht unsynchronisierte Umsätze.
Präzedenzfall gleicher Klasse:
[ADR 0015](0015-modusunabhaengiger-sync-keepalive.md) („Bereits ausgesperrte Edges brauchen ein
Re-Pairing; das kann kein Code-Fix heilen").

Ein Ablauf, der abweist, ist damit keine Härtung, sondern ein eingebauter Ausfall mit
Vorlaufzeit von sechs Monaten.

## Entscheidung

`validUntil` weist **nie** ab. Es ist ein Rotations-Auslöser, kein Fallbeil. Das Sperrmittel
ist und bleibt `active: false`.

| Größe                       | Wert     | Wirkung                                                               |
| --------------------------- | -------- | --------------------------------------------------------------------- |
| `APIKEY_TTL_DAYS`           | 180 Tage | Lebensdauer eines frisch ausgestellten Schlüssels                     |
| `APIKEY_ROTATION_LEAD_DAYS` | 60 Tage  | ab dieser Restlaufzeit stellt der Handshake einen neuen Schlüssel aus |
| `APIKEY_GRACE_DAYS`         | 90 Tage  | Karenz nach Ablauf: authentifiziert weiter, Rotation erzwungen        |
| `APIKEY_PENDING_STALE_DAYS` | 7 Tage   | ab hier gilt ein nie eingelöster neuer Schlüssel als verloren          |

Die Werte liegen als Konstanten in `@panary/apikeys/domain`
(`apikey-lifecycle.ts`), zusammen mit `evaluateApikeyLifecycle()` — einer reinen Funktion ohne
Feathers, Knex und Uhr. Das Cloud-Pendant (panary/panary-cloud#447) konsumiert dieselbe
Semantik über das veröffentlichte Paket. **Geteilt wird die Semantik, nicht der Datensatz:**
API-Keys sind pro Backend isoliert (Edge-Key nur in der Edge-SQLite, Cloud-Key nur in Mongo;
`apikeys` steht in keiner Sync-Allowlist).

### Eine Prüfstelle für beide Pfade

`apps/api-edge/src/utils/device-apikey-auth.ts` (`authenticateDeviceApiKey`) macht Lookup,
Stempel, Promotion und Ausstellung. Handshake und Print-Server rufen dieselbe Funktion.

Der Print-Pfad ist dabei nicht Kosmetik: Er prüft **pro Request**. Kennt er nur den
gespeicherten Hash, antwortet er ab dem Moment der Rotation 401 — die Kasse läuft weiter, die
Bons brechen ab. Deshalb greifen Karenz, pending-Annahme und Promotion dort identisch.

**Ausgestellt wird nur im Handshake** (`canIssue`). Über HTTP gibt es keinen Kanal, auf dem der
Client zuhört; ein dort ausgestellter Schlüssel würde nie abgeholt und den zugestellten
entwerten.

### Fail-safe: der alte Schlüssel gilt weiter

Nach dem Vorbild der Edge↔Cloud-Token-Rotation (panary-cloud `services/sync/sync.ts`):

1. Ist die Rotation fällig, würfelt der Server einen neuen Schlüssel und legt **nur dessen
   Hash** in `pendingApikey` ab. `apikey` bleibt unverändert gültig.
2. Der Klartext geht erst raus, **wenn der Persist geglückt ist** — sonst bleibt alles beim
   Alten und der nächste Handshake versucht es erneut.
3. Zustellung über das Socket-Event `device:key-rotated`, nach `device:authenticated`. Der
   Client ersetzt ein Feld in seiner DeviceConfig (`updateApiKey`) und zieht die `auth` der
   laufenden Socket-Instanz nach. Kein Reload, kein Logout, kein IndexedDB-Zugriff.
4. Der erste erfolgreiche Handshake mit dem neuen Schlüssel **promotet** ihn auf `apikey` und
   setzt `validUntil` neu.

`validUntil` wird bewusst **erst bei der Promotion** verlängert, nicht beim Ausstellen. Sonst
bekäme ein Schlüssel, den nie jemand abholt, unbegrenzt Verlängerungen und rotierte in
Wahrheit nie — der Ablauf wäre wieder auf dem Papier.

### Kein Backfill für Bestands-Schlüssel

Alle heutigen Schlüssel sind unbefristet. Ein flottenweiter Stempel bei der Migration ließe die
180-Tage-Uhr aller Geräte am Deploy-Tag gleichzeitig starten — und damit auch die Rotation aller
Geräte auf denselben Tag fallen. Stattdessen stempelt der **erste Kontakt jedes Geräts** sein
eigenes `validUntil`.

### Schreibrechte enger als vom Plan gefordert

Der ursprüngliche Plan sah für `validUntil` die `provider`-Weiche vor, die `lastUsedAt` bereits
hat. Umgesetzt ist eine engere: `provider === undefined` **und** `params._apikeyRotation ===
true`. Der Marker wird ausschließlich in `device-apikey-auth.ts` gesetzt.

Begründung: Hier geht es um Credential-Material. `apikey` überschreiben heißt, ein Gerät
auszutauschen. „Irgendein interner Aufrufer" ist dafür zu weit — der Rotations-Pfad ist genau
einer, und das lässt sich benennen. Das Muster (Steuerung über `context.params._*`) folgt
`_rawApiKey` in derselben Datei. Extern bleibt jedes dieser Felder unveränderlich.

### Lookup über `deviceId` statt `apikeyPrefix`

Der rotierte Schlüssel hat einen anderen Prefix als der gespeicherte — ein Prefix-Lookup fände
ihn nicht. `deviceId` ist genauso selektiv (ein Gerät hat im Regelfall genau einen Schlüssel)
und bekommt in der Migration einen eigenen Index. Der timing-safe Hash-Vergleich bleibt
unverändert.

## Konsequenzen

**Gewonnen**

- Ein Geräte-Schlüssel ist nach spätestens 180 Tagen durchrotiert, ohne dass es jemandem
  auffällt. Ein Gerät, das lange aus war, holt die Rotation beim nächsten Start nach.
- Der Print-Pfad kann nicht mehr mitten in der Schicht auf 401 fallen, während der Socket steht.
- Ein abgebrochener Rotationsversuch sperrt nie aus — in keiner der drei Stufen (Ausstellen,
  Zustellen, Promoten).

**Erkauft**

- **Die 90 Tage Karenz sind eine Setzung, keine Messung.** Es gibt im Repo keine dokumentierte
  Annahme darüber, wie lange ein POS-Gerät offline sein darf: Für Edge↔Cloud existieren
  Keepalive 4 h und Freshness 5 h, für POS↔Edge nichts Vergleichbares. Betriebsferien über
  90 Tage sind durch nichts ausgeschlossen. Der Wert gehört korrigiert, sobald es echte Zahlen
  gibt.
- **Jenseits der Karenz bleibt die Aussperrung real.** Sie ist jetzt nur sehr weit nach hinten
  geschoben und benannt: Das Terminal zeigt `LOGIN.DEVICE_KEY_EXPIRED` statt der generischen
  Ablehnung und nennt den Weg zurück (Kopplungscode im Admin erzeugen,
  `POST /device-pairing/redeem` am Terminal einlösen — dieser Endpunkt braucht keinen gültigen
  Schlüssel). ⚠️ **Der Weg ist vorhanden, aber vom abgelehnten Login-Screen aus nicht
  erreichbar**: Solange eine DeviceConfig im localStorage liegt, meldet `isRegistered()` true
  und der Kopplungs-Assistent erscheint nicht. Das ist eine offene Lücke und ein eigenes Issue
  wert.
- **Ein manuell gesetztes `validUntil` auf einem Geräte-Schlüssel gehört ab jetzt der
  Automatik.** Ein verkürztes Datum wird beim nächsten Handshake rotiert und verlängert. Wer
  einen Schlüssel stilllegen will, setzt `active: false` — das ist eindeutig, sofort wirksam und
  überlebt die Rotation. Integrations-Schlüssel ohne `deviceId` sind davon nicht betroffen: Sie
  haben keinen Rotationspfad und bleiben unbefristet bzw. beim manuell gesetzten Wert.
- **Zwei Schlüssel-Hashes je Gerät** in der Datenbank statt einem, solange eine Rotation läuft.
  Beide sind gültige Credentials, und der pending-Hash ist wie `apikey` vom externen Resolver
  ausgeblendet.
- Das Socket-Event `device:key-rotated` ist hier definiert; cloud#447 verwendet dasselbe, damit
  der POS-Client nur einen Pfad braucht.

**Was diese Entscheidung nicht leistet**

Sie beantwortet nicht die Frage „war dieses Gerät so lange weg, dass es sich neu ausweisen
sollte". Das ist ein eigener Mechanismus und ein eigenes Issue
(panary/panary-core#325) — bewusst nicht über den Schlüssel-Ablauf gelöst, weil beide
Fragen unterschiedliche Antworten brauchen: Der Ablauf schützt gegen ein altes Credential, die
Re-Verifikation gegen ein entwendetes Gerät.
