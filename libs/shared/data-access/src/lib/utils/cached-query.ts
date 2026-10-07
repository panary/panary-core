/**
 * Feathers-Query gegen eine Cache-Liste auswerten (core#649).
 *
 * Offline beantwortet der `BaseService` `find`/`count` aus dem Cache. Ohne Auswertung der
 * Query kam dort jeder Datensatz des Stores zurück — ein paginierender Lader
 * (`count` → n Seiten `find` mit `$skip`/`$limit`) bekam dann n-mal dieselbe Liste,
 * inklusive inaktiver Einträge.
 *
 * Unterstützt: Gleichheit, `$in`, `$nin`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$sort`,
 * `$skip`, `$limit`. Unbekannte Operatoren filtern bewusst **nicht**: Offline lieber eine
 * Zeile zu viel als eine verschwiegene — vorher wurde gar nicht gefiltert.
 */

type CacheQuery = Record<string, unknown>
type Row = Record<string, unknown>

const COMPARATORS: Record<string, (value: unknown, operand: unknown) => boolean> = {
  $in: (value, operand) => !Array.isArray(operand) || operand.includes(value),
  $nin: (value, operand) => !Array.isArray(operand) || !operand.includes(value),
  $ne: (value, operand) => value !== operand,
  $gt: (value, operand) => isPresent(value) && compare(value, operand) > 0,
  $gte: (value, operand) => isPresent(value) && compare(value, operand) >= 0,
  $lt: (value, operand) => isPresent(value) && compare(value, operand) < 0,
  $lte: (value, operand) => isPresent(value) && compare(value, operand) <= 0,
}

/** Ein fehlender Wert erfüllt keinen Bereich — wie `NULL` in SQL. */
function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null
}

/** `undefined`/`null` gelten als größer (ans Ende); sonst Vergleich wie `<`/`>` (Strings binär, wie SQLite). */
function compare(a: unknown, b: unknown): number {
  const aMissing = !isPresent(a)
  const bMissing = !isPresent(b)
  if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? 1 : -1
  if (a === b) return 0
  return (a as number | string) < (b as number | string) ? -1 : 1
}

function isOperatorObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).some(key => key.startsWith('$'))
  )
}

function matches(row: Row, field: string, condition: unknown): boolean {
  const value = row[field]
  if (!isOperatorObject(condition)) return value === condition
  return Object.entries(condition).every(([operator, operand]) => COMPARATORS[operator]?.(value, operand) ?? true)
}

/** Filterbedingungen der Query anwenden (ohne `$sort`/`$skip`/`$limit`/`$select`). */
export function filterCachedRecords<TEntity>(records: readonly TEntity[], query: CacheQuery | undefined): TEntity[] {
  const conditions = Object.entries(query ?? {}).filter(([field]) => !field.startsWith('$'))
  if (conditions.length === 0) return [...records]
  return records.filter(record => conditions.every(([field, condition]) => matches(record as Row, field, condition)))
}

/**
 * Filtern, sortieren und die Seite schneiden. `$limit: 0` schneidet **nicht** ab: Online
 * liefert es ein `Paginated` mit `total` und leerem `data`, offline gibt es nur die Liste —
 * Aufrufer wie `OrderService` lesen die Summe dann aus deren Länge.
 */
export function applyCachedQuery<TEntity>(records: readonly TEntity[], query: CacheQuery | undefined): TEntity[] {
  const result = filterCachedRecords(records, query)

  const sort = query?.['$sort']
  if (sort && typeof sort === 'object') {
    const keys = Object.entries(sort as Record<string, unknown>)
    result.sort((a, b) => {
      for (const [field, direction] of keys) {
        const av = (a as Row)[field]
        const bv = (b as Row)[field]
        const order = compare(av, bv)
        if (order === 0) continue
        // Fehlende Werte bleiben auch absteigend am Ende, statt mit umzudrehen.
        if (!isPresent(av) || !isPresent(bv)) return order
        return Number(direction) < 0 ? -order : order
      }
      return 0
    })
  }

  const skip = Number(query?.['$skip'] ?? 0) || 0
  const limit = Number(query?.['$limit'] ?? 0) || 0
  return limit > 0 ? result.slice(skip, skip + limit) : result.slice(skip)
}
