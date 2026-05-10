# suppliers-domain

Lieferanten-Stammdaten (Großhändler, Hersteller). Enthält den `supplierSchema`-
TypeBox-Schema (Name, GLN-13, Kontakt, Adresse, Status).

Wird konsumiert von SupplierProduct-Schemas und IncomingGoods (siehe
`panary-cloud/documentation/ingredients-supplier-products-konzept.md`).

## Building

Run `nx build suppliers-domain` to build the library.

## Running unit tests

Run `nx test suppliers-domain` to execute the unit tests via [Vitest](https://vitest.dev/).
