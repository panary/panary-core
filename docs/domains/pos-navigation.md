---
type: Domain Concept
title: POS-Navigation — Rail statt Dashboard-Kacheln
description: 'Wie der POS seit core#832 navigiert — Rail mit fünf direkten Einträgen, „Mehr" mit Gruppen und direktem Einstellungen-Eintrag, ruhige Fußzone mit Stempeltaste, Abmelden und Avatar (core#942), Rail gegenüber dem Warenkorb, Avatar-Menü mit Bedienhand und Darstellung; woher die Sichtbarkeitsregeln kommen, was ausblendet und was sperrt, und warum die Rail bei offenem Sheet gesperrt ist.'
tags: [pos, ui, navigation, routing]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-10-25T09:10:00Z }
---

# POS-Navigation — Rail statt Dashboard-Kacheln

Seit [core#832](https://github.com/panary/panary-core/issues/832), Teil des Design-Ankers
[core#819](https://github.com/panary/panary-core/issues/819), navigiert der POS über eine **Rail**; sie ersetzt die Schnellzugriff-Kacheln des Dashboards, das zur
„Übersicht" wird. Seit
[core#942](https://github.com/panary/panary-core/issues/942) sitzt sie dem Warenkorb gegenüber: Rechtshänder
(Warenkorb rechts) haben sie links, Linkshänder (Warenkorb links) rechts — auf jeder Seite mit Rail
(`railSide`, `PosStaffService.railSide`). Weil ohne eigene Wahl „links" gilt (`DEFAULT_POS_HANDEDNESS`,
[Bedienhand](pos-bedienhand.md)), steht die Rail bei allen, die nie gewählt haben, **rechts**. Ihre Menüs
öffnen immer zur Bildschirmmitte hin. Nach dem
Login landet man seit [core#907](https://github.com/panary/panary-core/issues/907) auf der **Übersicht**
(`/dashboard`) mit Kennzahlen und Vorbestellungen; von core#832 bis dahin war es die Kasse. Grund: Michaels
Test von `pos-v26.10.25` — Vorbestellungen und Kennzahlen (auch für die Betrugsauswertung) sollen beim
Anmelden im Blick sein. Vorlage: Konzept §3 und Mockup 2.7 in `sandbox/design-studie/konzept.html` (Workbench).

Die Start-/Übersichtsseite ([core#977](https://github.com/panary/panary-core/issues/977)) zeigt ein Balkendiagramm
„Bestellungen je Stunde" nur über die Öffnungszeit des Tages (aufgeweitet um Stunden mit Bestellungen; ohne gepflegte
Öffnungszeit 08–20 Uhr), die aktuelle Stunde in der Akzentfarbe, künftige Stunden leer. Die Kachel „Offene
Bestellungen" öffnet `/orders/active`, daneben listet „Als Nächstes abholen" die nächsten Vorbestellungen. Zahlen
laufen über `formatDecimal` (`@panary/shared/util-helpers`, de-DE: „0,6" statt „0.6", core#969).

## Aufbau

| Platz | Einträge |
| --- | --- |
| Rail, direkt | Start · Kasse · Offen (Badge) · Vorbest. · Historie |
| Rail, „Mehr" | Personal: Arbeitszeiten · Ware: Abschreiben · Geschäftstag & Kasse: Tag eröffnen, Tagesabschluss, Kassenlade · Gerät: Einstellungen (direkt, ohne Untermenü) |
| Rail, unten (core#942, nur Icons) | Stempeltaste · Abmelden (Schloss) · ganz unten Avatar mit Online-Punkt (grün/rot); offline zusätzlich „Offline" über dem Avatar |
| Avatar-Menü | Name, Stempelstatus · Bedienhand (Linkshänder/Rechtshänder, Hand-Icon) · Darstellung (Hell/Dunkel/System) |

Login und Einrichtung liegen außerhalb der Shell (`AppPosShellComponent`) und haben keine Rail.

**Badge „Offen"** zählt `OrderService.ordersActive()`, dieselbe Menge, die „Offene Bestellungen" listet.

**Einstellungen** sind ein direkter Eintrag (`SETTINGS_ENTRY`, [core#971](https://github.com/panary/panary-core/issues/971)) und öffnen `/settings`, ohne `?section=` also „Allgemein".
Die Abschnitte wechselt die Seite in ihrer eigenen Seitenleiste (`?section=`, nur dort geführt). „Mehr" leuchtet auf jeder Route des Menüs.
Der Hinweis der Stempeltaste ist ein `matTooltip` zur Bildschirmmitte hin (core#968); das native `title` erschien im Tauri-Fenster oben links.

Die Warenkorb-Seite (Bedienhand, [core#833](https://github.com/panary/panary-core/issues/833)) liegt im
Avatar-Menü.

**Stempeltaste** (core#942, vorher drei Tasten aus core#907). Eine Taste, der Zustand steht in der Farbe
(`timeClockState`): grau = ausgestempelt, ein Tipp stempelt ein; mint = eingestempelt, ein Tipp öffnet ein
Menü mit Uhrzeit und Dauer, **Pause** und **Gehen**; amber = Pause, ein Tipp beendet sie
(`timeClockTapAction`). Ein Tipp löst genau einen Aufruf aus — `PosStaffService.timeClock()` sperrt, solange
die Antwort aussteht. Rückmeldung ist die Farbe der Taste: Die generische Realtime-Meldung „Benutzer wurde
geändert“, die jedes Stempeln über das `patched`-Event auslöste, unterdrückt `UserService`
([core#954](https://github.com/panary/panary-core/issues/954), Muster core#657 bei Bestellungen). Gesperrt (offline, Mandantensperre) öffnet die Taste kein Menü, sondern nennt den Grund.
Stempeltaste und Abmelden sind 48 px hoch (Touch-Minimum). Die Arbeitszeit für Uhrzeit und Dauer lädt
`PosTimeClock` je Stempel-ID einmal.

**Avatar-Menü** (core#942). „Linkshänder/Rechtshänder" ersetzt „Warenkorb-Seite" und wählt die Seite direkt
(`PosStaffService.chooseCartSide`); Kasse und Rail spiegeln sofort. Die Darstellung nutzt denselben
`ThemeServiceService` wie die Einstellungen und gilt damit für das Gerät, nicht für die Person.

## Code

| Was | Wo |
| --- | --- |
| Einträge und Regeln (rein, ohne Angular) | `libs/apps/pos-client/shell/src/lib/navigation/pos-navigation.ts` |
| Gerätezustand lesen, Eintrag ausführen | `…/navigation/pos-navigation.service.ts` (`PosNavigationService`) |
| Dialog-Einträge (Abschreiben, Tag, Kassenlade) | `…/navigation/pos-day-actions.service.ts` |
| Mitarbeiter, Stempeln, Abmelden | `…/navigation/pos-staff.service.ts` |
| Rail und Menüs | `…/shell/pos-rail.{ts,html,css}`, `pos-menu.css`, `pos-account-panel.ts` |
| Stempeltaste | `…/shell/pos-time-clock.ts` (`PosTimeClock`), Regeln `timeClockState`/`timeClockTapAction`/`railSide` in `pos-navigation.ts` |
| Übersicht-Kennzahlen | `libs/domains/orders/feature-pos-dashboard/src/lib/dashboard-kpis.ts` |

**Angemeldeter Mitarbeiter.** `PosStaffService` ist ein Root-Dienst und überlebt den Bedienerwechsel. Er liest
`pos_current_user` aus dem `localStorage`, und der ist kein Signal. Damit `currentUser()` und `displayName()` beim
Wechsel A→B neu rechnen, lesen beide `posOperatorSession()` mit (`@panary/shared/data-access`). Das Signal zählt
`storePosOperatorToken`/`clearPosOperatorToken` hoch, die bei jeder Anmeldung und Abmeldung laufen. Bis
[core#902](https://github.com/panary/panary-core/issues/902) hielt der Dienst den vorigen Bediener fest, bis zufällig
`users()` neu emittierte. In diesem Fenster stempelten Kommen, Pause und Gehen die falsche Person. Dass der Server die
Zeiterfassung selbst an das Bediener-Token bindet, ist [core#903](https://github.com/panary/panary-core/issues/903);
die Stempel-Aufrufe schicken das Token dafür seit core#907 mit (`withPosOperatorToken`).

Die Menüs sind `@angular/cdk/menu` (Tastatur, Fokus, Schließen bei Klick daneben). Eine Eigenheit
der CDK ist im Code begründet: `cdkMenuItemDisabled` setzt nur `aria-disabled`; die Grautönung hängt deshalb an diesem Attribut.

## Seitenkopf

`<lib-page-header>` (`@panary/shared/ui-common`, [core#972](https://github.com/panary/panary-core/issues/972), Designstudie E6) ist der eine Kopf aller POS-Seiten: 68 px, `title`, grauer `subtitle`, Standard-Slot für Zähler und Suche, `[pageHeaderActions]` für Aktionen. Ohne Zurück-Pfeil und Kopf-Icon, ohne Kasten. Die Shell setzt `data-rail-side` am App-Rahmen; der Kopf spiegelt die Reihenfolge per `:host-context`, wenn die Rail rechts sitzt — Seiten brauchen keine Eingabe dafür. Jede Seite setzt ihn selbst ein; eine DOM-Spec gibt es nicht, weil der Workspace keine Komponenten-Tests fährt.

**Offline-Streifen** ([core#972](https://github.com/panary/panary-core/issues/972), E8): `AppComponent` rendert den priorisierten Cloud-Status mit `layout="strip"` — volle Breite oben im Fluss, der Inhalt rückt nach unten, nichts wird verdeckt. Die Wurzel ist dafür eine Spalte; die geroutete Seite füllt den Rest. Der Admin-Client behält die schwebende Karte (`layout="floating"`, Standard). Die Einstellungen nutzen den Seitenkopf ohne Zurück-Pfeil und Zahnrad-Icon.

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

**Abgelehntes Bediener-Token** ([core#923](https://github.com/panary/panary-core/issues/923)). Seit
[core#903](https://github.com/panary/panary-core/issues/903) bindet der Edge die Zeiterfassung an das
Bediener-Token. Ist es abgelaufen (12 h) oder gehört es zu einem anderen Gerät, antwortet er mit `401` und
`data.reason: POS_OPERATOR_REQUIRED`. Das ist **kein** Ablauf der Geräte-Sitzung: `ServiceHelper.handleError`
leert dann weder `sessionStorage` noch zeigt es einen Toast, sondern reicht den Fehler weiter
(`isPosOperatorRejection`, `@panary/shared/data-access`). `PosStaffService` beendet die Bediener-Sitzung über
`PosSessionService.endSession` und zeigt **danach** den Hinweis, sich erneut mit PIN anzumelden — vorher
ersetzte ihn die Snackbar „Benutzer erfolgreich abgemeldet“ aus `AuthService.logout()` sofort
([core#937](https://github.com/panary/panary-core/issues/937)). Nach der PIN ist die
Stempelung wiederholbar; es wurde nichts gestempelt. Jeden anderen `401` behandelt `ServiceHelper` wie bisher.

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
