---
type: Domain Concept
title: POS-Kasse als Route /kasse
description: 'Warum die Kasse seit core#828 eine Route statt eines MatDialogs ist, wie sie nach jeder Bestellung frisch startet, wer beim Verlassen nachfragt, warum der Auto-Logout jetzt an der Eingabe hängt und wie sie ein Neuladen auf /kasse übersteht.'
tags: [orders, pos, ui, routing]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-10-22T14:40:00Z }
---

# POS-Kasse als Route `/kasse`

Seit [core#828](https://github.com/panary/panary-core/issues/828), Teil des Design-Ankers
[core#819](https://github.com/panary/panary-core/issues/819). Bis dahin öffnete die Kachel „Neue Bestellung"
`OrderDialogComponent` als MatDialog (98vw × 95vh) über dem Dashboard, ebenso „Neue Bestellung" in
Offene Bestellungen und „Neue Vorbestellung" in der Vorbestellungsliste. Der neue Kassenbildschirm
([core#829](https://github.com/panary/panary-core/issues/829)) und die Rail-Shell
([core#832](https://github.com/panary/panary-core/issues/832)) brauchen die Kasse als eigene Seite.

Code: `libs/domains/orders/feature-pos-order-dialog/src/lib/` (`kasse-page.component.ts`, `kasse.guards.ts`,
`kasse-draft-registry.ts`, `order-dialog.component.ts`), Route in `libs/apps/pos-client/shell/src/lib/app.routes.ts`.

## Ablauf

| Ereignis | `closed`-Output | Route |
| --- | --- | --- |
| Bestellen | `order-placed` | bleibt in der Kasse, Kasse startet leer |
| Vorbestellung angelegt | `preorder-created` | bleibt in der Kasse, Kasse startet leer |
| „Zur Übersicht" (Bestellung nicht möglich), nach Rückfrage | `cancelled` | `/dashboard` |
| Browser-Zurück, anderer Eintrag der [Rail](pos-navigation.md) | — | `kasseLeaveGuard` fragt nach |
| Logout, Inaktivität, Neueinrichtung (`/login`, `/setup`) | — | ohne Rückfrage, Entwurf verworfen |

Die Komponente kennt keinen Dialog mehr: Ihr Ende meldet sie über `closed`. Was dann geschieht,
entscheidet `KassePageComponent`. Der Klassenname `OrderDialogComponent` bleibt vorerst, denn
core#829 baut den Bildschirm ohnehin neu.

## Frischer Start je Bestellung

`KassePageComponent` rendert die Bestellkomponente in einem `@for` über eine laufende Nummer, die jede
abgeschickte Bestellung hochzählt. Dadurch wird sie neu aufgebaut. Der Grund: Sie führt rund zwanzig
Felder je Bestellung (Kunde, Pager, Tisch, Fertigungszeit, Vertriebskanal, Bestellbeginn,
Erfassungszeit, Personalessen, „schon getippt"-Merker …). Bisher setzte erst das Schließen des Dialogs
sie zurück. Der Neuaufbau verhält sich genau wie das Öffnen eines neuen Dialogs; ein Reset von Hand
vergäße beim nächsten neuen Feld eines. Kosten: dieselben wie früher je Dialog (Rabatt-Bestand laden,
Produktgruppen kommen aus dem Cache).

## Verlassen der Kasse

Entschieden im Issue (Abschnitt „Nicht abgedeckt"): **Ein Routenwechsel mit angefangener Bestellung
fragt nach, statt still zu verwerfen.** Das gilt auch mitten im Bundle-Flow. `confirmLeave()` ist die
Rückfrage des früheren X (`#hadInput`, „Bestellung verwerfen?", `disableClose`). „Weiter bearbeiten"
hält die Navigation auf, „Verwerfen" gibt sie frei und protokolliert `order-cancel` wie bisher das X.
„Übersicht" fragt einmal und navigiert dann. Der Guard fragt danach nicht erneut. Scheitert diese Navigation,
fragt er beim nächsten Verlassen wieder. Zweimal Zurück während einer offenen Rückfrage teilt sich
deren Antwort, statt eine zweite zu öffnen.

Ein `order-cancel` ohne Positionen entsteht nur in der ersten Bestellung eines Kassenbesuchs, wie
früher beim X eines frisch geöffneten Dialogs. Die nach dem Abschicken neu aufgebaute Folge-Bestellung
(`isFollowUp`) hat niemand geöffnet. Ihr Verlassen ohne Eingabe ist kein Abbruch und würde sonst jede
Kassensitzung mit einem leeren Abbruch in den OrderInteractions abschließen.

Der Router läuft dafür mit `canceledNavigationResolution: 'computed'` (`apps/pos-client/src/app/app.config.ts`).
Mit dem Standard `'replace'` überschrieb ein abgebrochenes Zurück („Weiter bearbeiten") den
History-Eintrag davor mit `/kasse`. Das nächste Zurück sprang dann zwei Seiten weit auf `/login`, in der
Sandbox so gemessen. `'computed'` stellt die History-Position wieder her, und das zweite Zurück zielt
wieder auf die Übersicht.

Ausgenommen sind Ziele, die die Sitzung beenden (`/login`, `/setup`). Dort entscheidet nicht der
Kassierer, und eine Rückfrage hielte den Logout auf. Verworfen wird dann wie früher: Auch der Dialog
ging beim Routenwechsel ungefragt zu (`PosSessionService.endSession` → `closeAll()`).

## Neuladen direkt auf `/kasse`

Als Dialog öffnete die Kasse nur vom Dashboard aus, der Standort war dann schon geladen. Die Route ist
direkt ladbar (F5, WebView-Reload, Deep-Link), und dann entsteht die Komponente, bevor
`LocationService.activeLocation()` gesetzt ist. Der Blocker „Bestellung nicht möglich — Standort konnte
nicht geladen werden" wurde bis [core#868](https://github.com/panary/panary-core/issues/868) einmalig in
`ngOnInit` gesetzt und blieb dann stehen, obwohl der Standort Sekunden später da war.

`blockingReason` ist deshalb ein `computed()` aus `activeLocation()`: Der Blocker steht, solange kein
Standort geladen ist, und verschwindet, sobald er eintrifft. Fällt der Standort weg, kommt er wieder.
Ein fehlender Geschäftstag blockiert weiterhin nicht, den legt der Edge beim ersten Order an.

Zwei weitere Werte las der Konstruktor einmal und hielten deshalb den Stand „ohne Standort"
([core#878](https://github.com/panary/panary-core/issues/878)): die Vorbelegung des Kanals (sonst Telefon statt
Kasse im Kassenbetrieb) und die Pauschalpreise für Beilage und Getränk (sonst 0). `orderChannel` ist ein
`linkedSignal` über den Betriebsmodus. Als Quelle dient ein `computed`, kein Funktionsliteral: Ein Refresh des
Standorts mit gleichem Modus setzt die Wahl des Kassierers so nicht zurück. Die Preise sind Getter auf den
Standort.

## Mandantensperre

`kasseBookingGuard` leitet `/kasse` bei gesperrtem Mandanten (`TenantSuspensionService.suspended()`) auf
die Übersicht um. Der Rail-Eintrag „Kasse" ist dann ohnehin gesperrt (`requiresBooking`). Der Abbruch in
`placeOrder` bleibt bestehen, für eine Sperre, die erst bei offener Kasse eintrifft. Der Warenkorb
bleibt dabei stehen.

## Auto-Logout

Als Dialog setzte der [Inaktivitäts-Logout](pos-auto-logout.md#wann-eingefroren-wird) aus, solange der
Bestelldialog offen war. Die Route ist dauernd offen und bleibt es nach dem Bestellen, der Logout käme
nie. Deshalb zählt jetzt die Eingabe: `KasseDraftRegistry.hasDraft()` fragt je Takt die laufende Kasse
nach `#hadInput`. Eine leere Kasse meldet ab wie jede andere Seite.

## Nicht abgedeckt

- Die Specs instanziieren Komponente, Seite und Guards direkt. Das echte Routing (Browser-Zurück mit
  `canDeactivate`, Neuaufbau durch `@for`) prüft erst der Sichttest in der Sandbox.
- Nach einer Vorbestellung aus der Vorbestellungsliste bleibt man in der Kasse. Zurück zur Liste geht es
  über die Rail („Vorbest.").
- `apps/pos-client/src/styles.scss` trägt noch die Panel-Klasse `.order-dialog-panel`, die jetzt niemand
  mehr setzt. Sie bleibt bis zum Umbau der Styles ([core#823](https://github.com/panary/panary-core/issues/823)) stehen.
