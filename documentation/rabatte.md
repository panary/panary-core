---
title: Rabatte — Datenmodell, Anwendungslogik & Sync
date: 2026-05-25
category: Architektur
domains: [discounts, orders]
status: active
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
  `target`, `lineItemId?`, `isStaffMeal?`). Additiv zum Legacy-Feld
  `order.discount`, das als Spiegel erhalten bleibt (Aggregator/Bon-Reader).
- Die kanonische Engine `computeOrderTax` (`@panary/orders/domain`, siehe
  [order-bundle-pricing-modell.md](order-bundle-pricing-modell.md)) ist führend:
  ist `appliedDiscounts` gesetzt, nutzt sie diese; sonst Fallback `order.discount`.
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

## Personalessen

Ein manueller Rabatt mit `isStaffMeal: true`. Beim Anwenden am POS
(`order-dialog.placeOrder`) wird zusätzlich `order.staffPaymentInfo` gestempelt —
die Subventions-/COGS-/Z-Bon-Logik (`businessdays/aggregator`) bleibt damit
unverändert korrekt. Personalessen ist also **Preisreduktion + Subventions-
Tracking**, nicht das eine oder andere.

## Services & Sync

- **Edge** (`apps/api-edge/src/services/discounts/`): read-only Spiegel,
  `cloudManaged()` blockt externe Writes nach Pairing. JSON-Array-Felder via
  `getJsonFieldHooks`. In `SyncableMasterDataService` registriert (Pull
  Cloud→Edge).
- **Cloud** (`panary-cloud/apps/api-cloud/src/services/discounts/` +
  `discount-codes/`): Source of Truth via `registerMongoService`
  (`booleanFields`, `dateFields`, `stripNullPayload`). `discount-codes` ist
  Cloud-only (kein Edge-Sync — Offline-Counter-Problem).
- **RBAC** (`@panary/users/domain`): `AppResource.DISCOUNTS` (OWNER/MANAGER/
  TECHNICIAN MANAGE, STAFF/DEVICE_POS/DEVICE_TABLET READ) +
  `DISCOUNT_CODES` (MANAGE für OWNER/MANAGER/TECHNICIAN).

## Offen / Folgeschritte

- POS-Rabatt-Picker-UI (Auswahl aus `@panary/discounts/data-access`
  `loadActivePosDiscounts`) — braucht Edge-Stack-UAT.
- Promo-Code-Einlösung + atomarer `usageCount`-Inc + Public-Validate — an die
  Storefront-Roadmap Phase 5 gekoppelt.
- MwSt-Korrektur (Phase 0) gegen echte Bons validieren.
