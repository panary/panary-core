import { DatabaseType } from '@panary-core/shared-common'
import type { Application } from '../declarations'
import { logger } from '../logger'

/**
 * Definiert einen einzelnen Index DB-agnostisch.
 *
 * - `name` wird als Index-Name in SQLite und MongoDB verwendet
 *   (Konvention: `idx_<table>_<cols>`)
 * - `columns` beschreibt die Spalten in Reihenfolge (ascending)
 * - `unique` markiert den Index als eindeutig (UNIQUE INDEX bzw. unique: true)
 * - `whereSqlite` erlaubt partielle Indizes auf SQLite
 *   (z.B. `externalId IS NOT NULL`)
 * - `mongoSpec` ueberschreibt das aus `columns` abgeleitete Mongo-Key-Pattern
 *   (z.B. `{ name: 'text', acronym: 'text' }` fuer Text-Suche)
 * - `mongoSparse` aktiviert SPARSE-Indizes auf MongoDB
 *   (fuer optionale eindeutige Felder)
 * - `dbTypes` beschraenkt den Index auf bestimmte DBs
 *   (default: ueberall anlegen)
 */
export interface IndexDef {
  name: string
  columns: string[]
  unique?: boolean
  whereSqlite?: string
  mongoSpec?: Record<string, 1 | -1 | 'text'>
  mongoSparse?: boolean
  dbTypes?: DatabaseType[]
}

/**
 * Erstellt Indizes idempotent auf SQLite oder MongoDB, je nach dbType.
 *
 * SQLite: `CREATE [UNIQUE] INDEX IF NOT EXISTS "<name>" ON "<table>" (cols) [WHERE ...]`
 * MongoDB: `collection.createIndexes([...])`
 *
 * Jeder Index wird einzeln versucht und bei Fehler geloggt, ohne die weiteren
 * Indizes zu blockieren. Die App startet auch, wenn die DB waehrend des
 * Startups gesperrt ist oder einzelne Spalten fehlen.
 *
 * @param app            Feathers-App (liest dbType aus `system`-Config)
 * @param serviceName    SQLite-Tabellenname = Service-Pfad (kebab-case)
 * @param indexes        Liste der Index-Definitionen
 * @param serviceInstance  Der createServiceAdapter-Service (fuer getModel auf MongoDB)
 */
export async function ensureIndexes(
  app: Application,
  serviceName: string,
  indexes: IndexDef[],
  serviceInstance?: unknown,
): Promise<void> {
  if (!indexes.length) return

  const systemConfig = app.get('system') || {}
  const dbType = (systemConfig.dbType || DatabaseType.SQLITE) as DatabaseType
  const applicable = indexes.filter((idx) => !idx.dbTypes || idx.dbTypes.includes(dbType))
  if (!applicable.length) return

  if (dbType === DatabaseType.SQLITE) {
    const knex = app.get('sqliteClient')
    if (!knex) return

    let hasTable = false
    try {
      hasTable = await knex.schema.hasTable(serviceName)
    } catch (error) {
      logger.error({
        message: 'Failed to check table existence',
        event: 'db.indexes_error',
        dbType: 'sqlite',
        service: serviceName,
        error: String(error),
      })
      return
    }
    if (!hasTable) return

    let created = 0
    for (const idx of applicable) {
      try {
        const unique = idx.unique ? 'UNIQUE ' : ''
        const cols = idx.columns.join(', ')
        const where = idx.whereSqlite ? ` WHERE ${idx.whereSqlite}` : ''
        await knex.raw(
          `CREATE ${unique}INDEX IF NOT EXISTS "${idx.name}" ON "${serviceName}" (${cols})${where}`,
        )
        created++
      } catch (error) {
        logger.error({
          message: 'Failed to create index',
          event: 'db.indexes_error',
          dbType: 'sqlite',
          service: serviceName,
          indexName: idx.name,
          error: String(error),
        })
      }
    }

    logger.info({
      message: 'Indexes ensured',
      event: 'db.indexes',
      dbType: 'sqlite',
      service: serviceName,
      count: created,
    })
    return
  }

  if (dbType === DatabaseType.MONGODB) {
    try {
      const adapter = serviceInstance as { getModel?: (app: Application) => Promise<unknown> } | undefined
      const model = (await adapter?.getModel?.(app)) as
        | { createIndexes?: (specs: unknown[]) => Promise<unknown> }
        | undefined

      if (!model?.createIndexes) return

      const specs = applicable.map((idx) => {
        const key = idx.mongoSpec ?? Object.fromEntries(idx.columns.map((c) => [c, 1 as const]))
        const spec: Record<string, unknown> = { key, name: idx.name }
        if (idx.unique) spec['unique'] = true
        if (idx.mongoSparse) spec['sparse'] = true
        return spec
      })

      await model.createIndexes(specs)

      logger.info({
        message: 'Indexes ensured',
        event: 'db.indexes',
        dbType: 'mongodb',
        service: serviceName,
        count: applicable.length,
      })
    } catch (error) {
      logger.error({
        message: 'Failed to ensure indexes',
        event: 'db.indexes_error',
        dbType: 'mongodb',
        service: serviceName,
        error: String(error),
      })
    }
  }
}
