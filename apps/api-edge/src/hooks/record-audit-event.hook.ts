// After-Hook: Schreibt fuer geschaeftskritische Mutationen einen append-only
// Audit-Eintrag in `audit-events`. Sidecar-Pattern parallel zu `recordSyncOutbox`.
//
// Wichtige Eigenschaften:
//   - Self-Skip fuer audit-events/sync-outbox/sync-cursor/sync-conflicts —
//     verhindert Recursive-Loops.
//   - Resource-Whitelist via AUDIT_RESOURCE_MAP. Nicht-whitelisted Pfade
//     werden ignoriert.
//   - dynamicAction-Logik: VOID/REFUND/DISCOUNT (order-interactions),
//     PRICE_CHANGE (products), PERMISSION_CHANGE (users) werden anhand der
//     Daten/des Diffs abgeleitet.
//   - Diff-Berechnung: shallow key-by-key zwischen `params.audit.before` und
//     `result`. Sensitive Felder werden maskiert.
//   - Failure-Modus: Try/catch + logger.warn. Audit-Verlust ist akzeptabel,
//     Business-Pfad bleibt intakt.
import { uuidv7 } from 'uuidv7'

import {
  AUDIT_NEVER_AUDIT_PATHS,
  AuditAction,
  AuditOutcome,
  type AuditAction as AuditActionType,
  type AuditEventData,
  getAuditMapping,
} from '@panary-core/audit-events/domain'
import { logger } from '@panary-core/shared-backend'

import type { HookContext } from '../declarations'
import type { AuditCaptureState } from './capture-audit-before.hook'

const SENSITIVE_FIELDS = ['password', 'posPin', 'apikey', 'secret', 'token']
const REDACTED = '***REDACTED***'

export const recordAuditEvent = async (context: HookContext): Promise<void> => {
  // 1. Self-Skip — verhindert Loops
  if (AUDIT_NEVER_AUDIT_PATHS.has(context.path)) return

  // 2. Whitelist-Check
  const mapping = getAuditMapping(context.path, context.method)
  if (!mapping) return

  // 3. User-Kontext — interne Aufrufe ohne User werden NICHT auditiert.
  // Audits ohne Akteur sind forensisch wertlos; Login-Events laufen ueber
  // record-auth-audit-event.hook.ts (mit explizitem Akteur).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user = (context.params as any)?.user as
    | { _id?: string; role?: string; tenantId?: string; locationId?: string | null; permissions?: string[] }
    | undefined
  if (!user || !user._id || !user.tenantId) return

  // 4. Result extrahieren
  const result = getSingleResult(context.result)
  const entityId =
    context.method === 'remove'
      ? (context.id as string | undefined)
      : ((result?._id as string | undefined) ?? (context.id as string | undefined))
  if (!entityId) return

  // 5. before/after/diff
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const captureState = ((context.params as any)?.audit ?? {}) as AuditCaptureState
  const before = captureState.before
  const after = context.method === 'remove' ? undefined : (result ?? undefined)
  const diff = before && after ? buildDiff(before, after as Record<string, unknown>) : undefined

  // 6. Action-Resolution (dynamicAction)
  const action = resolveAction(mapping.action, mapping.dynamicAction === true, context, after, diff)

  // 7. correlationId aus canonicalLog
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const correlationId = ((context.params as any)?.requestId as string | undefined) ?? uuidv7()

  // 8. Event bauen
  const occurredAt = new Date().toISOString()
  const event: AuditEventData = {
    _id: uuidv7(),
    tenantId: user.tenantId,
    locationId: (user.locationId ?? null) as unknown as string,
    occurredAt,
    actor: {
      userId: user._id,
      role: user.role ?? 'unknown',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ipAddress: ((context.params as any)?.ip as string | undefined) ?? undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      userAgent: ((context.params as any)?.headers?.['user-agent'] as string | undefined) ?? undefined,
      requestId: correlationId,
    },
    target: {
      resource: context.path,
      entityType: deriveEntityType(context.path),
      entityId,
    },
    action,
    category: mapping.category,
    outcome: AuditOutcome.SUCCESS,
    severity: mapping.severity,
    before: before ? sanitize(before) : undefined,
    after: after ? sanitize(after as Record<string, unknown>) : undefined,
    diff: diff && Object.keys(diff).length > 0 ? sanitizeDiff(diff) : undefined,
    metadata: buildMetadata(context, captureState, mapping.dynamicAction === true),
    correlationId,
  }

  // 9. Schreiben — via internen Aufruf (provider: undefined umgeht
  // blockExternalWrites + authorize). Audit-Trigger und Append-only-Service
  // erlauben create.
  try {
    // Flache Index-Spalten zusaetzlich setzen — Knex schreibt JSON-Felder via
    // stringifyJsonFields-Hook, aber actor.userId etc. brauchen wir flach
    // fuer Indizes (siehe Migration). Wir injizieren sie beim Persistieren.
    const persistedEvent: Record<string, unknown> = {
      ...(event as unknown as Record<string, unknown>),
      actor_userId: event.actor.userId,
      target_resource: event.target.resource,
      target_entityType: event.target.entityType,
      target_entityId: event.target.entityId,
    }
    await context.app
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .service('audit-events' as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .create(persistedEvent as any, { provider: undefined } as any)
  } catch (err) {
    logger.warn({
      message: 'Audit-Event konnte nicht geschrieben werden',
      event: 'audit.record_failed',
      service: context.path,
      method: context.method,
      entityId,
      errorMessage: err instanceof Error ? err.message : String(err),
    })
  }
}

// ----- Hilfsfunktionen -----

function getSingleResult(result: unknown): Record<string, unknown> | null {
  if (result == null) return null
  if (Array.isArray(result)) return result.length === 1 ? (result[0] as Record<string, unknown>) : null
  if (typeof result === 'object' && 'data' in (result as Record<string, unknown>)) {
    const data = (result as Record<string, unknown>).data
    return Array.isArray(data) && data.length === 1 ? (data[0] as Record<string, unknown>) : null
  }
  return result as Record<string, unknown>
}

function deriveEntityType(servicePath: string): string {
  // 'orders' → 'order', 'order-interactions' → 'order-interaction'
  if (servicePath.endsWith('s')) return servicePath.slice(0, -1)
  return servicePath
}

function resolveAction(
  defaultAction: AuditActionType,
  dynamic: boolean,
  context: HookContext,
  after: Record<string, unknown> | undefined,
  diff: Record<string, { from: unknown; to: unknown }> | undefined,
): AuditActionType {
  if (!dynamic) return defaultAction

  // products: PRICE_CHANGE wenn `price` im Diff
  if (context.path === 'products' && diff && 'price' in diff) {
    return AuditAction.PRICE_CHANGE
  }

  // users: PERMISSION_CHANGE wenn `role` oder `permissions` im Diff
  if (context.path === 'users' && diff) {
    if ('role' in diff || 'permissions' in diff) {
      return AuditAction.PERMISSION_CHANGE
    }
  }

  // order-interactions: aus data.interactionType / data.type ableiten
  if (context.path === 'order-interactions') {
    const data = (context.data as { type?: string; interactionType?: string } | undefined) ?? after
    const t = (data?.['interactionType'] ?? data?.['type'] ?? '').toString().toUpperCase()
    if (t === 'VOID' || t === 'CANCELLED' || t === 'CANCEL') return AuditAction.VOID
    if (t === 'REFUND') return AuditAction.REFUND
    if (t === 'DISCOUNT') return AuditAction.DISCOUNT
  }

  return defaultAction
}

function buildDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {}
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const key of keys) {
    if (key === 'updatedAt') continue // server-managed, irrelevant fuer Audit
    const beforeVal = before[key]
    const afterVal = after[key]
    if (!shallowEqual(beforeVal, afterVal)) {
      diff[key] = { from: beforeVal, to: afterVal }
    }
  }
  return diff
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  if (typeof a !== typeof b) return false
  if (typeof a === 'object') {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  return false
}

