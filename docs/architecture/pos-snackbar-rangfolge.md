---
type: Architecture
title: 'POS-Snackbar — Rangfolge quittierpflichtiger Meldungen'
description: 'PosSnackBar ersetzt MatSnackBar im POS-Client app-weit: Eine Meldung ohne duration mit Aktion bleibt bis zum Tipp auf ihre Aktion und kehrt zurück, wenn eine Kurzmeldung oder dismiss() sie verdrängt.'
tags: [pos, ui, snackbar, notifications]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-10-03T23:30:00Z }
---

# POS-Snackbar — Rangfolge quittierpflichtiger Meldungen

`MatSnackBar` zeigt immer nur **eine** Meldung. Jede neue verdrängt die laufende, und
`MatSnackBar.dismiss()` schließt, was gerade offen ist, ganz gleich, wer es geöffnet hat.
Im POS öffnen rund 18 Stellen Snackbars, fast alle mit Ablaufzeit („Bestellungen
aktualisiert", „… erstellt", „Rückgängig", Kontosperre). Für die eine Meldung, die stehen
bleiben **soll**, hieß das: Sie war nach Bruchteilen einer Sekunde weg
([#531](https://github.com/panary/panary-core/issues/531)).

## Die Regel

[`PosSnackBar`](../../apps/pos-client/src/app/pos-snack-bar.ts) ersetzt `MatSnackBar` im
POS-Client unter demselben Token (`providePosSnackBar()` in `app.config.ts`). Kein
Aufrufer ändert sich.

| Meldung | gilt als | Verhalten |
|---|---|---|
| ohne `duration`, **mit** Aktion | quittierpflichtig | bleibt, bis ihre Aktion getippt wird; verdrängt oder per `dismiss()` geschlossen, erscheint sie wieder, sobald nichts anderes mehr offen ist |
| mit `duration` | Kurzmeldung | unverändert: verdrängt die laufende, läuft ab, ihre Aktion (z. B. „Rückgängig") funktioniert |
| ohne `duration`, **ohne** Aktion | Kurzmeldung | ließe sich sonst nie beenden |

Eine quittierpflichtige Meldung **ohne** `duration` zu öffnen genügt. Wer eine neue
Meldung dieser Art baut, braucht nichts weiter zu tun.

## Grenzen

- **Eine** quittierpflichtige Meldung zur Zeit: Eine neue ersetzt eine ältere, noch
  offene. Heute gibt es genau eine (Rabattcode, [Rabatte](../domains/rabatte.md)).
- Die Rückkehr ist eine **neue** Snackbar mit eigenem `MatSnackBarRef`. Wer am Ref der
  ersten Anzeige `onAction()` abonniert, sieht den Tipp auf eine zurückgekehrte nicht.
  Kein heutiger Aufrufer tut das.
- Zwischen Verdrängung und Rückkehr liegen Ein- und Ausblend-Animation: Die Meldung
  flackert kurz, statt durchgehend zu stehen.
- Gezählt wird nur `open()`. `openFromComponent`/`openFromTemplate` nutzt der POS nicht.
- Wer eine **eigene** Snackbar schließen will, schließt ihr Ref, nicht den Dienst.
  `matSnackBar.dismiss()` trifft, was gerade offen ist. Genau so hat das Undo-Aufräumen
  im Bestelldialog die Rabattcode-Meldung geschlossen (seit #270, `pos-v26.9.3`).
  `PosSnackBar` fängt das inzwischen ab, die Ursache ist trotzdem behoben.

## Tests

`apps/pos-client/src/app/pos-snack-bar.spec.ts` läuft gegen den **echten** `MatSnackBar`
mit abgeschalteten Animationen. Ein Mock bildet die Semantik „eine Meldung zur Zeit" nicht
nach: Die Dialog-Spec zählte nur `open`-Aufrufe und blieb grün, während die Meldung in
jedem Fall verschwand.
