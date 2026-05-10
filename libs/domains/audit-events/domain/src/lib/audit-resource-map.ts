import { AuditAction, type AuditAction as AuditActionType } from './audit-action.enum'
import { AuditCategory, AuditSeverity, type AuditCategory as AuditCategoryType, type AuditSeverity as AuditSeverityType } from './audit-category.enum'

// Mapping: (Service-Pfad, FeathersJS-Methode) → (Audit-Action, Category, Severity).
// Dient als Whitelist für den `record-audit-event`-Hook im Edge-Backend.
//
// `dynamicAction: true` heißt: Der Recorder bestimmt die finale Action erst zur
// Laufzeit (z. B. PRICE_CHANGE statt UPDATE, wenn `price` im Diff liegt; oder
// VOID/REFUND statt CREATE, wenn `data.interactionType` das markiert).
export interface AuditResourceMapping {
  action: AuditActionType
  category: AuditCategoryType
  severity: AuditSeverityType
  dynamicAction?: boolean
}

export type AuditResourceMethod =
  | 'create'
  | 'patch'
  | 'update'
  | 'remove'
  // Custom-Methoden (FeathersJS v5)
  | 'checkin'
  | 'checkout'
  | 'startBreak'
  | 'endBreak'

const r = (
  action: AuditActionType,
  category: AuditCategoryType,
  severity: AuditSeverityType,
  dynamicAction = false,
): AuditResourceMapping => ({ action, category, severity, dynamicAction })

// Map<resource, Map<method, mapping>>
export const AUDIT_RESOURCE_MAP: Readonly<
  Record<string, Partial<Record<AuditResourceMethod, AuditResourceMapping>>>
> = {
  orders: {
    create: r(AuditAction.CREATE, AuditCategory.TRANSACTION, AuditSeverity.INFO),
    patch: r(AuditAction.UPDATE, AuditCategory.TRANSACTION, AuditSeverity.NOTICE),
    update: r(AuditAction.UPDATE, AuditCategory.TRANSACTION, AuditSeverity.NOTICE),
    remove: r(AuditAction.DELETE, AuditCategory.TRANSACTION, AuditSeverity.WARNING),
  },
  'order-interactions': {
    // dynamicAction: VOID / REFUND / DISCOUNT abgeleitet aus data.interactionType
    create: r(AuditAction.UPDATE, AuditCategory.TRANSACTION, AuditSeverity.NOTICE, true),
  },
  products: {
    // dynamicAction: PRICE_CHANGE wenn `price` im Diff liegt, sonst UPDATE
    patch: r(AuditAction.UPDATE, AuditCategory.PRICING, AuditSeverity.NOTICE, true),
    update: r(AuditAction.UPDATE, AuditCategory.PRICING, AuditSeverity.NOTICE, true),
  },
  users: {
    // dynamicAction: PERMISSION_CHANGE wenn `role`/`permissions` im Diff
    patch: r(AuditAction.UPDATE, AuditCategory.CONFIGURATION, AuditSeverity.WARNING, true),
    update: r(AuditAction.UPDATE, AuditCategory.CONFIGURATION, AuditSeverity.WARNING, true),
    // Custom Methods (Zeiterfassung)
    checkin: r(AuditAction.CLOCK_IN, AuditCategory.TIME, AuditSeverity.INFO),
    checkout: r(AuditAction.CLOCK_OUT, AuditCategory.TIME, AuditSeverity.INFO),
    startBreak: r(AuditAction.BREAK_START, AuditCategory.TIME, AuditSeverity.INFO),
    endBreak: r(AuditAction.BREAK_END, AuditCategory.TIME, AuditSeverity.INFO),
  },
  apikeys: {
    create: r(AuditAction.API_KEY_CREATE, AuditCategory.ACCESS, AuditSeverity.WARNING),
    remove: r(AuditAction.API_KEY_REVOKE, AuditCategory.ACCESS, AuditSeverity.WARNING),
  },
  'working-times': {
    create: r(AuditAction.CLOCK_IN, AuditCategory.TIME, AuditSeverity.INFO),
    patch: r(AuditAction.UPDATE, AuditCategory.TIME, AuditSeverity.NOTICE),
    update: r(AuditAction.UPDATE, AuditCategory.TIME, AuditSeverity.NOTICE),
  },
  customers: {
    patch: r(AuditAction.UPDATE, AuditCategory.DATA_MUTATION, AuditSeverity.INFO),
    update: r(AuditAction.UPDATE, AuditCategory.DATA_MUTATION, AuditSeverity.INFO),
    remove: r(AuditAction.DELETE, AuditCategory.DATA_MUTATION, AuditSeverity.WARNING),
  },
  'write-offs': {
    create: r(AuditAction.WRITE_OFF, AuditCategory.CASH, AuditSeverity.NOTICE),
  },
}

// Schreib-Pfade, die NIEMALS auditiert werden — verhindert Self-Audit-Loops und
// reduziert Noise. Komplementär zur Whitelist oben.
export const AUDIT_NEVER_AUDIT_PATHS: ReadonlySet<string> = new Set([
  'audit-events',
  'sync-outbox',
  'sync-cursor',
  'sync-conflicts',
])

// Hilfsfunktion: bestimmt das Mapping für ein Service-/Method-Paar.
// Liefert undefined, wenn nicht in der Whitelist enthalten.
export function getAuditMapping(resource: string, method: string): AuditResourceMapping | undefined {
  return AUDIT_RESOURCE_MAP[resource]?.[method as AuditResourceMethod]
}
