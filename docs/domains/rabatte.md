---
type: Domain Concept
title: 'Rabatte — Datenmodell, Anwendungslogik & Sync'
description: 'Rabattsystem für POS und Storefront: Domänen-Lib @panary/discounts/domain, Anwendung ausschließlich über order.appliedDiscounts mit MwSt-Extraktion, Automatik-Hook, Order- und Positionsrabatten am POS, Personalessen, Rabatt-KPI und Edge-Sync.'
tags: [discounts, orders, sync, pos]
status: stable
generated: { by: claude-code/opus-5, at: 2026-08-14T22:55:00Z }
---

# Rabatte (Discounts)

Verwaltbares Rabatt-System für POS und (perspektivisch) Online-Storefront.
Orientiert an Shopify, auf die Gastronomie zugeschnitten. Drei Auslöse-Arten
(`method`): **manuell** (Kassierer wählt am POS), **automatisch** (Happy Hour /
Bedingungen) und **code** (Promo-Code, Storefront-affin).

## Domänen-Lib `@panary/discounts/domain`

| Datei | Inhalt |
|---|---|
| `discount.schema.ts` | Rabatt-**Definition** (Regel): `method` (manual/automatic/code), `target` (order/line), `valueType` (percent/amount) + `valuePercent`/`valueCents`, `appliesTo` (all/categories/products), `eligibility`, `minRequirement`, Aktiv-Zeitraum + `recurringWeekdays`/`recurringStartTime`/`recurringEndTime`, `channels`, `combinable`, `isStaffMeal`, `usageLimitTotal`/`onePerCustomer`, `status` (DRAFT/ACTIVE/ARCHIVED). |
| `discount-code.schema.ts` | Code-**Instanz** (Phase 3): `code`/`codeUpper` (case-insensitive unique je Tenant), `isShared`, `usageCount` (server-managed), `usageLimit`, `expiresAt`. |
| `discount-apply.ts` | Reine, order-agnostische Funktionen: `resolveDiscountAmountCents`, `isDiscountApplicable`, `deriveDiscountDisplayStatus`, `validateDiscountConsistency` sowie die Automatik-Bedingungen (`isWithinRecurringWindow`, `meetsMinRequirement`, `isEligibleCustomer`, `matchesScope`, `evaluateAutomaticDiscounts`). Kontext wird vom Aufrufer übergeben → keine Abhängigkeit zu `orders/domain`. |

**Geldeinheit:** `valueCents` (Integer) für Festbeträge — konsistent zum
cents-basierten `order-interactions.discountAmountCents`-Audit und der Tax-Engine.
`SCHEDULED`/`EXPIRED` werden nicht gespeichert, sondern read-time aus dem
Aktiv-Zeitraum abgeleitet (`deriveDiscountDisplayStatus`).

## Anwendung auf die Order

- `order.appliedDiscounts[]` (Snapshot je angewandtem Rabatt: `discountId?`,
  `code?`, `valueType`, `valuePercent`/`valueCents`, `computedAmountCents`,
  `target`, `lineItemId?`, `isStaffMeal?`) ist die **einzige** Rabattquelle der Order.
  Das frühere Legacy-Feld `order.discount` ist entfernt (siehe unten).
- Die kanonische Engine `computeOrderTax` (`@panary/orders/domain`, siehe
  [0004-order-bundle-pricing-modell.md](../adr/0004-order-bundle-pricing-modell.md)) rechnet
  ausschließlich auf `appliedDiscounts`.

### Legacy-Feld `order.discount` — entfernt ([ADR 0030](../adr/0030-legacy-rabattfeld-abgeschafft.md))

`order.discount` existiert nicht mehr. Es gibt genau **eine** Rabattquelle je Order:
`appliedDiscounts`.

