---
title: M2 — DB-Agnostik-Refactor (SQLite Edge ↔ MongoDB Cloud)
date: 2026-04-24
category: architecture
domains: [api-edge, shared-backend, shared-common, orders, products, pre-orders, write-offs, working-times, locations, organizations]
status: completed
---

# M2 — DB-Agnostik-Refactor

## Problem

Das Panary-Core-Backend lief bisher hauptsächlich auf SQLite (Edge) und enthielt an mehreren Stellen direkt Knex-QueryBuilder-Aufrufe oder SQLite-spezifische `knex.raw(...)`-Indexerstellungen. Für die geplante Cloud-Sync-Schicht mit MongoDB musste jeder Service portabel werden, ohne dass der Service-Code selbst wissen muss, auf welcher DB er gerade läuft.

## Entscheidung

1. **Hybrid-Adapter-Pattern** bleibt der Kern: `createServiceAdapter()` entscheidet via `DatabaseType` (SQLITE | MONGODB), welcher Adapter verwendet wird.
2. **Alle rohen Knex-Queries** in Services entfernen. Zugriff erfolgt ausschließlich über die Feathers-Adapter-API (`app.service('...').find(...)`).
3. **Index-Erstellung** wird durch die neue Factory `ensureIndexes()` in `@panary-core/shared-backend/util-db` zentralisiert. Die Factory liest den DB-Typ aus `app.get('system').dbType` und ruft entweder `CREATE INDEX IF NOT EXISTS` (SQLite via `service.knex.schema.raw`) oder `collection.createIndex` (MongoDB via Mongoose) auf.
4. **JSON-Feld-Serialisierung** für SQLite läuft über die zentrale Factory `getJsonFieldHooks()` (stringify bei write, parse bei read). Auf MongoDB sind beide Hooks No-Op.
5. **Schema-First-Prinzip**: Jede persistierte Entität hat ihr TypeBox-Schema neben `service.ts` (für Edge-Services) bzw. in `libs/domains/[domain]/domain/src/lib/[entity].schema.ts`. Legacy-Interfaces in `*.model.ts` wurden entweder gelöscht (wenn dupliziert) oder zu reinen Re-Exports des TypeBox-abgeleiteten Typs vereinfacht.

## Konsequenzen

### Positiv

- Ein einziger Service-Code läuft auf Edge (SQLite) und Cloud (MongoDB).
- Migrationen/Indexe werden deklarativ beschrieben (`name`, `columns`, optional `unique`, `whereSqlite`, `mongoSpec`, `dbTypes`).
- Neue Services müssen keine DB-spezifischen Sonderfälle kennen.
- Test-Setup wird einfacher: Integration-Tests können gegen SQLite laufen, E2E gegen MongoDB — derselbe Service-Code.

### Negativ / Trade-offs

- DB-spezifische Features (z.B. MongoDB-Text-Indexe auf mehreren Feldern, SQLite-partielle Indexe) werden über optionale Zusatzfelder am Index-Deskriptor abgebildet. Das macht die Deklaration länger, aber explizit.
- `MIN()`-/`GROUP BY`-Semantik wurde durch In-Memory-Deduplikation nach `$sort` ersetzt (siehe `organizations.ts`). Bei sehr großen Datenmengen pro Tenant wäre eine eigenständige Cloud-Aggregations-API nötig — vorerst reicht der Ansatz (< 50 Locations pro Tenant).
- Pre-existierende Migration-Bridges (`product.model.ts` mit `ItemType`/`Pricelist`-Stubs, `authentication-item.model.ts` als JWT-Framework-Typ) bleiben bestehen, bis die jeweils betroffenen Features migriert sind.

## Umgesetzte Phasen

| Phase | Inhalt | Status |
|---|---|---|
| 1 | 11 triviale Re-Export-Models gelöscht (orders, users, products, customers) | ✅ |
| 2.1 | `organizations.ts`: rohe Knex-GroupBy durch `app.service('locations').find` ersetzt | ✅ |
| 2.2 | `working-times.ts` auf `createServiceAdapter` + `getJsonFieldHooks` umgestellt | ✅ |
| 2.3 | `ensureIndexes`-Factory + Rollout auf 12 Services | ✅ |
| 3.1 | `write-offs.schema.ts` als TypeBox-Schema angelegt | ✅ |
| 3.2 | `authentication-item.model.ts` als Framework-Typ beibehalten | ✅ |
| 3.3 | `order-line-item.model.ts` in `order.schema.ts` integriert (inkl. `GenericOrderLineItem`-Typ) | ✅ |
| 3.4 | `app-config.model.ts` → `app-config.schema.ts` (TypeBox) | ✅ |
| 3.5 | `pre-order.model.ts` mit `pre-order.schema.ts` gemerged | ✅ |
| 4 | Rest-Cleanup + diese Dokumentation | ✅ |

## Guard-Rails (grep-basiert)

Folgende Patterns dürfen im Service-Code **nicht** mehr auftauchen:

```bash
# Direkte Knex-QueryBuilder-Aufrufe in Services
grep -rn "knex\.raw\|knex\.schema\|createIndexes" apps/api-edge/src/services
# Erwartet: keine Treffer (außer in Migrations und shared-backend/util-db)

# Legacy mongoose-Models in Services
grep -rn "mongoose\." apps/api-edge/src/services
# Erwartet: keine Treffer
```

## Verwandte Dokumente

- [ensureIndexes-Entwicklungs-Guide](ensure-indexes-guide.md)
- [Service-Erstellungsanleitung](service-creation-guide.md)
