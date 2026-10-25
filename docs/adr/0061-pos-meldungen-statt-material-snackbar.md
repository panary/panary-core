---
type: ADR
title: 'ADR 0061 — POS-Meldungen über den NotificationService statt MatSnackBar'
description: 'Der POS zeigt alle Meldungen über den ausgebauten NotificationService aus shared/ui-notifications, oben mittig über Dialogen, in Volltonfarbe je Art; MatSnackBar und PosSnackBar entfallen.'
tags: [pos-client, ui, notifications, design-system]
status: stable
decision: accepted
generated: { by: claude-code/opus-5.5, at: 2026-10-25T14:00:00Z }
sources:
  - { id: issue-1026, resource: 'https://github.com/panary/panary-core/issues/1026', title: 'POS: eigene Snackbar statt Material-Snackbar' }
---

# ADR 0061 — POS-Meldungen über den NotificationService statt MatSnackBar

## Problem

Michaels Test von `pos-v26.10.29` auf der Sunmi-Kasse am 2026-10-25 zeigte drei Mängel der
Material-Snackbar:

- Sie hatte die Farbe der Dialoge (`--surface-panel-elevated`) und war deshalb kaum als Meldung
  zu erkennen.
- Sie saß unten mittig, also über Ziffern, „Bestellen" und den Fußtasten offener Dialoge, auch
  über deren Schließen-Tasten.
- Sie zeigte immer nur eine Meldung. Damit eine quittierpflichtige Meldung nicht verdrängt wurde,
  brauchte es `PosSnackBar` mit Rückhol-Logik (core#531, [Vorgänger](../architecture/pos-snackbar-rangfolge.md)).

Daneben gab es einen zweiten Meldeweg: den signal-basierten `NotificationService` mit eigenem
Outlet oben rechts, den nur `handleError` benutzte. Zwei Systeme mit verschiedenem Aussehen,
verschiedener Dauer und verschiedener Position.

## Entscheidung

Es gibt im POS **einen** Meldeweg: `NotificationService` aus `@panary/shared/ui-notifications`,
ausgebaut statt neu gebaut. Die Gestaltung stammt aus der Designstudie zu #1026, Michael hat
Variante A gewählt.

- **Position:** oben mittig im Arbeitsbereich, direkt unter dem Offline-Streifen. Dort liegen
  weder Primärtaste und Ziffern noch Dialog-Fuß oder Dialog-×. Die Lage hängt nicht von der
  Bedienhand ab; nur die Rail-Breite wird ausgeglichen.
- **Über Dialogen:** Die Ebene liegt im Top-Layer über den Dialogen der CDK (Popover-API, seit
  [#1060](https://github.com/panary/panary-core/issues/1060); vorher reichte der `z-index` nicht).
- **Farbe:** Vollton je Art (Erfolg, Hinweis, Warnung, Fehler) aus den `*-ink`-Tokens, Schrift in
  `--surface-bg`. Keine Meldung sieht wie ein Dialog aus.
- **Dauer je Art** statt je Aufruf. Quittierpflichtige Meldungen (`sticky`) laufen nicht ab.
- **Stapel** aus höchstens drei. Gleiche Meldungen zählen hoch, Quittierpflichtige werden nie
  verdrängt.
- `MatSnackBar`, `PosSnackBar` und die Snackbar-Styles verschwinden aus dem POS. Die geteilten
  data-access-Libs (`BaseService`, `ServiceHelper`) nutzen ebenfalls den Dienst. Der Admin-Client
  ist davon nicht betroffen, er benutzt keine der beiden Klassen.

Einzelheiten und API: [POS-Meldungen](../architecture/pos-meldungen.md).

## Konsequenzen

- Aufrufer wählen eine **Art**, keine Dauer: `success`, `info`, `warning`, `error`. Eine eigene
  Dauer gibt es nur über `duration` als Ausnahme.
- Die Rangfolge aus core#531 ergibt sich aus dem Stapel und braucht keine eigene Klasse mehr. Eine
  Meldung, die stehen bleiben soll, bekommt `sticky: true`; sie hat keine Aktion, sondern ein ×.
- Eine Aktion (etwa „Rückgängig") ist eine Funktion an der Meldung, kein Observable am Ref. Sie
  läuft außerhalb der Komponente; OnPush-Aufrufer markieren selbst neu.
- Der Ablauf liegt im Dienst, nicht in der Anzeige. Dadurch ist er ohne DOM prüfbar, und ein
  aufliegender Finger hält ihn an.
- Die Meldungsebene ist an `--notification-shift` gebunden, das der POS über `:has()` aus
  `data-rail-side` setzt. Ändert sich die Rail-Breite, muss der Wert mitziehen.
- Wer `ui-notifications` baut, braucht jetzt `@panary/shared/util-helpers` (Phosphor-Icons).
