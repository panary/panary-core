---
type: Architecture
title: 'POS-Socket-Fristen — jeder Aufruf der Kasse endet mit Antwort, Frist oder Trennung'
description: 'Die Kasse gibt jedem Feathers-Socket-Aufruf eine Frist als socket.io-Flag timeout (20 s, Geschäftstag-Wechsel 120 s). Ablauf wird 408, Trennung nach dem Senden 503, beides mit einer Logzeile ohne Nutzdaten; ein gepufferter Aufruf verfällt mit der Frist. Bestellen mit Sofortbezahlung behält nach einer Frist die ID, und die Edge lehnt die Wiederholung mit 409 ab, bevor Vorgangsnummer und TSE-Start laufen.'
tags: [pos-client, socket, feathers, logging, resilience]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-11-06T23:45:00Z }
sources:
  - { id: adr-0069, resource: '../adr/0069-pos-fehlerberichte-bleiben-lokal.md', title: 'ADR 0069' }
  - { id: code, resource: '../../libs/shared/data-access/src/lib/services/socket-deadlines.ts', title: 'socket-deadlines.ts' }
  - { id: dup-hook, resource: '../../apps/api-edge/src/hooks/reject-duplicate-order-id.hook.ts', title: 'reject-duplicate-order-id.hook.ts' }
---

# POS-Socket-Fristen

