// Konkrete Geschäftsaktion, die ein Audit-Event beschreibt.
// Die Liste deckt den MVP-Scope (Kern-Gastronomie) ab — Phase 2 erweitert sie.
export const AuditAction = {
  // Generische CRUD-Aktionen (Fallback wenn keine spezifischere Action passt)
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',

  // Bestellungen
  VOID: 'VOID', // Storno einer Bestellung
  REFUND: 'REFUND', // Rückerstattung
  DISCOUNT: 'DISCOUNT', // Manueller Rabatt

  // Zeiterfassung
  CLOCK_IN: 'CLOCK_IN',
  CLOCK_OUT: 'CLOCK_OUT',
  BREAK_START: 'BREAK_START',
  BREAK_END: 'BREAK_END',

  // Authentifizierung
  LOGIN: 'LOGIN',
  LOGIN_FAILED: 'LOGIN_FAILED',
  PIN_VERIFY: 'PIN_VERIFY',

  // Sicherheit / Konfiguration
  PERMISSION_CHANGE: 'PERMISSION_CHANGE',
  PRICE_CHANGE: 'PRICE_CHANGE',
  CONFIG_CHANGE: 'CONFIG_CHANGE',

  // API-Keys / Geräte
  API_KEY_CREATE: 'API_KEY_CREATE',
  API_KEY_REVOKE: 'API_KEY_REVOKE',

  // Bestand / Kasse
  WRITE_OFF: 'WRITE_OFF',

  // Audit-Lifecycle (Phase 2)
  // AUDIT_REDACT: Tenant-Owner/Technician hat ein Audit-Event redacted (DSGVO).
  // AUDIT_CLEANUP: Edge-Cleanup-Worker hat alte Eintraege geloescht (Retention).
  AUDIT_REDACT: 'AUDIT_REDACT',
  AUDIT_CLEANUP: 'AUDIT_CLEANUP',
} as const

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction]