function sanitize(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...record }
  for (const field of SENSITIVE_FIELDS) {
    if (field in out) out[field] = REDACTED
  }
  return out
}

function sanitizeDiff(
  diff: Record<string, { from: unknown; to: unknown }>,
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {}
  for (const [key, val] of Object.entries(diff)) {
    if (SENSITIVE_FIELDS.includes(key)) {
      out[key] = { from: REDACTED, to: REDACTED }
    } else {
      out[key] = val
    }
  }
  return out
}

function buildMetadata(
  context: HookContext,
  captureState: AuditCaptureState,
  isDynamic: boolean,
): Record<string, unknown> | undefined {
  const meta: Record<string, unknown> = {}
  if (captureState.bulkOperation) meta.bulkOperation = true
  if (captureState.beforeError) meta.beforeFetchFailed = captureState.beforeError

  // Geschaeftskontext fuer haeufig auditierte Resources, der direkt im Event
  // sichtbar bleiben soll (UI-Quickview ohne Diff-Drilldown).
  const result = getSingleResult(context.result)
  if (context.path === 'orders' && result) {
    if (result.dailySequenceNumber != null) meta.dailySequenceNumber = result.dailySequenceNumber
    const payment = result.payment as Record<string, unknown> | undefined
    if (payment?.totalAmount != null) meta.grossAmount = payment.totalAmount
  }
  if (context.path === 'order-interactions' && result) {
    if (result.orderId) meta.orderId = result.orderId
    if (result.deletedQuantity != null) meta.deletedQuantity = result.deletedQuantity
  }
  if (context.path === 'products' && result && isDynamic) {
    if (result.price != null) meta.price = result.price
  }

  return Object.keys(meta).length > 0 ? meta : undefined
}
