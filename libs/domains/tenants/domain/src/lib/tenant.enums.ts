// Tenant-Lifecycle. Bewusst ein eigener State-Machine-State,
// nicht abgeleitet aus User-/Location-Status.
export const TenantStatus = {
  PROVISIONING: 'PROVISIONING',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  ARCHIVED: 'ARCHIVED',
} as const
export type TenantStatusValue = (typeof TenantStatus)[keyof typeof TenantStatus]

// Subscription-State — provider-neutral. Der jeweilige PSP-Webhook
// (Mollie/Stripe) mappt seinen Provider-Status in dieses Feld.
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

// Aktiver Zahlungs-/Billing-Anbieter eines Tenants (provider-neutrale Abstraktion).
// Subscription-Billing laeuft ueber Mollie; STRIPE bleibt fuer Bestand/POS-Acquiring.
export const BillingProvider = {
  MOLLIE: 'mollie',
  STRIPE: 'stripe',
} as const
export type BillingProviderValue = (typeof BillingProvider)[keyof typeof BillingProvider]

// Quelle einer Tenant-Aenderung im Audit-Trail. Wichtig fuer DSGVO-
// Auditing (welche Aenderung kam von Stripe vs. Mensch).
export const TenantAuditSource = {
  PLATFORM_ADMIN: 'PLATFORM_ADMIN',
  // L1-Support darf eine begrenzte Sub-Menge an Plattform-Operationen ausloesen
  // (z. B. Trial-Extension <= 14 Tage). Eigene Source, damit Audit-Filter "von wem"
  // sauber zwischen Owner/Admin und Support unterscheidet.
  PLATFORM_SUPPORT: 'PLATFORM_SUPPORT',
  TENANT_OWNER: 'TENANT_OWNER',
  STRIPE_WEBHOOK: 'STRIPE_WEBHOOK',
  MOLLIE_WEBHOOK: 'MOLLIE_WEBHOOK',
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
  // Subscription-Bearbeitung mit Drei-Schicht-Sicherung (siehe documentation/
  // subscription-administration.md). Granularere Actions als generisches
  // SUBSCRIPTION_CHANGE — Audit-Filter im UI werden damit aussagekraeftig.
  //
  // Schicht 1 (Tenant-OWNER Self-Service):
  PLAN_SWITCHED_SELF_SERVICE: 'PLAN_SWITCHED_SELF_SERVICE',
  CANCEL_REQUESTED_SELF_SERVICE: 'CANCEL_REQUESTED_SELF_SERVICE',
  // Schicht 2 (Plattform Single-Sign — SUPPORT/ADMIN/OWNER):
  TRIAL_EXTENDED: 'TRIAL_EXTENDED',
  GRACE_EXTENDED: 'GRACE_EXTENDED',
  COUPON_APPLIED: 'COUPON_APPLIED',
  PLAN_SWITCHED_PLATFORM: 'PLAN_SWITCHED_PLATFORM',
  STATUS_RECOVERY: 'STATUS_RECOVERY',
  // Schicht 3 (Plattform Dual-Sign — Maker stellt Request, OWNER approved):
  REQUEST_CREATED: 'REQUEST_CREATED',
  REQUEST_APPROVED: 'REQUEST_APPROVED',
  REQUEST_REJECTED: 'REQUEST_REJECTED',
  REQUEST_EXPIRED: 'REQUEST_EXPIRED',
  LIMIT_OVERRIDE_APPLIED: 'LIMIT_OVERRIDE_APPLIED',
  ENTERPRISE_ASSIGNED: 'ENTERPRISE_ASSIGNED',
  ARCHIVE_REQUESTED: 'ARCHIVE_REQUESTED',
  // OoS-Items Follow-up:
  GDPR_EXPORT: 'GDPR_EXPORT', // Welle D Item 2 — Auskunftsersuchen nach DSGVO Art. 15
  PLAN_LIMIT_VIOLATION: 'PLAN_LIMIT_VIOLATION', // Welle B Item 1 — Plan-Limit-Verstoss (best-effort-Detector)
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
