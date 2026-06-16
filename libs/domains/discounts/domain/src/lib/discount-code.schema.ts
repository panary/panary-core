import { querySyntax, Static, Type } from '@feathersjs/typebox'
import { baseSchema } from '@panary/shared-common'

// Rabattcode-Instanz (Phase 3, Storefront-affin). Separate Entität, NICHT in die
// Definition eingebettet: ein Rabatt kann einen geteilten Code (`WILLKOMMEN10`)
// ODER viele Einmalcodes haben; `usageCount` braucht atomare Inkremente.
//
// `usageCount` ist server-managed (protectFromExternal) — niemals vom Client setzbar.
// `codeUpper` wird serverseitig aus `code` abgeleitet (case-insensitive Unique je Tenant).
//
// Einlösung/Validierung laufen über den Online-Checkout (Storefront-Roadmap Phase 5);
// am Edge werden Codes vorerst NICHT gesynct (Offline-Counter-Problem, siehe Plan R1).
export const discountCodeSchema = Type.Object(
  {
    ...baseSchema,
    // Global (tenant-weit) möglich → Service nutzt allowGlobalData (Scope-`$or` mit
    // locationId: null). baseSchema.locationId ist non-nullable → hier überschreiben.
    locationId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    discountId: Type.String({ format: 'uuid' }),
    code: Type.String({ minLength: 1, maxLength: 64 }),
    codeUpper: Type.String({ maxLength: 64 }),
    isShared: Type.Boolean({ default: true }),
    usageCount: Type.Integer({ default: 0, minimum: 0 }),
    usageLimit: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
    assignedCustomerId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
    expiresAt: Type.Optional(Type.Union([Type.String({ format: 'date-time' }), Type.Null()])),
    _deletedAt: Type.Optional(Type.Union([Type.String({ format: 'date-time' }), Type.Null()])),
  },
  { $id: 'DiscountCode', additionalProperties: false },
)
export type DiscountCode = Static<typeof discountCodeSchema>

export const discountCodeDataSchema = Type.Intersect(
  [
    Type.Omit(discountCodeSchema, ['_id', 'createdAt', 'updatedAt', 'codeUpper', 'usageCount']),
    Type.Partial(Type.Pick(discountCodeSchema, ['_id', 'createdAt', 'updatedAt', 'codeUpper', 'usageCount'])),
  ],
  { $id: 'DiscountCodeData', additionalProperties: false },
)
export type DiscountCodeData = Static<typeof discountCodeDataSchema>

export const discountCodePatchSchema = Type.Partial(discountCodeSchema, { $id: 'DiscountCodePatch' })
export type DiscountCodePatch = Static<typeof discountCodePatchSchema>

export const discountCodeQueryProperties = Type.Pick(discountCodeSchema, [
  '_id',
  'discountId',
  'code',
  'codeUpper',
  'assignedCustomerId',
  'tenantId',
  'locationId',
  'createdAt',
  'updatedAt',
  '_deletedAt',
])
export const discountCodeQuerySchema = Type.Intersect(
  [querySyntax(discountCodeQueryProperties), Type.Object({}, { additionalProperties: false })],
  { additionalProperties: false },
)
export type DiscountCodeQuery = Static<typeof discountCodeQuerySchema>

/** Normalisiert einen Code für case-insensitive Eindeutigkeit (server-seitig genutzt). */
export function deriveCodeUpper(code: string): string {
  return code.trim().toUpperCase()
}

/** Ist der Code (rein zeitlich/limit-basiert) einlösbar? Ohne Tenant-/Order-Kontext. */
export function isCodeRedeemable(code: DiscountCode, now: Date = new Date()): boolean {
  if (code._deletedAt) return false
  if (code.expiresAt && now > new Date(code.expiresAt)) return false
  if (code.usageLimit != null && code.usageCount >= code.usageLimit) return false
  return true
}
