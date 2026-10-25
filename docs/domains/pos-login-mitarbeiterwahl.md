---
type: Domain Concept
title: Zweistufiger POS-Login mit Mitarbeiterwahl
description: Wie sich Mitarbeiter am POS anmelden — Seitenpanel nach Konzept 2.5, Schritt 1 Mitarbeiterliste, Schritt 2 PIN; was unverändert bleibt.
tags: [pos-client, users, security]
status: stable
generated: { by: claude-code/sonnet-5.5, at: 2026-10-23T00:00:00.000Z }
---

Der Login hat zwei Schritte (Anker panary/panary-core#819): erst die Person wählen, dann die PIN eingeben.
Code: `libs/domains/users/feature-pos-login`.

## Seitenpanel (ab lg links)

Panel auf App-Tokens (`bg-surface-rail`, `border-line`, `text-ink`), Konzept (Workbench-Repo, `sandbox/design-studie/konzept.html`),
Mockup 2.5/2.6: Logo, Gerätename mit Version, Verbindungsanzeige, darunter nur auf **geteilten** Geräten die
Zeiterfassung (`lib-time-clock-panel`, Logik unverändert), auf zugewiesenen Geräten die Namen der Zugewiesenen.
Ganz unten stehen Theme- und Sprachtaste. Auf schmalen Bildschirmen entfällt das Panel; Logo, Sprache,
Verbindung und das Slide-in der Zeiterfassung bleiben wie bisher.

## Schritt 1 — Mitarbeiterwahl (geteilte Geräte)

Überschrift „Wer kassiert?", darunter alle Personen als alphabetisches Kartenraster (Nachname, dann Vorname):
Karten mit Kontur (`pos-key`), Initialen-Kreis (Farbe je Person aus der ID, `monogramStyle`, siehe [Design-Tokens](../architecture/design-tokens.md)) und Kurzname (`Anna A.`), Spalten nach Breite
(`auto-fill`, mindestens 9,5 rem), Höhe 5,25 rem. Es gibt bewusst **keine Suche, keine Buchstabengruppen und
kein „Zuletzt hier"** — sie wurden mit panary/panary-core#835 eingeführt und nach dem Test auf dem MacBook
(panary/panary-core#906) wieder entfernt. Der Login legt seither keine Personenangaben mehr im `localStorage` ab;
ein Altwert unter `pnry_login_recent_staff` wird nicht mehr gelesen.

Zugewiesene Geräte behalten die kompakte Zeilenliste (zwei bis fünf Einträge) mit „Willkommen", ein Gerät mit
genau einer Person überspringt Schritt 1.

## Stempel-Panel

Karte „Nur Arbeitszeit stempeln": „Kommen" breit (Akzent), darunter „Pause" und „Gehen" (Gefahr). „Pause Ende"
steht als schmale vierte Taste darunter: Das Mockup kennt sie nicht, weil der Zustand der Person vor der Eingabe
der Personalnummer unbekannt ist — eine zustandsabhängige Taste bräuchte erst die Nummer. Fußtasten: Theme
(„Hell/Dunkel/System") und Sprache (Klartext, z. B. „Deutsch").

Der Gerätename in der Panelzeile ist der Name aus der Kopplung (`panary_device_config.deviceName`, Rückfall
„POS Terminal"); der Code belegt keinen Testnamen vor.

## Schritt 2 — PIN

Großer Name, Ziffernblock und der Zurück-Pfeil (zurück zu Schritt 1; auf einem Ein-Personen-Gerät
ausgeblendet). Eine zweite Taste „Andere Person" gibt es seit core#963 nicht mehr. `verifyPin`, `changePin`, die Re-Verifikation und die Rate-Limits sind unverändert.

## Grenzen

- `users.find` am Login lädt höchstens 50 Personen (`$limit: 50`). Bei mehr Mitarbeitern je Filiale fehlen
  die übrigen in der Wahl.
