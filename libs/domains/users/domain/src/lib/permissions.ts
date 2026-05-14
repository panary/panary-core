// libs/domains/users/domain/src/lib/permissions.ts

// 1. Die Ressourcen (Worauf greifen wir zu?)
export const AppResource = {
  USERS: 'users',
  PRODUCTS: 'products',
  PRODUCT_GROUPS: 'product-groups',
  ORDERS: 'orders',
  INVENTORY: 'inventory',
  LOCATIONS: 'locations',
  SYSTEM: 'system',
  CUSTOMERS: 'customers',
  ORDER_INTERACTIONS: 'order-interactions',
  WORKING_TIMES: 'working-times',
  PRE_ORDERS: 'pre-orders',
  PRINT_SERVER: 'print-server',
  /**
   * Cloud→Edge-Befehlswarteschlange für Drucker-Aktionen (z. B. Test-Druck).
   * Cloud erzeugt PENDING-Jobs, Edge pollt sie im Heartbeat-Worker, führt
   * lokal aus (Print-Server-Manager.testPrint) und meldet den Status zurück.
   */
  PRINTER_COMMANDS: 'printer-commands',
  APIKEYS: 'apikeys',
  CLOUD_CONNECTION: 'cloud-connection',
  OPENING_HOUR_EXCEPTIONS: 'opening-hour-exceptions',
  CLOUD_EDGES: 'cloud-edges',
  EDGE_PAIRING_CODES: 'edge-pairing-codes',
  SYNC_CONFLICTS: 'sync-conflicts',
  SYNC_OUTBOX: 'sync-outbox',
  SYNC_CURSOR: 'sync-cursor',
  SYNC_RUNS: 'sync-runs',
  BOOTSTRAP_REPORTS: 'bootstrap-reports',
  AUDIT_EVENTS: 'audit-events',
  AUDIT_EVENT_REDACTIONS: 'audit-event-redactions',

  // Cloud-spezifische Ressourcen (panary-cloud Backend)
  TENANTS: 'tenants',
  CORPORATE_CUSTOMERS: 'corporate-customers',
  RECIPES: 'recipes',
  INGREDIENTS: 'ingredients',
  SUPPLIERS: 'suppliers',
  SUPPLIER_PRODUCTS: 'supplier-products',
  GLOBAL_SUPPLIERS: 'global-suppliers',
  GLOBAL_SUPPLIER_SUBMISSIONS: 'global-supplier-submissions',
  GTIN_LOOKUP_CACHE: 'gtin-lookup-cache',
  EXTERNAL_OFF_LOOKUP: 'external/off-lookup',
  INGREDIENTS_IMPORT: 'ingredients-import',
  PRICELISTS: 'pricelists',
  INVENTORIES: 'inventories',
  INCOMING_GOODS: 'incoming-goods',
  /** Cloud-only: KI-gestuetzte Extraktion eines Wareneingangs aus einem Beleg-Foto. */
  INCOMING_GOODS_EXTRACT: 'incoming-goods-extract',
  /** Cloud-only: Read-only Audit-Log der KI-Wareneingang-Calls (Cost/Quality). */
  INCOMING_GOODS_EXTRACT_AUDIT: 'incoming-goods-extract-audit',
  /** Cloud-only: Tagesaggregat des Extract-Audits (Cost-Ledger). */
  INCOMING_GOODS_EXTRACT_AUDIT_DAILY: 'incoming-goods-extract-audit-daily',
  /** Cloud-only: Pro-Tenant Settings (Feature-Flags, Limits, KI-Konfiguration). */
  TENANT_SETTINGS: 'tenant-settings',
  WRITE_OFFS: 'write-offs',
  INVENTORY_MOVEMENTS: 'inventory-movements',
  STOCK_LEVELS: 'stock-levels',
  INVOICES: 'invoices',
  BUSINESS_DAYS: 'businessdays',
  USER_PREFERENCES: 'user-preferences',
  DEVICES: 'devices',
  SHIFTS: 'shifts',
  SHIFT_TEMPLATES: 'shift-templates',
  SHIFT_SWAP_REQUESTS: 'shift-swap-requests',
  OPEN_SHIFT_APPLICATIONS: 'open-shift-applications',
  LEAVE_REQUESTS: 'leave-requests',
  HOLIDAY_CALENDARS: 'holiday-calendars',
  /** Cloud-only: PDF-Reports der Personalzeit (Stats-Uebersicht + Lohnkonto). */
  WORKING_TIME_REPORTS: 'working-time-reports',
  ORGANIZATIONS: 'organizations',

  /** Cloud-only: Stornoanalyse & Mitarbeiter-Verhaltens-Auswertung. On-Demand-
   *  MongoDB-Aggregation ueber `order-interactions`. Custom-Method-Service
   *  unter `/fraud-analytics` mit View-Param (`overview`, `staff-ranking`,
   *  `staff-timeseries`, `order-drilldown`). Sichtbar fuer TENANT_OWNER und
   *  TENANT_MANAGER (READ). */
  FRAUD_ANALYTICS: 'fraud-analytics',

  /** Cloud-only: Konfigurierbare Schwellen fuer die Stornoanalyse. CRUD-Service
   *  unter `/fraud-alert-rules`. Owner darf MANAGE, Manager nur READ — Rules
   *  sind sensitive Konfig. Pro Filiale (`locationId`) ODER tenant-weit
   *  (`locationId: null`) gesetzt. */
  FRAUD_ALERT_RULES: 'fraud-alert-rules',

  /** Cloud-only: Append-only Alert-Records, erzeugt durch `evaluateFraudRules()`
   *  nach Sync-Push. Owner und Manager duerfen READ + UPDATE (Acknowledge);
   *  CREATE/DELETE bleibt internal. */
  FRAUD_ALERTS: 'fraud-alerts',

  /** Cloud-only: Plan-Katalog (Subscription-Plans). Globale Stammdaten — alle
   *  authentifizierten User lesen, Schreiben nur PLATFORM_*. */
  SUBSCRIPTION_PLANS: 'subscription-plans',
  /** Cloud-only: Append-Only-Audit-Log fuer Tenant-Stamm-Daten-Aenderungen
   *  (DSGVO/SOC2). CREATE nur intern; Read fuer TENANT_OWNER (eigener Tenant)
   *  + PLATFORM_* (alle). */
  TENANT_AUDIT_TRAIL: 'tenant-audit-trail',

  /** Cloud-only: DSGVO-Art-15-Auskunftsersuchen fuer Tenant-Geschaeftsdaten
   *  (OoS-Welle D Item 2). Owner-only — Sammler-Service ueber alle tenant-
   *  scoped Collections mit Platform-Actor-Redaction. */
  GDPR_TENANT_EXPORT: 'gdpr-tenant-export',
  /** Cloud-only: DSGVO-Art-15-Auskunftsersuchen fuer persoenliche Daten des
   *  aufrufenden Users. Jeder authentifizierte User. */
  GDPR_SELF_EXPORT: 'gdpr-self-export',
  /** Cloud-only: Custom-Method `tenants.transfer(toUserId)` fuer Tenant-Owner-
   *  Wechsel (Welle C Item 8). TENANT_OWNER (Self-Transfer) + PLATFORM_*. */
  TENANT_OWNER_TRANSFER: 'tenant-owner-transfer',
  /** Cloud-only: TTL-Cache fuer EU-VIES-VAT-Validation (Welle D Item 5).
   *  Tenant-User lesen, Platform-Admin schreibt (via Hook). */
  VAT_VALIDATION_CACHE: 'vat-validation-cache',
  /** Cloud-only: External-Service fuer VIES-Lookup (Welle D Item 5). Wird
   *  intern vom trigger-vies-validation-Hook aufgerufen. */
  EXTERNAL_VIES_LOOKUP: 'external/vies-lookup',

  /** Cloud-only: Tenant-Logo-Upload (OoS-Item-7). Multipart-Endpoint mit
   *  Validator + sharp-Resize-Pipeline. Schreibt `tenant.branding.logo` als
   *  BinData (max 200 KB WebP). CREATE/REMOVE nur TENANT_OWNER + PLATFORM_*;
   *  GET (find) fuer alle authentifizierten User des Tenants (Beleg-Druck-
   *  Vorbereitung) + Edge-Token (Offline-Belege). */
  TENANT_BRANDING_ASSET: 'tenant-branding-asset',

  // Plattform-Verwaltungs-Ressourcen (nur Cloud)
  PLATFORM_TENANTS: 'platform-tenants',
  PLATFORM_IMPERSONATION: 'platform-impersonation',
  PLATFORM_IMPERSONATION_EVENTS: 'platform-impersonation-events',
  PLATFORM_USER_PREFERENCES: 'platform-user-preferences',
  PLATFORM_SYSTEM_HEALTH: 'platform-system-health',
  PLATFORM_BUSINESS_METRICS: 'platform-business-metrics',
  PLATFORM_TENANT_HEALTH: 'platform-tenant-health',
  PLATFORM_ALERTS: 'platform-alerts',
  PLATFORM_EVENT_STATS: 'platform-event-stats',
  PLATFORM_CONFIG: 'platform-config',
  PLATFORM_PUSH_SUBSCRIPTION: 'platform-push-subscription',
  PLATFORM_CLOUD_CONNECTIONS: 'platform-cloud-connections',
  TENANT_GRANTS: 'tenant-grants',

  // Auth-Hilfsdienste (offen für authentifizierte User)
  PASSWORD_RESET: 'password-reset',
  EDGE_PAIRING: 'edge-pairing',
  AUTHENTICATION: 'authentication',

  // Passkey/WebAuthn (Self-Service: User verwaltet eigene Credentials)
  WEBAUTHN_CREDENTIALS: 'webauthn-credentials',
  WEBAUTHN_REGISTRATION: 'webauthn-registration',

  // Benachrichtigungen (Cloud-only — Tenant-User-In-App + E-Mail + Web-Push).
  // Owner-Modell: tenantId + userId. User sehen/patchen nur eigene Records
  // (userScoping-Hook). Erzeugung erfolgt intern (kein CREATE per Client).
  NOTIFICATIONS: 'notifications',
  NOTIFICATION_PREFERENCES: 'notification-preferences',
  PUSH_SUBSCRIPTIONS: 'push-subscriptions',
} as const

