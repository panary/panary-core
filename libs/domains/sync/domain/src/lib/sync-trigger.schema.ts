import type { Static } from '@feathersjs/typebox'
import { Type } from '@feathersjs/typebox'

// Cloud-getriggerter Edge-Sync ("Click-to-Sync"):
// Admin/Owner in der Cloud-UI klickt "Jetzt synchronisieren" pro Edge → Cloud
// emittiert ein `force-sync`-Event ueber den bestehenden edge-events-Backbone
// an genau diesen Edge → Edge fuehrt einen vollen Scheduler-Cycle aus.
//
// `scope` ist ein Enum statt eines Bools, damit kuenftige Erweiterungen
// (master-data-only, push-only) abwaertskompatibel ergaenzt werden koennen.

export const syncTriggersPath = 'sync-triggers'

export const SyncTriggerScope = {
  FULL_CYCLE: 'full-cycle',
} as const
export type SyncTriggerScope = (typeof SyncTriggerScope)[keyof typeof SyncTriggerScope]

export const SYNC_TRIGGER_SCOPES = Object.values(SyncTriggerScope)

export const syncTriggerRequestSchema = Type.Object(
  {
    cloudEdgeId: Type.String({ format: 'uuid' }),
    scope: Type.Optional(Type.Union([Type.Literal(SyncTriggerScope.FULL_CYCLE)])),
  },
  { $id: 'SyncTriggerRequest', additionalProperties: false },
)
export type SyncTriggerRequest = Static<typeof syncTriggerRequestSchema>

export const syncTriggerResponseSchema = Type.Object(
  {
    ok: Type.Boolean(),
    correlationId: Type.String({ format: 'uuid' }),
    dispatchedAt: Type.String({ format: 'date-time' }),
    scope: Type.Union([Type.Literal(SyncTriggerScope.FULL_CYCLE)]),
  },
  { $id: 'SyncTriggerResponse', additionalProperties: false },
)
export type SyncTriggerResponse = Static<typeof syncTriggerResponseSchema>

// Fehler-Codes, die der Cloud-Service im `message`-Feld setzt. Frontend mappt sie
// auf verstaendliche Texte; Backend-Tests pruefen exakt diese Strings.
export const SyncTriggerErrorCode = {
  EDGE_NOT_FOUND: 'EDGE_NOT_FOUND',
  EDGE_REVOKED: 'EDGE_REVOKED',
  EDGE_UNREACHABLE: 'EDGE_UNREACHABLE',
  RATE_LIMITED: 'RATE_LIMITED',
  NOT_AUTHORIZED: 'NOT_AUTHORIZED',
} as const
export type SyncTriggerErrorCode = (typeof SyncTriggerErrorCode)[keyof typeof SyncTriggerErrorCode]
