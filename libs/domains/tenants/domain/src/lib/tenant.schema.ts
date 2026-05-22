import type { Static } from '@feathersjs/typebox'
import { querySyntax, StringEnum, Type } from '@feathersjs/typebox'

import { addressSchema } from '@panary/shared-common'
import {
  BillingCustomerType,
  BillingTaxStatus,
  ComplianceSocStatus,
  SubscriptionStatus,
  TenantRegion,
  TenantStatus,
  TseJurisdiction,
  TseLegalEntityType,
  TseProvider,
  TseStatus,
  WeekStart,
} from './tenant.enums'

//#region Sub-Aggregat: legalEntity (V1-Pflicht, in Backfill aus organizationName)
export const legalEntitySchema = Type.Object(
  {
    registeredName: Type.String({ minLength: 1, maxLength: 200 }),
    legalForm: Type.Optional(Type.String({ maxLength: 50 })),
    vatId: Type.Optional(Type.String({ maxLength: 30 })),
    taxNumber: Type.Optional(Type.String({ maxLength: 30 })),
    registrationCourt: Type.Optional(Type.String({ maxLength: 100 })),
    registrationNumber: Type.Optional(Type.String({ maxLength: 50 })),
    ceoName: Type.Optional(Type.String({ maxLength: 200 })),
    // VIES-Validation (Welle D Item 5): wird vom trigger-vies-validation-Hook
    // gesetzt nach EU-VAT-VIES-REST-Lookup. KEIN Overwrite von registeredName
    // — VIES gibt fuer DE/AT nur valid:bool zurueck (Skeptiker-Befund).
    vatIdValid: Type.Optional(Type.Boolean()),
    vatIdValidatedAt: Type.Optional(Type.String({ format: 'date-time' })),
  },
  { $id: 'TenantLegalEntity', additionalProperties: false },
)
export type TenantLegalEntity = Static<typeof legalEntitySchema>
//#endregion

//#region Sub-Aggregat: billing
// `billing.idempotencyKeys[]` haelt die letzten ~100 verarbeiteten Stripe-
// Event-IDs zur Deduplikation des Webhooks. Aelteste werden gepruned.
export const billingSchema = Type.Object(
  {
    customerType: StringEnum(Object.values(BillingCustomerType)),
    address: addressSchema,
    invoiceEmail: Type.Optional(Type.String({ format: 'email' })),
    stripeCustomerId: Type.Optional(Type.String({ maxLength: 255 })),
    paymentMethodRef: Type.Optional(Type.String({ maxLength: 255 })),
    sepaMandateRef: Type.Optional(Type.String({ maxLength: 255 })),
    currency: Type.String({ default: 'EUR', minLength: 3, maxLength: 3 }),
    paymentTerms: Type.Optional(Type.Number({ minimum: 0 })),
    taxStatus: Type.Optional(StringEnum(Object.values(BillingTaxStatus))),
    taxIdValidatedAt: Type.Optional(Type.String({ format: 'date-time' })),
    idempotencyKeys: Type.Optional(Type.Array(Type.String({ maxLength: 255 }), { maxItems: 200 })),
  },
  { $id: 'TenantBilling', additionalProperties: false },
)
export type TenantBilling = Static<typeof billingSchema>
//#endregion

//#region Sub-Aggregat: subscription
// `planCode` ist FK auf `subscription-plans._id` — keine Hardcoded-Enum,
// Plan-Katalog lebt in eigener Collection.
// Override-Limits (maxLocations/maxUsers/maxDevices) ueberschreiben die
// Plan-Defaults, falls gesetzt — z. B. Custom-Deals.
export const subscriptionSchema = Type.Object(
  {
    planCode: Type.String({ minLength: 1, maxLength: 80 }),
    status: StringEnum(Object.values(SubscriptionStatus)),
    trialEndsAt: Type.Optional(Type.String({ format: 'date-time' })),
    currentPeriodStart: Type.Optional(Type.String({ format: 'date-time' })),
    currentPeriodEnd: Type.Optional(Type.String({ format: 'date-time' })),
    cancelAt: Type.Optional(Type.String({ format: 'date-time' })),
    stripeSubscriptionId: Type.Optional(Type.String({ maxLength: 255 })),
    appliedCoupons: Type.Optional(Type.Array(Type.String({ maxLength: 80 }), { maxItems: 20 })),
    cancelReason: Type.Optional(Type.String({ maxLength: 200 })),
    cancelFeedback: Type.Optional(Type.String({ maxLength: 2000 })),
    maxLocations: Type.Optional(Type.Number({ minimum: 0 })),
    maxUsers: Type.Optional(Type.Number({ minimum: 0 })),
    maxDevices: Type.Optional(Type.Number({ minimum: 0 })),
    // Plan-Limit-Enforcement (Welle B Item 1): denormalisierte Counter fuer
    // atomic findOneAndUpdate. Race-frei gegen TOCTOU. Wird vom
    // enforce-plan-limits-Hook gewartet und vom reconcile-plan-limit-counters-
    // Skript re-initialisiert. _deletedAt-Records werden NICHT mitgezaehlt.
    currentLocationCount: Type.Optional(Type.Number({ minimum: 0 })),
    currentUserCount: Type.Optional(Type.Number({ minimum: 0 })),
    currentDeviceCount: Type.Optional(Type.Number({ minimum: 0 })),
  },
  { $id: 'TenantSubscription', additionalProperties: false },
)
export type TenantSubscription = Static<typeof subscriptionSchema>
//#endregion

