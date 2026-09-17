---
type: ADR
title: Edge-Boot-Härtung — Secret-Pflicht, Config-ENV-Allowlist und kein Setup-Modus als Auffangnetz
description: Der Edge startet nur noch mit einem echten FEATHERS_SECRET, überträgt aus der Setup-Konfiguration nur noch erlaubte Schlüssel nach process.env und fällt bei Boot-Fehlern nicht mehr in den offenen Setup-Modus zurück.
tags: [api-edge, security, boot, setup, infra]
status: stable
decision: accepted
generated: { by: claude-code/opus-5, at: 2026-09-17T12:10:00.000Z }
---

# Edge-Boot-Härtung

## Problem

Die Bestandsaufnahme zum zweiten Faktor am 2026-09-16 hat entschieden, einen zweiten Faktor
am Edge zu vertagen ([ADR 0023](0023-zugewiesene-pos-geraete.md) §5 nennt das Auslösekriterium:
Capacitor-Client mit Sensor **oder** POS über HTTPS — ohne TLS gibt es im LAN keinen
Secure Context für WebAuthn). Sie hat dabei drei Löcher freigelegt,
die **ohne** zweiten Faktor offenstanden und billiger zu schließen sind
([#323](https://github.com/panary/panary-core/issues/323)).

**1. Die Setup-Konfiguration war ein Generalschlüssel für die Prozessumgebung.**
`POST /api/setup` schreibt den Request-Body 1:1 nach `data/panary.config.json`. Beim nächsten
Boot übertrug `main.ts` **jeden skalaren Schlüssel dieser Datei nach `process.env`** — ohne
Filter. Über `config/custom-environment-variables.json` landet `FEATHERS_SECRET` von dort im
JWT-Signaturschlüssel. Wer den Setup-Endpunkt erreichte, bestimmte also nicht nur die
Einrichtung, sondern den Schlüssel, mit dem der Edge anschließend jedes Token signiert —
und daneben `ADMIN_EMAIL`/`ADMIN_PASSWORD` und sämtliche Endpunkte.

**2. `FEATHERS_SECRET` hatte einen Platzhalter im öffentlichen Repo.**
`config/default.json` trug `"secret": "CHANGE_ME_IN_PRODUCTION"`. Fehlte die
Umgebungsvariable, startete der Edge damit und signierte JWTs mit einem Wert, den jeder
nachlesen kann. Nichts prüfte das beim Start. Betroffen war unter anderem
`tools/docker/docker-compose.edge.yml`, das das Secret gar nicht erst durchreichte.

**3. Der Setup-Modus war das Auffangnetz für *jeden* Boot-Fehler.**
Er hing im `catch` des gesamten Boot-Blocks. Ein Fehler beim Lesen der Konfiguration, bei
einer Migration oder beim Service-Start führte dazu, dass ein produktiv laufender Edge einen
unauthentifizierten Setup-Endpunkt im LAN öffnete — und sich per mDNS als `_panary._tcp`
mit `setupComplete: false` aktiv anbot. Der Zustand „kaputt" wurde so zum Zustand
„übernehmbar".

## Entscheidung

**Das JWT-Secret hat genau eine Quelle: die Umgebungsvariable `FEATHERS_SECRET`.**
Der Platzhalter ist aus `config/default.json` entfernt. `assertFeathersSecret`
(`apps/api-edge/src/utils/boot-guards.ts`) bricht den Boot ab, wenn das Secret fehlt, dem
alten Platzhalter entspricht oder unter 32 Zeichen liegt — geprüft **vor** der
Modus-Entscheidung, also auch vor dem Setup-Modus. Sonst liefe ein Betreiber durch die
komplette Einrichtung und der Edge stürbe erst beim Neustart danach.

Dass die Prüfung die Umgebungsvariable liest und nicht den von node-config aufgelösten Wert,
ist Absicht und zugleich eine Einschränkung: Ein Secret in `config/local.json` würde ignoriert
und der Boot bräche trotzdem ab. Der Preis ist gewollt — zwei Quellen für denselben
Schlüssel sind genau die Unschärfe, die Punkt 1 erst möglich gemacht hat. Die Testsuite setzt
das Secret deshalb ebenfalls über die Umgebung (`vitest.config.mts`, `test.env`), nicht über
`config/test.json`.

**Die Übertragung Config → `process.env` läuft über eine Allowlist.** `filterConfigEnv`
kennt drei Klassen:

| Klasse | Schlüssel | Verhalten |
| --- | --- | --- |
| erlaubt | `HOSTNAME`, `LOG_DIR`, `PORT`, `SYSTEM_MODE`, `TZ` | nach `process.env` übertragen |
| gesperrt | `FEATHERS_SECRET`, `EDGE_TOKEN_ENCRYPTION_KEY`, `ADMIN_*`, `NODE_OPTIONS`, `NODE_ENV`, `PATH`, `LD_*`, … | verworfen, eigener Log-Eintrag |
| Setup-Payload | `shopName`, `locationName`, `businessType`, `adminEmail`, `adminPassword`, `adminLogin`, `mode` | still übergangen |

Die dritte Klasse ist kein Detail: Diese Felder stehen in **jeder** normalen Konfiguration und
werden direkt als `config.x` gelesen, nie über die Umgebung. Ohne sie meldete jeder gesunde
Boot sieben „verworfene" Schlüssel, und die Warnung wäre nach dem dritten Mal Rauschen.

Die Denyliste ist technisch redundant — die Allowlist lässt ohnehin nichts anderes durch.
Sie steht trotzdem da, weil sie die Absicht dokumentiert (niemand soll `NODE_OPTIONS` später
arglos ergänzen) und weil ein Treffer als eigenes Ereignis auffällt: Wer dort anklopft,
probiert nicht herum, sondern zielt. Geloggt werden ausschließlich **Schlüsselnamen**, nie
Werte — ein verworfener Schlüssel kann selbst ein Geheimnis tragen.

**Nur eine fehlende Konfigurationsdatei führt in den Setup-Modus.** Jeder andere Boot-Fehler
beendet den Prozess mit `exit(1)` und einer Meldung im Container-Log. Ein kaputter Edge bleibt
stehen, statt sich anzubieten.

## Konsequenzen

- **Ein Edge ohne gesetztes `FEATHERS_SECRET` startet nicht mehr.** Der reguläre Installer
  `get.panary.cloud/install.sh` erzeugt das Secret seit jeher bei der Erstinstallation
  (`openssl rand -base64 32`); er prüft jetzt zusätzlich den Wert einer **bestehenden** `.env`
  und erzeugt neu, wenn er leer, der Platzhalter oder zu kurz ist. Ohne diese Ergänzung wäre
  ein so aufgesetzter Edge nach dem nächsten Watchtower-Update tot, und niemand stünde davor.
  Ein neu erzeugtes Secret entwertet alle bestehenden Edge-JWTs — angemeldete Sitzungen enden
  einmalig. `tools/docker/docker-compose.edge.yml` verlangt das Secret jetzt ebenfalls und
  scheitert ohne (`${FEATHERS_SECRET:?…}`), statt still auf den Platzhalter zu fallen.
- **Lokale Entwicklung braucht das Secret ebenfalls.** `apps/api-edge/.env` ist gitignored und
  der vorgesehene Ort; Nx lädt sie für `nx serve api-edge`.
- **Die Fehlerdiagnose vor Ort wird schwerer.** Wo früher ein Setup-Bildschirm erschien, steht
  jetzt ein beendeter Container. Das ist der Zweck — die Abbruchmeldung nennt deshalb
  ausdrücklich den Behebungsweg und landet über `message` im Log, nicht nur als Zweitargument.
  Bei kaputtem JSON in der Konfiguration bedeutet das eine Neustartschleife der
  Docker-Restart-Policy statt eines offenen Setup-Endpunkts.
- **Die Allowlist ist bewusst kurz und wird wachsen müssen.** Jeder Eintrag ist eine Variable,
  die der Setup-Endpunkt setzen kann; eine Erweiterung ist deshalb eine Sicherheits- und keine
  Konfigurationsentscheidung.
- **Der Setup-Endpunkt selbst bleibt in diesem Schritt unauthentifiziert.** Die Allowlist nimmt
  ihm den Generalschlüssel, nicht den Zugang. Der Besitznachweis folgt im zweiten Teil von
  [#323](https://github.com/panary/panary-core/issues/323).

## Alternativen

- **Secret beim Boot selbst erzeugen und in `data/` ablegen.** Kein Edge wäre am Auto-Update
  gestorben, und der Platzhalter käme nie zum Einsatz. Verworfen auf Entscheidung des Nutzers
  (2026-09-17): Eine stille Selbstheilung verdeckt eine Fehlkonfiguration, und der Installer
  deckt den realistischen Kreis der Betroffenen bereits ab.
- **Karenz — N Releases nur warnen, dann hart.** Sicherster Übergang, lässt das Loch aber
  offen und verschiebt das Scharfschalten auf einen Zeitpunkt, den niemand terminiert.
  Ebenfalls verworfen.
- **Die Config→ENV-Übertragung ersatzlos streichen.** Kein Code im Repo braucht sie heute —
  die Setup-Felder werden direkt gelesen. Verworfen, weil handgepflegte Konfigurationen im
  Feld sie nutzen könnten und ein ersatzloser Wegfall dort still wirkte.
