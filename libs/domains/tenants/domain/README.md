# tenants-domain

Kanonische Tenant-Entity für panary-cloud (Multi-Tenancy First-Class).
Enthält Schemas für:

- **`tenant`** — Tenant-Stamm-Daten (Name, Status, Owner, legalEntity,
  Subscription, Billing, TSE, Branding, Localization, Future-proof-Felder).
- **`subscription-plan`** — Plan-Katalog (Preise, Limits, Feature-Flags,
  Stripe-Product-Refs).
- **`tenant-audit-trail`** — Append-Only-Log aller Tenant-Änderungen
  (DSGVO/SOC2-Audits).

Hintergrund / Architektur-Entscheidung: siehe
[panary-cloud/documentation/tenant-as-first-class-entity-adr.md](../../../../panary-cloud/documentation/tenant-as-first-class-entity-adr.md).

## Building

`nx build tenants-domain`

## Running unit tests

`nx test tenants-domain`
