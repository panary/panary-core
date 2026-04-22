import { HookContext } from '@feathersjs/feathers'

/**
 * After-Hook: Parsed JSON-Felder die als Text in SQLite gespeichert sind.
 * SQLite speichert Arrays/Objekte als JSON-String — Knex deserialisiert sie nicht automatisch.
 */
export function parseJsonFields(...fields: string[]) {
  const parseValue = (value: unknown): unknown => {
    if (typeof value !== 'string') return value
    const trimmed = value.trim()
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return JSON.parse(trimmed)
      } catch {
        return value
      }
    }
    return value
  }

  const parseRecord = (record: Record<string, unknown>): void => {
    for (const field of fields) {
      if (field in record) {
        record[field] = parseValue(record[field])
      }
    }
  }

  return async (context: HookContext) => {
    const { result } = context

    if (!result) return context

    // Paginated result
    if (result.data && Array.isArray(result.data)) {
      for (const item of result.data) {
        parseRecord(item)
      }
    }
    // Array result
    else if (Array.isArray(result)) {
      for (const item of result) {
        parseRecord(item)
      }
    }
    // Single result
    else if (typeof result === 'object') {
      parseRecord(result)
    }

    return context
  }
}
