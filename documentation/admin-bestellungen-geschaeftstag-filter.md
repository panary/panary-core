---
title: Admin-Bestellungen — Geschäftstag-Filter + Status-Änderung
date: 2026-05-23
category: Architektur
domains: [orders, businessdays, users]
status: implementiert
---

# Admin-Bestellungen — Geschäftstag-Filter + Status-Änderung

Das Edge-Admin-Panel (`apps/admin-client`) zeigt Bestellungen jetzt standardmäßig
nach **aktuellem Geschäftstag** statt nach Kalenderdatum und erlaubt das **Ändern
des Bestellstatus**, um hängengebliebene Orders aufzuräumen.

## Problem

- Der Bestell-Filter im Admin filterte ausschließlich nach `createdAt`
  (Kalenderdatum): „Heute" = `createdAt >= lokale Mitternacht`. Bestellungen, die
  vor Mitternacht zu einem **noch offenen** Geschäftstag erfasst wurden, fielen aus
  „Heute" heraus → die Liste zeigte oft 0 Einträge, obwohl offene Orders existierten.
- Die Detail-Ansicht war read-only (nur Löschen). Es gab keine Möglichkeit, eine
  Bestellung abzuschließen/stornieren, um den Tagesabschluss zu entsperren.

## Entscheidung

1. **Neuer Filter „Aktueller Geschäftstag" (Default).**
   `apps/admin-client/src/app/features/orders/order-list.ts` — neuer
   `TimeRange`-Wert `'businessDay'` als erster Eintrag und Default-Auswahl.
   `loadOrders()` liest den `currentBusinessDay`-Pointer der Location(en)
   (`GET /locations?$select[]=currentBusinessDay`) und filtert die Bestellungen
   per `businessDayId: { $in: [pointer-ids] }`. Die Kalenderfilter (Heute/Gestern/
   Woche/Monat) bleiben unverändert fürs Reporting. Ohne gesetzten
   `currentBusinessDay` wird sauber „Keine Bestellungen" angezeigt.

   > Hintergrund: Es gibt bewusst **nicht** `status:open`-`$in` über alle offenen
   > Tage — sonst würden verwaiste, nie geschlossene Alt-Geschäftstage (die in der
   > Praxis vorkommen) mit angezeigt. „Aktueller Geschäftstag" meint exakt den
   > `location.currentBusinessDay`-Pointer (dieselbe Quelle wie im POS-Client).
   > Bestellungen verwaister Alt-Tage bleiben über die Kalenderfilter erreichbar.

2. **Status-Änderung in der Detail-Ansicht.**
   `apps/admin-client/src/app/features/orders/order-detail.ts` — Button-Gruppe für
   alle vier wählbaren Status (`active`/`production`/`completed`/`aborted`,
   aktueller Status deaktiviert). `changeStatus()` patcht `PATCH /orders/:id
   { status }` und lädt die Order neu; neues Output `statusChanged` aktualisiert
   das Listen-Badge in `order-list.ts`.

   > Nebenwirkung: `→ produced/completed` löst in api-cloud die Bestandsbuchung aus
   > (idempotent über `stockBookedAt`); `→ aborted` erzeugt eine Storno-/Reversal-
   > Buchung (`order.schema.ts` `stockReversedAt`). Für den Aufräum-Use-Case gewollt.

3. **RBAC: `orders:UPDATE` für Owner + Manager.**
   `libs/domains/users/domain/src/lib/roles.matrix.ts` —
   `TENANT_OWNER` ORDERS: `READ` → `[READ, UPDATE]`;
   `TENANT_MANAGER` ORDERS: `[CREATE, READ, DELETE]` → `[CREATE, READ, UPDATE, DELETE]`.
   Ohne `UPDATE` hätte der Status-PATCH mit `403 Forbidden` geendet
   (`authorize()`-Hook). Der `orderPatchResolver` blockt `status` nicht — der PATCH
   ist serverseitig erlaubt, kein Schema-Change nötig.

## Anzeige: Person + Geschäftstag

- **Geschäftstag-Spalte/-Feld:** Tabelle und Detail zeigen das Datum des
  Geschäftstags (aufgelöst aus `businessDayId` über den `businessdays`-Service).
  Wichtig zur Abgrenzung von `createdAt`: eine kurz nach Mitternacht erfasste
  Order (z. B. `createdAt` 23.05. 00:37) kann zum Geschäftstag 22.05. gehören.
- **Person:** Fallback-Kette `staffPaymentInfo.userName` →
  `customerPaymentInfo.customerName` → Ersteller-Name (aufgelöst aus
  `creationContext.createdBy` via `users`-Service) → `–`. Telefon-Bestellungen
  ohne Kunden-/Mitarbeiter-Bezug zeigen den Ersteller; ist die `createdBy`-ID auf
  dem Edge nicht (mehr) vorhanden, bleibt `–`.

## Konsequenzen

- POS-Client bleibt unverändert: zeigt offene Bestellungen weiterhin nur aus dem
  aktuellen Geschäftstag (`location.currentBusinessDay`). Der frühere Fall
  „POS zeigt nichts" entstand durch einen Tagesabschluss trotz offener Orders und
  wird durch die separat ergänzte Closing-Vorbedingung verhindert.
- Operator-Ausweg bei hängenden Orders: Admin-Panel → Filter „Aktueller
  Geschäftstag" → Status auf „Abgeschlossen"/„Storniert" setzen → Tagesabschluss
  ist nicht mehr blockiert.
- i18n-Keys ergänzt: `ORDERS.TIME_BUSINESS_DAY`, `ORDERS.CHANGE_STATUS`
  (de/en/tr).
