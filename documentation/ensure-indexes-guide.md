---
title: ensureIndexes — Entwicklungs-Guide
date: 2026-04-24
category: guide
domains: [shared-backend, api-edge]
status: active
---

# ensureIndexes — Entwicklungs-Guide

## Zweck

`ensureIndexes()` ist die einzige zulässige Methode, um DB-Indexe in Service-Modulen zu deklarieren. Die Factory abstrahiert zwischen SQLite (Edge) und MongoDB (Cloud) und übernimmt die idempotente Erstellung.

## Aufruf

```typescript
import { ensureIndexes } from '@panary/shared-backend'

;(service as any).setup = async (app: Application) =>
  ensureIndexes(
    app,
    'products',                               // Feathers-Service-Pfad
    [
      { name: 'idx_products_tenant', columns: ['tenantId'] },
      { name: 'idx_products_tenant_location', columns: ['tenantId', 'locationId'] },
    ],
    service,
  )
```

Die Factory wird ausschließlich in `service.setup` aufgerufen, damit Indexe beim App-Start einmalig angelegt werden.

## Index-Deskriptor

| Feld | Typ | Beschreibung |
|---|---|---|
| `name` | `string` | Eindeutiger Index-Name (Konvention: `idx_<table>_<col1>_<col2>`). Wird auf SQLite via `CREATE INDEX IF NOT EXISTS "<name>"` erzeugt, auf MongoDB via `collection.createIndex({ ... }, { name })`. |
| `columns` | `string[]` | Liste der Spaltennamen. Pflichtfeld. |
| `unique` | `boolean` (optional) | Erzeugt einen Unique-Constraint auf beiden DBs. |
| `whereSqlite` | `string` (optional) | SQLite-Partial-Index-Klausel. Wird auf MongoDB ignoriert. Beispiel: `'externalId IS NOT NULL'`. |
| `mongoSpec` | `Record<string, 1 \| 'text'>` (optional) | MongoDB-spezifische Index-Spezifikation. Nützlich für Text-Indexe (`{ name: 'text', acronym: 'text' }`). Wird auf SQLite ignoriert. |
| `dbTypes` | `DatabaseType[]` (optional) | Beschränkt den Index auf bestimmte DB-Typen. Ohne Angabe: beide. |

## Beispiele

### Einfacher Tenant-Index

```typescript
{ name: 'idx_orders_tenant', columns: ['tenantId'] }
```

### Unique-Index mit SQLite-Partial-Clause

Nur Produkte mit nicht-null `externalId` dürfen pro Tenant eindeutig sein:

```typescript
{
  name: 'idx_products_tenant_externalId_unique',
  columns: ['tenantId', 'externalId'],
  unique: true,
  whereSqlite: 'externalId IS NOT NULL',
}
```

### DB-spezifischer Index

SQLite nutzt prefix-LIKE-Support über einen normalen Index, MongoDB benötigt einen echten Text-Index:

```typescript
// SQLite: nur name
{ name: 'idx_products_name', columns: ['name'], dbTypes: [DatabaseType.SQLITE] },

// MongoDB: Volltext-Index auf name + acronym
{
  name: 'idx_products_text_search',
  columns: ['name', 'acronym'],
  mongoSpec: { name: 'text', acronym: 'text' },
  dbTypes: [DatabaseType.MONGODB],
},
```

## Benennungskonventionen

- **Präfix**: immer `idx_`.
- **Format**: `idx_<tabellenname>_<spalte1>[_<spalte2>][_unique]`.
- **kebab-case** in Tabellennamen mit Anführungszeichen im SQL (z.B. `"idx_pre-orders_tenant"`).

## Was `ensureIndexes` **nicht** macht

- Keine Migrationen: Schema-Änderungen (neue Spalten) laufen weiterhin über `pnpm db:create` + `pnpm db:migrate`.
- Keine Index-Löschungen: Obsolete Indexe müssen manuell entfernt werden (SQLite: `DROP INDEX`; MongoDB: `dropIndex`).
- Keine Fremdschlüssel: Referenzielle Integrität wird nicht forciert — Multi-Tenancy-Isolation erfolgt über Hooks.

## Referenz-Implementierung

Die Factory lebt in `libs/shared/backend/src/util-db/ensure-indexes.ts`. Sie:
1. Liest `app.get('system').dbType`.
2. Iteriert über die Index-Liste und filtert nach `dbTypes` (falls gesetzt).
3. Ruft je nach DB-Typ entweder `service.knex.schema.raw(...)` oder `collection.createIndex(...)` auf.
4. Loggt ein Wide Event `db.indexes` pro erstelltem Index.

## Beispiel-Services mit Best-Practice-Usage

- `apps/api-edge/src/services/products/products.ts` — DB-spezifische Text-Indexe
- `apps/api-edge/src/services/corporate-customers/corporate-customers.ts` — Einfacher Tenant-Status-Index
- `apps/api-edge/src/services/locations/locations.ts` — Reduktion von 46 auf 8 Zeilen Setup-Code
