import type { Static } from '@feathersjs/typebox'
import { Type } from '@feathersjs/typebox'

import { SyncTriggerScope } from './sync-trigger.schema'

// Push-Backbone Cloud→Edge: Die Cloud benachrichtigt einen gepairten Edge über
// eine bestehende, vom Edge OUTBOUND aufgebaute Socket.IO-Connection. Der Push
// trägt KEINE Geschäftsdaten — nur ein Trigger-Signal. Die eigentlichen Daten
// fließen weiterhin durch den auditierten `/sync-pull`-Pfad (Tenant-/Location-
// Projektionen, Tombstones, Allowlist). Exakte Edge-Isolation wird cloud-seitig
// über die Channel-Mitgliedschaft (`edge/<cloudEdgeId>`) erzwungen.

export const EDGE_EVENTS_PATH = 'edge-events'

export const EdgeEventName = {
  // Stammdaten/Lifecycle-Änderung für genau diesen Edge — Edge zieht die
  // genannten Services per Pull nach.
  CHANGED: 'changed',
  // Operator-/Cloud-getriggerter Voll-Sync (alle Services).
  FORCE_SYNC: 'force-sync',
  // Pairing widerrufen — Edge baut die Socket-Verbindung ab und wechselt in den
  // Standalone-Modus.
  REVOKED: 'revoked',
} as const

export type EdgeEventName = (typeof EdgeEventName)[keyof typeof EdgeEventName]

export const EDGE_EVENT_NAMES = Object.values(EdgeEventName)

export const edgeChangedEventSchema = Type.Object(
  {
    cloudEdgeId: Type.String({ format: 'uuid' }),
    services: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { minItems: 1, maxItems: 50 }),
  },
  { $id: 'EdgeChangedEvent', additionalProperties: false },
)
export type EdgeChangedEvent = Static<typeof edgeChangedEventSchema>

// v2-Erweiterung: alle Felder ausser `cloudEdgeId` sind Optional → bestehende
// Caller (`emitEdgeForceSync(app, { cloudEdgeId })`) bleiben gueltig. Edge-Seite
// liest die neuen Felder defensiv mit `??`-Fallback.
export const edgeForceSyncEventSchema = Type.Object(
  {
    cloudEdgeId: Type.String({ format: 'uuid' }),
    scope: Type.Optional(Type.Union([Type.Literal(SyncTriggerScope.FULL_CYCLE)])),
    requestedByUserId: Type.Optional(Type.String({ format: 'uuid' })),
    requestedAt: Type.Optional(Type.String({ format: 'date-time' })),
    correlationId: Type.Optional(Type.String({ format: 'uuid' })),
  },
  { $id: 'EdgeForceSyncEvent', additionalProperties: false },
)
export type EdgeForceSyncEvent = Static<typeof edgeForceSyncEventSchema>

export const edgeRevokedEventSchema = Type.Object(
  {
    cloudEdgeId: Type.String({ format: 'uuid' }),
    reason: Type.Optional(Type.String({ maxLength: 500 })),
  },
  { $id: 'EdgeRevokedEvent', additionalProperties: false },
)
export type EdgeRevokedEvent = Static<typeof edgeRevokedEventSchema>

export type EdgeEventPayload = EdgeChangedEvent | EdgeForceSyncEvent | EdgeRevokedEvent
