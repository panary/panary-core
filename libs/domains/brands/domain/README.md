# brands-domain

Kanonische Brand-Entity für panary-cloud (Brand-Schicht zwischen Tenant und Location).
Enthält:

- **`brand`** — Brand-Stamm-Daten (Name, Handle, Branding, Custom-Domains).
- **`slugifyHandle`** — Helper zur Erzeugung URL-fähiger Handles aus Anzeige-Namen
  (Umlaut-Mapping ä/ö/ü/ß, Diakritika-Strip, Length-Cap 60).

Hintergrund / Architektur-Entscheidung: siehe
[panary-cloud/.planning/phases/06-reservierung-r1-r2-brand-schicht/06-CONTEXT.md](../../../../../panary-cloud/.planning/phases/06-reservierung-r1-r2-brand-schicht/06-CONTEXT.md)
(D-01..D-04 Brand-Modellierung).

## Building

`nx build brands-domain`

## Running unit tests

`nx test brands-domain`
