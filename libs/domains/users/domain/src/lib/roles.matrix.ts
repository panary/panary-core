import { UserSystemRole } from './user.schema'
import { AppAction, AppResource, AppAbility } from './permissions'

// Wir exportieren den Typ, damit wir ihn im Hook nutzen können (Clean Code)
export type PermissionRule = { resource: AppResource; action: AppAction | AppAction[] } | AppAbility

// Wir erzwingen mit 'Record<...>', dass ALLE Keys vorhanden sein müssen
export const RolePermissions: Record<UserSystemRole, PermissionRule[]> = {
  // =======================================================
  // PLATFORM PERMISSIONS
  // =======================================================
  [UserSystemRole.PLATFORM_OWNER]: [
    // Always-on über alle Ressourcen. Im authorize-Hook explizit per Bypass behandelt.
    // Diese Liste dient als Dokumentation der Mindest-Rechte (falls Bypass entfällt).
    { resource: AppResource.SYSTEM, action: AppAction.MANAGE },
    { resource: AppResource.USERS, action: AppAction.MANAGE },
    { resource: AppResource.PLATFORM_TENANTS, action: AppAction.MANAGE },
    { resource: AppResource.PLATFORM_IMPERSONATION, action: AppAction.MANAGE },
    { resource: AppResource.PLATFORM_IMPERSONATION_EVENTS, action: AppAction.READ },
    { resource: AppResource.PLATFORM_USER_PREFERENCES, action: AppAction.MANAGE },
    { resource: AppResource.PLATFORM_SYSTEM_HEALTH, action: AppAction.READ },
    { resource: AppResource.PLATFORM_BUSINESS_METRICS, action: AppAction.READ },
    { resource: AppResource.PLATFORM_TENANT_HEALTH, action: AppAction.READ },
    { resource: AppResource.PLATFORM_ALERTS, action: AppAction.MANAGE },
    { resource: AppResource.PLATFORM_EVENT_STATS, action: AppAction.READ },
    { resource: AppResource.PLATFORM_CONFIG, action: AppAction.MANAGE },
    { resource: AppResource.PLATFORM_PUSH_SUBSCRIPTION, action: AppAction.MANAGE },
    { resource: AppResource.PLATFORM_CLOUD_CONNECTIONS, action: AppAction.READ },
    { resource: AppResource.TENANT_GRANTS, action: AppAction.MANAGE },
    { resource: AppResource.WEBAUTHN_CREDENTIALS, action: AppAction.MANAGE },
    { resource: AppResource.WEBAUTHN_REGISTRATION, action: AppAction.CREATE },
    // Tenant-Audit-Events: Owner hat Bypass; Eintrag dient als Dokumentation
    // (siehe authorize-Hook). PLATFORM_SUPPORT bekommt KEINEN Direktzugriff —
    // Support liest Tenant-Audits nur via Cloud-Impersonation.
    { resource: AppResource.AUDIT_EVENTS, action: AppAction.READ },
    { resource: AppResource.AUDIT_EVENT_REDACTIONS, action: AppAction.READ },
    // Globaler Lieferanten-Katalog (Phase 2): Plattform-Owner pflegt master.
    { resource: AppResource.GLOBAL_SUPPLIERS, action: AppAction.MANAGE },
    { resource: AppResource.GLOBAL_SUPPLIER_SUBMISSIONS, action: AppAction.MANAGE },
    // Tenant-Settings: PLATFORM_OWNER aktiviert das KI-Wareneingang-Feature pro Tenant.
    { resource: AppResource.TENANT_SETTINGS, action: AppAction.MANAGE },
    // KI-Wareneingang-Audit (cross-tenant fuer Plattform-Reports).
    { resource: AppResource.INCOMING_GOODS_EXTRACT_AUDIT, action: AppAction.READ },
    { resource: AppResource.INCOMING_GOODS_EXTRACT_AUDIT_DAILY, action: AppAction.READ },
  ],

  [UserSystemRole.PLATFORM_ADMIN]: [
    // Always-on Lesen über Plattform-Ressourcen, Schreiben in fremde Tenants nur per Switch.
    { resource: AppResource.USERS, action: AppAction.READ },
    { resource: AppResource.ORDERS, action: AppAction.READ },
    { resource: AppResource.PRODUCTS, action: AppAction.READ },
    { resource: AppResource.PRODUCT_GROUPS, action: AppAction.READ },
    { resource: AppResource.LOCATIONS, action: AppAction.READ },
    { resource: AppResource.SYSTEM, action: AppAction.MANAGE },
    { resource: AppResource.PLATFORM_TENANTS, action: AppAction.MANAGE },
    { resource: AppResource.PLATFORM_IMPERSONATION, action: AppAction.MANAGE },
    { resource: AppResource.PLATFORM_IMPERSONATION_EVENTS, action: AppAction.READ },
    { resource: AppResource.PLATFORM_USER_PREFERENCES, action: AppAction.MANAGE },
    { resource: AppResource.PLATFORM_SYSTEM_HEALTH, action: AppAction.READ },
    { resource: AppResource.PLATFORM_BUSINESS_METRICS, action: AppAction.READ },
    { resource: AppResource.PLATFORM_TENANT_HEALTH, action: AppAction.READ },
    { resource: AppResource.PLATFORM_ALERTS, action: [AppAction.READ, AppAction.UPDATE] },
    { resource: AppResource.PLATFORM_EVENT_STATS, action: AppAction.READ },
    { resource: AppResource.PLATFORM_CONFIG, action: AppAction.READ },
    { resource: AppResource.PLATFORM_PUSH_SUBSCRIPTION, action: AppAction.MANAGE },
    { resource: AppResource.PLATFORM_CLOUD_CONNECTIONS, action: AppAction.READ },
    { resource: AppResource.TENANT_GRANTS, action: AppAction.READ },
    { resource: AppResource.WEBAUTHN_CREDENTIALS, action: AppAction.MANAGE },
    { resource: AppResource.WEBAUTHN_REGISTRATION, action: AppAction.CREATE },
    // Globaler Lieferanten-Katalog (Phase 2): Plattform-Admin curated.
    { resource: AppResource.GLOBAL_SUPPLIERS, action: AppAction.MANAGE },
    { resource: AppResource.GLOBAL_SUPPLIER_SUBMISSIONS, action: AppAction.MANAGE },
    // Tenant-Settings darf der Admin lesen (zur Diagnose), aber nicht aendern.
    { resource: AppResource.TENANT_SETTINGS, action: AppAction.READ },
    { resource: AppResource.INCOMING_GOODS_EXTRACT_AUDIT, action: AppAction.READ },
    { resource: AppResource.INCOMING_GOODS_EXTRACT_AUDIT_DAILY, action: AppAction.READ },
  ],

  [UserSystemRole.PLATFORM_SUPPORT]: [
    // Pro-Tenant Opt-in via Impersonation. Always-on nur Selbst-Verwaltung + Lese-Basics.
    { resource: AppResource.USERS, action: AppAction.READ },
    { resource: AppResource.ORDERS, action: AppAction.READ },
    { resource: AppResource.PRODUCTS, action: AppAction.READ },
    { resource: AppResource.SYSTEM, action: AppAction.READ },
    { resource: AppResource.PLATFORM_TENANTS, action: AppAction.READ },
    // CREATE: Impersonation starten. DELETE: eigene Sitzung beenden ("Zurück zur Plattform")
    // — ohne DELETE bleibt der Support-Mitarbeiter im Tenant-Kontext gefangen.
    { resource: AppResource.PLATFORM_IMPERSONATION, action: [AppAction.CREATE, AppAction.DELETE] },
    { resource: AppResource.PLATFORM_IMPERSONATION_EVENTS, action: AppAction.READ },
    { resource: AppResource.PLATFORM_USER_PREFERENCES, action: AppAction.MANAGE },
    { resource: AppResource.PLATFORM_SYSTEM_HEALTH, action: AppAction.READ },
    // Support hat keinen READ auf platform-business-metrics — Globalblick bleibt Owner/Admin.
    { resource: AppResource.PLATFORM_TENANT_HEALTH, action: AppAction.READ },
    // Support liest Alerts und kann sie quittieren (acknowledge), aber nicht loeschen.
    { resource: AppResource.PLATFORM_ALERTS, action: [AppAction.READ, AppAction.UPDATE] },
    // Support sieht Konfig nur lesend; Schwellenwerte aendert ausschliesslich Owner.
    { resource: AppResource.PLATFORM_CONFIG, action: AppAction.READ },
    // Eigene Push-Subscription verwalten (Browser-Notifications fuer Critical-Alerts).
    { resource: AppResource.PLATFORM_PUSH_SUBSCRIPTION, action: AppAction.MANAGE },
    { resource: AppResource.PLATFORM_CLOUD_CONNECTIONS, action: AppAction.READ },
    { resource: AppResource.TENANT_GRANTS, action: AppAction.READ },
    { resource: AppResource.WEBAUTHN_CREDENTIALS, action: AppAction.MANAGE },
    { resource: AppResource.WEBAUTHN_REGISTRATION, action: AppAction.CREATE },
    // Globaler Lieferanten-Katalog (Phase 2): Support liest mit, kein Schreibzugriff.
    { resource: AppResource.GLOBAL_SUPPLIERS, action: AppAction.READ },
    { resource: AppResource.GLOBAL_SUPPLIER_SUBMISSIONS, action: AppAction.READ },
  ],

  // =======================================================
  // TENANTS PERMISSIONS
  // =======================================================
  [UserSystemRole.TENANT_OWNER]: [
    { resource: AppResource.USERS, action: AppAction.MANAGE },
    { resource: AppResource.PRODUCTS, action: AppAction.MANAGE },
    { resource: AppResource.PRODUCT_GROUPS, action: AppAction.MANAGE },
    { resource: AppResource.ORDERS, action: AppAction.READ },
    { resource: AppResource.WORKING_TIMES, action: AppAction.MANAGE },
    { resource: AppResource.PRE_ORDERS, action: AppAction.MANAGE },
    { resource: AppResource.PRINT_SERVER, action: AppAction.MANAGE },
    { resource: AppResource.APIKEYS, action: AppAction.MANAGE },
    { resource: AppResource.CLOUD_CONNECTION, action: AppAction.MANAGE },
    { resource: AppResource.OPENING_HOUR_EXCEPTIONS, action: AppAction.MANAGE },
    { resource: AppResource.CLOUD_EDGES, action: AppAction.MANAGE },
    { resource: AppResource.EDGE_PAIRING_CODES, action: AppAction.MANAGE },
    { resource: AppResource.SYNC_CONFLICTS, action: AppAction.MANAGE },
    { resource: AppResource.SYNC_OUTBOX, action: AppAction.READ },
    { resource: AppResource.SYNC_CURSOR, action: AppAction.READ },
    { resource: AppResource.SYNC_RUNS, action: AppAction.READ },
    { resource: AppResource.BOOTSTRAP_REPORTS, action: AppAction.READ },
    // Cloud-spezifische Ressourcen
    { resource: AppResource.CORPORATE_CUSTOMERS, action: AppAction.MANAGE },
    { resource: AppResource.CUSTOMERS, action: AppAction.MANAGE },
    { resource: AppResource.RECIPES, action: AppAction.MANAGE },
    { resource: AppResource.INGREDIENTS, action: AppAction.MANAGE },
    { resource: AppResource.SUPPLIERS, action: AppAction.MANAGE },
    { resource: AppResource.SUPPLIER_PRODUCTS, action: AppAction.MANAGE },
    // Globaler Lieferanten-Katalog: lesen + Vorschlaege einreichen.
    { resource: AppResource.GLOBAL_SUPPLIERS, action: AppAction.READ },
    { resource: AppResource.GLOBAL_SUPPLIER_SUBMISSIONS, action: [AppAction.READ, AppAction.CREATE] },
    { resource: AppResource.GTIN_LOOKUP_CACHE, action: AppAction.MANAGE },
    { resource: AppResource.EXTERNAL_OFF_LOOKUP, action: AppAction.READ },
    { resource: AppResource.INGREDIENTS_IMPORT, action: AppAction.MANAGE },
    { resource: AppResource.PRICELISTS, action: AppAction.MANAGE },
    { resource: AppResource.INVENTORIES, action: AppAction.MANAGE },
    { resource: AppResource.INCOMING_GOODS, action: AppAction.MANAGE },
    { resource: AppResource.WRITE_OFFS, action: AppAction.MANAGE },
    { resource: AppResource.INVENTORY_MOVEMENTS, action: AppAction.MANAGE },
    { resource: AppResource.STOCK_LEVELS, action: AppAction.READ },
    { resource: AppResource.INVOICES, action: AppAction.MANAGE },
    { resource: AppResource.BUSINESS_DAYS, action: AppAction.MANAGE },
    { resource: AppResource.USER_PREFERENCES, action: AppAction.MANAGE },
    { resource: AppResource.DEVICES, action: AppAction.MANAGE },
    { resource: AppResource.SHIFTS, action: AppAction.MANAGE },
    { resource: AppResource.LEAVE_REQUESTS, action: AppAction.MANAGE },
    { resource: AppResource.LOCATIONS, action: AppAction.MANAGE },
    { resource: AppResource.ORDER_INTERACTIONS, action: AppAction.MANAGE },
    { resource: AppResource.ORGANIZATIONS, action: AppAction.READ },
    { resource: AppResource.TENANTS, action: AppAction.READ },
    // Tenant-Settings: lesen (Anzeige im Settings-UI). Aktivieren bleibt PLATFORM_OWNER.
    { resource: AppResource.TENANT_SETTINGS, action: AppAction.READ },
    // KI-Wareneingang: Foto hochladen + Audit lesen.
    { resource: AppResource.INCOMING_GOODS_EXTRACT, action: AppAction.CREATE },
    { resource: AppResource.INCOMING_GOODS_EXTRACT_AUDIT, action: AppAction.READ },
    { resource: AppResource.INCOMING_GOODS_EXTRACT_AUDIT_DAILY, action: AppAction.READ },
    { resource: AppResource.TENANT_GRANTS, action: AppAction.MANAGE },
    { resource: AppResource.WEBAUTHN_CREDENTIALS, action: AppAction.MANAGE },
    { resource: AppResource.WEBAUTHN_REGISTRATION, action: AppAction.CREATE },
    // Tenant-Audit-Trail (append-only)
    { resource: AppResource.AUDIT_EVENTS, action: AppAction.READ },
    // Audit-Redactions (Phase 2 — DSGVO-Loeschungen / Fehleintraege markieren)
    { resource: AppResource.AUDIT_EVENT_REDACTIONS, action: [AppAction.READ, AppAction.CREATE] },
    AppAbility.CAN_SEE_REPORTS,
    AppAbility.CAN_REFUND,
    AppAbility.CAN_VOID_ORDER,
  ],

  // Techniker — Admin-ähnliche Rechte für Systemkonfiguration und Support
  [UserSystemRole.TENANT_TECHNICIAN]: [
    { resource: AppResource.USERS, action: AppAction.MANAGE },
    { resource: AppResource.PRODUCTS, action: AppAction.MANAGE },
    { resource: AppResource.PRODUCT_GROUPS, action: AppAction.MANAGE },
    { resource: AppResource.ORDERS, action: AppAction.MANAGE },
    { resource: AppResource.WORKING_TIMES, action: AppAction.MANAGE },
    { resource: AppResource.PRE_ORDERS, action: AppAction.MANAGE },
    { resource: AppResource.PRINT_SERVER, action: AppAction.MANAGE },
    { resource: AppResource.APIKEYS, action: AppAction.MANAGE },
    { resource: AppResource.CLOUD_CONNECTION, action: AppAction.MANAGE },
    { resource: AppResource.OPENING_HOUR_EXCEPTIONS, action: AppAction.MANAGE },
    { resource: AppResource.CLOUD_EDGES, action: AppAction.MANAGE },
    { resource: AppResource.EDGE_PAIRING_CODES, action: AppAction.MANAGE },
    { resource: AppResource.SYNC_CONFLICTS, action: AppAction.MANAGE },
    { resource: AppResource.SYNC_OUTBOX, action: AppAction.MANAGE },
    { resource: AppResource.SYNC_CURSOR, action: AppAction.READ },
    { resource: AppResource.SYNC_RUNS, action: AppAction.READ },
    { resource: AppResource.BOOTSTRAP_REPORTS, action: AppAction.READ },
    { resource: AppResource.LOCATIONS, action: AppAction.MANAGE },
    { resource: AppResource.SYSTEM, action: AppAction.MANAGE },
    // Cloud-spezifische Ressourcen
    { resource: AppResource.CORPORATE_CUSTOMERS, action: AppAction.MANAGE },
    { resource: AppResource.CUSTOMERS, action: AppAction.MANAGE },
    { resource: AppResource.RECIPES, action: AppAction.MANAGE },
    { resource: AppResource.INGREDIENTS, action: AppAction.MANAGE },
    { resource: AppResource.SUPPLIERS, action: AppAction.MANAGE },
    { resource: AppResource.SUPPLIER_PRODUCTS, action: AppAction.MANAGE },
    // Globaler Lieferanten-Katalog: lesen + Vorschlaege einreichen.
    { resource: AppResource.GLOBAL_SUPPLIERS, action: AppAction.READ },
    { resource: AppResource.GLOBAL_SUPPLIER_SUBMISSIONS, action: [AppAction.READ, AppAction.CREATE] },
    { resource: AppResource.GTIN_LOOKUP_CACHE, action: AppAction.MANAGE },
    { resource: AppResource.EXTERNAL_OFF_LOOKUP, action: AppAction.READ },
    { resource: AppResource.INGREDIENTS_IMPORT, action: AppAction.MANAGE },
    { resource: AppResource.PRICELISTS, action: AppAction.MANAGE },
    { resource: AppResource.INVENTORIES, action: AppAction.MANAGE },
    { resource: AppResource.INCOMING_GOODS, action: AppAction.MANAGE },
    { resource: AppResource.WRITE_OFFS, action: AppAction.MANAGE },
    { resource: AppResource.INVENTORY_MOVEMENTS, action: AppAction.MANAGE },
    { resource: AppResource.STOCK_LEVELS, action: AppAction.READ },
    { resource: AppResource.INVOICES, action: AppAction.MANAGE },
    { resource: AppResource.BUSINESS_DAYS, action: AppAction.MANAGE },
    { resource: AppResource.USER_PREFERENCES, action: AppAction.MANAGE },
    { resource: AppResource.DEVICES, action: AppAction.MANAGE },
    { resource: AppResource.SHIFTS, action: AppAction.MANAGE },
    { resource: AppResource.LEAVE_REQUESTS, action: AppAction.MANAGE },
    { resource: AppResource.ORDER_INTERACTIONS, action: AppAction.MANAGE },
    { resource: AppResource.TENANTS, action: AppAction.READ },
    // Tenant-Settings + KI-Wareneingang: Techniker hat Manager-aequivalente Rechte.
    { resource: AppResource.TENANT_SETTINGS, action: AppAction.READ },
    { resource: AppResource.INCOMING_GOODS_EXTRACT, action: AppAction.CREATE },
    { resource: AppResource.INCOMING_GOODS_EXTRACT_AUDIT, action: AppAction.READ },
    { resource: AppResource.INCOMING_GOODS_EXTRACT_AUDIT_DAILY, action: AppAction.READ },
    { resource: AppResource.WEBAUTHN_CREDENTIALS, action: AppAction.MANAGE },
    { resource: AppResource.WEBAUTHN_REGISTRATION, action: AppAction.CREATE },
    // Tenant-Audit-Trail (append-only)
    { resource: AppResource.AUDIT_EVENTS, action: AppAction.READ },
    // Audit-Redactions (Phase 2 — DSGVO-Loeschungen / Fehleintraege markieren)
    { resource: AppResource.AUDIT_EVENT_REDACTIONS, action: [AppAction.READ, AppAction.CREATE] },
    AppAbility.CAN_SEE_REPORTS,
    AppAbility.CAN_REFUND,
    AppAbility.CAN_VOID_ORDER,
    AppAbility.CAN_MANAGE_TIME,
    AppAbility.CAN_SEE_POS_PIN,
    AppAbility.CAN_READ_SENSITIVE_USER_DATA,
  ],

  [UserSystemRole.TENANT_MANAGER]: [
    // Self-Service: Manager darf seinen EIGENEN User-Datensatz patchen
    // (posPin, password, email). Self-Restriction wird im Service-Hook
    // `restrictUserSelfPatch` enforced — kein Patch fremder User, keine
    // Eskalation auf role/tenantId/permissions.
    { resource: AppResource.USERS, action: [AppAction.READ, AppAction.UPDATE] },
    { resource: AppResource.PRODUCTS, action: AppAction.MANAGE },
    { resource: AppResource.PRODUCT_GROUPS, action: AppAction.READ },
    { resource: AppResource.ORDERS, action: [AppAction.CREATE, AppAction.READ, AppAction.DELETE] },
    { resource: AppResource.WORKING_TIMES, action: [AppAction.READ, AppAction.UPDATE] },
    { resource: AppResource.PRE_ORDERS, action: AppAction.MANAGE },
    { resource: AppResource.PRINT_SERVER, action: [AppAction.READ, AppAction.UPDATE] },
    { resource: AppResource.APIKEYS, action: AppAction.READ },
    { resource: AppResource.CLOUD_EDGES, action: AppAction.READ },
    { resource: AppResource.EDGE_PAIRING_CODES, action: AppAction.READ },
    // Cloud-spezifische Ressourcen
    { resource: AppResource.CORPORATE_CUSTOMERS, action: AppAction.MANAGE },
    { resource: AppResource.CUSTOMERS, action: AppAction.MANAGE },
    { resource: AppResource.RECIPES, action: AppAction.READ },
    { resource: AppResource.INGREDIENTS, action: AppAction.READ },
    { resource: AppResource.SUPPLIERS, action: AppAction.MANAGE },
    { resource: AppResource.SUPPLIER_PRODUCTS, action: AppAction.MANAGE },
    // Globaler Lieferanten-Katalog: lesen + Vorschlaege einreichen.
    { resource: AppResource.GLOBAL_SUPPLIERS, action: AppAction.READ },
    { resource: AppResource.GLOBAL_SUPPLIER_SUBMISSIONS, action: [AppAction.READ, AppAction.CREATE] },
    { resource: AppResource.GTIN_LOOKUP_CACHE, action: AppAction.MANAGE },
    { resource: AppResource.EXTERNAL_OFF_LOOKUP, action: AppAction.READ },
    { resource: AppResource.INGREDIENTS_IMPORT, action: AppAction.MANAGE },
    { resource: AppResource.PRICELISTS, action: AppAction.MANAGE },
    { resource: AppResource.INVENTORIES, action: AppAction.MANAGE },
    { resource: AppResource.INCOMING_GOODS, action: AppAction.MANAGE },
    { resource: AppResource.WRITE_OFFS, action: AppAction.MANAGE },
    { resource: AppResource.INVENTORY_MOVEMENTS, action: AppAction.READ },
    { resource: AppResource.STOCK_LEVELS, action: AppAction.READ },
    { resource: AppResource.INVOICES, action: [AppAction.READ, AppAction.UPDATE] },
    { resource: AppResource.BUSINESS_DAYS, action: AppAction.MANAGE },
    { resource: AppResource.USER_PREFERENCES, action: AppAction.MANAGE },
    { resource: AppResource.SHIFTS, action: AppAction.MANAGE },
    { resource: AppResource.LEAVE_REQUESTS, action: [AppAction.READ, AppAction.UPDATE] },
    { resource: AppResource.LOCATIONS, action: AppAction.READ },
    { resource: AppResource.ORDER_INTERACTIONS, action: AppAction.MANAGE },
    { resource: AppResource.TENANTS, action: AppAction.READ },
    // Tenant-Settings: nur lesend; Aktivierung bleibt PLATFORM_OWNER vorbehalten.
    { resource: AppResource.TENANT_SETTINGS, action: AppAction.READ },
    // KI-Wareneingang: Foto hochladen + Audit lesen.
    { resource: AppResource.INCOMING_GOODS_EXTRACT, action: AppAction.CREATE },
    { resource: AppResource.INCOMING_GOODS_EXTRACT_AUDIT, action: AppAction.READ },
    { resource: AppResource.INCOMING_GOODS_EXTRACT_AUDIT_DAILY, action: AppAction.READ },
    { resource: AppResource.WEBAUTHN_CREDENTIALS, action: AppAction.MANAGE },
    { resource: AppResource.WEBAUTHN_REGISTRATION, action: AppAction.CREATE },
    // Tenant-Audit-Trail (append-only)
    { resource: AppResource.AUDIT_EVENTS, action: AppAction.READ },
    // Manager darf Redactions sehen, aber NICHT selbst durchfuehren — nur
    // OWNER/TECHNICIAN haben CREATE. Daher hier nur READ.
    { resource: AppResource.AUDIT_EVENT_REDACTIONS, action: AppAction.READ },
    AppAbility.CAN_VOID_ORDER,
  ],

  [UserSystemRole.TENANT_STAFF]: [
    // Self-Service: Mitarbeiter darf seinen EIGENEN User-Datensatz patchen
    // (posPin, password, email). Self-Restriction wird im Service-Hook
    // `restrictUserSelfPatch` enforced — kein Patch fremder User, keine
    // Eskalation auf role/tenantId/permissions.
    { resource: AppResource.USERS, action: [AppAction.READ, AppAction.UPDATE] },
    { resource: AppResource.PRODUCTS, action: AppAction.READ },
    { resource: AppResource.PRODUCT_GROUPS, action: AppAction.READ },
    { resource: AppResource.ORDERS, action: [AppAction.CREATE, AppAction.READ] },
    { resource: AppResource.WORKING_TIMES, action: AppAction.READ },
    { resource: AppResource.PRE_ORDERS, action: [AppAction.CREATE, AppAction.READ, AppAction.UPDATE] },
    // Cloud-spezifische Ressourcen (Lese-/Erfassungs-Rechte)
    { resource: AppResource.CUSTOMERS, action: [AppAction.READ, AppAction.CREATE] },
    { resource: AppResource.PRICELISTS, action: AppAction.READ },
    { resource: AppResource.RECIPES, action: AppAction.READ },
    { resource: AppResource.INGREDIENTS, action: AppAction.READ },
    { resource: AppResource.SUPPLIERS, action: AppAction.READ },
    { resource: AppResource.SUPPLIER_PRODUCTS, action: AppAction.READ },
    { resource: AppResource.STOCK_LEVELS, action: AppAction.READ },
    { resource: AppResource.BUSINESS_DAYS, action: AppAction.READ },
    { resource: AppResource.USER_PREFERENCES, action: AppAction.MANAGE }, // eigene Prefs
    { resource: AppResource.SHIFTS, action: AppAction.READ },
    { resource: AppResource.LEAVE_REQUESTS, action: [AppAction.READ, AppAction.CREATE] },
    { resource: AppResource.LOCATIONS, action: AppAction.READ },
    { resource: AppResource.ORDER_INTERACTIONS, action: [AppAction.READ, AppAction.CREATE] },
    { resource: AppResource.TENANTS, action: AppAction.READ },
    // Tenant-Settings: lesen (z.B. um zu wissen, ob KI-Funktion aktiviert ist).
    { resource: AppResource.TENANT_SETTINGS, action: AppAction.READ },
    // KI-Wareneingang: Mitarbeitende duerfen Foto hochladen.
    { resource: AppResource.INCOMING_GOODS_EXTRACT, action: AppAction.CREATE },
    { resource: AppResource.WEBAUTHN_CREDENTIALS, action: AppAction.MANAGE },
    { resource: AppResource.WEBAUTHN_REGISTRATION, action: AppAction.CREATE },
  ],

  // =======================================================
  // DEVICE PERMISSIONS
  // =======================================================

  // 1. POS COUNTER (Stationäre Kasse)
  // Alt: USERS_READ_POS, ORDERS_FULL, PRODUCTS_READ, LOCATIONS_READ, USERS_TIME_CLOCK
  [UserSystemRole.DEVICE_POS]: [
    // Darf Kellner-Logins abrufen (USERS_READ_POS)
    { resource: AppResource.USERS, action: AppAction.READ },

    // Volle Kontrolle über Bestellungen (ORDERS_FULL)
    { resource: AppResource.ORDERS, action: AppAction.MANAGE },

    // Produkte & Menüs lesen (PRODUCTS_READ)
    { resource: AppResource.PRODUCTS, action: AppAction.READ },
    { resource: AppResource.PRODUCT_GROUPS, action: AppAction.READ },
    { resource: AppResource.LOCATIONS, action: AppAction.READ },

    // Order-Interactions (Bestellverlauf)
    { resource: AppResource.ORDER_INTERACTIONS, action: AppAction.MANAGE },

    // Kunden lesen/anlegen (für Loyalty)
    { resource: AppResource.CUSTOMERS, action: [AppAction.READ, AppAction.CREATE, AppAction.UPDATE] },

    // Vorbestellungen verwalten
    { resource: AppResource.PRE_ORDERS, action: [AppAction.CREATE, AppAction.READ, AppAction.UPDATE] },

    // Öffnungszeiten-Ausnahmen lesen (für Vorbestelldialog)
    { resource: AppResource.OPENING_HOUR_EXCEPTIONS, action: AppAction.READ },

    // Zeiterfassung erlauben (USERS_TIME_CLOCK)
    { resource: AppResource.WORKING_TIMES, action: [AppAction.CREATE, AppAction.READ, AppAction.UPDATE] },
    AppAbility.CAN_CLOCK_IN,

    // Drucken erlauben
    { resource: AppResource.PRINT_SERVER, action: AppAction.CREATE },

    // Kasse darf natürlich kassieren
    AppAbility.CAN_DISCOUNT,
    AppAbility.CAN_REFUND,
    AppAbility.CAN_VOID_ORDER,
  ],

  // 2. KITCHEN DISPLAY (KDS)
  // Alt: ORDERS_READ, ORDERS_UPDATE, PRODUCTS_READ
  [UserSystemRole.DEVICE_KDS]: [
    // Darf Bestellungen sehen und Status ändern (z.B. auf "Fertig")
    { resource: AppResource.ORDERS, action: [AppAction.READ, AppAction.UPDATE] },

    // Muss Produkte lesen können (Namen, Zutaten)
    { resource: AppResource.PRODUCTS, action: AppAction.READ },

    // Drucken erlauben (z.B. Bon nachdrucken)
    { resource: AppResource.PRINT_SERVER, action: AppAction.CREATE },

    // KDS darf KEINE neuen Orders anlegen und KEINE User sehen!
  ],

  // 3. TABLET (Mobiler Kellner)
  // Alt: ORDERS_READ, ORDERS_CREATE, PRODUCTS_READ, USERS_TIME_CLOCK
  [UserSystemRole.DEVICE_TABLET]: [
    // Darf Orders aufnehmen (Create) und sehen (Read), aber evtl. nicht löschen (Delete)
    { resource: AppResource.ORDERS, action: [AppAction.READ, AppAction.CREATE, AppAction.UPDATE] },
    { resource: AppResource.ORDER_INTERACTIONS, action: [AppAction.READ, AppAction.CREATE] },

    { resource: AppResource.PRODUCTS, action: AppAction.READ },
    { resource: AppResource.PRODUCT_GROUPS, action: AppAction.READ },
    { resource: AppResource.LOCATIONS, action: AppAction.READ },
    { resource: AppResource.USERS, action: AppAction.READ }, // Für Login

    { resource: AppResource.WORKING_TIMES, action: [AppAction.CREATE, AppAction.READ, AppAction.UPDATE] },
    AppAbility.CAN_CLOCK_IN,
  ],

  // 4. KIOSK (Selbstbedienung)
  // Ein Kiosk darf nur bestellen und bezahlen, aber NIEMALS User sehen oder stornieren.
  [UserSystemRole.DEVICE_KIOSK]: [
    // Darf Produkte und Menüs lesen (um sie anzuzeigen)
    { resource: AppResource.PRODUCTS, action: AppAction.READ },
    { resource: AppResource.PRODUCT_GROUPS, action: AppAction.READ },

    // Darf neue Bestellungen aufgeben (Create)
    { resource: AppResource.ORDERS, action: AppAction.CREATE },

    // Darf den Status seiner EIGENEN Bestellung prüfen (Read)
    { resource: AppResource.ORDERS, action: AppAction.READ },

    // Darf bezahlen (Discount/Refund verboten!)
    // Evtl. braucht er Payment-Rechte, aber das regelt meist der Payment-Provider direkt.
  ],
}
