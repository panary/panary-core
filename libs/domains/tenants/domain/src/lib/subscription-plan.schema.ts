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
    // End-User-Software — Leitprinzip „Gehirn in jedem Plan": in allen
    // zahlenden Tiers true, bewusst NICHT als Upsell-Gate genutzt.
    aiExtraction: Type.Optional(Type.Boolean()),
    fraudAnalytics: Type.Optional(Type.Boolean()),
    multiLocationConsolidation: Type.Optional(Type.Boolean()),
    // Fiskalisierung (KassenSichV) — eigenes Add-on, ENTKOPPELT von offlinePos.
    // Gated `pos-cashier` (fiskalischer Kassenbetrieb + TSE) — buchbar quer über
    // Tiers, auch cloud-direkt ohne Edge (Online-TSE). Siehe ADR
    // fiskalisierung-architektur-adr.md.
    fiscalCashier: Type.Optional(Type.Boolean()),
    // Betriebs-Capability — Offline-First/Edge (Resilienz-Upsell). NICHT mehr
    // Voraussetzung fürs Kassieren; `physicalPrintServer` = physischer Bondrucker.
    offlinePos: Type.Optional(Type.Boolean()),
    physicalPrintServer: Type.Optional(Type.Boolean()),
    // Integration & Governance — Enterprise-Gate (echte Grenzkosten/Sicherheitsflaeche).
    apiAccess: Type.Optional(Type.Boolean()),
    webhookSubscriptions: Type.Optional(Type.Boolean()),
    sso: Type.Optional(Type.Boolean()),
    auditTrailExport: Type.Optional(Type.Boolean()),
    customDomain: Type.Optional(Type.Boolean()),
    prioritySupport: Type.Optional(Type.Boolean()),
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
    stripeProductId: Type.Optional(Type.String({ maxLength: 255 })),
    stripePriceIdMonthly: Type.Optional(Type.String({ maxLength: 255 })),
    stripePriceIdYearly: Type.Optional(Type.String({ maxLength: 255 })),

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

//#region Plan-Code-Const-Enum
// Zentrale, getypte Plan-Codes — Single Source of Truth fuer die builtin-Plaene.
// Ersetzt verstreute String-Literale ('trial'/'connect'/'operate'/'enterprise')
// in api-cloud (tenant-subscription-actions, platform-subscriptions). Tenant-
// definierte Custom-Plaene (z. B. 'partner-deal-2026') bleiben als freie Strings
// moeglich — das Enum deckt nur die mitgelieferten Standard-Tiers ab.
export const SubscriptionPlanCode = {
  TRIAL: 'trial',
  CONNECT: 'connect',
  OPERATE: 'operate',
  ENTERPRISE: 'enterprise',
} as const
export type SubscriptionPlanCodeValue = (typeof SubscriptionPlanCode)[keyof typeof SubscriptionPlanCode]

// Self-Service-Tiers: Plaene, die ein Tenant-OWNER selbst ohne Plattform-
// Eingriff wechseln darf. Enterprise ist bewusst NICHT enthalten (Custom-
// Billing, nur ueber Plattform-Vergabe).
export const SELF_SERVICE_PLAN_CODES: ReadonlyArray<SubscriptionPlanCodeValue> = [
  SubscriptionPlanCode.TRIAL,
  SubscriptionPlanCode.CONNECT,
  SubscriptionPlanCode.OPERATE,
]
//#endregion

//#region Initial-Seed-Defaults
// Werden vom Seed-Skript (Phase 5.1) angelegt — V1-Vorschlag. Preise
// koennen vom User vor dem ersten Stripe-Go-Live angepasst werden.
export const SUBSCRIPTION_PLAN_SEED_DEFAULTS: ReadonlyArray<Omit<SubscriptionPlan, 'createdAt' | 'updatedAt'>> = [
  {
    _id: SubscriptionPlanCode.TRIAL,
    name: 'Trial',
    description: '60 Tage kostenlos testen — voller Operate-Funktionsumfang, eine Filiale.',
    active: true,
    visibilityForSelfService: true,
    monthlyPriceCents: 0,
    yearlyPriceCents: 0,
    currency: 'EUR',
    // Voller Operate-Set (Fiskal + Offline-POS + Fraud + AI), nur 1 Filiale.
    limits: { maxLocations: 1, maxUsers: 30, maxDevices: 8 },
    features: {
      aiExtraction: true,
      fraudAnalytics: true,
      multiLocationConsolidation: true,
      fiscalCashier: true,
      offlinePos: true,
      physicalPrintServer: true,
    },
  },
  {
    _id: SubscriptionPlanCode.CONNECT,
    name: 'Connect',
    description: 'Cloud-Bestellsystem mit vollem Backend — Online Bons, keine Offline-Kasse.',
    active: true,
    visibilityForSelfService: true,
    // €29/Monat, Jahresabo −15 % (2900 · 12 · 0,85 = 29.580 ct).
    monthlyPriceCents: 2900,
    yearlyPriceCents: 29580,
    currency: 'EUR',
    limits: { maxLocations: 9, maxUsers: 10, maxDevices: 3 },
    // Volles ERP-Gehirn (AI + Fraud + Konsolidierung). Basis nicht-fiskalisch +
    // kein Offline-POS — Fiskalisierung (fiscalCashier) als Add-on dazubuchbar
    // (ermöglicht cloud-direktes Kassieren ohne Edge).
    features: {
      aiExtraction: true,
      fraudAnalytics: true,
      multiLocationConsolidation: true,
      fiscalCashier: false,
      offlinePos: false,
      physicalPrintServer: false,
    },
  },
  {
    _id: SubscriptionPlanCode.OPERATE,
    name: 'Operate',
    description: 'Volle Offline-Kasse + ERP — pos-cashier, physischer Druck/KDS, Fiskal-Z-Bon.',
    active: true,
    visibilityForSelfService: true,
    // €89/Monat, Jahresabo −15 % (8900 · 12 · 0,85 = 90.780 ct).
    monthlyPriceCents: 8900,
    yearlyPriceCents: 90780,
    currency: 'EUR',
    limits: { maxLocations: 9, maxUsers: 30, maxDevices: 8 },
    features: {
      aiExtraction: true,
      fraudAnalytics: true,
      multiLocationConsolidation: true,
      fiscalCashier: true,
      offlinePos: true,
      physicalPrintServer: true,
    },
  },
  {
    _id: SubscriptionPlanCode.ENTERPRISE,
    name: 'Enterprise',
    description: 'Unlimitierte Skalierung + Integration — API, Webhooks, SSO, Audit-Export, Custom Domain.',
    active: true,
    visibilityForSelfService: false,
    // Custom-Billing — Preise leer, da pro Vertrag verhandelt.
    monthlyPriceCents: 0,
    yearlyPriceCents: 0,
    currency: 'EUR',
    // Leeres limits = unbegrenzt (omitted/undefined-Konvention).
    limits: {},
    features: {
      aiExtraction: true,
      fraudAnalytics: true,
      multiLocationConsolidation: true,
      fiscalCashier: true,
      offlinePos: true,
      physicalPrintServer: true,
      apiAccess: true,
      webhookSubscriptions: true,
      sso: true,
      auditTrailExport: true,
      customDomain: true,
      prioritySupport: true,
    },
  },
] as const
//#endregion
