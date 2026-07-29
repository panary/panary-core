// Zugriffsschicht fuer `pending-local-overrides` — die Puffer-Tabelle des
// Notfall-Modus (ADR 0001).
//
// **Warum ein Repository und kein Feathers-Service:** `.claude/rules/code-style.md`
// §6 verlangt fuer Schreib-Pfade die Adapter-API. Die Tabelle hat aber bewusst
// keinen Service: sie ist eine rein interne Audit-Spur ohne externen Konsumenten,
// und ein registrierter Service brauchte RBAC-Eintraege plus Resolver, nur um
// anschliessend jeden externen Zugriff wieder zu verbieten. Die Regel nennt fuer
// genau diesen Fall die Alternative: „Helper-Wrapper bauen, der den Tenant-Scope
// erzwingt, statt jedem Call die Disziplin zu ueberlassen."
//
// Vorher lagen sechs rohe Knex-Zugriffe verteilt in Hook, Worker und Service —
// zwei davon ohne Tenant-Filter. Hier ist `tenantId` Pflichtparameter auf jeder
// scope-behafteten Operation.

import { logger } from '@panary/shared-backend'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Feathers Application hat generischen Typ Application<any, any>
type FeathersApp = any

export const PENDING_OVERRIDES_TABLE = 'pending-local-overrides'

export const OverrideStatus = {
  PENDING: 'PENDING_RECONCILE',
  CONFLICT: 'CONFLICT',
} as const

export interface PendingOverrideRow {
  _id: string
  tenantId: string
  locationId: string
  tableName: string
  recordId: string
  fieldPath: string
  oldValueJson: string
  newValueJson: string
  changedAt: string
  changedBy: string | null
  status: string
  createdAt: string
  updatedAt: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Knex als generischer Query-Builder
const table = (app: FeathersApp): any | null => {
  const knex = app.get('sqliteClient') as any
  return knex ? knex.table(PENDING_OVERRIDES_TABLE) : null
}

/** Schreibt die Diff-Zeilen eines Override-Patches. */
export const insertOverrides = async (app: FeathersApp, rows: PendingOverrideRow[]): Promise<void> => {
  if (rows.length === 0) return
  const t = table(app)
  if (!t) throw new Error('sqliteClient nicht verfuegbar')
  await t.insert(rows)
}

/**
 * Zaehlt offene und konfliktbehaftete Overrides — als SQL-Aggregat, nicht durch
 * Laden der ganzen Tabelle. Nach einem laengeren Ausfall koennen das Tausende
 * Zeilen sein (eine je geaendertem Drucker-Feldpfad).
 */
export const countOverridesByStatus = async (
  app: FeathersApp,
  tenantId: string,
): Promise<{ pendingCount: number; conflictCount: number }> => {
  const t = table(app)
  if (!t) return { pendingCount: 0, conflictCount: 0 }
  try {
    const rows = (await t.where({ tenantId }).select('status').count({ n: '*' }).groupBy('status')) as Array<{
      status: string
      n: number | string
    }>
    const of = (status: string) => Number(rows.find(r => r.status === status)?.n ?? 0)
    return {
      pendingCount: of(OverrideStatus.PENDING),
      conflictCount: of(OverrideStatus.CONFLICT),
    }
  } catch (err) {
    // Tabelle fehlt (Migration noch nicht gelaufen) — kein Grund, den Aufrufer
    // scheitern zu lassen; er braucht die Zahlen nur fuer die Anzeige.
    logger.warn({
      message: 'pending-local-overrides nicht zaehlbar',
      event: 'emergency-override.count_failed',
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    return { pendingCount: 0, conflictCount: 0 }
  }
}

/** Alle noch abzugleichenden Overrides des Tenants. */
export const findPendingOverrides = async (
  app: FeathersApp,
  tenantId: string,
): Promise<Array<Record<string, unknown>>> => {
  const t = table(app)
  if (!t) return []
  return (await t.where({ tenantId, status: OverrideStatus.PENDING }).select()) as Array<Record<string, unknown>>
}

/** Entfernt die von der Cloud uebernommenen Overrides. */
export const deleteOverridesByIds = async (app: FeathersApp, ids: string[]): Promise<void> => {
  if (ids.length === 0) return
  const t = table(app)
  if (!t) return
  await t.whereIn('_id', ids).del()
}

/** Markiert die von der Cloud abgelehnten Overrides als Konflikt. */
export const markOverridesConflicted = async (app: FeathersApp, ids: string[]): Promise<void> => {
  if (ids.length === 0) return
  const t = table(app)
  if (!t) return
  await t.whereIn('_id', ids).update({ status: OverrideStatus.CONFLICT, updatedAt: new Date().toISOString() })
}

/**
 * Verwirft die noch nicht abgeglichenen Overrides eines Tenants.
 *
 * Nur auf ausdrueckliche Anweisung aufrufen: das Loeschen der Zeilen rollt
 * `settings.printSettings` NICHT zurueck — die lokalen Werte bleiben am Edge
 * stehen, nur die Reconcile-Spur ist weg.
 *
 * @returns Anzahl der geloeschten Zeilen.
 */
export const discardPendingOverrides = async (app: FeathersApp, tenantId: string): Promise<number> => {
  const t = table(app)
  if (!t) return 0
  return (await t.where({ tenantId, status: OverrideStatus.PENDING }).del()) as number
}
