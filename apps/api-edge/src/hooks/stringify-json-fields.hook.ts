import { HookContext } from '@feathersjs/feathers'

/**
 * Before-Hook: Serialisiert Arrays/Objekte zu JSON-Strings für SQLite text-Spalten.
 * Knex serialisiert Arrays/Objekte nicht automatisch — SQLite speichert sie als '[object Object]'.
 */
export function stringifyJsonFields(...fields: string[]) {
  return async (context: HookContext) => {
    const { data } = context
    if (!data) return context

    const processRecord = (record: Record<string, unknown>): void => {
      for (const field of fields) {
        if (field in record && record[field] !== undefined && record[field] !== null) {
          const value = record[field]
          if (typeof value === 'object') {
            record[field] = JSON.stringify(value)
          }
        }
      }
    }

    if (Array.isArray(data)) {
      for (const item of data) {
        processRecord(item)
      }
    } else if (typeof data === 'object') {
      processRecord(data)
    }

    return context
  }
}
