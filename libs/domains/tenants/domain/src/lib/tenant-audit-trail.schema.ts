import type { Static } from '@feathersjs/typebox'
import { querySyntax, StringEnum, Type } from '@feathersjs/typebox'

import { TenantAuditAction, TenantAuditSource } from './tenant.enums'

//#region Tenant-Audit-Trail — Append-Only-Log fuer DSGVO/SOC2-Audits
// Eigene Collection, parallel zu `audit-events` (allgemeines Audit-System).
// Hier ausschliesslich Tenant-Stamm-Daten-Aenderungen.
//
// `beforeDiff` / `afterDiff` halten Snapshots der geaenderten Felder
// (nur betroffene Pfade — keine Vollkopie), z. B.:
//   beforeDiff: { 'subscription.status': 'TRIALING' }
//   afterDiff:  { 'subscription.status': 'ACTIVE' }
export const tenantAuditTrailSchema = Type.Object(
  {
    _id: Type.String({ format: 'uuid' }),
    tenantId: Type.String({ format: 'uuid' }),

    actorUserId: Type.Union([Type.String(), Type.Null()]),
    actorRole: Type.Union([Type.String({ maxLength: 80 }), Type.Null()]),
    source: StringEnum(Object.values(TenantAuditSource)),

    action: StringEnum(Object.values(TenantAuditAction)),
    changedPaths: Type.Array(Type.String({ maxLength: 200 }), { maxItems: 100 }),
    beforeDiff: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    afterDiff: Type.Optional(Type.Record(Type.String(), Type.Unknown())),

    requestId: Type.Optional(Type.String({ format: 'uuid' })),
    ipAddress: Type.Optional(Type.String({ maxLength: 45 })),
    userAgent: Type.Optional(Type.String({ maxLength: 500 })),

    // Stripe-Webhook-Quelle: zugehoerige Event-ID fuer Cross-Reference.
    stripeEventId: Type.Optional(Type.String({ maxLength: 100 })),

    notes: Type.Optional(Type.String({ maxLength: 2000 })),

    createdAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'TenantAuditTrail', additionalProperties: false },
)
export type TenantAuditTrail = Static<typeof tenantAuditTrailSchema>

// Service ist Append-Only — daher data === full schema minus _id/createdAt
// (werden serverseitig gesetzt).
export const tenantAuditTrailDataSchema = Type.Omit(tenantAuditTrailSchema, ['_id', 'createdAt'], {
  $id: 'TenantAuditTrailData',
  additionalProperties: false,
})
export type TenantAuditTrailData = Static<typeof tenantAuditTrailDataSchema>

// Patch ist verboten (Append-Only) — Schema existiert nur fuer Type-Compat
// mit Feathers-Resolver-Signatur.
export const tenantAuditTrailPatchSchema = Type.Object({}, { $id: 'TenantAuditTrailPatch', additionalProperties: false })
export type TenantAuditTrailPatch = Static<typeof tenantAuditTrailPatchSchema>

export const tenantAuditTrailQueryProperties = Type.Pick(tenantAuditTrailSchema, [
  '_id',
  'tenantId',
  'actorUserId',
  'source',
  'action',
  'createdAt',
])
export const tenantAuditTrailQuerySchema = Type.Intersect(
  [querySyntax(tenantAuditTrailQueryProperties), Type.Object({}, { additionalProperties: false })],
  { additionalProperties: false },
)
export type TenantAuditTrailQuery = Static<typeof tenantAuditTrailQuerySchema>
//#endregion
