// Before-Hook: Schnappt den Vor-Zustand einer Mutation, damit der spaetere
// `record-audit-event`-Hook ein before/after-Diff bilden kann.
//
// - Aktiv nur fuer Whitelist-Resources (siehe AUDIT_RESOURCE_MAP) und nur bei
//   patch/update/remove (CREATE hat per Definition keinen Vor-Zustand).
// - Liest den aktuellen Datensatz via `service.get(id, { provider: undefined })`,
//   sodass authorize/multiTenancy keine Sperre auswerfen.
// - Schlaegt der Get fehl, wird der Audit-Pfad degradiert (nicht abgebrochen):
//   `params.audit.beforeError` wird gesetzt, der Business-Write laeuft normal.
// - Bei Bulk-Patches ohne ID (`context.id == null`) wird `bulkOperation: true`
//   notiert; der Recorder produziert dann ein Audit-Event ohne Diff.
import { AUDIT_NEVER_AUDIT_PATHS, getAuditMapping } from '@panary/audit-events/domain'
import { logger } from '@panary/shared-backend'

import type { HookContext } from '../declarations'

export interface AuditCaptureState {
  before?: Record<string, unknown>
  beforeError?: string
  bulkOperation?: boolean
}

const MUTATING_METHODS = new Set(['patch', 'update', 'remove'])

export const captureAuditBefore = async (context: HookContext): Promise<void> => {
  if (AUDIT_NEVER_AUDIT_PATHS.has(context.path)) return
  if (!MUTATING_METHODS.has(context.method)) return

  const mapping = getAuditMapping(context.path, context.method)
  if (!mapping) return

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params = context.params as any
  if (!params.audit) params.audit = {} as AuditCaptureState
  const audit = params.audit as AuditCaptureState

  if (context.id == null) {
    audit.bulkOperation = true
    return
  }

  try {
    // Internen Lookup ohne Provider, damit authorize/multiTenancy nicht
    // den Aufruf des Audit-Pfads blockieren. Der User-Kontext bleibt
    // erhalten — multiTenancy bypasst bei `!user`, aber wir behalten den
    // User aus Sicherheitsgruenden, damit die ensureTenantIsolation
    // weiterhin greift.
    const before = await context.app
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .service(context.path as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .get(context.id as any, { ...params, provider: undefined } as any)
    audit.before = before as Record<string, unknown>
  } catch (err) {
    audit.beforeError = err instanceof Error ? err.message : String(err)
    logger.warn({
      message: 'Audit before-snapshot konnte nicht geladen werden',
      event: 'audit.before_snapshot_failed',
      service: context.path,
      method: context.method,
      entityId: context.id,
      errorMessage: audit.beforeError,
    })
  }
}
