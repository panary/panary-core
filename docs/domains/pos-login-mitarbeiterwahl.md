---
type: Domain Concept
title: Zweistufiger POS-Login mit Mitarbeiterwahl
description: Wie sich Mitarbeiter am POS anmelden — helles Seitenpanel nach Konzept 2.5, Schritt 1 Mitarbeiterliste, Schritt 2 PIN; was unverändert bleibt.
tags: [pos-client, users, security]
status: stable
generated: { by: claude-code/sonnet-5.5, at: 2026-10-23T00:00:00.000Z }
---

Der Login hat zwei Schritte (Anker panary/panary-core#819): erst die Person wählen, dann die PIN eingeben.
Code: `libs/domains/users/feature-pos-login`.

## Seitenpanel (ab lg links)

Helles Panel auf App-Tokens (`bg-surface-panel`, `border-line`, `text-ink`), Konzept `sandbox/design-studie/konzept.html`,
Mockup 2.5/2.6: Logo, Gerätename mit Version, Verbindungsanzeige, darunter nur auf **geteilten** Geräten die
Zeiterfassung (`lib-time-clock-panel`, Logik unverändert), auf zugewiesenen Geräten die Namen der Zugewiesenen.
Ganz unten stehen Theme- und Sprachtaste. Auf schmalen Bildschirmen entfällt das Panel; Logo, Sprache,
Verbindung und das Slide-in der Zeiterfassung bleiben wie bisher.

## Schritt 1 — Mitarbeiterwahl (geteilte Geräte)

`lib-staff-picker` zeigt alle Personen als alphabetisches Kachelraster (Nachname, dann Vorname). Es gibt
bewusst **keine Suche, keine Buchstabengruppen und kein „Zuletzt hier"** — sie wurden mit panary/panary-core#835
eingeführt und nach dem Test auf dem MacBook (panary/panary-core#906) wieder entfernt. Der Login legt seither
keine Personenangaben mehr im `localStorage` ab; ein Altwert unter `pnry_login_recent_staff` wird nicht mehr gelesen.

Zugewiesene Geräte behalten die kompakte Zeilenliste (zwei bis fünf Einträge), ein Gerät mit genau einer
Person überspringt Schritt 1.

## Schritt 2 — PIN

Großer Name, Ziffernblock und die Taste „Andere Person" (zurück zu Schritt 1; auf einem Ein-Personen-Gerät
ausgeblendet). `verifyPin`, `changePin`, die Re-Verifikation und die Rate-Limits sind unverändert.

## Grenzen

- `users.find` am Login lädt höchstens 50 Personen (`$limit: 50`). Bei mehr Mitarbeitern je Filiale fehlen
  die übrigen in der Wahl.
