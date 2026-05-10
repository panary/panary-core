import type { Static } from '@feathersjs/typebox'
import { querySyntax, StringEnum, Type } from '@feathersjs/typebox'

import { baseSchema } from '@panary-core/shared-common'
import { AuditAction } from './audit-action.enum'
import { AuditCategory, AuditOutcome, AuditSeverity } from './audit-category.enum'

//#region Sub-Schemas
export const auditActorSchema = Type.Object(
  {
    userId: Type.String(),
    role: Type.String(),
    sessionId: Type.Optional(Type.String()),
    ipAddress: Type.Optional(Type.String()),
    userAgent: Type.Optional(Type.String()),
    deviceId: Type.Optional(Type.String()),
    requestId: Type.String(),
  },
  { $id: 'AuditActor', additionalProperties: false },
)

export type AuditActor = Static<typeof auditActorSchema>

export const auditTargetSchema = Type.Object(
  {
    resource: Type.String(), // Service-Pfad, z. B. 'orders'
    entityType: Type.String(), // semantischer Typ, oft == resource (singular)
    entityId: Type.String(),
    entityRef: Type.Optional(Type.String()), // menschenlesbarer Verweis (z. B. Beleg-Nr.)
  },
  { $id: 'AuditTarget', additionalProperties: false },
)

export type AuditTarget = Static<typeof auditTargetSchema>

const diffEntrySchema = Type.Object(
  {
    from: Type.Unknown(),
    to: Type.Unknown(),
  },
  { additionalProperties: false },
)
//#endregion

//#region Haupt-Schema
export const auditEventSchema = Type.Object(
  {
    ...baseSchema,
    // baseSchema.locationId ist `Type.String` (Pflicht). Audit-Events sind
    // aber teilweise tenant-global (LOGIN_FAILED, LOGIN ohne Filial-Bindung,
    // Tenant-Settings-Aenderungen) — `locationId: null` ist hier legitim und
    // wird in der SQLite-Migration auch als `nullable()` deklariert.
    locationId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    occurredAt: Type.String({ format: 'date-time' }),
    actor: auditActorSchema,
    target: auditTargetSchema,
    action: StringEnum(Object.values(AuditAction)),
    category: StringEnum(Object.values(AuditCategory)),
    outcome: StringEnum(Object.values(AuditOutcome)),
    severity: StringEnum(Object.values(AuditSeverity)),
    before: Type.Optional(Type.Unknown()),
    after: Type.Optional(Type.Unknown()),
    diff: Type.Optional(Type.Record(Type.String(), diffEntrySchema)),
    metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    correlationId: Type.String(),
    // Flache Persistenz-Spiegel der haeufig gefilterten verschachtelten
    // Felder. SQLite-Migration legt sie als eigene Spalten mit Indizes an.
    // Werden vom auditEventDataResolver aus `actor`/`target` abgeleitet —
    // optional im Schema, damit der Validate-Hook sie nicht erzwingt
    // (Cloud-Kontext ohne flache Spalten muss durchgehen koennen).
    actor_userId: Type.Optional(Type.String()),
    target_resource: Type.Optional(Type.String()),
    target_entityType: Type.Optional(Type.String()),
    target_entityId: Type.Optional(Type.String()),
    // Phase-2-Read-Only-Felder: Redaction-Marker. NIE persistiert — werden vom
    // Cloud-resolveResult aus der `audit-event-redactions`-Side-Tabelle
    // gemerged. Edge sieht diese Felder nie, weil der Edge-Service keine
    // Redactions kennt (Cloud-only Feature).
    isRedacted: Type.Optional(Type.Boolean()),
    redaction: Type.Optional(
      Type.Object({
        redactedAt: Type.String({ format: 'date-time' }),
        redactedBy: Type.String(),
        redactionReason: Type.String(),
        scope: Type.String(),
        bulkRedactionId: Type.Union([Type.String(), Type.Null()]),
      }),
    ),
  },
  { $id: 'AuditEvent', additionalProperties: false },
)

export type AuditEvent = Static<typeof auditEventSchema>
//#endregion

//#region Erstellungs-Schema (intern: nur via provider:undefined)
export const auditEventDataSchema = Type.Omit(auditEventSchema, ['createdAt', 'updatedAt'], {
  $id: 'AuditEventData',
})

export type AuditEventData = Static<typeof auditEventDataSchema>
//#endregion

//#region Patch-Schema
// Audit-Events sind append-only; das Patch-Schema existiert ausschliesslich, damit
// Feathers-Typings beim Service-Setup keine Compile-Fehler werfen. Der Service
// verbietet update/patch/remove unconditionally (siehe audit-events.ts).
export const auditEventPatchSchema = Type.Partial(auditEventSchema, {
  $id: 'AuditEventPatch',
})

export type AuditEventPatch = Static<typeof auditEventPatchSchema>
//#endregion

//#region Query-Schema
export const auditEventQueryProperties = Type.Pick(auditEventSchema, [
  '_id',
  'tenantId',
  'locationId',
  'occurredAt',
  'action',
  'category',
  'outcome',
  'severity',
  'correlationId',
])

export const auditEventQuerySchema = Type.Intersect(
  [
    querySyntax(auditEventQueryProperties),
    Type.Object(
      {
        // Flache Filter auf verschachtelte Felder (werden im Recorder als
        // separate Spalten persistiert, daher als Top-Level-Query exponiert).
        'actor.userId': Type.Optional(Type.String()),
        'target.resource': Type.Optional(Type.String()),
        'target.entityType': Type.Optional(Type.String()),
        'target.entityId': Type.Optional(Type.String()),
      },
      { additionalProperties: false },
    ),
  ],
  { additionalProperties: false },
)

export type AuditEventQuery = Static<typeof auditEventQuerySchema>
//#endregion
