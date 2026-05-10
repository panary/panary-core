# supplier-products-domain

Konkrete Hersteller-/Lieferanten-Produkte (mit GTIN, Verpackung, Preis,
Allergenen, Nährwerten). N:1 unter einer generischen Zutat (`Ingredient`).

Trägt Provenance (`source: MANUAL | OFF | GS1`) und den ungefilterten
OFF-Payload als `sourceMeta`. Wird konsumiert von `IncomingGoods` und vom
`api-cloud`-Service `supplier-products`.

Siehe `panary-cloud/documentation/ingredients-supplier-products-konzept.md`.

## Building

Run `nx build supplier-products-domain` to build the library.

## Running unit tests

Run `nx test supplier-products-domain` to execute the unit tests via [Vitest](https://vitest.dev/).
