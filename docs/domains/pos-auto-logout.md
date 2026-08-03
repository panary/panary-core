---
type: Domain Concept
title: POS-Auto-Logout bei Inaktivität
description: Wie sich der POS-Client nach Inaktivität abmeldet — Konfigurationskette, Einfrier-Regeln, Offline-Verhalten und die beiden Schwellwerte.
tags: [pos-client, users, locations, auth]
status: stable
generated: { by: claude-code/opus-5, at: 2026-08-03T00:00:00.000Z }
---

Der POS-Client meldet einen Mitarbeiter nach einer konfigurierbaren Zeit ohne
Interaktion automatisch ab und kündigt das vorher mit einem Countdown an.

> **Vorgeschichte:** Die Konfiguration existierte seit Langem, die Auswertung
> nie. `user.autoLogOff` hatte im gesamten Repo genau drei Treffer — Schema,
> Pick-Liste, DB-Migration — und `genericUserSettings.autoLogOffTime` hatte
> einen Getter ohne einen einzigen Aufrufer. Die Checkbox in der
> Cloud-Benutzerverwaltung schrieb also ein Feld, das niemand las.

## Konfigurationskette

| Stufe | Ort |
|---|---|
| Checkbox „Auto-Logoff am POS aktivieren" | `panary-cloud` → `settings/feature-admin/.../users/user-form-dialog.component.ts` |
| Feld „Automatische Abmeldung nach (Minuten)" | `panary-cloud` → `settings/feature-admin/.../locations/dialogs/location-details-dialog.component.ts` |
| Schema `user.autoLogOff` (bool, Default `true`) | `libs/domains/users/domain/src/lib/user.schema.ts` |
| Schema `location.settings.genericUserSettings` | `libs/domains/locations/domain/src/lib/location.schema.ts` |
| Sync Cloud → Edge | `users` über die Feld-Projektion, `locations` als ganzer Datensatz (keine Projektion) |
| Auswertung Mitarbeiter-Flag | `isAutoLogOffEnabled` in `libs/domains/users/domain/src/lib/auto-log-off-policy.ts` |
| Auswertung Frist | `resolveAutoLogOffTimeoutMs` in `libs/domains/locations/domain/src/lib/auto-log-off-timeout.ts` |
| Zustandsautomat | `libs/apps/pos-client/shell/src/lib/services/idle-evaluator.ts` |
| Laufzeit | `libs/apps/pos-client/shell/src/lib/services/pos-idle-logout.service.ts` |
| Anzeige | `libs/apps/pos-client/shell/src/lib/shell/idle-warning-overlay.component.ts` |

Das Flag reist über `pos_current_user` (localStorage) zum Idle-Service, nicht
über `UserService.users()`. Grund: die POS-Nutzerliste lädt mit einem `$select`
ohne `autoLogOff` (Schutz der `employeeNumber`), und nach einem Reload ohne
Verbindung gibt es sie gar nicht — `users` liegt bewusst nicht im Offline-Cache.
Die `verifyPin`-Custom-Method liefert den vollen Datensatz, das Feld ist beim
Login also ohne Zusatz-Roundtrip verfügbar.

`autoLogOff` steht bewusst **nicht** in `userQueryProperties`: das erlaubte
`GET /users?autoLogOff=false` und damit eine Enumeration „welche Mitarbeiter
haben den Auto-Logoff aus" — ohne fachlichen Gegenwert.

## Phasen

| Phase | Bedeutung |
|---|---|
| `disabled` | `user.autoLogOff` ist aus — kein Timer, keine Listener |
| `armed` | Frist läuft, keine Anzeige |
| `warning` | Countdown-Overlay sichtbar |
| `frozen` | Frist ausgesetzt |

## Wann eingefroren wird

Zwei Gründe, beide **pro Takt aus dem Zustand abgeleitet** statt gebucht. Ein
vergessener Hold würde den Auto-Logoff dauerhaft und unsichtbar abschalten —
bei einem sicherheitsnahen Feature ist ein selbstheilender Zustand einem
manuell geführten überlegen.

