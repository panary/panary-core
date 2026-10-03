---
type: Reference
title: Rollen-Matrix — Generat aus roles.matrix.ts
description: 'Welche Rolle welche Aktion auf welcher Ressource darf, als aus RolePermissions erzeugte Tabelle, die ein Spec in users-domain bei jeder Abweichung vom Code rot werden lässt.'
tags: [users, rbac, permissions, generat]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-10-02T00:00:00Z }
---

# Rollen-Matrix

Quelle der Wahrheit ist
[`libs/domains/users/domain/src/lib/roles.matrix.ts`](../../libs/domains/users/domain/src/lib/roles.matrix.ts).
Der Block unten ist ein **Generat** daraus. Von Hand geändert wird er nicht, denn der Spec
[`roles.matrix-doc.spec.ts`](../../libs/domains/users/domain/src/lib/roles.matrix-doc.spec.ts)
vergleicht ihn bei jedem `nx test users-domain` mit der Matrix und schlägt bei jeder
Abweichung an. Nach einer Änderung an der Matrix neu erzeugen:

```bash
ROLLEN_MATRIX_SCHREIBEN=1 pnpm nx test users-domain --skip-nx-cache
```

Warum es das Generat gibt: Die frühere Kurzfassung in `.claude/rules/security.md` §7 war
gedriftet. Zwei Rollen standen falsch darin, `tenant:technician` fehlte ganz, und Sichttests
wurden gegen diese Tabelle statt gegen den Code geschrieben (panary/panary-core#384). Ein Prüfer erwartete
dort bei `PATCH /orders` als `tenant:manager` ein 403, der Code liefert korrekt 200.

## Lesart

| Kürzel | Bedeutung                                                         |
| ------ | ----------------------------------------------------------------- |
| `M`    | `MANAGE`, also alle Aktionen                                      |
| `C`    | `CREATE` → `create`                                               |
| `R`    | `READ` → `find`, `get`                                            |
| `U`    | `UPDATE` → `update`, `patch`                                      |
| `D`    | `DELETE` → `remove`                                               |
| `–`    | kein Recht aus der Rolle                                          |
| `✓`    | Ability ist der Rolle zugewiesen                                  |

Grenzen der Tabelle:

- Sie zeigt nur die **Rollen**-Rechte. Additive Pro-User-Grants (`permissions` am Konto,
  Capability-Bundles) kommen hinzu, siehe
  [Effektive Berechtigungen](granulare-berechtigungen-helper.md).
- `platform:owner` umgeht `authorize()` ganz. Seine Spalte dokumentiert nur die
  Mindest-Rechte, falls der Bypass entfällt.
- Ein `✓`/Kürzel heißt nur, dass `authorize()` durchlässt. Mandanten- und Filialgrenzen
  (`multiTenancy()`), Resolver-Schutz und Custom-Method-Prüfungen greifen danach zusätzlich.
- Eine Zeile aus lauter `–` ist eine Ressource, die keine Rolle trägt. Sie ist entweder nur
  über Grants erreichbar oder ungenutzt.

<!-- rollen-matrix:start — Generat aus roles.matrix.ts, nicht von Hand ändern -->

### Ressourcen

| Ressource | `platform:owner` | `platform:admin` | `platform:support` | `tenant:owner` | `tenant:manager` | `tenant:technician` | `tenant:staff` | `device:pos-client` | `device:kds` | `device:tablet` | `device:kiosk` |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `users` | M | R | R | M | RU | M | RU | R | – | R | – |
| `products` | – | R | R | M | M | M | R | R | R | R | R |
| `product-groups` | – | R | – | M | R | M | R | R | – | R | R |
| `orders` | – | R | R | RU | CRUD | M | CR | M | RU | CRU | CR |
| `receipts` | – | – | – | RU | R | RU | R | R | – | – | – |
| `receipts-export` | – | – | – | R | – | R | – | – | – | – | – |
| `receipts-email` | – | – | – | C | C | C | C | C | – | – | – |
| `discounts` | – | – | – | M | M | M | R | R | – | R | – |
| `discount-codes` | – | – | – | M | M | M | – | – | – | – | – |
| `discount-code-redemptions` | – | – | – | CR | CR | CR | – | – | – | – | – |
| `discount-code-redeem` | – | – | – | CR | CR | CR | CR | CR | – | CR | – |
| `inventory` | – | – | – | – | – | – | – | – | – | – | – |
| `locations` | – | R | – | M | R | M | R | R | – | R | – |
| `system` | M | M | R | – | – | M | – | – | – | – | – |
| `customers` | – | – | – | M | M | M | CR | CRU | – | – | – |
| `order-interactions` | – | – | – | M | M | M | CR | M | – | CR | – |
| `order-references` | R | – | – | R | R | R | – | – | – | – | – |
| `working-times` | – | – | – | M | RU | M | R | CRU | – | CRU | – |
| `pre-orders` | – | – | – | M | M | M | CRU | CRU | – | – | – |
| `print-server` | – | – | – | M | M | M | – | C | C | C | C |
| `printer-commands` | – | – | – | M | CR | M | – | – | – | – | – |
| `apikeys` | – | – | – | M | R | M | – | – | – | – | – |
| `cloud-connection` | – | – | – | M | – | M | – | – | – | – | – |
| `opening-hour-exceptions` | – | – | – | M | – | M | – | R | – | – | – |
| `cloud-edges` | – | – | – | M | R | M | – | – | – | – | – |
| `edge-pairing-codes` | – | – | – | M | R | M | – | – | – | – | – |
| `sync-conflicts` | – | – | – | M | M | M | – | – | – | – | – |
| `sync-outbox` | – | – | – | M | M | M | – | – | – | – | – |
| `sync-cursor` | – | – | – | R | – | R | – | – | – | – | – |
| `sync-runs` | – | – | – | R | – | R | – | – | – | – | – |
| `sync-triggers` | C | – | – | C | – | C | – | – | – | – | – |
| `bootstrap-reports` | – | – | – | R | – | R | – | – | – | – | – |
| `fiscal-counters` | – | – | – | R | – | R | – | – | – | – | – |
| `log-export` | – | – | – | R | R | R | – | – | – | – | – |
| `audit-events` | R | – | – | R | R | R | – | – | – | – | – |
| `audit-event-redactions` | R | – | – | CR | R | CR | – | – | – | – | – |
| `cloud-sync-reject` | R | R | – | R | R | R | – | – | – | – | – |
| `tenants` | M | M | R | RU | R | R | R | – | – | – | – |
| `corporate-customers` | – | – | – | M | M | M | – | R | – | – | – |
| `recipes` | – | – | – | M | R | M | R | – | – | – | – |
| `ingredients` | – | – | – | M | R | M | R | – | – | – | – |
| `suppliers` | – | – | – | M | M | M | R | – | – | – | – |
| `supplier-products` | – | – | – | M | M | M | R | – | – | – | – |
| `global-suppliers` | M | M | R | R | R | R | – | – | – | – | – |
| `global-supplier-submissions` | M | M | R | CR | CR | CR | – | – | – | – | – |
| `gtin-lookup-cache` | – | – | – | M | M | M | – | – | – | – | – |
| `external/off-lookup` | – | – | – | R | R | R | – | – | – | – | – |
| `ingredients-import` | – | – | – | M | M | M | – | – | – | – | – |
| `product-groups-export` | – | – | – | M | M | M | – | – | – | – | – |
| `product-groups-import` | – | – | – | M | M | M | – | – | – | – | – |
| `ingredients-export` | – | – | – | M | M | M | – | – | – | – | – |
| `recipes-export` | – | – | – | M | M | M | – | – | – | – | – |
| `recipes-import` | – | – | – | M | M | M | – | – | – | – | – |
| `products-export` | – | – | – | M | M | M | – | – | – | – | – |
| `products-import` | – | – | – | M | M | M | – | – | – | – | – |
| `pricelists-export` | – | – | – | M | M | M | – | – | – | – | – |
| `pricelists-import` | – | – | – | M | M | M | – | – | – | – | – |
| `pricelists` | – | – | – | M | M | M | R | – | – | – | – |
| `inventories` | – | – | – | M | M | M | – | – | – | – | – |
| `incoming-goods` | – | – | – | M | M | M | – | – | – | – | – |
| `outgoing-goods` | – | – | – | M | – | M | – | – | – | – | – |
| `incoming-goods-extract` | – | – | – | C | C | C | C | – | – | – | – |
| `incoming-goods-extract-audit` | R | R | – | R | R | R | – | – | – | – | – |
| `incoming-goods-extract-audit-daily` | R | R | – | R | R | R | – | – | – | – | – |
| `menu-extract` | – | – | – | C | C | C | – | – | – | – | – |
| `menu-import` | – | – | – | C | C | C | – | – | – | – | – |
| `menu-extract-audit` | – | – | – | R | R | R | – | – | – | – | – |
| `ai-usage-summary` | R | R | – | R | R | R | R | – | – | – | – |
| `onboarding-state` | – | – | – | RU | RU | RU | R | – | – | – | – |
| `tenant-settings` | M | R | – | CRU | R | R | R | – | – | – | – |
| `write-offs` | – | – | – | M | M | M | – | – | – | – | – |
| `inventory-movements` | – | – | – | M | R | M | – | – | – | – | – |
| `stock-levels` | – | – | – | R | R | R | R | – | – | – | – |
| `invoices` | – | – | – | M | RU | M | – | – | – | – | – |
| `businessdays` | – | – | – | M | M | M | R | M | – | – | – |
| `business-day-reports` | – | – | – | M | M | M | – | – | – | – | – |
| `business-day-report-events` | – | – | – | R | R | R | – | – | – | – | – |
| `business-day-overdue-notice` | – | – | – | R | R | R | – | – | – | – | – |
| `cash-sessions` | – | – | – | M | M | M | CRU | CRU | – | – | – |
| `meal-settlements` | – | – | – | CR | CR | CR | – | – | – | – | – |
| `user-preferences` | – | – | – | M | M | M | M | – | – | – | – |
| `devices` | – | – | – | M | – | M | – | RU | – | – | – |
| `device-connections` | – | – | – | R | – | R | – | – | – | – | – |
| `fiscal-devices` | – | – | – | M | CRU | M | – | – | – | – | – |
| `shifts` | – | – | – | M | M | M | R | – | – | – | – |
| `shift-templates` | – | – | – | M | M | M | R | – | – | – | – |
| `shift-swap-requests` | – | – | – | M | M | M | CRU | – | – | – | – |
| `open-shift-applications` | – | – | – | M | M | M | CRU | – | – | – | – |
| `leave-requests` | – | – | – | M | RU | M | CRU | – | – | – | – |
| `holiday-calendars` | – | – | – | M | RU | M | R | – | – | – | – |
| `working-time-reports` | – | – | – | C | C | C | – | – | – | – | – |
| `organizations` | – | – | – | R | – | R | – | – | – | – | – |
| `fraud-analytics` | – | – | – | R | R | R | – | – | – | – | – |
| `fraud-alert-rules` | – | – | – | M | R | M | – | – | – | – | – |
| `fraud-alerts` | – | – | – | RU | RU | RU | – | – | – | – | – |
| `subscription-plans` | M | M | R | R | R | R | R | – | – | – | – |
| `tenant-audit-trail` | R | R | R | R | R | R | – | – | – | – | – |
| `gdpr-tenant-export` | M | M | – | C | – | – | – | – | – | – | – |
| `gdpr-self-export` | M | M | C | C | C | C | C | – | – | – | – |
| `tenant-owner-transfer` | M | M | – | C | – | – | – | – | – | – | – |
| `vat-validation-cache` | M | M | R | R | R | R | – | – | – | – | – |
| `external/vies-lookup` | M | M | – | – | – | – | – | – | – | – | – |
| `tenant-branding-asset` | M | M | R | M | R | R | R | – | – | – | – |
| `storefront-asset` | – | – | – | M | CRD | – | R | – | – | – | – |
| `storefront-pages` | – | – | – | M | CRUD | – | R | – | – | – | – |
| `storefront-config` | – | – | – | M | RU | – | R | – | – | – | – |
| `storefront-theme-catalog` | – | M | – | R | R | – | R | – | – | – | – |
| `storefront-publish` | – | CR | R | CR | CR | – | – | – | – | – | – |
| `storefront-publish-brand` | – | C | – | C | C | – | – | – | – | – | – |
| `storefront-publish-rollback` | – | C | – | C | C | – | – | – | – | – | – |
| `storefront-publish-meta` | – | R | R | R | R | – | – | – | – | – | – |
| `storefront-preview-token` | – | C | – | C | C | – | – | – | – | – | – |
| `storefront-preset-library` | – | M | – | R | R | – | R | – | – | – | – |
| `storefront-scaffold` | – | – | – | C | C | – | – | – | – | – | – |
| `storefront-theme-requests` | – | M | R | CR | CR | – | – | – | – | – | – |
| `storefront-page-view-stats` | – | R | R | R | R | – | R | – | – | – | – |
| `platform-tenants` | M | M | R | – | – | – | – | – | – | – | – |
| `platform-users` | M | C | – | – | – | – | – | – | – | – | – |
| `platform-subscriptions` | M | M | R | – | – | – | – | – | – | – | – |
| `platform-subscription-invoices` | M | M | R | R | – | – | – | – | – | – | – |
| `platform-promo-codes` | M | M | R | – | – | – | – | – | – | – | – |
| `tenant-subscription-actions` | M | M | CR | CRU | – | – | – | – | – | – | – |
| `platform-subscription-change-requests` | M | CR | R | – | – | – | – | – | – | – | – |
| `platform-impersonation` | M | M | CD | – | – | – | – | – | – | – | – |
| `platform-impersonation-events` | R | R | R | – | – | – | – | – | – | – | – |
| `platform-user-preferences` | M | M | M | – | – | – | – | – | – | – | – |
| `platform-system-health` | R | R | R | – | – | – | – | – | – | – | – |
| `platform-metrics` | R | R | – | – | – | – | – | – | – | – | – |
| `platform-business-metrics` | R | R | – | – | – | – | – | – | – | – | – |
| `platform-ai-usage` | R | R | – | – | – | – | – | – | – | – | – |
| `platform-tenant-health` | R | R | R | – | – | – | – | – | – | – | – |
| `platform-alerts` | M | RU | RU | – | – | – | – | – | – | – | – |
| `platform-event-stats` | R | R | – | – | – | – | – | – | – | – | – |
| `platform-config` | M | R | R | – | – | – | – | – | – | – | – |
| `platform-push-subscription` | M | M | M | – | – | – | – | – | – | – | – |
| `platform-cloud-connections` | R | R | R | – | – | – | – | – | – | – | – |
| `tenant-grants` | M | R | R | M | – | – | – | – | – | – | – |
| `accounts` | M | M | R | – | – | – | – | – | – | – | – |
| `account-invitations` | – | – | – | M | – | M | – | – | – | – | – |
| `password-reset` | – | – | – | – | – | – | – | – | – | – | – |
| `edge-pairing` | – | – | – | – | – | – | – | – | – | – | – |
| `authentication` | – | – | – | – | – | – | – | – | – | – | – |
| `webauthn-credentials` | M | M | M | M | M | M | M | – | – | – | – |
| `webauthn-registration` | C | C | C | C | C | C | C | – | – | – | – |
| `notifications` | – | – | – | RUD | RUD | RUD | RUD | – | – | – | – |
| `notification-preferences` | – | – | – | M | M | M | M | – | – | – | – |
| `push-subscriptions` | – | – | – | M | M | M | M | – | – | – | – |
| `brands` | M | M | R | M | M | M | R | – | – | – | – |
| `reservations` | M | M | R | M | M | M | RU | – | – | – | – |
| `reservation-tables` | M | M | – | M | M | M | R | – | – | – | – |
| `reservable-slots` | M | M | – | M | M | M | R | – | – | – | – |
| `table-links` | M | M | – | M | M | M | R | – | – | – | – |
| `merch-products` | M | M | – | R | R | R | R | – | – | – | – |
| `shop-orders` | M | R | – | M | M | R | R | – | – | – | – |

### Abilities

| Ability | `platform:owner` | `platform:admin` | `platform:support` | `tenant:owner` | `tenant:manager` | `tenant:technician` | `tenant:staff` | `device:pos-client` | `device:kds` | `device:tablet` | `device:kiosk` |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `can_discount` | – | – | – | – | – | – | – | ✓ | – | – | – |
| `can_refund` | – | – | – | ✓ | – | ✓ | – | ✓ | – | – | – |
| `can_open_drawer` | – | – | – | – | – | – | – | – | – | – | – |
| `can_void_order` | – | – | – | ✓ | ✓ | ✓ | – | ✓ | – | – | – |
| `can_change_pos_pin` | – | – | – | – | – | – | – | ✓ | – | ✓ | – |
| `can_clock_in` | – | – | – | – | – | – | – | ✓ | – | ✓ | – |
| `can_manage_time` | – | – | – | – | – | ✓ | – | – | – | – | – |
| `can_see_reports` | – | – | – | ✓ | – | ✓ | – | – | – | – | – |
| `can_see_pos_pin` | – | – | – | – | – | ✓ | – | – | – | – | – |
| `can_read_sensitive_user_data` | – | – | – | – | – | ✓ | – | – | – | – | – |

<!-- rollen-matrix:end -->
