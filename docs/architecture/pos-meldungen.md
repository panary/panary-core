---
type: Architecture
title: 'POS-Meldungen — Arten, Dauer, Stapel und Position'
description: 'Wie der POS Meldungen zeigt: NotificationService mit vier Arten und fester Dauer, Quittierpflicht, Stapel aus drei, Zählung gleicher Meldungen, Anzeige oben mittig über Dialogen, ohne deren Tasten zu verdecken.'
tags: [pos-client, ui, notifications, design-system]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-10-25T22:40:00Z }
sources:
  - { id: adr-0061, resource: '../adr/0061-pos-meldungen-statt-material-snackbar.md', title: 'ADR 0061' }
---

# POS-Meldungen — Arten, Dauer, Stapel und Position

Seit [#1026](https://github.com/panary/panary-core/issues/1026) zeigt der POS jede Meldung über
den [`NotificationService`](../../libs/shared/ui-notifications/src/lib/services/notification.service.ts).
Die Anzeige übernimmt der
[`notification-outlet`](../../libs/shared/ui-notifications/src/lib/components/notification-outlet.component.ts)
in `apps/pos-client/src/app/app.ts`. Warum es keine Material-Snackbar mehr gibt, steht in
[ADR 0061](../adr/0061-pos-meldungen-statt-material-snackbar.md).

## Benutzung

```ts
readonly #notifications = inject(NotificationService)

this.#notifications.success('Abschreibung gespeichert')
this.#notifications.warning('Kasse nicht freigegeben — die Bestellung bleibt offen')
this.#notifications.error(`Rabattcode nicht eingelöst — ${grund}`, { sticky: true })
this.#undoRef = this.#notifications.info('Bauernbrot entfernt', {
  action: { label: 'Rückgängig', run: () => this.restore() },
})
this.#undoRef?.dismiss()
```

Weitere Optionen: `title` (fett vor dem Text, z. B. „Fehler HTTP-Code 500" aus `handleError`) und
`duration` für Ausnahmen.

## Arten und Dauer

| Art | Wann | Dauer | Fläche (hell / dunkel) |
|---|---|---|---|
| `success` | etwas ist erledigt | 5 s | `--accent-ink`: Grün / Mint |
| `info` | Hinweis, ggf. mit Aktion | 7 s, mit Aktion 9 s | `--text-primary`: Navy / Creme |
| `warning` | ging nicht, nichts verloren | 9 s | `--warn-ink`: dunkles Bernstein / Bernstein |
| `error` | ist schiefgegangen | 12 s | `--danger-ink`: Rot / Hellrot |
| `sticky: true` | muss gesehen werden | bis × | Farbe der Art |

Die Dauern gelten seit [#1065](https://github.com/panary/panary-core/issues/1065). Vorher waren es 3/4 (6)/6/8 s.
Beim zweiten Test auf der Sunmi-Kasse (2026-10-25) konnte eine Erstnutzerin die Meldungen nicht zu Ende lesen.
Antippen schließt weiterhin sofort, und solange der Finger auf der Meldung liegt, pausiert ihr Ablauf. Die längere
Standzeit bremst also niemanden, der schon gelesen hat. Der Admin-Client nutzt denselben Dienst und übernimmt die
Dauern mit. Nicht betroffen ist der Hinweis unten im Raster der Kasse (`setInfoBoxText`, 4 s / rot 6 s). Er ist
keine Meldung dieses Dienstes.

Die Schrift ist immer `--surface-bg`. In Dunkel drehen sich Fläche und Schrift über dieselben
Tokens um, deshalb gibt es keine eigenen Meldungs-Tokens.

## Verhalten

- **Stapel:** höchstens drei, die neueste oben. Eine weitere verdrängt die älteste mit Ablauf.
  Quittierpflichtige werden nie verdrängt, die gerade neue auch nicht; stehen schon drei
  quittierpflichtige, wächst der Stapel.
- **Gleiche Meldung** (Art, Titel, Text): Sie erscheint nicht doppelt, sondern zählt „×2" und
  beginnt ihren Ablauf neu. Eine quittierpflichtige bleibt quittierpflichtig, eine Aktion bleibt,
  wenn die Wiederholung keine mitbringt, und eine angehaltene Meldung bleibt angehalten.
- **Ein „Rückgängig" zur Zeit** im Bestelldialog: Ein neues Angebot schließt das vorige.
- **Ein Tipp schließt** die Meldung, außer bei quittierpflichtigen, die nur das × schließt. Die
  Aktionstaste führt ihre Aktion aus und schließt die Meldung. Aktionstaste und × sind 48px groß;
  Enter/Leertaste auf der Fläche schließen, Enter auf der Aktionstaste löst die Aktion aus.
- **Finger auf der Meldung** hält den Ablauf an (`pause`/`resume`).
- **Vorlesen:** `success`/`info` als `role="status"`, `warning`/`error` als `role="alert"`.

## Position

Der Outlet steht in der Spalte des App-Rahmens zwischen Cloud-Status-Streifen und Inhalt und ist
0 hoch. Die Ebene darin ist absolut positioniert und beginnt deshalb immer direkt unter dem
Streifen, ohne dessen Höhe zu kennen. Waagrecht ist sie mittig über dem Arbeitsbereich: Die Rail
(3.875rem) verschiebt dessen Mitte, `styles.scss` setzt `--notification-shift` je
`data-rail-side`.

**Über Dialogen (core#1060).** Angular CDK 21 legt Dialoge und Sheets als Popover in den
**Top-Layer** des Browsers (`div.cdk-overlay-popover`). Dagegen hilft kein `z-index`: Bis
[#1060](https://github.com/panary/panary-core/issues/1060) lag die Ebene unter dem
Dialog-Backdrop, abgedunkelt und nicht antippbar. Deshalb ist die Ebene jetzt selbst ein Popover
(`popover="manual"`, [`top-layer.ts`](../../libs/shared/ui-notifications/src/lib/components/top-layer.ts)):

- Sie öffnet, sobald es Meldungen gibt, und schließt, wenn keine mehr stehen. Ihre Oberkante
  übernimmt sie dabei vom 0 hohen Host, also direkt unter dem Streifen.
- Im Top-Layer liegt oben, was zuletzt geöffnet wurde. Öffnet ein Dialog, während Meldungen
  stehen, öffnet die Ebene neu und liegt wieder darüber. Sie hört dafür im Capture-Durchlauf auf
  `toggle`-Ereignisse fremder Popover.
- Ohne Popover-API (alte WebView) bleibt sie im normalen Fluss mit `z-index: 2000`.
- Die Vorwarnung des Auto-Logouts nutzt seit [#1080](https://github.com/panary/panary-core/issues/1080)
  dasselbe `syncTopLayer` (aus `@panary/shared/ui-notifications` exportiert), aber ohne Listener für fremde
  Popover. Zwei Ebenen, die sich gegenseitig nach oben holen, sprängen sonst hin und her. Stehen beide, liegen
  die Meldungen über der Vorwarnung.

Schwäche: Öffnet die Ebene wegen eines neuen Dialogs neu, spielen die stehenden Meldungen ihre
Einblendung noch einmal ab.

**Neben einem modalen Dialog (core#1087).** Über dem Dialog zu liegen hieß bis
[#1087](https://github.com/panary/panary-core/issues/1087) auch, ihn zu verdecken: Nach dem Abschicken lagen bis zu
drei Meldungen über Kopf und Druckertasten des Druckdialogs. Jetzt richtet sich die Ebene am obersten offenen
Element mit `aria-modal="true"` aus (`placeBesideDialog` in `top-layer.ts`, gerechnet im Outlet):

- Passt der Stapel zwischen Streifen und Dialog-Oberkante, bleibt er an gewohnter Stelle.
- Sonst steht er direkt unter dem Dialog, wenn er dort ganz passt.
- Passt er nirgends ganz, zeigt die Ebene im größeren Streifen so viele der **neuesten** Meldungen, wie hineinpassen,
  notfalls keine, solange ein fensterhoher Dialog offen ist. Die übrigen bleiben im Dienst stehen
  (`.notification--held`), laufen weiter ab und erscheinen wieder, sobald der Dialog schließt.
- Neu gerechnet wird nach jeder neuen Meldung und bei jedem Öffnen oder Schließen eines fremden Popovers, dazu
  noch einmal 250 ms später, weil die CDK Dialoge hereinwachsen lässt.
- Die Auto-Logout-Vorwarnung (#1080) ist davon unberührt: Sie ist ein eigenes Popover und bleibt bewusst über Dialogen.

Nicht abgedeckt: Ein Dialog, der seine Höhe nach dem Öffnen ändert (nachgeladene Liste), verschiebt die Ebene erst mit
der nächsten Meldung oder dem nächsten Dialogwechsel.

## Was entfallen ist

- `PosSnackBar` und `providePosSnackBar()` aus core#531. Deren Rangfolge ergibt sich jetzt aus dem
  Stapel: Die quittierpflichtige Meldung bleibt stehen, Kurzmeldungen erscheinen darüber.
  Dokumentation des Vorgängers: [POS-Snackbar-Rangfolge](pos-snackbar-rangfolge.md) (deprecated).
- Die Snackbar-Styles in `apps/pos-client/src/styles.scss`.
- Die Snackbar-Konstanten `SNACKBAR_ACTION`/`SNACKBAR_DURATION` in `BaseService`, `ServiceHelper`,
  `AuthService` und `OrderService`. Die i18n-Schlüssel `SNACKBAR.*` und der Methodenname
  `showSnackbar` sind geblieben.

## Grenzen

- Ein Benutzerwechsel beendet offene Meldungen nicht. Eine quittierpflichtige gilt dem Gerät.
- Zwei Aufrufe derselben Meldung mit verschiedener Aktion werden zusammengelegt; es gilt die
  Aktion des letzten Aufrufs, der eine mitbringt.
- Das × trägt das feste Label „Schließen" (deutsch), nicht über i18n.
- Der Admin-Client rendert keinen Outlet. Er braucht keinen, solange er weder `BaseService` noch
  `ServiceHelper` benutzt.

## Tests

`top-layer.spec.ts` prüft `syncTopLayer`, das Nach-oben-Holen und `placeBesideDialog` (core#1087).
`libs/shared/ui-notifications/src/lib/services/notification.service.spec.ts` prüft Dauer, Stapel,
Zählung, Aktion, Pause und Verdrängung mit Fake-Timern. Die Aufrufer-Specs benutzen den echten
Dienst und beobachten `notify` per `vi.spyOn`; so prüft z. B. die Bestelldialog-Spec, dass das
Undo-Aufräumen die Rabattcode-Meldung stehen lässt.
