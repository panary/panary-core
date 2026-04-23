import { DatabaseType } from '@panary-core/shared-common'
import type { Application } from '../declarations'
import { parseJsonFields } from '../hooks/parse-json-fields.hook'
import { stringifyJsonFields } from '../hooks/stringify-json-fields.hook'

/**
 * Liefert dbType-abhaengige JSON-Hooks fuer Services mit JSON-Feldern.
 *
 * SQLite (Knex) speichert Arrays/Objekte als Text-Spalten — Knex serialisiert
 * nicht automatisch, deshalb werden Felder vor dem Schreiben in JSON-Strings
 * konvertiert und nach dem Lesen zurueck geparst. MongoDB speichert nativ
 * BSON, daher sind die Hooks dort No-Ops.
 *
 * Spread im Service-Hook-Array an die richtige Stelle:
 *   const jsonHooks = getJsonFieldHooks(app, ORDER_JSON_FIELDS)
 *   before: { create: [...resolver, ...jsonHooks.before] }
 *   after:  { all: [...jsonHooks.after] }
 */
export function getJsonFieldHooks(app: Application, jsonFields?: string[]) {
  const systemConfig = app.get('system') || {}
  const dbType = systemConfig.dbType || DatabaseType.SQLITE

  if (!jsonFields?.length || dbType !== DatabaseType.SQLITE) {
    return { before: [], after: [] }
  }

  return {
    before: [stringifyJsonFields(...jsonFields)],
    after: [parseJsonFields(...jsonFields)],
  }
}
