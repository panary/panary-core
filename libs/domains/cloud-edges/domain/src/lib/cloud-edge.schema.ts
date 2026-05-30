import type { Static } from '@feathersjs/typebox'
import { querySyntax, StringEnum, Type } from '@feathersjs/typebox'
import { baseSchema } from '@panary/shared-common'

export const CloudEdgeStatus = {
  PENDING_PAIRING: 'pending-pairing',
  ACTIVE: 'active',
  REVOKED: 'revoked',
} as const

export type CloudEdgeStatus = (typeof CloudEdgeStatus)[keyof typeof CloudEdgeStatus]

export const ClockSkewStatus = {
  OK: 'ok',
  WARN: 'warn',
  ERROR: 'error',
} as const

export type ClockSkewStatus = (typeof ClockSkewStatus)[keyof typeof ClockSkewStatus]

// Geraete-Provenienz: ob das Geraet von uns verkauft/bereitgestellt und damit
// SLA-gebunden ist (PANARY_MANAGED) oder Kundenhardware ist (TENANT_SELF_MANAGED).
// Fachlicher Default beim Pairing/Migration = TENANT_SELF_MANAGED (siehe
// edge-pairing.create). Bewusst KEIN TypeBox-Default, damit „nie gesetzt" von
// „bewusst self-managed" unterscheidbar bleibt.
export const EdgeProvenance = {
  PANARY_MANAGED: 'panary-managed',
  TENANT_SELF_MANAGED: 'tenant-self-managed',
} as const

export type EdgeProvenance = (typeof EdgeProvenance)[keyof typeof EdgeProvenance]

// Abgeleitetes Vertrauens-Niveau der Edge-Identitaet. Server-gestempelt, nie vom
// Client setzbar.
//   - UNVERIFIED          : keine pruefbare Herkunft (heutiger Default)
//   - PROVENANCE_VERIFIED : verifizierbare Supply-Chain-Attestation (cosign/SLSA)
//                           des offiziellen Images gemeldet — Detektion, KEIN
//                           kryptografisches Fork-Verbot
//   - CRYPTO_VERIFIED     : hardware-gebundene Per-Geraet-Identitaet verifiziert
//                           (Stufe 2 — setzt Imaging-/Provisioning-Pipeline voraus)
export const EdgeTrustTier = {
  CRYPTO_VERIFIED: 'crypto-verified',
  PROVENANCE_VERIFIED: 'provenance-verified',
  UNVERIFIED: 'unverified',
} as const

export type EdgeTrustTier = (typeof EdgeTrustTier)[keyof typeof EdgeTrustTier]

export const cloudEdgeSchema = Type.Object(
  {
    ...baseSchema,
    // Cloud-Edges koennen ohne konkrete Location existieren (globaler Edge fuer
    // den Tenant). Lokale Override des Pflicht-uuid-locationId aus baseSchema —
    // sonst scheitert findExistingActiveEdge mit query.locationId=null an der
    // querySyntax-anyOf-Validierung (uuid ODER Operator-Object, kein null).
    locationId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    edgeName: Type.String({ minLength: 1, maxLength: 100 }),
    edgeVersion: Type.Optional(Type.String({ maxLength: 50 })),
    platform: Type.Optional(Type.String({ maxLength: 50 })),
    status: StringEnum(Object.values(CloudEdgeStatus)),
    currentTokenHash: Type.Optional(Type.String({ maxLength: 128 })),
    pendingTokenHash: Type.Optional(Type.String({ maxLength: 128 })),
    tokenExpiresAt: Type.Optional(Type.String({ format: 'date-time' })),
    pairedAt: Type.Optional(Type.String({ format: 'date-time' })),
    pairedByUserId: Type.Optional(Type.String({ format: 'uuid' })),
    revokedAt: Type.Optional(Type.String({ format: 'date-time' })),
    revokedByUserId: Type.Optional(Type.String({ format: 'uuid' })),
    revocationReason: Type.Optional(Type.String({ maxLength: 500 })),
    lastSeenAt: Type.Optional(Type.String({ format: 'date-time' })),
    lastSyncAt: Type.Optional(Type.String({ format: 'date-time' })),
    lastClockSkewMs: Type.Optional(Type.Number()),
    lastClockSkewStatus: Type.Optional(StringEnum(Object.values(ClockSkewStatus))),
    // Live-Verbindungsstatus des Edge-Socket-Channels (cloudseitig gestempelt
    // bei Socket-Connect/Disconnect, siehe registerEdgeAuthListener). Quelle der
    // Wahrheit fuer die „online"-Anzeige im Admin-Status-Header — anders als das
    // staleness-basierte `lastSeenAt` spiegelt es Connect/Disconnect sofort.
    liveConnected: Type.Optional(Type.Boolean()),
    // Provenienz-Flag (managed vs self-managed). Wird beim Pairing auf
    // TENANT_SELF_MANAGED defaultet und kann ausschliesslich von Platform-Admins
    // umgestuft werden (Feld-Level-Gate restrictProvenancePatch in der Cloud) —
    // cloud-edges ist sonst tenant-MANAGE.
    provenance: Type.Optional(StringEnum(Object.values(EdgeProvenance))),
    // Server-abgeleitetes Vertrauens-Niveau. Nie client-setzbar (protectFromExternal).
    trustTier: Type.Optional(StringEnum(Object.values(EdgeTrustTier))),
    // Audit der letzten Provenienz-Aenderung.
    provenanceSetByUserId: Type.Optional(Type.String({ format: 'uuid' })),
    provenanceSetAt: Type.Optional(Type.String({ format: 'date-time' })),
  },
  { $id: 'CloudEdge', additionalProperties: false },
)

