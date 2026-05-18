import type { Static } from '@feathersjs/typebox'
import { StringEnum, Type } from '@feathersjs/typebox'

import { SyncConflictReason } from './sync-conflict.schema'

export const SyncOp = {
  CREATE: 'create',
  PATCH: 'patch',
  REMOVE: 'remove',
} as const

export type SyncOp = (typeof SyncOp)[keyof typeof SyncOp]

export const SyncSource = {
  LIVE: 'live',
  BACKFILL: 'backfill',
} as const

export type SyncSource = (typeof SyncSource)[keyof typeof SyncSource]

/**
 * Klassifikation eines Cloud-Rejects fuer den Edge-Push-Worker. Steuert das
 * Retry-Verhalten und ob ein `sync-conflicts`-Eintrag erzeugt werden muss.
 *
 * - `transient`:  Vorübergehender Fehler (Netzwerk, 5xx, Mongo-Connection-Loss)
 *                 → Edge inkrementiert `attempts` + setzt `nextAttemptAt` mit
 *                 Exponential Backoff. Eskalation zu Conflict bei MAX_ATTEMPTS.
 * - `terminal`:   Persistenter Schema-/Konfig-Bug (AJV-Fehler, Service-Allowlist
 *                 etc.) → Edge markiert Outbox als `rejected`, KEIN automatisches
 *                 Retry. Operator muss eingreifen (Schema-Fix + Re-Push).
 * - `conflict`:   Daten-Konflikt, User-Resolution erforderlich (Tenant-Mismatch,
 *                 Concurrent-Write). Edge erzeugt `sync-conflicts`-Eintrag mit
 *                 Edge- und Cloud-Payload zur Vergleichsanzeige.
 *
 * Aeltere Edge-Versionen ohne dieses Feld interpretieren jeden Reject als
 * `terminal` (Default-Fallback im Worker).
 */
export const SyncRejectionClassification = {
  TRANSIENT: 'transient',
  TERMINAL: 'terminal',
  CONFLICT: 'conflict',
} as const

export type SyncRejectionClassification =
  (typeof SyncRejectionClassification)[keyof typeof SyncRejectionClassification]

export const syncOpSchema = Type.Object(
  {
    _id: Type.String({ format: 'uuid' }),
    service: Type.String({ minLength: 1, maxLength: 80 }),
    op: StringEnum(Object.values(SyncOp)),
    entityId: Type.String({ format: 'uuid' }),
    payload: Type.Optional(Type.Unknown()),
    occurredAt: Type.String({ format: 'date-time' }),
    syncSource: StringEnum(Object.values(SyncSource)),
  },
  { $id: 'SyncOp', additionalProperties: false },
)

export type SyncOpEntry = Static<typeof syncOpSchema>

export const syncRejectionSchema = Type.Object(
  {
    _id: Type.String({ format: 'uuid' }),
    reason: Type.String(),
    code: Type.Optional(Type.String()),
    // Optional-only fuer Backwards-Compat: aeltere Cloud-Versionen ohne
    // Klassifikation liefern das Feld nicht; der Edge-Worker faellt dann auf
    // `terminal` zurueck (kein automatisches Retry).
    classification: Type.Optional(StringEnum(Object.values(SyncRejectionClassification))),
    // Nur gesetzt wenn classification='conflict' — steuert die Reason-Spalte
    // im sync-conflicts-Eintrag (z.B. PUSH_FORBIDDEN bei Tenant-Mismatch).
    conflictReason: Type.Optional(StringEnum(Object.values(SyncConflictReason))),
    // Nur gesetzt wenn classification='conflict' — Cloud-Stand des Records fuer
    // die Vergleichsanzeige im Operator-UI (Edge-Payload steht in der Outbox).
    cloudPayload: Type.Optional(Type.Unknown()),
  },
  { $id: 'SyncRejection', additionalProperties: false },
)

export type SyncRejection = Static<typeof syncRejectionSchema>
