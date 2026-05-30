import { CacheEntity } from './cache-storage.port'

/** Read-/Schreib-Strategie eines Services im Cache. */
export type CachePolicy = 'none' | 'master-data' | 'transactional'

/**
 * Normalisiert ein Feathers-Service-Ergebnis (Einzelobjekt, Array oder `Paginated`)
 * auf eine flache Datensatzliste — die Form, in der der Cache persistiert.
 */
export function normalizeToRecords<TEntity extends CacheEntity>(result: unknown): TEntity[] {
  if (Array.isArray(result)) {
    return result as TEntity[]
  }
  if (
    result &&
    typeof result === 'object' &&
    'data' in result &&
    Array.isArray((result as { data: unknown }).data)
  ) {
    return (result as { data: TEntity[] }).data
  }
  if (result && typeof result === 'object' && '_id' in result) {
    return [result as TEntity]
  }
  return []
}

/**
 * Merge-Strategie für den In-Memory-Mirror. `upsert` ersetzt/ergänzt per `_id`,
 * `remove` entfernt die genannten IDs. Die Reihenfolge bleibt stabil (Insert-Order).
 */
export function mergeRecords<TEntity extends CacheEntity>(
  current: readonly TEntity[],
  incoming: readonly TEntity[],
  mode: 'upsert' | 'remove',
): TEntity[] {
  if (mode === 'remove') {
    const removeIds = new Set(incoming.map(record => record._id))
    return current.filter(record => !removeIds.has(record._id))
  }
  const byId = new Map<string, TEntity>()
  for (const record of current) byId.set(record._id, record)
  for (const record of incoming) byId.set(record._id, record)
  return [...byId.values()]
}
