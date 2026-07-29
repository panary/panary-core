---
type: Domain Concept
title: 'Rabatte — Datenmodell, Anwendungslogik & Sync'
description: 'Rabattsystem für POS und Storefront: Domänen-Lib @panary/discounts/domain, Anwendung über order.appliedDiscounts mit MwSt-Extraktion, Automatik-Hook, Personalessen, discount-mutex und Edge-Sync.'
tags: [discounts, orders, sync, pos]
status: stable
generated: { by: claude-code/historic, at: 2026-05-25T00:00:00Z }
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
  `target`, `lineItemId?`, `isStaffMeal?`). Löst das Legacy-Feld `order.discount`
  ab: ist `appliedDiscounts` nicht-leer, ist es führend und `order.discount` wird
  server-seitig geleert (siehe „discount-mutex" unten).
- Die kanonische Engine `computeOrderTax` (`@panary/orders/domain`, siehe
  [0004-order-bundle-pricing-modell.md](../adr/0004-order-bundle-pricing-modell.md)) ist führend:
  ist `appliedDiscounts` gesetzt, nutzt sie diese; sonst Fallback `order.discount`.

### discount-mutex — Einweg-Migration (Fix 2026-07-04)

Der Frontend-Data-Access (`order.service.ts`) setzt beim Anlegen einer
rabattierten Order **beide** Felder — `appliedDiscounts` (führend) und
`order.discount` als „Legacy-Spiegel". Damit ohne diese Regel ein fachlich
unwirksamer `discount` als stale „Karteileiche" in DB/Sync/Audit zurückbliebe
(Mehrdeutigkeit „welcher Rabatt gilt?"), wird die Invariante serverseitig
erzwungen: sobald ein Create/Patch (nicht-leere) `appliedDiscounts` schreibt,
gewinnt das neue Feld und `order.discount` wird **aktiv auf `null` geleert**.

- **Helper (Single Source of Truth):** `clearLegacyDiscountIfApplied`
  (`@panary/orders/domain → pricing/discount-mutex.ts`).
- **Verdrahtung:** `discount`-Data-Resolver in Edge
  (`apps/api-edge/src/services/orders/orders.schema.ts`) **und** Cloud
  (`apps/api-cloud/src/services/orders/orders.schema.ts`), je für create + patch.
- **`null` statt `undefined`:** damit ein PATCH einen bereits gespeicherten
  Legacy-`discount` tatsächlich überschreibt statt ihn nur wegzulassen. Cloud
  greift auch für Sync-Push-Creates (Alt-Edge-Daten werden mitbereinigt).
- Ist `appliedDiscounts` leer/ungesetzt, bleibt `order.discount` als aktiver
  Fallback unverändert. Sicher, weil alle Reader (Tax-Engine + Bon-Renderer via
  `computeOrderTax`) `appliedDiscounts` bevorzugen und `null`/`undefined`
  discount identisch behandeln.
- **Reihenfolge:** erst LINE-Rabatte (auf der jeweiligen Position, summen-exakt
  über die Steuer-Atome verteilt), dann ORDER-Rabatte auf die Restsumme.
  Festbeträge via Largest-Remainder. `computedAmountCents` wird von der Engine
  zurückgeschrieben. Tax-Integrität (netto + steuer = brutto) bleibt pro Satz.

### MwSt-Extraktion (Phase 0)

Die Engine **extrahiert** die enthaltene MwSt aus dem Brutto-Preis
(`netFromGross`) statt sie aufzuschlagen. Der Brutto-Betrag bleibt unverändert,
nur der Netto-/Steuer-Ausweis ist korrekt (konsistent zum Reporting-Aggregator).
Beispiel 1,19 € @19 %: netto 1,00 € / steuer 0,19 €. **KassenSichV-relevant** —
vor Produktivgang gegen echte Bons / mit dem Steuerberater validieren.

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
- Offene Klärung: Patcht ein Flow einen Legacy-`discount` auf eine Order mit
  bestehenden `appliedDiscounts` (z. B. Automatik-Rabatt), bleibt
  `appliedDiscounts` engine-seitig führend — der gepatchte Legacy-Rabatt wirkt
  dann nicht auf den Snapshot. Kombinationsregel dafür ist fachlich zu klären.

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
- **Positionsrabatte** (`target: 'line'`) sind bewusst Phase 2 — der Picker ist
  Order-Level. Mehrfach-/Automatik-Kombination folgt der Engine-Reihenfolge
  (LINE vor ORDER).

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

## Offen / Folgeschritte

- POS-Rabatt-Picker: Live-Stack-UAT (Rabatt in Cloud anlegen → Edge-Sync →
  am POS anwenden) gegen eine gepairte Edge ausstehend; Build/Typecheck grün.
- Positionsrabatte (`target: 'line'`) im POS-Picker (Phase 2).
- Promo-Code: Verwaltung (Admin) **und** Einlöse-Backend (append-only
  `discount-code-redemptions`, atomare Validierung) sind gebaut. **Noch offen,
  weil Client/Infrastruktur fehlt:** (a) **öffentlicher Storefront-Validate-
  Endpoint** für anonymen Cart-Preview — braucht die Tenant-Auflösung der
  Storefront (Subdomain/Tenant-Kontext für nicht-authentifizierte Requests);
  (b) **POS-Code-Eingabe** — der POS spricht den Edge, Codes sind aber Cloud-only;
  erfordert die Offline-Entscheidung (R1) + einen Edge→Cloud-Online-Proxy;
  (c) **Storefront-Checkout** (`orders.channel=ONLINE` + Mollie), der die
  Einlösung tatsächlich aufruft. Alle drei mit der Storefront-Roadmap Phase 5.
- MwSt-Extraktion (Phase 0): Probeberechnung dokumentiert + 22 Engine-Tests grün
  (siehe `0004-order-bundle-pricing-modell.md` → „MwSt-Extraktion — Korrektur &
  Probeberechnung"); Spot-Check gegen einen physischen Bon optional.
