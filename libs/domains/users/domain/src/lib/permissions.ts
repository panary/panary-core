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
  LEAVE_REQUESTS: 'leave-requests',
  ORGANIZATIONS: 'organizations',

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
