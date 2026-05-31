import { CacheEntity } from './cache-storage.port'

// `normalizeToRecords` + `CachePolicy` leben im neutralen shared-common (geteilt mit
// dem BaseService) — hier re-exportiert für `@panary/shared/offline-cache`-Konsumenten.
export { normalizeToRecords } from '@panary/shared-common'
export type { CachePolicy } from '@panary/shared-common'

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