//#region Sub-Aggregat: tse (KassenSichV + RKSV)
// `apiKeyRef`/`apiSecretRef` sind BWS-Secret-IDs, niemals der Klartext.
// Frontend zeigt nur die ID, Edge holt die echten Secrets aus BWS.
export const tseAccountSchema = Type.Object(
  {
    provider: StringEnum(Object.values(TseProvider)),
    status: StringEnum(Object.values(TseStatus)),
    entityType: Type.Optional(StringEnum(Object.values(TseLegalEntityType))),
    jurisdiction: Type.Optional(StringEnum(Object.values(TseJurisdiction))),
    externalAccountId: Type.Optional(Type.String({ maxLength: 200 })),
    apiKeyRef: Type.Optional(Type.String({ maxLength: 200 })),
    apiSecretRef: Type.Optional(Type.String({ maxLength: 200 })),
    contactPersonName: Type.Optional(Type.String({ maxLength: 200 })),
    contactPersonEmail: Type.Optional(Type.String({ format: 'email' })),
    contractStartedAt: Type.Optional(Type.String({ format: 'date-time' })),
    notes: Type.Optional(Type.String({ maxLength: 2000 })),
    // AT/RKSV-Spezifika
    atSignatureUnitId: Type.Optional(Type.String({ maxLength: 100 })),
    atRegisterNumber: Type.Optional(Type.String({ maxLength: 100 })),
    belegausgabepflichtExempt: Type.Optional(Type.Boolean()),
    // Health-Telemetrie
    lastSignedAt: Type.Optional(Type.String({ format: 'date-time' })),
    lastHealthCheckAt: Type.Optional(Type.String({ format: 'date-time' })),
    errorCount24h: Type.Optional(Type.Number({ minimum: 0 })),
  },
  { $id: 'TenantTseAccount', additionalProperties: false },
)
export type TenantTseAccount = Static<typeof tseAccountSchema>
//#endregion

//#region Sub-Aggregat: branding
// Hex-Pattern erlaubt 6-stellige Werte mit fuehrendem #. Custom-Domain ist
// ein DNS-Name; das tatsaechliche DNS-Setup ist Out-of-Scope V1.
//
// Logo wird als BinData (base64-encoded String) direkt im Tenant-Doc
// gespeichert — kein externer S3/CDN. Upload-Pipeline in
// `apps/api-cloud/src/services/tenant-branding-asset/`:
//   1. Multipart-Upload (PNG/JPEG/WebP, max 5 MB)
//   2. Magic-Number-Validation (verhindert Polyglot-Files)
//   3. sharp-Resize → max 512x512 WebP, q=85, max 200 KB
//   4. sha256-Hash fuer Cache-Busting in `<img src="...?v=<hash>">`
//
// Edge-Sync transportiert das Logo via projectTenantForEdge (Welle-E-
// Allowlist-Projection), damit POS-Belege offline mit Logo gedruckt
// werden koennen.
export const tenantLogoAssetSchema = Type.Object(
  {
    /** base64-encoded BinData (max ~270 KB nach Base64-Overhead bei 200 KB Binary). */
    data: Type.String({ minLength: 1, maxLength: 300_000 }),
    contentType: Type.Union([
      Type.Literal('image/webp'),
      Type.Literal('image/png'),
      Type.Literal('image/jpeg'),
    ]),
    sizeBytes: Type.Number({ minimum: 1, maximum: 300_000 }),
    width: Type.Number({ minimum: 1, maximum: 4096 }),
    height: Type.Number({ minimum: 1, maximum: 4096 }),
    /** SHA-256-Hex des Binary-Inhalts (vor Base64). Cache-Busting + ETag. */
    hash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    uploadedAt: Type.String({ format: 'date-time' }),
    uploadedByUserId: Type.String(),
  },
  { $id: 'TenantLogoAsset', additionalProperties: false },
)
export type TenantLogoAsset = Static<typeof tenantLogoAssetSchema>

