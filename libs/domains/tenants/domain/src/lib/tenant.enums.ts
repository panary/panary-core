// Tenant-Lifecycle. Bewusst ein eigener State-Machine-State,
// nicht abgeleitet aus User-/Location-Status.
export const TenantStatus = {
  PROVISIONING: 'PROVISIONING',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  ARCHIVED: 'ARCHIVED',
} as const
export type TenantStatusValue = (typeof TenantStatus)[keyof typeof TenantStatus]

// Subscription-State spiegelt direkt die Stripe-Subscription-Statuus.
// Stripe-Webhook synchronisiert in dieses Feld.
export const SubscriptionStatus = {
  TRIALING: 'TRIALING',
  ACTIVE: 'ACTIVE',
  PAST_DUE: 'PAST_DUE',
  CANCELED: 'CANCELED',
  PAUSED: 'PAUSED',
} as const
export type SubscriptionStatusValue = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus]

// TSE-Anbieter fuer KassenSichV (DE) und RKSV (AT) — Liste kann
// erweitert werden, sobald neue Anbieter integriert werden.
export const TseProvider = {
  FISKALY: 'FISKALY',
  SWISSBIT: 'SWISSBIT',
  EPSON: 'EPSON',
  DEUTSCHE_FISKAL: 'DEUTSCHE_FISKAL',
  EPOSIT: 'EPOSIT',
  OTHER: 'OTHER',
} as const
export type TseProviderValue = (typeof TseProvider)[keyof typeof TseProvider]

export const TseStatus = {
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  PENDING_VALIDATION: 'PENDING_VALIDATION',
  ACTIVE: 'ACTIVE',
  FAILED: 'FAILED',
  SUSPENDED: 'SUSPENDED',
} as const
export type TseStatusValue = (typeof TseStatus)[keyof typeof TseStatus]

// §146a AO: juristische vs. natuerliche Person als Steuerpflichtiger.
export const TseLegalEntityType = {
  JURISTIC: 'JURISTIC',
  NATURAL: 'NATURAL',
} as const
export type TseLegalEntityTypeValue = (typeof TseLegalEntityType)[keyof typeof TseLegalEntityType]

// Multi-Country-Fiskalisierungsregimes. Schema ready, V1-UI nur DE.
export const TseJurisdiction = {
  DE: 'DE',
  AT: 'AT',
  CH: 'CH',
} as const
export type TseJurisdictionValue = (typeof TseJurisdiction)[keyof typeof TseJurisdiction]

// Data-Residency-Hinweis fuer DSGVO/Compliance. Default EU.
export const TenantRegion = {
  EU: 'EU',
  CH: 'CH',
  US: 'US',
} as const
export type TenantRegionValue = (typeof TenantRegion)[keyof typeof TenantRegion]

// Steuer-Behandlung im Billing. B2B-EU-Reverse-Charge ist haeufigster
// Sonderfall (USt-IdNr-validierter EU-Kunde, Rechnung ohne USt).
export const BillingTaxStatus = {
  STANDARD: 'STANDARD',
  REVERSE_CHARGE: 'REVERSE_CHARGE',
  EXEMPT: 'EXEMPT',
} as const
export type BillingTaxStatusValue = (typeof BillingTaxStatus)[keyof typeof BillingTaxStatus]

export const BillingCustomerType = {
  B2B: 'B2B',
  B2C: 'B2C',
} as const
export type BillingCustomerTypeValue = (typeof BillingCustomerType)[keyof typeof BillingCustomerType]

// Quelle einer Tenant-Aenderung im Audit-Trail. Wichtig fuer DSGVO-
// Auditing (welche Aenderung kam von Stripe vs. Mensch).
export const TenantAuditSource = {
  PLATFORM_ADMIN: 'PLATFORM_ADMIN',
  TENANT_OWNER: 'TENANT_OWNER',
  STRIPE_WEBHOOK: 'STRIPE_WEBHOOK',
  SYSTEM: 'SYSTEM',
  MIGRATION: 'MIGRATION',
} as const
export type TenantAuditSourceValue = (typeof TenantAuditSource)[keyof typeof TenantAuditSource]

export const TenantAuditAction = {
  CREATE: 'CREATE',
  PATCH: 'PATCH',
  REMOVE: 'REMOVE',
  SUSPEND: 'SUSPEND',
  UNSUSPEND: 'UNSUSPEND',
  ARCHIVE: 'ARCHIVE',
  TSE_CONFIG_CHANGE: 'TSE_CONFIG_CHANGE',
  BILLING_CHANGE: 'BILLING_CHANGE',
  SUBSCRIPTION_CHANGE: 'SUBSCRIPTION_CHANGE',
  OWNER_TRANSFER: 'OWNER_TRANSFER',
  BRANDING_CHANGE: 'BRANDING_CHANGE',
} as const
export type TenantAuditActionValue = (typeof TenantAuditAction)[keyof typeof TenantAuditAction]

// SOC2-Self-Attestation-States.
export const ComplianceSocStatus = {
  NONE: 'NONE',
  IN_PROGRESS: 'IN_PROGRESS',
  CERTIFIED: 'CERTIFIED',
} as const
export type ComplianceSocStatusValue = (typeof ComplianceSocStatus)[keyof typeof ComplianceSocStatus]

// Wochenstart fuer Schichtplan/Reports.
export const WeekStart = {
  MO: 'MO',
  SU: 'SU',
} as const
export type WeekStartValue = (typeof WeekStart)[keyof typeof WeekStart]
