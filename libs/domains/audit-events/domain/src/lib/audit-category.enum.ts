// Grobe Kategorisierung für UI-Filter und Reporting. Eine Aktion gehört
// genau zu einer Kategorie.
export const AuditCategory = {
  TRANSACTION: 'TRANSACTION', // Bestellungen, Storno, Refund
  CASH: 'CASH', // Kasse, Schwund, Bestand
  PRICING: 'PRICING', // Preisänderungen
  TIME: 'TIME', // Zeiterfassung
  ACCESS: 'ACCESS', // Login, API-Keys, Permissions
  CONFIGURATION: 'CONFIGURATION', // System-/User-/Stammdaten-Änderungen
  DATA_MUTATION: 'DATA_MUTATION', // generischer Catch-All für Stammdaten
} as const

export type AuditCategory = (typeof AuditCategory)[keyof typeof AuditCategory]

// Severity steuert UI-Hervorhebung und ggf. Alerting (Phase 2).
export const AuditSeverity = {
  INFO: 'INFO',
  NOTICE: 'NOTICE',
  WARNING: 'WARNING',
  ALERT: 'ALERT',
} as const

export type AuditSeverity = (typeof AuditSeverity)[keyof typeof AuditSeverity]

export const AuditOutcome = {
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
} as const

export type AuditOutcome = (typeof AuditOutcome)[keyof typeof AuditOutcome]