Die frühere Einweg-Migration („discount-mutex", 2026-07-04) leerte `order.discount`,
sobald ein Create/Patch nicht-leere `appliedDiscounts` schrieb. Sie entschied das allein
am **eingehenden Payload** und sah deshalb nicht, wenn ein Flow nur `{ discount }` auf
eine Order patchte, die in der DB bereits `appliedDiscounts` trug: Der Legacy-Rabatt
wurde gespeichert und von der Engine ignoriert — ein Rabatt ohne Wirkung auf Preis,
`taxSnapshot` und Bon (panary/panary-core#181). Statt einer Kombinationsregel fiel das
Feld weg.

Entfernt wurden: `orderSchema.discount` samt `orderDataSchema`-Pick, der Fallback-Zweig
in `computeOrderTax`, `ORDER_JSON_FIELDS`, die `discount`-Data-Resolver am Edge, der
Legacy-Zweig der Rabatt-KPI und die SQLite-Spalte
(`20260813210000_orders_drop_legacy_discount.ts`).

- **Guard bleibt:** `rejectLegacyDiscount`
  (`apps/api-edge/src/hooks/reject-legacy-discount.hook.ts`) lehnt einen Patch/Create ab,
  der den Schlüssel `discount` überhaupt mitschickt — **inklusive `discount: null`**.
  Regel als reine Funktion: `findLegacyDiscountWrite` / `assertNoLegacyDiscountWrite`
  (`@panary/orders/domain → pricing/discount-mutex.ts`). `additionalProperties: false`
  würde ebenfalls greifen; der Hook läuft aber als **erster** in der Kette — vor
  Sequenznummer und TSE-Start — und nennt beim Namen, was zu tun ist.
- **POS:** `applyCorporateCustomer` schreibt den Vertragsrabatt des Firmenkunden als
  `AppliedDiscount` (`discountId: null`, Name = Kundenname) und **ersetzt** die
  bestehende Liste — konsistent zu `applyDiscount`/`applyStaffMeal`.
- **`discountSchema` / `Discount` bleiben** in `@panary/orders/domain`: Sie beschreiben
  das Konditionen-Shape der **Stammdaten** (`discountDetails` an Kunde, Firmenkunde,
  User, Filiale), aus dem der POS den Snapshot baut — nicht mehr ein Feld der Order.
- **Reihenfolge:** erst LINE-Rabatte (auf der jeweiligen Position, summen-exakt
  über die Steuer-Atome verteilt), dann ORDER-Rabatte auf die Restsumme.
  Festbeträge via Largest-Remainder. `computedAmountCents` wird von der Engine
  zurückgeschrieben. Tax-Integrität (netto + steuer = brutto) bleibt pro Satz.

#### Erkennung von Bestands-Orders

🚨 **Kein automatischer Repair.** Abgeschlossene bzw. TSE-signierte Vorgänge werden nach
KassenSichV nicht stillschweigend umgeschrieben — Treffer werden **berichtet**, nicht
korrigiert. Am Edge ist die Spalte mit der Migration weg; die Erkennung läuft deshalb auf
der Cloud-MongoDB, wo die gepushten Orders liegen (Zugang: ephemerer SSH-Tunnel, siehe
Betriebsdoku):

```js
// Bestand mit gesetztem Legacy-Rabatt (wirkungslos, sobald appliedDiscounts existiert)
db.orders.countDocuments({ discount: { $ne: null, $exists: true } })

db.orders
  .find(
    { discount: { $ne: null, $exists: true } },
    { _id: 1, tenantId: 1, locationId: 1, createdAt: 1, discount: 1, appliedDiscounts: 1, 'taxSnapshot.brutto': 1 },
  )
  .sort({ createdAt: 1 })
  .limit(50)
```

Ein Treffer mit **nicht-leerem** `appliedDiscounts` ist der Fall aus #181: Der
gespeicherte `discount` war schon vor der Entfernung wirkungslos, der `taxSnapshot`
stimmt also weiterhin. Ein Treffer **ohne** `appliedDiscounts` hatte einen wirksamen
Legacy-Rabatt — dort ist der `taxSnapshot` korrekt, aber die Rabattherkunft ist nach der
Feld-Entfernung nicht mehr auslesbar.

### Rabatt-KPI im Tagesabschluss

`aggregateFinancials` (`@panary/businessdays/aggregator → financials.ts`) zählt
`appliedDiscounts` und summiert deren `computedAmountCents` — den von
`computeOrderTax` zurückgeschriebenen, tatsächlich abgezogenen Brutto-Betrag. Eine
Eine Rückrechnung ist damit nicht nötig.

- **`discountsCount` ist PRO ORDER**, nicht pro Rabatt-Eintrag: Der Wert speist die
  Quote rabattierter Bestellungen. Eine Order mit zwei Rabatten ist eine rabattierte
  Order, nicht zwei.
- Bestands-Orders ohne Engine-Durchlauf tragen `computedAmountCents: 0` und zählen als
  rabattiert mit 0 € — statt mit einer geratenen Summe.

Bis 2026-08-13 las die Aggregation **ausschließlich** das inzwischen entfernte
`order.discount`. Da der Mutex genau dieses Feld leerte, sobald `appliedDiscounts`
gesetzt waren, zählte jeder über den POS gewährte Rabatt als **0 Rabatte / 0,00 €** —
im Z-Bon, in der Rabatt-Quote und in der Cloud-Karte „Finanzen".

⚠️ **Cloud-Seite offen** (panary/panary-cloud#253): `LIVE_KPI_ORDER_PROJECTION`
schneidet `appliedDiscounts` noch weg. Beim nächsten Pin-Bump muss das Feld in die
Projektion — `live-kpis.spec.ts` rechnet Fixtures projiziert und unprojiziert gegen
einander und wird sonst rot.

### MwSt-Extraktion (Phase 0)

Die Engine **extrahiert** die enthaltene MwSt aus dem Brutto-Preis
(`netFromGross`) statt sie aufzuschlagen. Der Brutto-Betrag bleibt unverändert,
nur der Netto-/Steuer-Ausweis ist korrekt (konsistent zum Reporting-Aggregator).
Beispiel 1,19 € @19 %: netto 1,00 € / steuer 0,19 €. **KassenSichV-relevant.**

**Gegenprobe gefahren (2026-08-14, panary/panary-core#182).** Die Formel ist gegen die
gesetzliche Divisor-Methode geprüft — nicht gegen sich selbst:
`compute-order-tax.ustg-gegenprobe.spec.ts` hält von Hand nach § 10 Abs. 1 Satz 2 UStG
gerechnete Werte dagegen (netto = brutto / (1 + p/100)), Rechenweg je Fall im Kommentar.
15 Fälle: Einzelsätze 19 %/7 %, gemischter Bon, Prozent- und Festbetrag-Rabatt inklusive
Largest-Remainder-Rest.

🔎 **Warum eine zweite Spec-Datei, obwohl 22 Engine-Tests grün waren:** Deren Erwartungen
stammen aus derselben Herleitung wie die Implementierung — ein Methodenfehler wäre darin
unsichtbar geblieben. Die Mutationsprobe belegt den Unterschied: `netFromGross` auf
Abschlag-vom-Brutto umgestellt, 14 der 15 Gegenprobe-Fälle werden rot (11,90 € liefert dann
netto 964 / steuer 226 statt 1000 / 190 — 36 ct Steuer zu viel auf einem Zwölf-Euro-Bon).

⚠️ **Grün blieb ausgerechnet „Σ netto + Σ steuer === brutto".** Die Aufrechnungs-Invariante
hält auch bei falscher Methode, weil `steuer` als `brutto − netto` definiert ist. Sie ist
also **kein** Nachweis der Methode — ein Bon kann sich sauber aufrechnen und trotzdem den
falschen Steuerbetrag ausweisen. Wer die Extraktion künftig anfasst, prüft gegen die
Gegenprobe, nicht gegen die Summenzeile.

Ein Spot-Check gegen einen physisch gedruckten Bon steht weiterhin aus; er prüft die
Druckstrecke, nicht mehr die Formel.

## Automatische Rabatte (Phase 2)

`apps/api-edge/src/hooks/apply-automatic-discounts.ts` läuft als `before.create`
der Order **vor** `calculateTaxDetails`: lädt tenant-scoped die aktiven
Automatik-Rabatte, wertet sie via `evaluateAutomaticDiscounts` gegen die Order
aus und injiziert den **günstigsten** als `appliedDiscounts`.

**Kombinationsregel (konservativ):** Automatik greift nur, wenn kein manueller
Rabatt gesetzt ist; kein Stacking. Geltungsbereich am Order-Level: PRODUCTS via
`lineItem.externalId`, CATEGORIES via `productGroupExternalId`.

## Serverseitiger taxSnapshot bei Order-Patches (Fix 2026-07-03)

**Problem:** `calculateTaxDetailsOnPatch` existierte seit Feb 2026 in
`apps/api-edge/src/hooks/calculate-tax-details.ts`, war aber nie in der
`before.patch`-Kette der Orders registriert. Der POS-Client patcht Rabatte als
reines `{ discount }` (Prozent-Rabatt, Personalessen via `discountDetails`,
Firmenkunde) — der fiskalische `taxSnapshot` blieb dadurch auf dem
create-Stand (unrabattiert): falscher MwSt-Ausweis auf Beleg (`issueReceipt`)
und in jeder Snapshot-basierten Auswertung.

**Entscheidung:** Hook in `before.patch` registriert — nach den Guards
(`checkMultiOperation`, `restrictOrderToCashSession`), **vor**
`signOrderTseFinish` (Steueraufteilung steht beim Signieren/Belegen fest) und
vor `validateData`/`resolveData` (berechneter Snapshot wird mitvalidiert;
Spiegel zur create-Kette). Der Hook rechnet bei allen per Patch erreichbaren
preisrelevanten Engine-Inputs neu: `discount` (auch `null` = Rabatt
entfernen), `appliedDiscounts`, `dineLocation` (19 % ↔ 7 %). `lineItems`
blockt der `orderPatchResolver` — Positionen sind nur beim create formbar.

**Konsequenzen:**
- Der Server ist für den Snapshot auch bei Patches autoritativ; ein
  client-gelieferter `taxSnapshot` wird bei preisrelevanten Patches überschrieben.
- Bestands-Orders, die vor dem Fix einen Rabatt-Patch erhielten, tragen einen
  veralteten (unrabattierten) Snapshot. Kein automatischer Repair —
  abgeschlossene/signierte Vorgänge werden nicht stillschweigend umgeschrieben
  (KassenSichV-Unveränderbarkeit); Erkennung: `discount`/`appliedDiscounts`
  gesetzt UND `taxSnapshot.brutto ≠ computeOrderTax(order).brutto`.
- ~~Offene Klärung: Kombinationsregel für einen Legacy-`discount`-Patch auf eine
  Order mit bestehenden `appliedDiscounts`.~~ **Erledigt 2026-08-13** — es gibt keine
  Kombinationsregel, das Legacy-Feld ist abgeschafft
  ([ADR 0030](../adr/0030-legacy-rabattfeld-abgeschafft.md)). Ein externer
  `discount`-Schreibzugriff wird mit `400` abgelehnt, statt wirkungslos gespeichert zu
  werden.

Specs: `calculate-tax-details.spec.ts` (Hook-Verhalten) +
`test/services/orders/orders.test.ts` (Integration: Registrierung in der
echten Hook-Kette, cent-korrekt gegen `computeOrderTax`).

## Personalessen

Ein manueller Rabatt mit `isStaffMeal: true`. Beim Anwenden am POS
(`order-dialog.placeOrder`) wird zusätzlich `order.staffPaymentInfo` gestempelt —
die Subventions-/COGS-/Z-Bon-Logik (`businessdays/aggregator`) bleibt damit
unverändert korrekt. Personalessen ist also **Preisreduktion + Subventions-
Tracking**, nicht das eine oder andere.

### Zuweisung pro Mitarbeiter (seit 2026-07-29)

Welcher Rabatt gilt, steht am Benutzer: `user.staffMealDiscountId` referenziert
einen `isStaffMeal`-Rabatt. Drückt der Kassierer „Personalessen", löst der
Bestelldialog die Referenz gegen den lokalen Rabatt-Bestand auf und wendet sie
ohne Auswahl an. Läuft sie ins Leere (archiviert/gelöscht/noch nicht
synchronisiert), wird ohne Nachlass erfasst statt abgelehnt.

Die frühere Wertkopie `user.discountDetails` wird für diesen Pfad **nicht mehr
gelesen** (Kunden/Firmenkunden nutzen die Struktur weiter). Gepflegt wird die
Zuweisung in der Cloud-Admin-UI; Standard, Vorbelegung und Rechte:
`panary-cloud/docs/domains/personalessen-rabatt.md`.

### Exklusivität

Trägt eine Bestellung `staffPaymentInfo`, führt sie **genau den einen**
Personalessen-Rabatt und sonst keinen — sonst ließen sich Rabatte stapeln
(100 % Personalessen + 20 % Stammgast) und die Subventions-Auswertung könnte den
Arbeitgeber-Zuschuss nicht mehr zuordnen. Außerhalb von Personalessen bleiben
Rabatte normal kombinierbar.

Quelle der Regel: `assertStaffMealDiscountExclusivity` /
`findStaffMealDiscountConflict` in `pricing/staff-meal-exclusivity.ts` — genutzt
vom Edge-Hook `validateStaffMealExclusivity` (orders create + patch, merged
Vorzustand + Body) und vom POS für die UI-Sperre. `applyAutomaticDiscounts`
überspringt Personalessen-Bestellungen ganz, statt einen Rabatt einzusammeln, an
dem die Bestellung anschließend scheitert.

## POS-Anwendung (Rabatt-Picker)

Im Order-Dialog (`@panary/orders/feature-pos-order-dialog`) öffnet der
„Rabatt"-Button (`sell`-Icon, untere Leiste) den `DiscountPickerDialogComponent`.
Dieser lädt über `DiscountService.loadActivePosDiscounts()` die aktiven,
**manuellen** Rabatte des POS-Kanals (Cloud-gepflegt, per Sync am Edge) und gibt
die Auswahl zurück.

- Die Auswahl wird als **Order-Level**-Snapshot (`target: 'order'`, `method:
  'manual'`, `discountId` gesetzt) beim `placeOrder` in `appliedDiscounts[]`
  geschrieben; die kanonische Engine füllt `computedAmountCents`.
- Ist der Rabatt `isStaffMeal`, stempelt der Flow zusätzlich
  `order.staffPaymentInfo` (siehe Personalessen).
- Der Dialog zeigt den rabattierten Gesamtbetrag live über `computeOrderTax`
  (durchgestrichener Originalpreis + neuer Betrag). Reset bei `deleteOrder()`.
## POS-Anwendung (Positionsrabatt)

Ein Nachlass auf **eine** Bestellzeile — Kulanz für einen reklamierten Artikel,
ohne die ganze Bestellung zu rabattieren (panary/panary-core#179). Bedienung:
Zeile im Warenkorb antippen, dann den `percent`-Knopf in der unteren Leiste. Er
ist deaktiviert, solange keine Zeile markiert ist.

Die reine Logik liegt in `line-discount.ts` (`evaluateLineDiscountGate`,
`buildLineAppliedDiscount`, `setLineDiscount`/`removeLineDiscount`/
`pruneLineDiscounts`) — außerhalb des Dialog-Monolithen
([ADR 0011](../adr/0011-order-dialog-monolith.md)) und ohne TestBed prüfbar,
wie `promo-code.ts` nebenan.

- Snapshot mit `target: 'line'` + `lineItemId`; `computedAmountCents` füllt
  ausschließlich `computeOrderTax`. Auch die Vorschau ruft die Engine — eine
  eigene Prozentrechnung an der Zeile wäre eine zweite Wahrheit neben dem
  fiskalischen Snapshot.
- **Einer je Zeile.** Ein zweiter Rabatt auf dieselbe Position ersetzt den
  ersten. Die Engine könnte stapeln (jeder wirkt auf das bereits reduzierte
  Brutto), aber am Bon wäre nicht mehr erkennbar, worauf sich welcher Satz bezog.
- **Kombinierbar mit Order-Rabatt und Code.** Reihenfolge ist die der Engine:
  LINE zuerst, ORDER danach auf die **verbleibende** Summe. 20 % auf eine
  10-€-Zeile plus 10 % auf die Bestellung (Rest 8 €) ergibt 14,40 € — nicht
  14,20 €, wie die Lesart „beide Rabatte auf die Ausgangssumme" nahelegt.
- **Personalessen sperrt.** Trägt die Bestellung `staffPaymentInfo`, ist genau
  der zugewiesene Rabatt erlaubt (`assertStaffMealDiscountExclusivity`); der
  Knopf meldet das statt einen 400er zu provozieren. Der Snapshot trägt deshalb
  hart `isStaffMeal: false`.
- Entfernen über das ×-Zeichen am Rabatt-Badge der Zeile. Rabatte verwaister
  Zeilen werden beim Löschen aufgeräumt (`pruneLineDiscounts`), Reset bei
  `deleteOrder()`.

> 🚨 **Mehrdeutige Zeilen-ID sperrt den Positionsrabatt.** `lineItem._id` ist die
> **Produkt-ID** (`increaseLineItem`: `_id: product._id`), nicht je Zeile vergeben.
> Für gewöhnliche Artikel bleibt sie eindeutig, weil der Duplikat-Check dort die
> Menge erhöht statt eine zweite Zeile anzulegen — für Bundles ist dieser Check
> ausgesetzt, zwei gleiche Menüs ergeben also zwei Zeilen mit derselben `_id`.
> `computeOrderTax` matcht Positionsrabatte über genau diese `lineItemId`, der
> Rabatt träfe die Steuer-Atome **beider** Zeilen: eine Position rabattiert,
> zwei abgezogen — still, weil die Summe plausibel aussieht. `evaluateLineDiscountGate`
> lehnt diesen Fall deshalb ab. Die Ursache (Zeilen-ID = Produkt-ID) bleibt offen.

**Die Picker-Auswahl ist in beiden Modi dieselbe** und bewusst **nicht** auf
`discount.target` gefiltert: Die Cloud-Admin-UI schreibt das Feld hart auf
`'order'` (kein Formularfeld), ein Filter auf `'line'` liesse den Picker also
immer leer. Fachlich ist „Kulanz 20 %" ohnehin derselbe Rabatt, ob er auf eine
Position oder die Bestellung wirkt — das Ziel entsteht durch die Verwendung
(`appliedDiscount.target`), nicht durch die Definition.

## POS-Anwendung (Rabattcode)

Neben dem Rabatt-Picker sitzt der Code-Knopf (`confirmation_number`), der den
`PromoCodeDialogComponent` öffnet: Touch-Tastatur, Eingabe, „Prüfen".

**Codes sind strikt online** ([ADR 0032](../adr/0032-promo-codes-am-pos-strikt-online.md)).
Sie werden nicht an den Edge gesynct — ein lokaler Zähler erzeugte bei mehreren
Kassen Lost Updates. Der Edge reicht stattdessen durch:

| Schritt   | Wann                | Aufruf                                             |
| --------- | ------------------- | -------------------------------------------------- |
| Prüfen    | beim „Prüfen"-Tipp  | `discount-code-redeem.find` → Cloud, kein Verbrauch |
| Einlösen  | beim `placeOrder`   | `discount-code-redeem.create` → Cloud, atomar       |

Die Trennung ist der Kern: Würde schon die Prüfung einlösen, verbrauchte ein
Abbruch nach der Eingabe den Code — bei `usageLimit: 1` unwiederbringlich.

**Zwei Ablehnungsklassen, im Dialog verschieden gefärbt:**

- **fachlich** (rot) — `not_found`, `expired`, `limit_reached`, `wrong_customer`,
  `discount_inactive`. Kommt von der Cloud als `200` mit `ok: false`.
- **technisch** (amber) — `not_paired`, `cloud_unreachable`. Entsteht am Edge; ein
  `401`/`429`/`5xx` der Cloud zählt hier hinein und **nie** als „Code ungültig".

Weitere Regeln:

- Beim Abschluss wird erneut eingelöst und damit erneut geprüft: Zwischen Eingabe
  und Kassiervorgang kann eine andere Kasse dasselbe Limit aufgebraucht haben.
  Schlägt das fehl, läuft die Bestellung **ohne** Code weiter (mit Hinweis) —
  der Gast steht an der Kasse, die Ware ist erfasst.
- Der Snapshot trägt `method: 'code'`, `code`, `discountCodeId` und `discountId`;
  `computedAmountCents` füllt wie überall die kanonische Engine.
- **Die Einlösung kennt ihre Bestellung.** Der POS vergibt die Order-`_id` (uuidv7)
  **vor** der Einlösung und reicht sie an beide Aufrufe: an `redeem({ orderId })` und
  als `_id` an `createOrder`. Der Edge-Resolver übernimmt eine mitgegebene `_id` —
  derselbe Weg, den der Offline-Pfad seit jeher nutzt.

  Die Reihenfolge ist erzwungen: Die Einlösung braucht die ID, die Bestellung darf
  aber erst *nach* erfolgreicher Einlösung entstehen (sonst bekäme der Gast bei einem
  aufgebrauchten Code den Rabatt ungezählt). Schlägt die Einlösung fehl, fällt die
  vorab vergebene ID weg und die Bestellung bekommt ihre wie gewohnt vom Server.
  Gekapselt in `redeemCodeForOrder` (`promo-code.ts`), dort auch getestet.

  ⚠️ **Bewusst in Kauf genommen:** Scheitert das *Anlegen* der Bestellung nach einer
  erfolgreichen Einlösung, zeigt die Einlösung auf eine Order, die es nicht gibt. Das
  ist ein auffindbarer Zustand — der Vorgänger (`orderId: null` bei jeder Einlösung)
  war es nicht.
- Ein per Code gewährter Rabatt ist **nie** `isStaffMeal` — sonst stempelte die
  Bestellung `staffPaymentInfo` und liefe in die Exklusivitätsprüfung.
- Gesperrt bei Personalessen und bei bereits gewähltem manuellem Rabatt
  (`evaluatePromoCodeGate` in `promo-code.ts`, dort auch getestet).
- Reset bei `deleteOrder()` wie beim manuellen Rabatt.

## Nachlass auf dem Beleg (seit panary/panary-core#228)

Der persistente Beleg (`@panary/receipts/domain`, §146a AO) trägt den gewährten
Nachlass als eigenes Snapshot-Feld `discounts`. Vorher fehlte er vollständig, und der
Beleg rechnete sich für den Gast nicht auf: die Positionen tragen ihre
**unrabattierten** `lineTotal`, `totalGross` ist rabattiert — die Differenz stand
unerklärt da (an der Test-Order oben gemessen: Positionen 11,90 €, „Gesamt" 9,52 €).

| Stelle | Verhalten |
|---|---|
| `receipt.schema.ts` | `discounts?: Array<{ name, amount }> \| null`. `amount` ist der abgezogene **Brutto**-Betrag in Währungseinheiten, positiv — das Vorzeichen setzt die Darstellung. |
| `receipt-builder.ts` | `buildReceiptSnapshot` liest `order.appliedDiscounts` und übernimmt `computedAmountCents` — den von `computeOrderTax` zurückgeschriebenen, tatsächlich abgezogenen Betrag. **Nicht** die Definition (`valuePercent`/`valueCents`): die überzeichnet den Abzug, sobald die Engine auf die Basis klemmt. |
| `receipt-escpos.renderer.ts` | Zeile `Nachlass: <Name>` + negativer Betrag je Rabatt, direkt unter den Positionen (sie ist eine Minderung genau dieses Blocks). |
| `buildReceiptHtml` | dieselbe Zeile im Abrufpfad `receipts.panary.io/r/<token>`. |

Drei Entscheidungen, die im Code als Kommentar stehen und hier ihren Grund tragen:

- **Bestand wird nicht nachgerechnet.** Vor #228 ausgestellte Belege bleiben, wie sie
  sind — der Snapshot ist unveränderbar (KassenSichV), ein Backfill ließe den
  `renderHash` gegen den bereits ausgelieferten Beleg laufen. Die Spalte kommt daher
  ohne Default und ohne Backfill (`20260814213000_receipts_add_discounts.ts`); `NULL`
  heißt „kein Rabatt **oder** vor #228 ausgestellt".
- **Ohne Rabatt fehlt das Feld ganz**, statt als leeres Array dazustehen. Damit ist die
  kanonische JSON eines rabattfreien Belegs byte-identisch zu vorher — nur rabattierte
  Belege ändern ihren `renderHash`.
- **Wirkungslose Rabatte (0 ct) erscheinen nicht** — eine Nachlasszeile über 0,00 €
  erklärt keine Differenz. Ein Rabatt **ohne** Namen fällt auf „Nachlass" zurück:
  `minLength: 1` risse sonst die Beleg-Validierung, und weil der `issue-receipt`-Hook
  Fehler bewusst schluckt (der Order-Flow darf nie brechen), fiele der Beleg dann
  still komplett aus.

⚠️ **Was das nicht heilt.** `receipt.lineItems[].lineTotal` ist `amount × price` und
lässt Modifier, Menü-Komponenten und `FIXED_PROPORTIONAL` außen vor — bei solchen
Zeilen weicht die Positionssumme des Belegs unabhängig vom Rabatt von der Engine ab.
Kanonisch wäre `lineItemGrossCents` (`@panary/orders/domain`), die der POS-Bon bereits
nutzt. Ebenfalls unberührt: der **POS-Bon** (`order-receipt.renderer.ts`) weist den
Nachlass weiterhin nicht aus, obwohl sein „Gesamt" über `computeOrderTax` rabattiert
ist — dort besteht dieselbe Lücke wie vor #228 auf dem Beleg.

## Services & Sync

- **Edge** (`apps/api-edge/src/services/discounts/`): read-only Spiegel,
  `cloudManaged()` blockt externe Writes nach Pairing. JSON-Array-Felder via
  `getJsonFieldHooks`. In `SyncableMasterDataService` registriert (Pull
  Cloud→Edge).
- **Cloud** (`panary-cloud/apps/api-cloud/src/services/discounts/` +
  `discount-codes/`): Source of Truth via `registerMongoService`
  (`booleanFields`, `dateFields`, `stripNullPayload`). `discount-codes` ist
  Cloud-only (kein Edge-Sync — Offline-Counter-Problem). `codeUpper` ist
  server-managed: der Data- **und** Patch-Resolver leiten ihn aus `code` ab
  (case-insensitive Unique `{tenantId, codeUpper}`); `usageCount` ist
  `protectFromExternal`.
- **Admin-Code-Verwaltung** (`discounts/feature-admin` → discount-details,
  `method=code`): „Rabattcode"-Card legt einen **geteilten** Code (z. B.
  `WILLKOMMEN10`) an/bearbeitet ihn (+ optional Nutzungslimit, Ablaufdatum) über
  `DiscountCodesService` (`@panary-cloud/discounts/data-access`). Anlegen erst
  nach dem ersten Speichern des Rabatts (Code braucht `discountId`).
- **Einlösung** (`api-cloud/src/services/discount-code-redemptions/`):
  **append-only** Log (`@panary/discounts/domain → discount-code-redemption`).
  `create` = Einlösung-oder-Ablehnung — löst den Code tenant-scoped auf, prüft
  `evaluateCodeRedeemability(code, discount, { redemptionCount, customerId })`
  gegen den **autoritativen Log-Zähler** (nicht den `usageCount`-Cache), stempelt
  `discountCodeId`/`discountId`/`code` server-seitig und lehnt nicht-einlösbare
  Codes mit `400` ab. After-Hook synct `usageCount` best-effort. Kein externes
  `patch`/`remove` (Log unveränderlich), Cloud-only. **Warum Log statt Counter:**
  nebenläufige Einlösungen + künftiger Edge→Cloud-Push würden bei read-modify-
  write Lost Updates erzeugen (Plan R4).
- **RBAC** (`@panary/users/domain`): `AppResource.DISCOUNTS` (OWNER/MANAGER/
  TECHNICIAN MANAGE, STAFF/DEVICE_POS/DEVICE_TABLET READ) +
  `DISCOUNT_CODES` (MANAGE für OWNER/MANAGER/TECHNICIAN) +
  `DISCOUNT_CODE_REDEMPTIONS` (CREATE+READ für OWNER/MANAGER/STAFF, append-only).

## Live-Verifikation am Stack (2026-08-14)

Durchstich gegen einen laufenden lokalen Stack gefahren (api-cloud + api-edge + SQLite,
panary/panary-core#182). Gemessen, nicht abgeleitet — die Erwartungswerte waren **vor** dem
Lauf von Hand gerechnet:

| Prüfpunkt | Ergebnis |
|---|---|
| Rabatt in der Cloud anlegen → Edge | kommt an; `isStaffMeal` als echtes `boolean` (nicht SQLite-0/1), `channels` als Array (nicht JSON-String) |
| Picker-Query (`status=ACTIVE&method=manual`) | liefert die POS-Rabatte mit korrekten JS-Typen |
| Rabatt anwenden (20 % auf 11,90 € take-out) | `taxSnapshot` = 7 %: netto 6,73/steuer 0,47 · 19 %: netto 1,95/steuer 0,37 · brutto 9,52 — cent-genau wie handgerechnet |
| `computedAmountCents` | serverseitig auf 238 gefüllt |
| Legacy-`discount` bei create | `400` mit Klartext — auch bei `discount: null` |
| Personalessen (50 %) | brutto 5,95, `staffPaymentInfo` gestempelt, `computedAmountCents` 595 |
| Exklusivität | zweiter Rabatt → `400` „Personalessen-Bestellungen erlauben keine zusätzlichen Rabatte" |
| Rabatt-KPI (`aggregateFinancials`) | `discountsCount` 2 (pro Order), `discountsCents` 833 = 238 + 595 |
| Rabattcode-Ausfallpfad | Cloud antwortet `401` → Edge meldet `cloud_unreachable` (technisch/amber), **nicht** „Code ungültig" |

## Offen / Folgeschritte

- ✅ **Der Beleg weist den Nachlass aus** (panary/panary-core#228) — siehe „Nachlass auf dem
  Beleg" oben. Der Sichttest am laufenden Stack steht noch aus.
- 🚨 **Der POS-Bon weist den Nachlass weiterhin nicht aus.** `order-receipt.renderer.ts`
  druckt unrabattierte Positionspreise und ein über `computeOrderTax` rabattiertes
  „Gesamt" — exakt die Lücke, die #228 auf dem Beleg geschlossen hat, nur auf dem Papier,
  das der Gast an der Kasse bekommt. Bei #228 bewusst nicht mitgefixt (anderes Artefakt,
  nicht in den betroffenen Pfaden des Issues).
- ⚠️ **`receipt.lineItems[].lineTotal` ist `amount × price`** und ignoriert Modifier,
  Menü-Komponenten und `FIXED_PROPORTIONAL`. Bei solchen Zeilen rechnet sich der Beleg
  auch mit Nachlasszeile nicht auf; kanonisch wäre `lineItemGrossCents`
  (`@panary/orders/domain`). Derselbe Nebenbefund gilt für `taxSummaryFromLines` (der
  Fallback in `receipt-builder.ts`, greift nur ohne `taxSnapshot`): er rechnet aus den
  unrabattierten `lineTotal` und in Float statt Cent-Integern.
- POS-Rabatt-Picker: der **UI-Klickpfad** (Dialog öffnen, Rabatt wählen, durchgestrichener
  Originalpreis) ist weiterhin ungeprüft — der Durchstich oben lief auf API-Ebene. Ebenso der
  `patch`-Pfad von `calculateTaxDetailsOnPatch`: Patchen auf `orders` verlangt die Rolle
  `DEVICE_POS`, die nur über eine Socket-Verbindung mit API-Key erreichbar ist.
- Positionsrabatte (`target: 'line'`) sind gebaut (panary/panary-core#179).
  **Offen:** (a) Live-Stack-UAT — insbesondere Bon und Z-Bon einer Bestellung mit
  Positions- **und** Order-Rabatt; die Verifikation oben deckt ausschließlich
  **Order**-Rabatte ab; (b) die **mehrdeutige Zeilen-ID** (siehe
  POS-Anwendung oben): Solange `lineItem._id` die Produkt-ID ist, bleibt der
  Rabatt auf einer von zwei gleichen Menü-Zeilen gesperrt statt möglich; (c) ein
  `target`-Feld im Cloud-Rabatt-Formular, falls Definitionen künftig auf ein Ziel
  festgelegt werden sollen — heute schreibt die Admin-UI hart `'order'`.
- Promo-Code: Verwaltung (Admin), Einlöse-Backend (append-only
  `discount-code-redemptions`) und die **POS-Strecke** (Edge-Proxy + Kassendialog,
  [ADR 0032](../adr/0032-promo-codes-am-pos-strikt-online.md), Cloud-Endpunkt
  panary/panary-cloud#271) sind gebaut. **Noch offen:** (a) **öffentlicher
  Storefront-Validate-Endpoint** für anonymen Cart-Preview — braucht die
  Tenant-Auflösung der Storefront (Subdomain/Tenant-Kontext für
  nicht-authentifizierte Requests); (b) **Storefront-Checkout**
  (`orders.channel=ONLINE` + Mollie), der die Einlösung dort aufruft. Beide mit
  der Storefront-Roadmap Phase 5 (panary/panary-cloud#203).
- POS-Rabattcode: **Ausfallpfad live bestätigt** (2026-08-14) — die Cloud antwortete `401`,
  der Edge meldete `cloud_unreachable`, also technisch/amber statt „Code ungültig". Weiterhin
  offen, weil dafür ein gültiges Edge↔Cloud-Pairing nötig ist: der **Gutfall**
  (Prüfen ohne Verbrauch → Einlösen beim `placeOrder`) und die **Kollision** zweier Kassen
  auf demselben `usageLimit: 1`.
- MwSt-Extraktion (Phase 0): Probeberechnung dokumentiert + 22 Engine-Tests grün
  (siehe `0004-order-bundle-pricing-modell.md` → „MwSt-Extraktion — Korrektur &
  Probeberechnung"); Spot-Check gegen einen physischen Bon optional.
