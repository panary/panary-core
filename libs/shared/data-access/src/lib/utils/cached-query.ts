/**
 * Feathers-Query gegen eine Cache-Liste auswerten (core#649).
 *
 * Offline beantwortet der `BaseService` `find`/`count` aus dem Cache. Ohne Auswertung der
 * Query kam dort jeder Datensatz des Stores zurück — ein paginierender Lader
 * (`count` → n Seiten `find` mit `$skip`/`$limit`) bekam dann n-mal dieselbe Liste,
 * inklusive inaktiver Einträge.
 *
 * Unterstützt: Gleichheit, `$in`, `$nin`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$regex`
 * (mit `$options`), `$sort`, `$skip`, `$limit`. Unbekannte Operatoren filtern bewusst
 * **nicht**: Offline lieber eine Zeile zu viel als eine verschwiegene.
 */

type CacheQuery = Record<string, unknown>
type Row = Record<string, unknown>

/** `undefined` = Operator unbekannt bzw. nicht auswertbar → die Bedingung filtert nicht. */
type Comparator = (value: unknown, operand: unknown, condition: Record<string, unknown>) => boolean | undefined

const COMPARATORS: Record<string, Comparator> = {
  $in: (value, operand) => (Array.isArray(operand) ? operand.includes(value) : undefined),
  $nin: (value, operand) => (Array.isArray(operand) ? !operand.includes(value) : undefined),
  $ne: (value, operand) => value !== operand,
  $gt: (value, operand) => isPresent(value) && compare(value, operand) > 0,
  $gte: (value, operand) => isPresent(value) && compare(value, operand) >= 0,
  $lt: (value, operand) => isPresent(value) && compare(value, operand) < 0,
  $lte: (value, operand) => isPresent(value) && compare(value, operand) <= 0,
  $regex: (value, operand, condition) => {
    const pattern = toRegExp(operand, condition['$options'])
    if (!pattern) return undefined
    return typeof value === 'string' && pattern.test(value)
  },
  // Begleiter von `$regex`, keine eigene Bedingung.
  $options: () => true,
}

function toRegExp(pattern: unknown, options: unknown): RegExp | null {
  if (pattern instanceof RegExp) return pattern
  if (typeof pattern !== 'string') return null
  try {
    return new RegExp(pattern, typeof options === 'string' ? options.replace(/[^imsu]/g, '') : '')
  } catch {
    return null
  }
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

interface Evaluation<TEntity> {
  rows: TEntity[]
  /** `false`, sobald eine Bedingung nicht ausgewertet werden konnte — das Ergebnis ist dann zu weit. */
  exact: boolean
}

function evaluate<TEntity>(records: readonly TEntity[], query: CacheQuery | undefined): Evaluation<TEntity> {
  const conditions = Object.entries(query ?? {}).filter(([field]) => !field.startsWith('$'))
  let exact = true

  const matches = (row: Row, field: string, condition: unknown): boolean => {
    const value = row[field]
    if (!isOperatorObject(condition)) return value === condition
    return Object.entries(condition).every(([operator, operand]) => {
      const result = COMPARATORS[operator]?.(value, operand, condition)
      if (result === undefined) exact = false
      return result ?? true
    })
  }

  const rows =
    conditions.length === 0
      ? [...records]
      : records.filter(record => conditions.every(([field, condition]) => matches(record as Row, field, condition)))
  return { rows, exact }
}

/** Filterbedingungen der Query anwenden (ohne `$sort`/`$skip`/`$limit`/`$select`). */
export function filterCachedRecords<TEntity>(records: readonly TEntity[], query: CacheQuery | undefined): TEntity[] {
  return evaluate(records, query).rows
}

/**
 * Filtern, sortieren und die Seite schneiden.
 *
 * Geschnitten wird nur, wenn das Ergebnis exakt **und** sortiert ist. Ohne `$sort` ist die
 * Cache-Reihenfolge nicht die des Servers, ein `$limit` träfe beliebige Zeilen (offline
 * angelegte Bestellungen stehen hinten und fielen als erste heraus). Mit einem nicht
 * ausgewerteten Filter wäre die Seite ein Ausschnitt einer zu weiten Liste und könnte den
 * gesuchten Treffer abschneiden. `$limit: 0` schneidet ebenfalls nicht ab: Online liefert es
 * ein `Paginated` mit leerem `data`, offline lesen Aufrufer wie `OrderService` die Summe aus
 * der Länge der Liste.
 */
export function applyCachedQuery<TEntity>(records: readonly TEntity[], query: CacheQuery | undefined): TEntity[] {
  const { rows: result, exact } = evaluate(records, query)

  const sort = query?.['$sort']
  const sorted = Boolean(sort && typeof sort === 'object' && Object.keys(sort).length > 0)
  if (sorted) {
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

  if (!exact || !sorted) return result

  const skip = Number(query?.['$skip'] ?? 0) || 0
  const limit = Number(query?.['$limit'] ?? 0) || 0
  return limit > 0 ? result.slice(skip, skip + limit) : result.slice(skip)
}