export type CloudEdge = Static<typeof cloudEdgeSchema>

// tenantId/locationId stehen im Schema, damit multiTenancy() die Felder beim
// PATCH stempeln darf, ohne dass der Validator sie als additional properties
// ablehnt — werden serverseitig im cloudEdgePatchResolver wieder auf undefined
// gesetzt (immutable nach Pairing).
export const cloudEdgePatchSchema = Type.Partial(
  Type.Pick(cloudEdgeSchema, [
    'edgeName',
    'status',
    'revocationReason',
    'tenantId',
    'locationId',
    // Cloud-intern gestempeltes Live-Verbindungs-Flag. Muss in der Patch-Pick
    // stehen, damit der provider-undefined-Stamp aus registerEdgeAuthListener
    // den `validateData`-Hook passiert (Schema ist additionalProperties:false).
    // Externe Clients koennen es trotzdem nicht setzen — restrictPatchFields
    // laesst nur interne Aufrufe durch.
    'liveConnected',
    // Provenienz-Flag. Muss in der Patch-Pick stehen, damit der Platform-Admin-
    // Patch den additionalProperties:false-Validator passiert. Nicht-Platform-
    // Aufrufe lehnt restrictProvenancePatch (Cloud) aktiv ab. trustTier und die
    // Audit-Felder bleiben bewusst DRAUSSEN (server-only via protectFromExternal).
    'provenance',
  ]),
  { $id: 'CloudEdgePatch' },
)

export type CloudEdgePatch = Static<typeof cloudEdgePatchSchema>

export const cloudEdgeQueryProperties = Type.Pick(cloudEdgeSchema, [
  '_id',
  'tenantId',
  'locationId',
  'status',
  'edgeName',
  // Sortier- und Filter-Felder fuer das Admin-UI:
  'pairedAt',
  'lastSeenAt',
  'lastSyncAt',
  // Provenienz/Trust — Filter + Sortierung in der Edge-Uebersicht.
  'provenance',
  'trustTier',
  // Pflicht fuer die EdgeTokenStrategy: findByTokenHash() filtert in der
  // Authentifizierung nach Token-Hash. Externe Clients erreichen die Felder
  // weiterhin nicht, weil cloud-edges nur fuer Platform-User zugreifbar ist
  // (RBAC-Matrix) und die Hashes per resolveExternal ohnehin unterdrueckt werden.
  'currentTokenHash',
  'pendingTokenHash',
])

export const cloudEdgeQuerySchema = Type.Intersect(
  [querySyntax(cloudEdgeQueryProperties), Type.Object({})],
  { additionalProperties: false },
)

export type CloudEdgeQuery = Static<typeof cloudEdgeQuerySchema>
