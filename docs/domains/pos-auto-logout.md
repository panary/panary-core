---
type: Domain Concept
title: POS-Auto-Logout bei Inaktivität
description: Wie sich der POS-Client nach Inaktivität abmeldet — Konfigurationskette, Einfrieren nur offline, eine angefangene Bestellung wird verworfen statt die Frist anzuhalten (core#1064), Offline-Verhalten und die beiden Schwellwerte.
tags: [pos-client, users, locations, auth]
status: stable
generated: { by: claude-code/opus-5, at: 2026-10-25T20:10:00.000Z }
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

Nur noch **offline**, pro Takt aus dem Zustand abgeleitet statt gebucht. Ein
vergessener Hold würde den Auto-Logoff dauerhaft und unsichtbar abschalten —
bei einem sicherheitsnahen Feature ist ein selbstheilender Zustand einem
manuell geführten überlegen. Die Wiederanmeldung braucht die serverseitige
PIN-Prüfung, ein Logout ohne Verbindung sperrt das Terminal bis zum Reconnect aus.

**Angefangene Bestellung: verwerfen statt einfrieren** (seit
[core#1064](https://github.com/panary/panary-core/issues/1064), Entscheidung Michael 2026-10-25, Variante A).
Bis dahin fror auch ein Entwurf in der Kasse die Frist ein (`KasseDraftRegistry.hasDraft()`,
seit core#828). Eine liegengelassene Kasse mit Artikeln blieb damit **unbegrenzt angemeldet**, für ein
Sicherheits-Feature die falsche Richtung. Heute läuft die Frist weiter:

- In der Vorwarnung steht zusätzlich „Die offene Bestellung wird dabei verworfen." (`POS_IDLE.DISCARDS_ORDER`,
  `PosIdleLogoutService.discardsOrder`). Ein Tipp hält die Sitzung wie immer offen.
- Beim Logout ruft der Dienst vor `endSession('idle')` `KasseDraftRegistry.discardDraft()`. Die Kasse
  protokolliert die Bestellung dann als `order-cancel` mit ihren Positionen. Ohne Eingabe gibt es keinen Eintrag.
- Parken (Entwurf sichern und nach dem Login wiederherstellen) gibt es bewusst nicht.

Das manuelle Abmelden fragt dagegen nach ([Kasse als Route](pos-kasse-route.md#auto-logout)).

Eingefroren wird **kein Budget verbraucht**: beim Auftauen läuft die volle
Frist neu, nicht der Rest von vorher. Ein kurzer Netzwackler während der
Vorwarnung darf den Kassierer nicht im nächsten Moment ausloggen.

**Nicht** eingefroren wird während der Pause (`startBreakAt`) — abgestimmte
Produktentscheidung: Wer in die Pause geht, ohne das Terminal zu sperren, hat
es schlicht vergessen; genau dafür gibt es den Auto-Logout. `startBreak()`
verzichtet bewusst auf den Logout *beim Pausenstart* („No logout to allow easy
resume"), das betrifft aber nur den Moment des Umschaltens und nicht die
folgenden Minuten ohne Aufsicht.

## Vorwarnung über Dialogen (seit core#1080)

Die Vorwarnung (`IdleWarningOverlayComponent`) ist ein Popover im Top-Layer (`popover="manual"`, geöffnet über
`syncTopLayer` der [Meldungsebene](../architecture/pos-meldungen.md)). Mit dem früheren `z-[1200]` lag sie unter
jedem CDK-Dialog, denn die CDK legt Dialoge seit core#1060 in den Top-Layer. Im Sichttest panary/panary-core#1077
verdeckte die Rückfrage „Bestellung verwerfen?“ den Countdown vollständig. Abgemeldet wurde trotzdem, nur sah es
niemand. Sie öffnet nach dem Dialog und liegt damit darüber. Einen Listener, der sie nach einem später geöffneten
Popover wieder hochholt, gibt es nicht: Ein neuer Dialog braucht einen Tipp, und der beendet die Vorwarnung.
Ohne Popover-API bleibt `z-[1200]` als Rückfall.

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
| `AUTO_LOG_OFF_FALLBACK_SECONDS` | 300 s | `locations/domain` |
| `POS_IDLE_WARNING_MS` | 20 s | `shell/services/idle-evaluator.ts` |

Die Vorwarnzeit wird auf die halbe Frist gedeckelt, damit nicht der gesamte
Zeitraum aus einem laufenden Countdown besteht.

Die Untergrenze ist Betriebsschutz: der alte Schema-Default lag bei **30
Sekunden** und meldet mitten im Kundengespräch ab. Er war nie wirksam, weil das
Feld keinen Leser hatte — Bestandsfilialen tragen ihn trotzdem in der DB. Der
Schema-Default steht auf 5 Minuten (vorher 2, core#941); die Bestandskorrektur leistet
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

### Hinweis am Login nach Inaktivität

`closeAll()` schließt beim Inaktivitäts-Logout auch eine **halb fertige
Manager-Freigabe**, etwa den PIN-Schritt eines Stornos. Der Login-Screen sieht
mit Personenwahl und Ziffernfeld genauso aus. Ohne Hinweis tippte der Manager
seine PIN in den Login, landete auf dem Dashboard und hielt den Storno für
gescheitert ([#604](https://github.com/panary/panary-core/issues/604); im
Edge-Log nur als `verifyPin` gefolgt von `pre-orders/find`, ohne `PATCH`).

`endSession()` merkt sich deshalb den Grund **vor** `logout()`, denn der
Login-Screen entsteht während dieser Navigation. `LoginComponent.ngOnInit` holt
ihn einmalig über `consumeEndReason()` ab. Bei `idle` steht über Benutzerauswahl
und PIN-Feld der Hinweis „Wegen Inaktivität abgemeldet“. Der Grund liegt als
Signal im Root-Service, nicht im `sessionStorage`, denn `logout()` leert den.
Nach einem Reload fehlt er, und das ist gewollt: Dann gibt es auch keinen
abgebrochenen Dialog mehr, auf den der Hinweis passen würde.

Bewusst **nicht** eingefroren wird die Frist bei offenem Freigabe-Dialog. Ein
vergessener Dialog hielte die Sitzung sonst offen. Seit core#1064 gilt das auch für
eine angefangene Bestellung (siehe oben).

Siehe auch: [POS-Pairing-Wizard](pos-pairing-wizard.md).
