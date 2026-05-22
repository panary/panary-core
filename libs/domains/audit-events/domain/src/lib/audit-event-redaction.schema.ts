import type { Static } from '@feathersjs/typebox'
import { querySyntax, StringEnum, Type } from '@feathersjs/typebox'

import { baseSchema } from '@panary/shared-common'

// Redaction-Scope: 'sensitive_only' redacted nur before/after/diff (forensisch
// streng, DSGVO-Standardfall); 'all' redacted zusaetzlich metadata und
// actor.ipAddress/actor.userAgent (Plattform-DSGVO-Vollloeschung).
export const RedactionScope = {
  SENSITIVE_ONLY: 'sensitive_only',
  ALL: 'all',
} as const

export type RedactionScope = (typeof RedactionScope)[keyof typeof RedactionScope]

//#region Haupt-Schema
export const auditEventRedactionSchema = Type.Object(
  {
    ...baseSchema,
    // locationId optional, weil Redactions tenant-global sind und nicht zwingend
    // an die Filiale gekoppelt werden — Owner kann tenant-uebergreifend redacten.
    locationId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    auditEventId: Type.String({ format: 'uuid' }),
    redactedAt: Type.String({ format: 'date-time' }),
    redactedBy: Type.String({ format: 'uuid' }),
    redactionReason: Type.String({ minLength: 10, maxLength: 500 }),
    scope: StringEnum(Object.values(RedactionScope)),
    // Bulk-Redactions teilen sich eine bulkRedactionId (uuidv7). Einzelne
    // Redactions haben null. Erlaubt UI-Gruppierung "redacted via Bulk".
    bulkRedactionId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    // Filter-Snapshot bei Bulk-Redactions: was war der Filter im Moment der
    // Operation? Hilft im Audit-Trail (welche Selektion wurde gewaehlt).
    bulkFilterSnapshot: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { $id: 'AuditEventRedaction', additionalProperties: false },
)

export type AuditEventRedaction = Static<typeof auditEventRedactionSchema>
//#endregion

//#region Erstellungs-Schema (Client schickt nur die fachlichen Felder)
export const auditEventRedactionDataSchema = Type.Object(
  {
    auditEventId: Type.String({ format: 'uuid' }),
    redactionReason: Type.String({ minLength: 10, maxLength: 500 }),
    scope: StringEnum(Object.values(RedactionScope)),
    // Optional bei Bulk-Aufrufen vom Service-internen bulkRedact-Pfad gesetzt.
    bulkRedactionId: Type.Optional(Type.String({ format: 'uuid' })),
    bulkFilterSnapshot: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { $id: 'AuditEventRedactionData', additionalProperties: false },
)

export type AuditEventRedactionData = Static<typeof auditEventRedactionDataSchema>
//#endregion

//#region Bulk-Redact-Request (Custom-Method-Payload)
// Filter-Felder sind optional, mindestens eines muss gesetzt sein — wird im
// Service validiert (nicht im Schema, weil 'oneOf required' ueber TypeBox
// muehsam ist).
export const auditEventBulkRedactionFilterSchema = Type.Object(
  {
    from: Type.Optional(Type.String({ format: 'date-time' })),
    to: Type.Optional(Type.String({ format: 'date-time' })),
    category: Type.Optional(Type.String({ maxLength: 80 })),
    action: Type.Optional(Type.String({ maxLength: 80 })),
    actorUserId: Type.Optional(Type.String({ maxLength: 80 })),
    targetEntityId: Type.Optional(Type.String({ maxLength: 80 })),
    targetResource: Type.Optional(Type.String({ maxLength: 80 })),
  },
  { $id: 'AuditEventBulkRedactionFilter', additionalProperties: false },
)

export const auditEventBulkRedactionRequestSchema = Type.Object(
  {
    filter: auditEventBulkRedactionFilterSchema,
    redactionReason: Type.String({ minLength: 10, maxLength: 500 }),
    scope: StringEnum(Object.values(RedactionScope)),
  },
  { $id: 'AuditEventBulkRedactionRequest', additionalProperties: false },
)

export type AuditEventBulkRedactionFilter = Static<typeof auditEventBulkRedactionFilterSchema>
export type AuditEventBulkRedactionRequest = Static<typeof auditEventBulkRedactionRequestSchema>

export const auditEventBulkRedactionResponseSchema = Type.Object(
  {
    bulkRedactionId: Type.String({ format: 'uuid' }),
    affectedCount: Type.Number({ minimum: 0 }),
    truncated: Type.Boolean(),
  },
  { $id: 'AuditEventBulkRedactionResponse', additionalProperties: false },
)

export type AuditEventBulkRedactionResponse = Static<typeof auditEventBulkRedactionResponseSchema>

// Maximalanzahl Eintraege, die eine einzelne bulkRedact-Operation erfasst.
// Groessere Selektionen muss die UI durch wiederholte Aufrufe abarbeiten.
export const AUDIT_BULK_REDACT_MAX = 1000
//#endregion

//#region Patch-Schema (existiert nur fuer Feathers-Typing — Redactions sind append-only)
export const auditEventRedactionPatchSchema = Type.Partial(auditEventRedactionSchema, {
  $id: 'AuditEventRedactionPatch',
})

export type AuditEventRedactionPatch = Static<typeof auditEventRedactionPatchSchema>
//#endregion

//#region Query-Schema
export const auditEventRedactionQueryProperties = Type.Pick(auditEventRedactionSchema, [
  '_id',
  'tenantId',
  'auditEventId',
  'redactedBy',
  'redactedAt',
  'bulkRedactionId',
  'scope',
])

export const auditEventRedactionQuerySchema = Type.Intersect(
  [
    querySyntax(auditEventRedactionQueryProperties),
    Type.Object({}, { additionalProperties: false }),
  ],
  { additionalProperties: false },
)

export type AuditEventRedactionQuery = Static<typeof auditEventRedactionQuerySchema>
//#endregion
