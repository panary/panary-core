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
Mockup 2.5/2.6: Logo, Gerätename, Verbindungsanzeige, darunter nur auf **geteilten** Geräten die
Zeiterfassung (`lib-time-clock-panel`, Logik unverändert), auf zugewiesenen Geräten die Namen der Zugewiesenen.
Ganz unten stehen Theme- und Sprachtaste. Auf schmalen Bildschirmen entfällt das Panel; Logo, Sprache,
Verbindung und das Slide-in der Zeiterfassung bleiben wie bisher.
Die installierte Version steht auf jeder Breite genau einmal: im Footer links unten (`Panary Terminal • vX`,
unter `sm` nur `vX`), rechts daneben bei Bedarf das Update-Badge mit der neuen Version (panary/panary-core#1169).

## Schritt 1 — Mitarbeiterwahl (geteilte Geräte)

Überschrift „Wer kassiert?", darunter alle Personen als alphabetisches Kartenraster (Nachname, dann Vorname):
Karten mit Kontur (`pos-key`), Initialen-Kreis (Farbe je Person aus der ID, `monogramStyle`, siehe [Design-Tokens](../architecture/design-tokens.md)) und Kurzname (`Anna A.`), feste Kachelbreite 9,5 rem
(`auto-fit`, Höhe 5,25 rem). Überschrift und Raster stehen als Block (höchstens `max-w-5xl`) mittig im Inhaltsbereich,
horizontal wie vertikal (`my-auto`), und die Kacheln bleiben bei wenigen Personen beieinander. Passt der Block nicht in
die Höhe, beginnt er oben und der Inhaltsbereich scrollt (panary/panary-core#1191); der Inaktivitäts-Hinweis steht
oberhalb des Blocks im Scrollbereich, der Block zentriert sich im Restraum darunter. Es gibt bewusst **keine Suche, keine Buchstabengruppen und
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

### PIN per Tastatur

Der Ziffernblock ist die gemeinsame Komponente `lib-pin-pad` (`libs/shared/ui-common`, core#1410). Sie nimmt
neben Touch/Maus auch die physische Tastatur an, **ohne dass vorher ein Feld angeklickt werden muss** und ohne
Bildschirmtastatur: nur Ziffern 0–9 sowie Backspace/Delete; Tasten mit Strg/Cmd/Alt und eine gehaltene Ziffer
ergeben nichts (`pinKeyAction`). Esc und alles Übrige bleiben beim Host (Login: zurück zur Auswahl bzw.
PIN-Wechsel verwerfen).

- **Quelle der Tasten:** (Stand PR 1/2: Login und Geräte-Reverify nutzen die Komponente; die übrigen PIN-Dialoge folgen in PR 2/2 von core#1410.) Vorgabe ist `window` in der Capture-Phase, damit ein `stopPropagation()` im Panel eines
  Overlays die Taste nicht verschluckt. Dialoge auf dem CDK (MatDialog) übergeben `dialogRef.keydownEvents()`,
  weil der CDK Tasten nur ans oberste Overlay routet und gestapelte Dialoge sonst gleichzeitig reagieren.
- **Länge:** `length` ist Pflicht-Input ohne Vorgabe; Aufrufer übergeben `POS_PIN_LENGTH`.
- **Slot** `pinPadStart` ersetzt das leere Feld unten links (z. B. Zurück zur Personenwahl).

## Grenzen

- `users.find` am Login lädt höchstens 50 Personen (`$limit: 50`). Bei mehr Mitarbeitern je Filiale fehlen
  die übrigen in der Wahl.