Seit [#1342](https://github.com/panary/panary-core/issues/1342) endet jeder Socket-Aufruf der Kasse. Vorher wartete
der Feathers-Socket-Client ohne Timer auf das Ack (`@feathersjs/transport-commons` 5.0.50, `lib/client.js`), und
eine ausbleibende Antwort ließ Bestellen ([#1216](https://github.com/panary/panary-core/issues/1216)) und Bezahlen
([#1314](https://github.com/panary/panary-core/issues/1314)) stumm hängen. Die Entscheidung dazu steht in
[ADR 0069](../adr/0069-pos-fehlerberichte-bleiben-lokal.md) Nr. 2.

## Mechanismus

`applySocketDeadline()` hängt als App-Mixin an jeden Socket-Service. Das erfasst auch Services, die erst beim ersten
`app.service(path)` über `defaultService` entstehen. Vor jedem `send` setzt es `socket.timeout(ms)`. Der
Feathers-Client liest das Flag synchron und emittiert sofort, danach setzt socket.io es zurück; ein anderer Aufruf
kann es dazwischen nicht verbrauchen.

Nur die **Device-Strategie** (`deviceId` und `apiKey` in der DeviceConfig) bekommt das Mixin. Der Admin-Zweig von
`createSocket()` bleibt unverändert.

| Aufruf | Frist |
|---|---|
| `businessdays.openDay`, `closeDay`, `refreshClosingStatus`, `approveClosedDay` | 120 s (`SOCKET_LONG_DEADLINE_MS`) |
| alle anderen | 20 s (`SOCKET_DEFAULT_DEADLINE_MS`) |

Warum das Flag je Aufruf statt einer globalen `ackTimeout` oder eines Feathers-Hooks:

- **Gegen `ackTimeout`:** Es gibt nur eine Zahl für alle Aufrufe. Sie müsste über dem Geschäftstag-Wechsel liegen,
  und eine hängende Bestellung stünde dann zwei Minuten.
- **Gegen einen `around`-Hook mit `Promise.race`:** Er beendet nur das Warten. Das Paket bleibt im `sendBuffer` und
  geht nach dem Reconnect raus, auch wenn der Nutzer den Fehler schon gesehen und neu bestellt hat. Eine Trennung
  bemerkt er nicht, weil socket.io sie nur Acks mit Timer meldet (`_clearAcks`).
- **Das Flag** nimmt bei Ablauf das gepufferte Paket aus dem `sendBuffer` und lässt socket.io einen schon gesendeten
  Aufruf bei einer Trennung sofort ablehnen.

## Fehler und Logzeile

| Fall | Fehler | Logzeile (`console.warn`, über den Console-Patch in der Logdatei) |
|---|---|---|
| Frist abgelaufen | `Timeout` (408), `data.reason = 'frist'` | `[socket] Keine Antwort: <service>.<methode> nach <ms> ms` |
| Trennung nach dem Senden | `Unavailable` (503), `data.reason = 'trennung'` | `[socket] Verbindung getrennt: <service>.<methode> ohne Antwort` |

`data` trägt `path`, `method`, `timeoutMs` und `reason`, nie Nutzdaten. `isSocketDeadlineError()` erkennt beide Fälle.

## Bestehende Einzelfristen

| Stelle | Frist | Bleibt, weil |
|---|---|---|
| `CLOSED_DAY_STATUS_TIMEOUT_MS` (`closed-day-prompt.ts`) | 3 s | kürzer: Die Ruhetag-Abfrage darf das Bestellen nicht aufhalten (#1215) |
| `CODE_CHECK_TIMEOUT_MS` (`discount-code.service.ts`) | 10 s | kürzer: Die Code-Prüfung ist eine Vorschau beim Tippen |
| `WRITE_OFF_SAVE_TIMEOUT_MS` (`write-off-error.ts`) | 15 s | kürzer; der Dialog bildet 408 schon auf eine eigene Meldung ab |
| `PAY_TIMEOUT_MS` (`order-checkout.service.ts`) | 20 s | gleich lang; der Bezahlablauf wertet jetzt auch die Socket-Frist und die Trennung als `timeout` und liest vor dem nächsten Versuch frisch nach. Bezahldialog und Kasse-Ansicht (`onCollect`, seit [#1348](https://github.com/panary/panary-core/issues/1348)) zeigen dann quittierpflichtig `ORDER_DIALOG.PAYMENT_TIMEOUT` |

## Bestellen nach einer Frist: dieselbe ID, keine zweite Bestellung

Seit [#1351](https://github.com/panary/panary-core/issues/1351). Bricht `orders.create` mit Frist oder Trennung ab,
kann die Edge die Bestellung trotzdem angelegt haben: Das Paket war schon gesendet. Im Sichttest
[#1347](https://github.com/panary/panary-core/issues/1347) entstand so beim zweiten Tipp auf „Bezahlen“ eine zweite
Bestellung, weil der Bestelldialog für jeden Versuch eine neue uuidv7 vergab.

**POS (Bestelldialog, nur Sofortbezahlung).** Bei `isSocketDeadlineError` merkt sich der Dialog die ID zusammen mit
einem Fingerabdruck des Warenkorbs (Positionen, Ort, Rabatte, Tisch, Pager) und meldet quittierpflichtig
`ORDER_DIALOG.ORDER_TIMEOUT`. Der nächste Versuch mit **unverändertem** Warenkorb schickt dieselbe ID. Ein
geänderter Warenkorb ist eine andere Bestellung und bekommt eine neue. Lehnt die Edge die wiederholte ID mit 409
(`ORDER_7002`) ab, übernimmt der Dialog die vorhandene Bestellung: Liste neu laden, Hinweis
`ORDER_DIALOG.ORDER_ADOPTED`, weiter in die Bezahlansicht. Beide Fehler meldet der Dialog selbst, deshalb übergibt er
`createOrder` ein `isExpectedError` (wie `patch` seit #1091), und `handleError` schweigt dazu. Eine 409 ohne
vorherige Frist geht weiter durch `handleError`.

**Edge (`rejectDuplicateOrderId`, around.create am `orders`-Service).** Around-Hooks laufen vor den before-Hooks.
Bringt der Body eine `_id` mit, die es schon gibt oder die gerade angelegt wird, antwortet die Edge mit `409 Conflict`,
`data = { code: 'ORDER_7002', orderId }`, ohne Nebenwirkung. Ohne den Hook scheiterte die Wiederholung erst am
Primärschlüssel, also nach `assignDailySequenceNumber`, `allocateFiscalCounter` und `signOrderTseStart`. Bei aktiver
TSE blieben eine Lücke in der lückenlosen Fiskal-Vorgangsnummer und eine offene TSE-Transaktion zurück, und der POS
bekam den rohen SQLite-Fehler als 500. Gegen eine Wiederholung, die eintrifft, während der erste Versuch noch in
seiner Hook-Kette steckt, hält der Hook die IDs laufender Anlagen in einem Prozess-Set (die Edge ist
single-process). Sync-Apply (`params.fromSync`) ist ausgenommen.

**Offline-Outbox.** Sie war schon vorher sicher: Eine wiederholt gesendete Bestellung stuft `classifyOutboxError`
bei 409 oder „unique“ als `already-exists` ein, und für `offlineCreated` entfällt der TSE-Start. Der Hook ändert
dort nur die Antwort (409 statt Primärschlüssel-Fehler), nicht das Ergebnis.

`DiscountCodeService.redeem` hat bewusst keine eigene Frist (ein später ankommender Aufruf verbrauchte den Code).
Die Socket-Frist begrenzt ihn trotzdem und nimmt ihn bei Ablauf aus dem Puffer.

## Messung

Quelle: `duration_ms` der Wide Events einer Dev-Edge (`panary-core/data/logs`, 2026-10-29 bis 2026-11-05, Mac, nur
TSE-Simulator), 4016 Socket-Aufrufe. Längster Aufruf 425 ms (`users.verifyPin`), danach `orders.patch` 382 ms und
`order-interactions.create` 304 ms. Die 20 s lassen Spielraum für Sunmi, Windows-Kassen und cloud-direct über das
Internet; gemessen sind diese nicht.

Die vier Geschäftstag-Wechsel kommen in den Daten **nicht** vor. Ihre 120 s sind eine Obergrenze aus dem Code: Die
Edge ruft dabei die Cloud mit eigenen Fristen von 10 s und 30 s (`business-days.ts`) und die TSE. Für cloud-direct
(api-cloud auf Staging) gibt es keine Messung.

## Nicht abgedeckt

Ob die Gegenseite einen schon gesendeten Aufruf nach Ablauf der Frist doch verbucht hat, sagt die Frist nicht; das
klärt der Aufrufer (Bezahlen liest den Status nach, Bestellen schickt dieselbe ID).

Beim Bestellen bleiben offen:

- **Ohne Sofortbezahlung** (Bestellbetrieb, Telefon, Personalessen, Firmenkunde) vergibt die Edge die ID. Der Dialog
  schließt dort sofort, ein Wiederholversuch aus demselben Warenkorb entsteht nicht. Ob nach einer Frist trotzdem
  doppelt bestellt wird, ist nicht gemessen.
- **Übernommene Bestellung:** Der Druckdialog nach dem Anlegen öffnet nicht, weil das Anlegen aus Sicht des POS
  gescheitert ist. Den Bon druckt der Kassierer über „Offen“ nach.
- **Geänderter Warenkorb nach der Frist:** neue ID. War die erste Bestellung doch angekommen, stehen zwei in „Offen“;
  darauf weist die Meldung hin.
- **cloud-direct:** Die Cloud bekommt denselben Body. Ob api-cloud eine doppelte `_id` als 409 meldet, prüft dieser
  Stand nicht (panary-cloud ist nicht Teil der Änderung). HTTP-Aufrufe per `fetch`/`HttpClient` (Health, Druck, Auth,
Device-Config) laufen nicht über den Socket und sind nicht erfasst.
