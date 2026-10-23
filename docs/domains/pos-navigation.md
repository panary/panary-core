---
type: Domain Concept
title: POS-Navigation — Rail statt Dashboard-Kacheln
description: 'Wie der POS seit core#832 navigiert — Rail links mit fünf direkten Einträgen, „Mehr" mit Gruppen und Einstellungen-Untermenü, Stempeln und Abmelden direkt in der Rail (core#907), Avatar-Menü für die Warenkorb-Seite; woher die Sichtbarkeitsregeln kommen, was ausblendet und was sperrt, und warum die Rail bei offenem Sheet gesperrt ist.'
tags: [pos, ui, navigation, routing]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-10-23T02:40:00Z }
---

# POS-Navigation — Rail statt Dashboard-Kacheln

Seit [core#832](https://github.com/panary/panary-core/issues/832), Teil des Design-Ankers
[core#819](https://github.com/panary/panary-core/issues/819), navigiert der POS über eine **Rail** am
linken Rand. Sie ersetzt die Schnellzugriff-Kacheln des Dashboards, das zur „Übersicht" wird. Nach dem
Login landet man seit [core#907](https://github.com/panary/panary-core/issues/907) auf der **Übersicht**
(`/dashboard`) mit Kennzahlen und Vorbestellungen; von core#832 bis dahin war es die Kasse. Grund: Michaels
Test von `pos-v26.10.25` — Vorbestellungen und Kennzahlen (auch für die Betrugsauswertung) sollen beim
Anmelden im Blick sein. Vorlage: Konzept §3 und Mockup 2.7 in `sandbox/design-studie/konzept.html` (Workbench).

## Aufbau

| Platz | Einträge |
| --- | --- |
| Rail, direkt | Übersicht · Kasse · Offen (Badge) · Vorbest. · Historie |
| Rail, „Mehr" | Personal: Arbeitszeiten · Ware: Abschreiben · Geschäftstag & Kasse: Tag eröffnen, Tagesabschluss, Kassenlade · Gerät: Einstellungen › Allgemein, Benutzer, Design, Drucker, Verbindung, Info |
| Rail, unten | Verbindung (Punkt + „Online"/„Offline") · Stempelstatus (Uhrzeit des Kommens, „Pause" oder „Aus"; Tooltip mit Dauer) · Kommen bzw. Pause/Weiter und Gehen · Avatar mit Stempelpunkt · Abmelden |
| Avatar-Menü | Name, Stempelstatus · Warenkorb-Seite |

Login und Einrichtung liegen außerhalb der Shell (`AppPosShellComponent`) und haben keine Rail.

**Badge „Offen"** zählt `OrderService.ordersActive()`, dieselbe Menge, die „Offene Bestellungen" listet.

**Einstellungen-Untermenü** springt per `/settings?section=<abschnitt>` direkt in den Abschnitt;
`SettingsComponent` leitet den Abschnitt allein daraus ab, auch ihre eigene Seitenleiste schreibt ihn in die URL. Die Liste der Abschnitte steht in beiden Dateien
(`SETTINGS_SECTIONS`).

Die Warenkorb-Seite (Bedienhand, [core#833](https://github.com/panary/panary-core/issues/833)) liegt im
Avatar-Menü.

**Stempeln in der Rail** (core#907). Die Rail zeigt je Zustand nur die passenden Tasten
(`timeClockActions`): ausgestempelt Kommen, eingestempelt Pause und Gehen, in der Pause Weiter und Gehen.
Ein Tipp löst genau einen Aufruf aus — `PosStaffService.timeClock()` sperrt, solange die Antwort aussteht,
und die Tasten sind so lange deaktiviert. Stempeltasten und Abmelden sind 48 px hoch statt 62 px
(Touch-Minimum), damit die Rail eingestempelt bei 768 px Höhe ohne Scrollen auskommt. Die Arbeitszeit für
die Uhrzeit lädt `PosTimeClock` je Stempel-ID einmal, nicht bei jedem Öffnen eines Menüs.

## Code

| Was | Wo |
| --- | --- |
| Einträge und Regeln (rein, ohne Angular) | `libs/apps/pos-client/shell/src/lib/navigation/pos-navigation.ts` |
| Gerätezustand lesen, Eintrag ausführen | `…/navigation/pos-navigation.service.ts` (`PosNavigationService`) |
| Dialog-Einträge (Abschreiben, Tag, Kassenlade) | `…/navigation/pos-day-actions.service.ts` |
| Mitarbeiter, Stempeln, Abmelden | `…/navigation/pos-staff.service.ts` |
| Rail und Menüs | `…/shell/pos-rail.{ts,html,css}`, `pos-menu.css`, `pos-account-panel.ts` |
| Stempeln in der Rail | `…/shell/pos-time-clock.ts` (`PosTimeClock`), Regeln `timeClockActions` in `pos-navigation.ts` |
| Übersicht-Kennzahlen | `libs/domains/orders/feature-pos-dashboard/src/lib/dashboard-kpis.ts` |

**Angemeldeter Mitarbeiter.** `PosStaffService` ist ein Root-Dienst und überlebt den Bedienerwechsel. Er liest
`pos_current_user` aus dem `localStorage`, und der ist kein Signal. Damit `currentUser()` und `displayName()` beim
Wechsel A→B neu rechnen, lesen beide `posOperatorSession()` mit (`@panary/shared/data-access`). Das Signal zählt
`storePosOperatorToken`/`clearPosOperatorToken` hoch, die bei jeder Anmeldung und Abmeldung laufen. Bis
[core#902](https://github.com/panary/panary-core/issues/902) hielt der Dienst den vorigen Bediener fest, bis zufällig
`users()` neu emittierte. In diesem Fenster stempelten Kommen, Pause und Gehen die falsche Person. Dass der Server die
Zeiterfassung selbst an das Bediener-Token bindet, ist [core#903](https://github.com/panary/panary-core/issues/903);
die Stempel-Aufrufe schicken das Token dafür seit core#907 mit (`withPosOperatorToken`).

Die Menüs sind `@angular/cdk/menu` (Tastatur, Fokus, Schließen bei Klick daneben). Zwei Eigenheiten
der CDK sind im Code begründet: Ein Untermenü öffnet mit der Maus schon beim Überfahren, und der
anschließende Klick schaltete es wieder zu — `PosRail.keepOpen()` öffnet es danach erneut.
`cdkMenuItemDisabled` setzt nur `aria-disabled`; die Grautönung hängt deshalb an diesem Attribut.

## Sichtbarkeitsregeln

Die Regeln stammen **unverändert** aus den früheren `quickActions` des Dashboards. Ausblenden und
Sperren bleiben getrennt:

| Regel | Wirkung | Einträge |
| --- | --- | --- |
| `hideInStandalone` | ausgeblendet im Standalone-Modus | Abschreiben, Tag eröffnen, Tagesabschluss |
| `hideWhenCloudPaired` | ausgeblendet, sobald die Edge gekoppelt ist (`cloudPairingStatus === 'connected'`) | Tag eröffnen, Tagesabschluss |
| `condition` | ausgeblendet, solange die Bedingung nicht gilt | Tag eröffnen (kein Tag offen), Tagesabschluss (Tag offen), Kassenlade (Tag offen **und** gekoppelt) |
| `requiresOnline` | gesperrt mit Hinweis, wenn offline | Historie, Arbeitszeiten, Abschreiben, Tag eröffnen, Tagesabschluss, Kassenlade |
| `requiresBooking` | gesperrt mit Hinweis bei Mandantensperre (`TENANT_SUSPENDED`) | Kasse |

Tag eröffnen und Tagesabschluss sind damit nur im Cloud-Modus ohne aktive Kopplung sichtbar. Das ist
gewollt ([core#838](https://github.com/panary/panary-core/issues/838)): Bei gekoppelter Edge laufen
beide im Cloud-Admin.

Ein **gesperrter** Rail-Eintrag bleibt antippbar und meldet den Grund per Snackbar — ein
`disabled`-Knopf nähme am Touchgerät jeden Hinweis mit. Im „Mehr"-Menü steht der Grund zusätzlich unter
dem Eintrag. Die Mandantensperre geht im Hinweis vor „offline", weil sie bleibt, wenn die Verbindung
zurückkommt.

**Stempeln und Abmelden** folgen ihren bisherigen Regeln: Kommen, Pause und Gehen sind offline und bei
Mandantensperre gesperrt (`timeTrackingBlockedHintKey`, Kontosperre vor „offline"), Abmelden ist
offline gesperrt (`PosSessionService.isOffline`). Gehen meldet danach ab. Gesperrte Stempeltasten und
Abmelden bleiben wie die übrigen Rail-Einträge antippbar und nennen den Grund per Snackbar.

**Keine Rechteprüfung im UI.** `allowedRoles` war an keiner Kachel gesetzt und ist entfallen. Was ein
Mitarbeiter darf, prüfen weiter Server (`authorize`, Custom-Methods wie `checkin`), Guards
(`kasseBookingGuard`) und PIN-Freigaben (Kassenlade). Die Sperren der Rail sind Bedienhilfe.

## Sperre bei offenem Sheet

Solange in der Kasse ein Sheet liegt (Extras, Bezahlen, Abschicken — `OrderDialogComponent.sheetOpen()`),
ist die ganze Rail gesperrt (Konzept §5). Die Kasse meldet ihren Zustand über
`KasseDraftRegistry.attachSheet()`; `sheetOpen` ist dort ein Signal, weil die Rail die Sperre anzeigt.
Beim Neuaufbau der Kasse je Bestellung löst das Abmelden der alten Instanz die neue nicht.

Die „Übersicht"-Taste im Kopf der Kasse ist entfallen. Wer die Kasse über die Rail verlässt, wird wie
bisher von `kasseLeaveGuard` gefragt, sobald etwas eingegeben ist ([Kasse als Route](pos-kasse-route.md)).

## Nicht abgedeckt

- Die Specs prüfen Regeln und Kennzahlen als reine Funktionen. Rail, Menüs und das Zusammenspiel mit
  Guards und Dialogen prüft der Sichttest in der Sandbox.
- Standalone mit offenem oder geschlossenem Tag: Die Tag-Einträge sind dort durch `hideInStandalone`
  ausgeblendet — Bestand, nicht neu geprüft.
- Die Zurück-Pfeile auf Historie, Arbeitszeiten, Vorbestellungen, Einstellungen und Offene Bestellungen
  führen weiter zur Übersicht. Mit der Rail sind sie doppelt; sie fallen mit dem Umbau der Seiten.
