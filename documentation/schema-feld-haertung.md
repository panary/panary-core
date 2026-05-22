---
title: Schema-Feld-Härtung (Inline-Constraints gegen Dokument-Aufblähung)
date: 2026-05-22
category: Sicherheit
domains: [users, apikeys, devices, cloud-connection, cloud-edges, edge-pairing, products, product-groups, ingredients, recipes, pricelists, suppliers, supplier-products, orders, pre-orders, customers, corporate-customers, locations, businessdays, working-times, write-offs, sync, tenants, audit-events, user-preferences]
status: implemented
---

# Schema-Feld-Härtung — Inline-Constraints

## Kontext

Die TypeBox-Schemas in `libs/domains/` sind dokumentenbasiert und bewusst flexibel.
Eine Analyse (Multi-Agenten-Durchlauf über alle Domänen in panary-core **und**
panary-cloud) zeigte: Die Grundsicherung war stark (`additionalProperties: false`
auf den meisten Root-Schemas, Format-Validierung auf Identifiern, Resolver-Schutz
für `password`/`posPin`/`apikey`), aber es fehlten systematisch **feldbezogene
Grenzen**, über die ein fehlerhafter oder bösartiger API-Aufruf Dokumente aufblähen
oder Integrität verletzen konnte:

- **String-Felder ohne `maxLength`** (~40 Felder) → unbegrenzter Freitext.
- **Number-Felder ohne `minimum`/`maximum`** → negative Preise/Mengen, absurde Steuersätze.
- **Arrays ohne `maxItems`** (projektweit war **keine einzige** `maxItems`-Nutzung
  vorhanden) → unbegrenzte Payloads (DoS / Dokument-Aufblähung).
- **Strukturierte Strings ohne `pattern`/`format`** (Zeiten `HH:mm`, Datumswerte,
  Locale, Telefon).
- **Zwei Query-Schemas mit `additionalProperties: true`** (`orderQuerySchema`,
  `writeOffQuerySchema`) → Filter-Injection auf beliebige Felder.

## Entscheidungen

1. **Inline am Feld, keine zentrale Constraint-Bibliothek.** Jedes Limit steht direkt
   am TypeBox-Feld (Single Source of Truth). Wer später einen Wert anpassen muss, geht
   ins Schema und ändert ihn dort — kein Springen in eine zentrale `MAX_*`-Datei.
2. **`Type.Any()` beibehalten (nicht auf `Type.Unknown()` umgestellt).** AJV behandelt
   `any` und `unknown` zur Laufzeit identisch (beide akzeptieren alles) — der Wechsel
   hätte **keinen** Härtungsgewinn gebracht, aber den TS-Build vieler Konsumenten
   gebrochen (`history`, `invoices`, `metadata`, `transaction.data`, `value`). Die
   echte Bloat-Kontrolle dieser Felder ist das **`maxItems`** auf den umschließenden
   Arrays (`history`, `invoices`, `recipeIngredients`, `incomingGoods`), das gesetzt
   wurde. Skalare `Any`-Felder (`transaction.data`, `pre-order.metadata`,
   `invoiceTemplate`, `user-preference.value`) bleiben unbeschränkt — die saubere
   Kontrolle dort ist ein Request-Body-Größenlimit (separate Aufgabe), nicht das
   Schema-Typing.
3. **`additionalProperties: false` ist in einem `Type.Intersect` sicher.** Empirisch
   mit der echten TypeBox+AJV-Konfiguration verifiziert: ein Core-Member mit
   `additionalProperties: false` lehnt die Cloud-only-Felder eines Intersect **nicht**
   ab (TypeBox rendert den Intersect mit `unevaluatedProperties`-Semantik). Bestätigt
   durch den `product`-Präzedenzfall (Core `productSchema` hat `additionalProperties:
   false` und wird in der Cloud per Intersect erweitert — in Produktion).

## Umgesetzte Härtungs-Kategorien (Beispiele)

| Kategorie | Beispiele |
|---|---|
| `maxLength` (Passwort) | `user.password`/`posPin`-Hash-Zweig → `72` (bcrypt-72-Byte-Grenze) |
| `maxLength` (Freitext) | `name` 100–200, `description`/`notes` 500–2000, PII `phone` 40, `email` 254 |
| `minimum: 0` | Preise/Mengen/Steuern (`product.price`, `order.lineItems[].amount`, `write-offs.quantity`, …); Steuer-% zusätzlich `maximum: 100` |
| `maxItems` | `order.lineItems` 500, `product.optionGroups` 50 (+`options` 100), `permissions` 100, `invoices` 1000, … |
| `pattern`/`format` | `transaction.currency` `^[A-Z]{3}$`, `countryCode` `^[A-Z]{2}$`, `email`-`format`, ID-Felder `format:'uuid'` |
| `additionalProperties: false` | `orderQuerySchema` + `writeOffQuerySchema` von `true` → `false`; Entity-Objekte bei ingredient/supplier/supplier-product/global-supplier(+submission) ergänzt |

## Bewusst offen gelassen (nicht limitiert)

Die dokumentenbasierte Dynamik bleibt erhalten — folgende Felder wurden bewusst
**nicht** beschnitten:

- **Sync-Payloads** (`sync-op.payload`, `sync-outbox.payload`, `sync-conflict.edge/cloudPayload`,
  `sync-pull.record`) — müssen jede Entity-Form tragen; Größe ist über Batch-Limits gedeckelt.
- **Server-generierte Tokens** (`cloudToken`, `nextToken`, `resumeToken`, `cursor`) —
  nie client-frei gesetzt (nur defensive `maxLength` wo eindeutig).
- **`inventory-movement.quantity`** — vorzeichenbehaftet by design (±= Zu-/Abgang).
- **`subscription-plan.limits.*`** — absichtlich nach oben offen (Enterprise = unlimitiert).
- **Audit-/Diff-Snapshots** (`audit-event.before/after/diff/metadata`, `tenant.metadata`) —
  variable Form ist die Funktion.
- **`recipeIngredientItemSchema` `additionalProperties: true`** — bewusst offen wegen
  Legacy-Migration (nur das umschließende `ingredients`-Array via `maxItems` begrenzt).

## Verifikation

- `pnpm nx affected -t build` über **panary-core** (79 Projekte) — grün.
- `pnpm nx affected -t build` über **panary-cloud** — grün.
- Die einzigen TS-relevanten Änderungen waren `Type.Any()→Unknown()` (zurückgenommen,
  s. o.); alle übrigen Constraints (`maxLength`/`minimum`/`maxItems`/`pattern`/`format`/
  `additionalProperties`) sind reine AJV-Laufzeit-Regeln ohne TS-Typ-Wirkung.

## Offene Folge-Aufgaben

- **Request-Body-Größenlimit** für die skalaren `Any`-Felder (`transaction.data`,
  `pre-order.metadata`, `location.invoiceSettings.invoiceTemplate`,
  `user-preference.value`) auf Transport-Ebene.
- **`order-interaction.schema.ts`** trug zum Zeitpunkt der Härtung uncommittete
  Arbeit; die dortigen Ergänzungen (`sessionId`/`businessDayId`/`requestId` `maxLength`,
  einige `minimum: 0`) liegen unkommittiert im Working Tree zur Übernahme.
- **`customer.discountType`** ist weiterhin freier String (Enum-Angleichung an
  `corporate-customer` erfordert Cross-Domain-Dependency-Wiring — separate Aufgabe).
