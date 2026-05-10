# ingredients-domain

Kanonisches `ingredientSchema` (TypeBox) für generische Zutaten in Panary
(Mehl, Oliven, Reis …). Single Source of Truth für panary-core (POS,
Edge-Sync) und panary-cloud.

Enthält:

- `ingredientSchema` — Kernfelder + Multi-Tenancy + Lifecycle (`status`).
- `INGREDIENT_VERSION_FIELDS` — Whitelist für versions-historisierte Felder
  (`baseUnit`, `baseQuantity`, `conversionFactor`).
- `ingredientWithComputedSchema` — erweitertes Read-Schema mit am Backend
  berechneten Aggregaten (`allergens`, `supplierProductCount`).

Siehe `panary-cloud/documentation/ingredients-supplier-products-konzept.md`.

## Building

Run `nx build ingredients-domain` to build the library.

## Running unit tests

Run `nx test ingredients-domain` to execute the unit tests via [Vitest](https://vitest.dev/).
