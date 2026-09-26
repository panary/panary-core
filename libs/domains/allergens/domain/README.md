# allergens-domain

EU-LMIV-Allergen-Enum (14 deklarationspflichtige Hauptallergene), Diät-Tags
und Mapping-Tabelle für Open-Food-Facts-Allergen-Tags.

Dazu der Zusatzstoff-Katalog `ADDITIVES` mit Pflichtangabe, Anwendungsfall und
Fundstelle je Code (`ADDITIVE_CATALOG`, Quelle § 5 Abs. 1 LMZDV) — Grundlage der
Deklaration am Produkt (`@panary/products/domain`, `labeling`).

Wird konsumiert von Ingredient- und SupplierProduct-Schemas (siehe
`panary-cloud/docs/domains/ingredients-supplier-products-konzept.md`).

## Building

Run `nx build allergens-domain` to build the library.

## Running unit tests

Run `nx test allergens-domain` to execute the unit tests via [Vitest](https://vitest.dev/).
