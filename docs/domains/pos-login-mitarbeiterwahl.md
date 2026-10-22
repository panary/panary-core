---
type: Domain Concept
title: Zweistufiger POS-Login mit Mitarbeiterwahl
description: Wie sich Mitarbeiter am POS anmelden — Schritt 1 Wahl über Suche, Buchstabengruppen und „Zuletzt hier" (gerätelokal, nur IDs), Schritt 2 PIN; was unverändert bleibt und warum die Suche ein natives Feld nutzt.
tags: [pos-client, users, security]
status: stable
generated: { by: claude-code/sonnet-5.5, at: 2026-10-22T00:00:00.000Z }
---

Der Login hat zwei Schritte (Anker panary/panary-core#819, Umsetzung panary/panary-core#835):
erst die Person wählen, dann die PIN eingeben. Code: `libs/domains/users/feature-pos-login`.

## Schritt 1 — Mitarbeiterwahl (geteilte Geräte)

`lib-staff-picker` ersetzt das frühere Kachelraster. Jede Person ist in höchstens zwei Taps erreichbar:

- **„Zuletzt hier"** steht oben (bis zu sechs Personen), solange weder gesucht noch gefiltert wird.
- **Suche** über Vor- und Nachname, auch als „Nachname Vorname", ohne Beachtung von Groß-/Kleinschreibung
  und Umlauten („mül" findet Müller). Eine Suche hat Vorrang vor der Gruppenwahl.
- **Buchstabengruppen** `A–C`, `D–F`, `G–I`, `J–L`, `M–O`, `P–R`, `S–U`, `V–Z` nach Nachname. Acht Gruppen
  statt 23 Einzelbuchstaben, weil einzelne Buchstaben die 48-px-Touchfläche unterschritten. Leere
  Gruppen sind deaktiviert.

Zugewiesene Geräte behalten die kompakte Zeilenliste (zwei bis fünf Einträge), ein Gerät mit genau einer
Person überspringt Schritt 1 wie bisher.

Die Suche ist ein natives `<input type="search">`: Die Bildschirmtastatur kommt vom Betriebssystem. Die
`touch-keyboard`-Komponente liegt im Bestelldialog (`feature-pos-order-dialog`); sie hier einzubinden hätte
eine Abhängigkeit users → orders geschaffen, und ihre Tasten sind mit 44 px unter der Touch-Untergrenze.

## „Zuletzt hier" — was gespeichert wird

`localStorage['pnry_login_recent_staff']` enthält **nur eine JSON-Liste von Mitarbeiter-IDs**, höchstens
sechs, neueste zuerst. Keine Namen, keine PIN, keine Personaldaten. Die Liste gilt je Terminal, es gibt
keine Schemaänderung. Sie wird erst nach **erfolgreicher** PIN-Prüfung (auch nach dem erzwungenen
PIN-Wechsel) fortgeschrieben; eine falsche PIN ändert die Reihenfolge nicht. IDs, die auf dem Gerät nicht
mehr auswählbar sind, werden nicht angezeigt.

## Schritt 2 — PIN

Großer Name, Ziffernblock 3 × 4 und die Taste „Andere Person" (zurück zu Schritt 1; auf einem
Ein-Personen-Gerät ausgeblendet). `verifyPin`, `changePin`, die Re-Verifikation und die Rate-Limits sind
unverändert. Das Zeiterfassungs-Panel erscheint weiterhin nur auf geteilten Geräten.

## Grenzen

- `users.find` am Login lädt höchstens 50 Personen (`$limit: 50`). Bei mehr Mitarbeitern je Filiale fehlen
  die übrigen in der Wahl.