export const brandingSchema = Type.Object(
  {
    // Tenant-eigenes Logo, hochgeladen via `tenant-branding-asset`-Service.
    // Ersetzt das frueher genutzte `logoUrl`-Feld (externe URLs) — siehe
    // OoS-Item-7-ADR und scripts/migrate-tenant-logo-urls.ts.
    logo: Type.Optional(tenantLogoAssetSchema),
    faviconUrl: Type.Optional(Type.String({ format: 'uri' })),
    primaryColor: Type.Optional(Type.String({ pattern: '^#[0-9a-fA-F]{6}$' })),
    accentColor: Type.Optional(Type.String({ pattern: '^#[0-9a-fA-F]{6}$' })),
    customDomain: Type.Optional(Type.String({ maxLength: 253 })),
    receiptHeader: Type.Optional(Type.String({ maxLength: 500 })),
    receiptFooter: Type.Optional(Type.String({ maxLength: 500 })),
    statusPageEnabled: Type.Optional(Type.Boolean()),
    statusPageSubdomain: Type.Optional(Type.String({ pattern: '^[a-z0-9-]+$', maxLength: 63 })),
  },
  { $id: 'TenantBranding', additionalProperties: false },
)
export type TenantBranding = Static<typeof brandingSchema>
//#endregion

//#region Sub-Aggregat: localization (V1)
// Wird vom Receipt-Renderer in panary-core konsumiert (Edge-Sync).
export const localizationSchema = Type.Object(
  {
    locale: Type.String({ minLength: 2, maxLength: 10 }),
    timezone: Type.String({ minLength: 1, maxLength: 60 }),
    dateFormat: Type.String({ minLength: 1, maxLength: 30 }),
    weekStart: StringEnum(Object.values(WeekStart)),
  },
  { $id: 'TenantLocalization', additionalProperties: false },
)
export type TenantLocalization = Static<typeof localizationSchema>
//#endregion

//#region Future-proof: Data-Retention (DSGVO Art. 5)
export const dataRetentionSchema = Type.Object(
  {
    years: Type.Number({ minimum: 0, maximum: 100 }),
    gdprDataRetentionUntil: Type.Optional(Type.String({ format: 'date-time' })),
    autoDeleteEnabled: Type.Optional(Type.Boolean()),
  },
  { $id: 'TenantDataRetention', additionalProperties: false },
)
export type TenantDataRetention = Static<typeof dataRetentionSchema>
//#endregion

//#region Future-proof: Webhook-Subscriptions (Tenant-eigene Integrationen)
export const tenantWebhookSubscriptionSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    url: Type.String({ format: 'uri' }),
    events: Type.Array(Type.String(), { minItems: 1, maxItems: 50 }),
    secretRef: Type.Optional(Type.String({ maxLength: 255 })),
    active: Type.Boolean({ default: true }),
    createdAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'TenantWebhookSubscription', additionalProperties: false },
)
export type TenantWebhookSubscription = Static<typeof tenantWebhookSubscriptionSchema>
//#endregion

//#region Future-proof: API-Quota
export const apiQuotaSchema = Type.Object(
  {
    monthlyCallLimit: Type.Optional(Type.Number({ minimum: 0 })),
    currentMonthCalls: Type.Optional(Type.Number({ minimum: 0 })),
    resetAt: Type.Optional(Type.String({ format: 'date-time' })),
  },
  { $id: 'TenantApiQuota', additionalProperties: false },
)
export type TenantApiQuota = Static<typeof apiQuotaSchema>
//#endregion

//#region Future-proof: SSO/SAML (Enterprise)
export const ssoSchema = Type.Object(
  {
    enabled: Type.Boolean({ default: false }),
    provider: Type.Optional(Type.String({ maxLength: 50 })),
    metadataUrl: Type.Optional(Type.String({ format: 'uri' })),
    entityId: Type.Optional(Type.String({ maxLength: 255 })),
    enforceForRoles: Type.Optional(Type.Array(Type.String(), { maxItems: 20 })),
  },
  { $id: 'TenantSso', additionalProperties: false },
)
export type TenantSso = Static<typeof ssoSchema>
//#endregion

