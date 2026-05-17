// Around-Hook für locations.patch im Emergency-Override-Modus.
//
// Wird nur dann aktiv, wenn `cloudManaged()`-Hook den Patch durchgelassen
// hat UND `params.isEmergencyOverride=true` gesetzt hat. Liest den Datensatz
// VOR dem Patch (via internem `_get`), führt den Patch aus, vergleicht
// `before.settings.printSettings` gegen `result.settings.printSettings` und
// schreibt einen Eintrag pro geänderten Feldpfad in `pending-local-overrides`.
//
// **Wichtig:** Diese Patches landen NICHT in der Sync-Outbox — Cloud entscheidet
// beim Reconnect via `POST /sync/reconcile-overrides`, ob sie übernommen werden
// oder als Konflikt landen.

import type { NextFunction } from '@feathersjs/feathers'
import { uuidv7 } from 'uuidv7'
import { logger } from '@panary-core/shared-backend'

import type { HookContext } from '../declarations'

const PENDING_OVERRIDES_TABLE = 'pending-local-overrides'

interface OverrideFieldDiff {
  fieldPath: string
  oldValue: unknown
  newValue: unknown
}

/**
 * Vergleicht zwei `printSettings`-Objekte und liefert eine flache Liste von
 * Feldpfaden mit Diffs. Für `printers[]` wird per `pid` verglichen — jeder
 * geänderte Drucker wird als eigener Eintrag `printers/<pid>` protokolliert,
 * damit der Reconciliation-Dialog feldgenau auflösen kann.
 */
const diffPrintSettings = (
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
): OverrideFieldDiff[] => {
  const result: OverrideFieldDiff[] = []
  const beforeObj = before ?? {}
  const afterObj = after ?? {}
  const keys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)])
  for (const key of keys) {
    if (key === 'printers') {
      const beforePrinters = (beforeObj['printers'] ?? []) as Array<{ pid: string; [k: string]: unknown }>
      const afterPrinters = (afterObj['printers'] ?? []) as Array<{ pid: string; [k: string]: unknown }>
      const beforeByPid = new Map(beforePrinters.map(p => [p.pid, p]))
      const afterByPid = new Map(afterPrinters.map(p => [p.pid, p]))
      const pids = new Set([...beforeByPid.keys(), ...afterByPid.keys()])
      for (const pid of pids) {
        const a = beforeByPid.get(pid)
        const b = afterByPid.get(pid)
        if (JSON.stringify(a) !== JSON.stringify(b)) {
          result.push({ fieldPath: `printSettings.printers/${pid}`, oldValue: a, newValue: b })
        }
      }
      continue
    }
    if (JSON.stringify(beforeObj[key]) !== JSON.stringify(afterObj[key])) {
      result.push({
        fieldPath: `printSettings.${key}`,
        oldValue: beforeObj[key],
        newValue: afterObj[key],
      })
    }
  }
  return result
}

export const recordEmergencyOverride =
  () =>
  async (context: HookContext, next: NextFunction): Promise<void> => {
    const isOverridePath =
      context.path === 'locations' && context.method === 'patch' && context.id != null
    let beforeRecord: { settings?: { printSettings?: Record<string, unknown> } } | null = null
    if (isOverridePath) {
      // Vor dem Patch lesen — der After-Vergleich braucht den Vor-Zustand.
      // Das machen wir UNABHÄNGIG vom Override-Flag, weil cloudManaged() das
      // Flag setzt BEVOR der Hook hier ausgeführt wird. Falls kein Override:
      // wir verschwenden einen Read-Call, aber bleiben funktional korrekt.
      try {
        beforeRecord = (await (context.service as unknown as {
          _get: (id: unknown, params?: unknown) => Promise<typeof beforeRecord>
        })._get(context.id)) ?? null
      } catch {
        beforeRecord = null
      }
    }

    await next()

    if (!isOverridePath) return
    if (!(context.params as Record<string, unknown>)['isEmergencyOverride']) return

    const result = context.result as
      | { _id?: string; tenantId?: string; settings?: { printSettings?: Record<string, unknown> } }
      | undefined
    if (!result?._id || !result.tenantId) return

    const diffs = diffPrintSettings(
      beforeRecord?.settings?.printSettings,
      result.settings?.printSettings,
    )
    if (diffs.length === 0) return

    const now = new Date().toISOString()
    const user = (context.params as Record<string, unknown>)['user'] as
      | { _id?: string }
      | undefined

    try {
      const knex = (context.app.get('sqliteClient') as unknown) as
        | { table: (name: string) => { insert: (rows: unknown) => Promise<unknown> } }
        | undefined
      if (!knex) return
      const rows = diffs.map(d => ({
        _id: uuidv7(),
        tenantId: result.tenantId,
        locationId: result._id,
        tableName: 'locations',
        recordId: result._id,
        fieldPath: d.fieldPath,
        oldValueJson: JSON.stringify(d.oldValue ?? null),
        newValueJson: JSON.stringify(d.newValue ?? null),
        changedAt: now,
        changedBy: user?._id ?? null,
        status: 'PENDING_RECONCILE',
        createdAt: now,
        updatedAt: now,
      }))
      await knex.table(PENDING_OVERRIDES_TABLE).insert(rows)

      logger.info({
        message: 'Emergency-Override gespeichert',
        event: 'emergency-override.patch-allowed',
        locationId: result._id,
        tenantId: result.tenantId,
        diffCount: diffs.length,
        fieldPaths: diffs.map(d => d.fieldPath),
      })
    } catch (err) {
      logger.error({
        message: 'Emergency-Override konnte nicht in pending-local-overrides geschrieben werden',
        event: 'emergency-override.persist_error',
        locationId: result._id,
        errorMessage: err instanceof Error ? err.message : String(err),
      })
    }
  }
