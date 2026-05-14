import type { Static } from '@feathersjs/typebox'
import { querySyntax, Type } from '@feathersjs/typebox'

//#region Plan-Limits — geschlossene Struktur
export const subscriptionPlanLimitsSchema = Type.Object(
  {
    maxLocations: Type.Optional(Type.Number({ minimum: 0 })),
    maxUsers: Type.Optional(Type.Number({ minimum: 0 })),
    maxDevices: Type.Optional(Type.Number({ minimum: 0 })),
    maxApiCallsPerMonth: Type.Optional(Type.Number({ minimum: 0 })),
  },
  { $id: 'SubscriptionPlanLimits', additionalProperties: false },
)
export type SubscriptionPlanLimits = Static<typeof subscriptionPlanLimitsSchema>
//#endregion

//#region Plan-Features — bewusst GESCHLOSSENE Enum-Map (Skeptiker-Befund:
// offene Maps fuehren zu Inkonsistenz). Neue Features werden hier
// eingetragen und sind dann tenant-seitig steuerbar.
export const subscriptionPlanFeaturesSchema = Type.Object(
  {
    aiExtraction: Type.Optional(Type.Boolean()),
    customDomain: Type.Optional(Type.Boolean()),
    sso: Type.Optional(Type.Boolean()),
    prioritySupport: Type.Optional(Type.Boolean()),
    multiLocation: Type.Optional(Type.Boolean()),
    advancedReporting: Type.Optional(Type.Boolean()),
    apiAccess: Type.Optional(Type.Boolean()),
    webhookSubscriptions: Type.Optional(Type.Boolean()),
    auditTrailExport: Type.Optional(Type.Boolean()),
  },
  { $id: 'SubscriptionPlanFeatures', additionalProperties: false },
)
export type SubscriptionPlanFeatures = Static<typeof subscriptionPlanFeaturesSchema>
//#endregion

//#region Haupt-Schema: subscription-plans-Collection
// `_id` ist ein menschenlesbarer Plan-Code (z. B. 'trial', 'starter',
// 'professional', 'enterprise', 'partner-deal-2026') und wird per
// `tenant.subscription.planCode` referenziert. Keine ObjectId/UUID hier —
// das macht Plan-Migration zwischen Stripe-Test/Prod-Konten trivial.
export const subscriptionPlanSchema = Type.Object(
  {
    _id: Type.String({ pattern: '^[a-z0-9-]+$', minLength: 2, maxLength: 80 }),
    name: Type.String({ minLength: 1, maxLength: 100 }),
    description: Type.Optional(Type.String({ maxLength: 2000 })),
    active: Type.Boolean({ default: true }),
    visibilityForSelfService: Type.Boolean({ default: false }),

    monthlyPriceCents: Type.Number({ minimum: 0 }),
    yearlyPriceCents: Type.Number({ minimum: 0 }),
    currency: Type.String({ minLength: 3, maxLength: 3, default: 'EUR' }),

    // Stripe-Referenzen — optional, weil Custom-/Partner-Plaene ohne Stripe-Anbindung
    // moeglich sind (manuelles Billing).
    stripeProductId: Type.Optional(Type.String()),
    stripePriceIdMonthly: Type.Optional(Type.String()),
    stripePriceIdYearly: Type.Optional(Type.String()),

    limits: subscriptionPlanLimitsSchema,
    features: subscriptionPlanFeaturesSchema,

    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'SubscriptionPlan', additionalProperties: false },
)
export type SubscriptionPlan = Static<typeof subscriptionPlanSchema>

export const subscriptionPlanDataSchema = Type.Partial(subscriptionPlanSchema, {
  $id: 'SubscriptionPlanData',
  additionalProperties: false,
})
export type SubscriptionPlanData = Static<typeof subscriptionPlanDataSchema>

export const subscriptionPlanPatchSchema = Type.Partial(subscriptionPlanSchema, {
  $id: 'SubscriptionPlanPatch',
  additionalProperties: false,
})
export type SubscriptionPlanPatch = Static<typeof subscriptionPlanPatchSchema>

export const subscriptionPlanQueryProperties = Type.Pick(subscriptionPlanSchema, [
  '_id',
  'active',
  'visibilityForSelfService',
])
export const subscriptionPlanQuerySchema = Type.Intersect(
  [querySyntax(subscriptionPlanQueryProperties), Type.Object({}, { additionalProperties: false })],
  { additionalProperties: false },
)
export type SubscriptionPlanQuery = Static<typeof subscriptionPlanQuerySchema>
//#endregion

//#region Initial-Seed-Defaults
// Werden vom Seed-Skript (Phase 5.1) angelegt — V1-Vorschlag. Preise
// koennen vom User vor dem ersten Stripe-Go-Live angepasst werden.
export const SUBSCRIPTION_PLAN_SEED_DEFAULTS: ReadonlyArray<Omit<SubscriptionPlan, 'createdAt' | 'updatedAt'>> = [
  {
    _id: 'trial',
    name: 'Trial',
    description: '30 Tage kostenlos testen — alle Funktionen, eine Filiale.',
    active: true,
    visibilityForSelfService: true,
    monthlyPriceCents: 0,
    yearlyPriceCents: 0,
    currency: 'EUR',
    limits: { maxLocations: 1, maxUsers: 5, maxDevices: 3 },
    features: { aiExtraction: true, multiLocation: false, apiAccess: false },
  },
  {
    _id: 'starter',
    name: 'Starter',
    description: 'Einsteigertarif fuer eine Filiale.',
    active: true,
    visibilityForSelfService: true,
    monthlyPriceCents: 2900,
    yearlyPriceCents: 29000,
    currency: 'EUR',
    limits: { maxLocations: 1, maxUsers: 10, maxDevices: 5 },
    features: { aiExtraction: false, multiLocation: false, apiAccess: false },
  },
  {
    _id: 'professional',
    name: 'Professional',
    description: 'Bis zu 3 Filialen, AI-Extraktion, API-Zugriff.',
    active: true,
    visibilityForSelfService: true,
    monthlyPriceCents: 7900,
    yearlyPriceCents: 79000,
    currency: 'EUR',
    limits: { maxLocations: 3, maxUsers: 30, maxDevices: 15 },
    features: {
      aiExtraction: true,
      multiLocation: true,
      apiAccess: true,
      advancedReporting: true,
      webhookSubscriptions: true,
    },
  },
  {
    _id: 'enterprise',
    name: 'Enterprise',
    description: 'Unlimitierte Skalierung, SSO, Priority Support, Custom Domain.',
    active: true,
    visibilityForSelfService: false,
    monthlyPriceCents: 0,
    yearlyPriceCents: 0,
    currency: 'EUR',
    limits: {},
    features: {
      aiExtraction: true,
      customDomain: true,
      sso: true,
      prioritySupport: true,
      multiLocation: true,
      advancedReporting: true,
      apiAccess: true,
      webhookSubscriptions: true,
      auditTrailExport: true,
    },
  },
] as const
//#endregion