//#region Future-proof: Security-Policy
export const securityPolicySchema = Type.Object(
  {
    mfaRequired: Type.Optional(Type.Boolean()),
    mfaGracePeriodDays: Type.Optional(Type.Number({ minimum: 0, maximum: 90 })),
    passwordMinLength: Type.Optional(Type.Number({ minimum: 8, maximum: 64 })),
    sessionMaxAgeHours: Type.Optional(Type.Number({ minimum: 1, maximum: 720 })),
  },
  { $id: 'TenantSecurityPolicy', additionalProperties: false },
)
export type TenantSecurityPolicy = Static<typeof securityPolicySchema>
//#endregion

//#region Future-proof: Compliance (DSGVO-DPO, SOC, PCI)
export const complianceSchema = Type.Object(
  {
    gdprDpoName: Type.Optional(Type.String({ maxLength: 200 })),
    gdprDpoEmail: Type.Optional(Type.String({ format: 'email' })),
    pciSelfAttested: Type.Optional(Type.Boolean()),
    socStatus: Type.Optional(StringEnum(Object.values(ComplianceSocStatus))),
  },
  { $id: 'TenantCompliance', additionalProperties: false },
)
export type TenantCompliance = Static<typeof complianceSchema>
//#endregion

//#region Future-proof: Incident-Kontakt (24/7, separat von Owner)
export const incidentContactSchema = Type.Object(
  {
    name: Type.String({ maxLength: 200 }),
    email: Type.Optional(Type.String({ format: 'email' })),
    phone24x7: Type.Optional(Type.String({ maxLength: 50 })),
    escalationOrder: Type.Optional(Type.Number({ minimum: 1, maximum: 10 })),
  },
  { $id: 'TenantIncidentContact', additionalProperties: false },
)
export type TenantIncidentContact = Static<typeof incidentContactSchema>
//#endregion

//#region Future-proof: Lifecycle-Metriken (Platform-Admin-Dashboard)
export const lifecycleSchema = Type.Object(
  {
    phase: Type.Optional(Type.String({ maxLength: 50 })),
    healthScore: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
    churnRisk: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    lastActiveAt: Type.Optional(Type.String({ format: 'date-time' })),
  },
  { $id: 'TenantLifecycle', additionalProperties: false },
)
export type TenantLifecycle = Static<typeof lifecycleSchema>
//#endregion

//#region Tenant Haupt-Schema
// Bewusst KEIN baseSchema-Spread: Tenant hat kein `tenantId`-Feld (sein
// `_id` IST der Tenant-Identifier) und kein `locationId` (er steht ueber
// Locations). Multi-Tenancy-Hook hat dafuer eine eigene Allowlist.
export const tenantSchema = Type.Object(
  {
    _id: Type.String({ format: 'uuid' }),
    name: Type.String({ minLength: 1, maxLength: 200 }),
    slug: Type.Optional(Type.String({ pattern: '^[a-z0-9-]+$', minLength: 2, maxLength: 80 })),
    status: StringEnum(Object.values(TenantStatus)),
    ownerUserId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),

    // Sub-Aggregate
    legalEntity: Type.Optional(legalEntitySchema),
    billing: Type.Optional(billingSchema),
    subscription: Type.Optional(subscriptionSchema),
    tse: Type.Optional(tseAccountSchema),
    branding: Type.Optional(brandingSchema),
    localization: Type.Optional(localizationSchema),

    // Future-proof — Schema-Felder ohne UI in V1
    region: Type.Optional(StringEnum(Object.values(TenantRegion))),
    parentTenantId: Type.Optional(Type.String({ format: 'uuid' })),
    dataRetentionPolicy: Type.Optional(dataRetentionSchema),
    webhookSubscriptions: Type.Optional(Type.Array(tenantWebhookSubscriptionSchema, { maxItems: 50 })),
    apiQuota: Type.Optional(apiQuotaSchema),
    sso: Type.Optional(ssoSchema),
    securityPolicy: Type.Optional(securityPolicySchema),
    compliance: Type.Optional(complianceSchema),
    incidentContact: Type.Optional(incidentContactSchema),
    lifecycle: Type.Optional(lifecycleSchema),
    metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),

    // Plattform-Sicht
    internalNotes: Type.Optional(Type.String({ maxLength: 5000 })),
    tags: Type.Optional(Type.Array(Type.String({ maxLength: 50 }), { maxItems: 20 })),

    // Audit
    createdBy: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
    suspendedAt: Type.Optional(Type.String({ format: 'date-time' })),
    suspendedReason: Type.Optional(Type.String({ maxLength: 1000 })),
    archivedAt: Type.Optional(Type.String({ format: 'date-time' })),
    lastLoginAt: Type.Optional(Type.String({ format: 'date-time' })),

    // Soft-Delete fuer Edge-Sync (Welle E Item 4). Wird vom
    // sync-soft-delete-Hook gesetzt; excludeSoftDeleted filtert externe
    // Reads. Edge sieht Tombstone via Sync-Pull.
    _deletedAt: Type.Optional(Type.String({ format: 'date-time' })),

    // Schema-Reserve fuer kuenftigen Merge (Welle C Item 8). Keine
    // Implementation jetzt — Merge/Split kommt bei realem Use-Case.
    mergedIntoTenantId: Type.Optional(Type.String({ format: 'uuid' })),

    // Optimistic Concurrency fuer Cloud->Edge-Sync (Skeptiker-Befund).
    syncVersion: Type.Optional(Type.Number({ minimum: 0 })),
  },
  { $id: 'Tenant', additionalProperties: false },
)
export type Tenant = Static<typeof tenantSchema>