1. **Offene Bestellannahme.** Der Entwurf lebt komponenten-privat im
   Bestelldialog (`#lineItems`, ein Plain-Array) und wäre nach einem Logout
   verloren. Erkannt über `MatDialog.openDialogs` gefiltert auf
   `OrderDialogComponent`; verschachtelte Dialoge (Numpad, Rabatt-Picker)
   ändern nichts, weil der Bestelldialog so lange offen bleibt.
2. **Offline.** Die Wiederanmeldung braucht die serverseitige PIN-Prüfung.
   Ein Logout ohne Verbindung sperrt das Terminal bis zum Reconnect aus.

Eingefroren wird **kein Budget verbraucht**: beim Auftauen läuft die volle
Frist neu, nicht der Rest von vorher. Ein kurzer Netzwackler während der
Vorwarnung darf den Kassierer nicht im nächsten Moment ausloggen.

**Nicht** eingefroren wird während der Pause (`startBreakAt`) — abgestimmte
Produktentscheidung: Wer in die Pause geht, ohne das Terminal zu sperren, hat
es schlicht vergessen; genau dafür gibt es den Auto-Logout. `startBreak()`
verzichtet bewusst auf den Logout *beim Pausenstart* („No logout to allow easy
resume"), das betrifft aber nur den Moment des Umschaltens und nicht die
folgenden Minuten ohne Aufsicht.

## Aktivitätserfassung

`document`-Listener auf `pointerdown`, `keydown`, `wheel` — mit
`{ passive: true, capture: true }`.

- **`capture: true` ist Pflicht.** Der Bestelldialog ruft an mehreren Stellen
  `stopPropagation()`; in der Bubble-Phase käme die Interaktion nie am
  `document` an und der Timer liefe während der intensivsten Arbeit ab.
- **Bewegungs-Events fehlen absichtlich.** `mousemove`/`touchmove`/`scroll`
  würden bei aufliegendem Finger auf dem Sunmi-Panel oder einem zappelnden
  USB-Scanner die Sitzung dauerhaft offen halten.
- Die Listener schreiben nur ein Plain-Feld, kein Signal. Der einzige
  Signal-Schreiber ist der 1-Hz-Takt — deshalb braucht es kein Throttling und
  es gibt keine Change Detection pro Tastendruck (der POS läuft zoneless).

## Schwellwerte

| Konstante | Wert | Ort |
|---|---|---|
| `AUTO_LOG_OFF_MIN_SECONDS` | 60 s | `locations/domain` |
| `AUTO_LOG_OFF_FALLBACK_SECONDS` | 120 s | `locations/domain` |
| `POS_IDLE_WARNING_MS` | 20 s | `shell/services/idle-evaluator.ts` |

Die Vorwarnzeit wird auf die halbe Frist gedeckelt, damit nicht der gesamte
Zeitraum aus einem laufenden Countdown besteht.

Die Untergrenze ist Betriebsschutz: der alte Schema-Default lag bei **30
Sekunden** und meldet mitten im Kundengespräch ab. Er war nie wirksam, weil das
Feld keinen Leser hatte — Bestandsfilialen tragen ihn trotzdem in der DB. Der
Schema-Default steht jetzt auf 2 Minuten; die Bestandskorrektur leistet
Migration 007 in `panary-cloud`.

## Logout-Pfad

Alle POS-Logouts (Button, Ausstempeln, Inaktivität) laufen über
`PosSessionService.endSession()` in `libs/domains/auth/data-access`:
Offline-Sperre, Doppel-Logout-Guard und `MatDialog.closeAll()` — offene Dialoge
blieben sonst über dem Login-Screen stehen, weil eine Navigation keine
CDK-Overlays schließt.

`AuthService.logout()` räumt seit derselben Änderung `pos_current_user` mit weg.
Vorher blieb der Schlüssel liegen, und da `posAuthGuard` ausschließlich daran
entscheidet, war nach einem Token-Ablauf jede geschützte Route weiter
erreichbar — nur ohne gültiges Geräte-JWT, also mit leerem Bildschirm statt
Login-Aufforderung.

Siehe auch: [POS-Pairing-Wizard](pos-pairing-wizard.md).
