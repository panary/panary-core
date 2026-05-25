import { querySyntax, Static, StringEnum, Type } from '@feathersjs/typebox'
import { baseSchema } from '@panary/shared-common'
import { DiscountChannel } from './discount.schema'

// Append-only Einlöse-Log eines Promo-Codes (Phase 3). Jede Einlösung ist EINE
// Zeile — die Anzahl der Zeilen je `discountCodeId` ist die autoritative
// Nutzungszahl (gegen `usageLimit` geprüft). `discountCode.usageCount` ist nur
// ein best-effort-Cache fürs Admin-UI.
//
// Warum append-only statt mutierendem Counter: nebenläufige Einlösungen +
// (künftig) Edge→Cloud-Push würden bei einem read-modify-write-Counter Lost
// Updates erzeugen. Server stempelt `discountCodeId`/`discountId`/`redeemedAt`
// aus dem per `code` aufgelösten Datensatz — der Client setzt sie NIE.
export const discountCodeRedemptionSchema = Type.Object(
  {
    ...baseSchema,
    discountCodeId: Type.String({ format: 'uuid' }),
    discountId: Type.String({ format: 'uuid' }),
    code: Type.String({ maxLength: 64 }),
    orderId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
    customerId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
    channel: StringEnum(Object.values(DiscountChannel)),
    redeemedAt: Type.String({ format: 'date-time' }),
    // Tatsächlich gewährter Rabatt (Audit/Reconciliation), optional.
    amountCents: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
  },
  { $id: 'DiscountCodeRedemption', additionalProperties: false },
)
export type DiscountCodeRedemption = Static<typeof discountCodeRedemptionSchema>

// Create-Eingabe: Client liefert `code` (String) + Kontext. `discountCodeId`,
// `discountId` und `redeemedAt` löst/stempelt der Server.
export const discountCodeRedemptionDataSchema = Type.Intersect(
  [
    Type.Omit(discountCodeRedemptionSchema, [
      '_id',
      'createdAt',
      'updatedAt',
      'discountCodeId',
      'discountId',
      'redeemedAt',
    ]),
    Type.Partial(
      Type.Pick(discountCodeRedemptionSchema, [
        '_id',
        'createdAt',
        'updatedAt',
        'discountCodeId',
        'discountId',
        'redeemedAt',
      ]),
    ),
  ],
  { $id: 'DiscountCodeRedemptionData', additionalProperties: false },
)
export type DiscountCodeRedemptionData = Static<typeof discountCodeRedemptionDataSchema>

export const discountCodeRedemptionPatchSchema = Type.Partial(discountCodeRedemptionSchema, {
  $id: 'DiscountCodeRedemptionPatch',
})
export type DiscountCodeRedemptionPatch = Static<typeof discountCodeRedemptionPatchSchema>

export const discountCodeRedemptionQueryProperties = Type.Pick(discountCodeRedemptionSchema, [
  '_id',
  'discountCodeId',
  'discountId',
  'code',
  'orderId',
  'customerId',
  'channel',
  'tenantId',
  'locationId',
  'createdAt',
  'updatedAt',
])
export const discountCodeRedemptionQuerySchema = Type.Intersect(
  [querySyntax(discountCodeRedemptionQueryProperties), Type.Object({}, { additionalProperties: false })],
  { additionalProperties: false },
)
export type DiscountCodeRedemptionQuery = Static<typeof discountCodeRedemptionQuerySchema>