export type AppResource = (typeof AppResource)[keyof typeof AppResource]

// 2. Die Aktionen (Was tun wir?)
export const AppAction = {
  READ: 'read', // Ansehen (find, get)
  CREATE: 'create', // Anlegen
  UPDATE: 'update', // Bearbeiten (patch, update)
  DELETE: 'delete', // Löschen
  MANAGE: 'manage', // Alles (Admin)
} as const

export type AppAction = (typeof AppAction)[keyof typeof AppAction]

// 3. Granulare Fähigkeiten (Business Features)
// Das sind die Strings, die im 'permissions'-Array in der DB landen können
export const AppAbility = {
  // =======================================================
  // Kasse (POS) PERMISSIONS
  // =======================================================
  CAN_DISCOUNT: 'can_discount',
  CAN_REFUND: 'can_refund',
  CAN_OPEN_DRAWER: 'can_open_drawer',
  CAN_VOID_ORDER: 'can_void_order', // Storno

  // =======================================================
  // Zeiterfassung PERMISSIONS
  // =======================================================
  CAN_CLOCK_IN: 'can_clock_in', // Einstempeln/Ausstempeln (für Kellner)
  CAN_MANAGE_TIME: 'can_manage_time', // Zeiten korrigieren (für Manager)

  // =======================================================
  // Reporting PERMISSIONS
  // =======================================================
  CAN_SEE_REPORTS: 'can_see_reports',

  // =======================================================
  // Sicherheit / Daten PERMISSIONS
  // =======================================================
  CAN_SEE_POS_PIN: 'can_see_pos_pin', // Darf Login-PINs prüfen (falls lokal nötig)
  CAN_READ_SENSITIVE_USER_DATA: 'can_read_sensitive_user_data', // E-Mail, Adresse, Gehalt
} as const

export type AppAbility = (typeof AppAbility)[keyof typeof AppAbility]
