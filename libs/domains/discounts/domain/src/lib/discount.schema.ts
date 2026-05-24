import { querySyntax, Static, StringEnum, Type } from '@feathersjs/typebox'
import { baseSchema } from '@panary/shared-common'

//#region Enums & Constants

// WIE wird der Rabatt ausgelöst?
export const DiscountMethod = {
  MANUAL: 'manual', // Kassierer wählt am POS (Personalessen, Kulanz, Stammgast)
  AUTOMATIC: 'automatic', // greift automatisch bei erfüllten Bedingungen (Happy Hour)
  CODE: 'code', // Rabattcode beim Checkout (Storefront)
} as const

// WORAUF wirkt der Rabatt?
export const DiscountTarget = {
  ORDER: 'order', // auf die gesamte Bestellung
  LINE: 'line', // auf einzelne Positionen
} as const

// Wertart. Werte identisch zu orders/domain DiscountType (Rückwärtskompatibilität).
export const DiscountValueType = {
  PERCENT: 'percent',
  AMOUNT: 'amount',
} as const

export const DiscountAppliesTo = {
  ALL: 'all',
  CATEGORIES: 'categories',
  PRODUCTS: 'products',
} as const

export const DiscountEligibility = {
  ALL_CUSTOMERS: 'all',
  SPECIFIC: 'specific',
} as const

export const DiscountMinRequirement = {
  NONE: 'none',
  AMOUNT: 'amount',
  QUANTITY: 'quantity',
} as const

// Gespeicherter Lebenszyklus-Status. SCHEDULED/EXPIRED werden NICHT gespeichert,
// sondern read-time aus activeFrom/activeUntil abgeleitet (siehe discount-apply.ts).
export const DiscountStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
} as const

// Vertriebskanäle. Werte identisch zu orders/domain OrderChannel.
export const DiscountChannel = {
  POS: 'pos',
  ONLINE: 'online',
  APP: 'app',
  TELEPHONE: 'telephone',
} as const

//#endregion

//#region The main data model (schema)
export const discountSchema = Type.Object(
  {
    ...baseSchema,

    name: Type.String({ minLength: 1, maxLength: 120 }),
    description: Type.Optional(Type.String({ maxLength: 500 })),
    status: StringEnum(Object.values(DiscountStatus)),

    method: StringEnum(Object.values(DiscountMethod)),
    target: StringEnum(Object.values(DiscountTarget)),

    // Wert: bei PERCENT zählt valuePercent (0..100), bei AMOUNT valueCents (Integer).
    // Cents konsistent zu order-interactions.discountAmountCents und der Tax-Engine.
    valueType: StringEnum(Object.values(DiscountValueType)),
    valuePercent: Type.Number({ minimum: 0, maximum: 100, default: 0 }),
    valueCents: Type.Integer({ minimum: 0, default: 0 }),

    // Geltungsbereich (Phase 2). Arrays immer [] (nie null) — Sync-Schema-Drift vermeiden.
    appliesTo: StringEnum(Object.values(DiscountAppliesTo)),
    categoryIds: Type.Array(Type.String({ format: 'uuid' }), { maxItems: 200, default: [] }),
    productExternalIds: Type.Array(Type.String({ format: 'uuid' }), { maxItems: 500, default: [] }),

    // Berechtigung (Phase 2).
    eligibility: StringEnum(Object.values(DiscountEligibility)),
    customerIds: Type.Array(Type.String({ format: 'uuid' }), { maxItems: 1000, default: [] }),

    // Mindestanforderung (Phase 2).
    minRequirementType: StringEnum(Object.values(DiscountMinRequirement)),
    minAmountCents: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
    minQuantity: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),

    // Aktiv-Zeitraum + wiederkehrendes Fenster (Phase 2). Datumsfelder top-level,
    // damit der Sync sie als dateFields (BSON-Date) coercen kann.
    activeFrom: Type.Optional(Type.Union([Type.String({ format: 'date-time' }), Type.Null()])),
    activeUntil: Type.Optional(Type.Union([Type.String({ format: 'date-time' }), Type.Null()])),
    recurringWeekdays: Type.Array(Type.Integer({ minimum: 0, maximum: 6 }), { maxItems: 7, default: [] }),
    recurringStartTime: Type.Optional(Type.Union([Type.String({ maxLength: 5 }), Type.Null()])), // 'HH:mm'
    recurringEndTime: Type.Optional(Type.Union([Type.String({ maxLength: 5 }), Type.Null()])),

    // Kanäle: leer = alle. Werte aus DiscountChannel.
    channels: Type.Array(StringEnum(Object.values(DiscountChannel)), { maxItems: 4, default: [] }),

    // Flache Booleans (Sync-Coercion greift nur top-level).
    combinable: Type.Boolean({ default: false }),
    isStaffMeal: Type.Boolean({ default: false }),
    onePerCustomer: Type.Boolean({ default: false }),

    // Nutzungslimit (Phase 3). Zähler liegt NICHT hier (Cloud-managed, siehe Plan R1).
    usageLimitTotal: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),

    sortIndex: Type.Optional(Type.Number({ default: 0 })),

    // Soft-Delete-Tombstone für Sync (Cloud→Edge).
    _deletedAt: Type.Optional(Type.Union([Type.String({ format: 'date-time' }), Type.Null()])),
  },
  { $id: 'Discount', additionalProperties: false },
)
export type Discount = Static<typeof discountSchema>
//#endregion

//#region Schema for creation (POST)
// `_id`/`createdAt`/`updatedAt` werden serverseitig gesetzt, müssen für den
// Sync-Bootstrap (Edge→Cloud) aber als Optional erlaubt bleiben. Daher Intersect
// statt Omit — gleiches Muster wie customer/order.
export const discountDataSchema = Type.Intersect(
  [
    Type.Omit(discountSchema, ['_id', 'createdAt', 'updatedAt']),
    Type.Partial(Type.Pick(discountSchema, ['_id', 'createdAt', 'updatedAt'])),
  ],
  { $id: 'DiscountData', additionalProperties: false },
)
export type DiscountData = Static<typeof discountDataSchema>
//#endregion

//#region Scheme for updates (PATCH)
export const discountPatchSchema = Type.Partial(discountSchema, {
  $id: 'DiscountPatch',
})
export type DiscountPatch = Static<typeof discountPatchSchema>
//#endregion

//#region Schema for search queries (query)
export const discountQueryProperties = Type.Pick(discountSchema, [
  '_id',
  'name',
  'status',
  'method',
  'target',
  'isStaffMeal',
  'tenantId',
  'locationId',
  // Pflicht für multiTenancy()-Filter + Sync-Pull (`updatedAt > since`) + Tombstones.
  'createdAt',
  'updatedAt',
  '_deletedAt',
])
export const discountQuerySchema = Type.Intersect(
  [
    querySyntax(discountQueryProperties, {
      name: { $regex: Type.String() },
    }),
    Type.Object({}, { additionalProperties: false }),
  ],
  { additionalProperties: false },
)
export type DiscountQuery = Static<typeof discountQuerySchema>
//#endregion
