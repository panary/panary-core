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
  LOG_EXPORT: 'log-export',
  AUDIT_EVENTS: 'audit-events',
  AUDIT_EVENT_REDACTIONS: 'audit-event-redactions',

  // Cloud-spezifische Ressourcen (panary-cloud Backend)
  /** Cloud-only: Read-only Liste abgelehnter Edge→Cloud-Push-Ops (Sync-Reject-
   *  Audit, dedupliziert pro Record, kurze TTL). Service-Pfad = Collection
   *  `cloud-sync-reject`. READ für Support/Owner/Manager (Diagnose). */
  SYNC_REJECTS: 'cloud-sync-reject',
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
  /** Cloud-only: Export von Produktgruppen (JSON oder XLSX). Custom-Method-
   *  Service `find({ query: { format: 'json' | 'xlsx' } })` liefert
   *  `{ filename, contentType, contentBase64 }`. TENANT_OWNER/MANAGER/TECHNICIAN
   *  duerfen exportieren (MANAGE). */
  PRODUCT_GROUPS_EXPORT: 'product-groups-export',
  /** Cloud-only: Import von Produktgruppen via JSON. Preview via `find`
   *  (Dry-Run mit matchType pro Record), Execute via `create` (Upsert,
   *  externalId-Match → patch, sonst create). TENANT_OWNER/MANAGER/TECHNICIAN
   *  duerfen importieren (MANAGE). */
  PRODUCT_GROUPS_IMPORT: 'product-groups-import',
  /** Cloud-only: Export von Zutaten als JSON oder XLSX (Inkrement 2 des
   *  Katalog-Bulk-Operations-Flows). Strippt computed-Felder (`allergens`,
   *  `supplierProductCount`) zusaetzlich zu den server-verwalteten Feldern. */
  INGREDIENTS_EXPORT: 'ingredients-export',
  /** Cloud-only: Export von Rezepten — JSON oder XLSX. Mit Tiefe-Modus
   *  (`withDependencies=true`) werden alle referenzierten Zutaten transitiv
   *  mit-exportiert. Strippt currentVersion/history (Server-managed). */
  RECIPES_EXPORT: 'recipes-export',
  /** Cloud-only: Import von Rezepten via JSON. Preview + Execute analog
   *  product-groups-import. Wenn die Datei eine `ingredients[]`-Sektion
   *  enthaelt, werden diese Zutaten als Erstes upgesertet, damit die
   *  Recipe-Ingredient-Refs (via externalId) aufgeloest werden koennen. */
  RECIPES_IMPORT: 'recipes-import',
  /** Cloud-only: Export von Produkten — JSON oder XLSX. Mit Tiefe-Modus
   *  werden ProductGroups (via categoryIds), Recipes (via recipeId +
   *  recipeReferences) und transitiv referenzierte Ingredients mit-
   *  exportiert. Bundle-Sub-Produkte werden rekursiv mit Cycle-Detection
   *  aufgesammelt. */
  PRODUCTS_EXPORT: 'products-export',
  /** Cloud-only: Import von Produkten via JSON. 4-Phasen-Wizard: Upsert
   *  ProductGroups → Ingredients → Recipes → Products (mit 2-Pass fuer
   *  Bundle-Sub-Produkte: Pass 1 ohne optionGroups, Pass 2 mit
   *  aufgeloesten Sub-Product-Refs). Resolution via externalId-Anker. */
  PRODUCTS_IMPORT: 'products-import',
  /** Cloud-only: Export von Preislisten — JSON oder XLSX. Pricelist-
   *  Product-Refs (`productPrices[].productId`) werden um productExternalId-
   *  Companion-Felder ergaenzt, damit der Re-Import diese Refs aufloesen
   *  kann. Audit-Felder (appliedOn, updateStatus) werden mit-exportiert,
   *  aber serverseitige Felder (updatedAt, updatedBy) gestrippt. */
  PRICELISTS_EXPORT: 'pricelists-export',
  /** Cloud-only: Import von Preislisten via JSON. Standalone-Import
   *  (kein Tiefe-Modus) — referenzierte Produkte muessen bereits im Tenant
   *  existieren, sonst Conflict-Report. Match-Policy externalId → patch,
   *  sonst create. */
  PRICELISTS_IMPORT: 'pricelists-import',
  PRICELISTS: 'pricelists',
  INVENTORIES: 'inventories',
  INCOMING_GOODS: 'incoming-goods',
  /** Cloud-only: Standorttransfer (Warenausgang Quelle → Wareneingang Ziel). */
  OUTGOING_GOODS: 'outgoing-goods',
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
  /** Cloud-only: Tagesabschluss-Reports (Z-Bon-Äquivalent). Custom-Methods
   *  `startClosing`, `cancelClosing`, `reAggregate` zusätzlich zu CRUD.
   *  TENANT_OWNER/MANAGER: voller READ + UPDATE (Audit-Freigabe).
   *  TENANT_STAFF: READ-only auf eigene Filiale.
   *  Edge-Token: CREATE + UPDATE für sync-getriggerten Closing-Flow. */
  BUSINESS_DAY_REPORTS: 'business-day-reports',
  /** Cloud-only: Append-Only-Audit-Trail eines Tagesabschluss-Reports.
   *  READ für TENANT_OWNER/MANAGER (für Live-Progress-Subscription).
   *  CREATE nur intern (Pipeline-Steps), kein externer Write. */
  BUSINESS_DAY_REPORT_EVENTS: 'business-day-report-events',
  /** Cloud-only: Kassen-Sessions (Schubladen) für den Multi-Kassen-Tages-
   *  abschluss. Mehrere pro Geschäftstag, von versch. Benutzern eröffnet.
   *  TENANT_OWNER/MANAGER/TECHNICIAN: MANAGE. TENANT_STAFF: READ+CREATE+UPDATE
   *  (öffnen/zählen/schließen — Self-Scope für fremde Sessions später). */
  CASH_SESSIONS: 'cash-sessions',
  USER_PREFERENCES: 'user-preferences',
  DEVICES: 'devices',
  /** Cloud-only: Live-Zählung der aktuell mit der Cloud verbundenen Geräte
   *  (Socket-Registry). Read-only `find` → { online, total, connectedDeviceIds }.
   *  READ für TENANT_OWNER + TENANT_TECHNICIAN (spiegelt die DEVICES-Leserechte). */
  DEVICE_CONNECTIONS: 'device-connections',
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
  /** Cloud-only: Globale Identitaets-Collection (E-Mail-Login, Passwort, MFA).
   *  Tenant-uebergreifend, ohne tenantId. Plattform-only — Tenant-Rollen haben
   *  KEINEN Matrix-Eintrag (→ 403), wodurch E-Mail-Enumeration ueber Tenants
   *  hinweg ausgeschlossen ist. Self-Daten erhalten Tenant-User ueber den
   *  Login-Response/Membership, nicht ueber diesen Service. */
  ACCOUNTS: 'accounts',
  /** Cloud-only: Einladung einer E-Mail-Identitaet (account) in den eigenen
   *  Tenant als Membership (Dienstleister-/Mitarbeiter-Onboarding). Tenant-
   *  gebunden — der Caller-tenantId bestimmt das Ziel. TENANT_OWNER/TECHNICIAN
   *  MANAGE, TENANT_MANAGER CREATE (nur Staff einladbar). */
  ACCOUNT_INVITATIONS: 'account-invitations',

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