export const tenantDataSchema = Type.Partial(tenantSchema, {
  $id: 'TenantData',
  additionalProperties: false,
})
export type TenantData = Static<typeof tenantDataSchema>

export const tenantPatchSchema = Type.Partial(tenantSchema, {
  $id: 'TenantPatch',
  additionalProperties: false,
})
export type TenantPatch = Static<typeof tenantPatchSchema>

export const tenantQueryProperties = Type.Pick(tenantSchema, [
  '_id',
  'name',
  'status',
  'ownerUserId',
  'parentTenantId',
  'region',
  'createdAt',
  'updatedAt',
])
export const tenantQuerySchema = Type.Intersect(
  [querySyntax(tenantQueryProperties), Type.Object({}, { additionalProperties: false })],
  { additionalProperties: false },
)
export type TenantQuery = Static<typeof tenantQuerySchema>
//#endregion

//#region Feld-Level-RBAC fuer TENANT_OWNER-Patches
// Whitelist der Top-Level-Felder, die ein TENANT_OWNER selbst patchen darf.
// Alle anderen Patches sind PLATFORM_*-only.
// Sub-Pfade von billing (z. B. nur `billing.address`, NICHT `billing.stripeCustomerId`)
// werden im `tenantsRestrictTenantPatchHook` granular geprueft.
export const TENANT_OWNER_EDITABLE_TOP_LEVEL_FIELDS = [
  'name',
  'branding',
  'localization',
  'legalEntity',
  'incidentContact',
] as const

// Innerhalb dieser Sub-Aggregate sind nur ausgewaehlte Pfade fuer
// TENANT_OWNER editierbar.
export const TENANT_OWNER_EDITABLE_BILLING_FIELDS = ['address', 'invoiceEmail'] as const

// Branding-Sub-Felder, die ein TENANT_OWNER per `tenants.patch` selbst aendern darf.
// `logo` ist BEWUSST ausgeschlossen — es darf NUR ueber den
// `tenant-branding-asset`-Service (Backend-Proxy mit Validator + sharp-Resize)
// gesetzt werden. Direkte Patches auf `branding.logo` werden geblockt, weil
// sie die Magic-Number-Validation + Size-Limit umgehen wuerden (Tenant-Owner
// koennte 10 MB-PNG einschmuggeln, oder Polyglot-PDFs).
export const TENANT_OWNER_EDITABLE_BRANDING_FIELDS = [
  'faviconUrl',
  'primaryColor',
  'accentColor',
  'customDomain',
  'receiptHeader',
  'receiptFooter',
  'statusPageEnabled',
  'statusPageSubdomain',
] as const

// Felder, die selbst der TENANT_OWNER nicht patchen darf — nur platform.
export const PLATFORM_ONLY_TENANT_FIELDS = [
  'status',
  'suspendedAt',
  'suspendedReason',
  'archivedAt',
  'subscription',
  'tse',
  'compliance',
  'securityPolicy',
  'sso',
  'apiQuota',
  'internalNotes',
  'tags',
  'metadata',
  'parentTenantId',
  'createdBy',
  'createdAt',
  'syncVersion',
] as const
//#endregion
