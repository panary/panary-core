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
    { resource: AppResource.TENANT_GRANTS, action: AppAction.MANAGE },
    { resource: AppResource.WEBAUTHN_CREDENTIALS, action: AppAction.MANAGE },
    { resource: AppResource.WEBAUTHN_REGISTRATION, action: AppAction.CREATE },
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
    { resource: AppResource.TENANT_GRANTS, action: AppAction.READ },
    { resource: AppResource.WEBAUTHN_CREDENTIALS, action: AppAction.MANAGE },
    { resource: AppResource.WEBAUTHN_REGISTRATION, action: AppAction.CREATE },
  ],

  [UserSystemRole.PLATFORM_SUPPORT]: [
    // Pro-Tenant Opt-in via Impersonation. Always-on nur Selbst-Verwaltung + Lese-Basics.
    { resource: AppResource.USERS, action: AppAction.READ },
    { resource: AppResource.ORDERS, action: AppAction.READ },
    { resource: AppResource.PRODUCTS, action: AppAction.READ },
    { resource: AppResource.SYSTEM, action: AppAction.READ },
    { resource: AppResource.PLATFORM_TENANTS, action: AppAction.READ },
    { resource: AppResource.PLATFORM_IMPERSONATION, action: AppAction.CREATE },
    { resource: AppResource.PLATFORM_IMPERSONATION_EVENTS, action: AppAction.READ },
    { resource: AppResource.PLATFORM_USER_PREFERENCES, action: AppAction.MANAGE },
    { resource: AppResource.PLATFORM_SYSTEM_HEALTH, action: AppAction.READ },
    // Support hat keinen READ auf platform-business-metrics — Globalblick bleibt Owner/Admin.
    { resource: AppResource.PLATFORM_TENANT_HEALTH, action: AppAction.READ },
    // Support liest Alerts und kann sie quittieren (acknowledge), aber nicht loeschen.
    { resource: AppResource.PLATFORM_ALERTS, action: [AppAction.READ, AppAction.UPDATE] },
    { resource: AppResource.TENANT_GRANTS, action: AppAction.READ },
    { resource: AppResource.WEBAUTHN_CREDENTIALS, action: AppAction.MANAGE },
    { resource: AppResource.WEBAUTHN_REGISTRATION, action: AppAction.CREATE },
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
    // Cloud-spezifische Ressourcen
    { resource: AppResource.CORPORATE_CUSTOMERS, action: AppAction.MANAGE },
    { resource: AppResource.CUSTOMERS, action: AppAction.MANAGE },
    { resource: AppResource.RECIPES, action: AppAction.MANAGE },
    { resource: AppResource.INGREDIENTS, action: AppAction.MANAGE },
    { resource: AppResource.PRICELISTS, action: AppAction.MANAGE },
    { resource: AppResource.INVENTORIES, action: AppAction.MANAGE },
    { resource: AppResource.INCOMING_GOODS, action: AppAction.MANAGE },
    { resource: AppResource.WRITE_OFFS, action: AppAction.MANAGE },
    { resource: AppResource.INVOICES, action: AppAction.MANAGE },
    { resource: AppResource.BUSINESS_DAYS, action: AppAction.MANAGE },
    { resource: AppResource.USER_PREFERENCES, action: AppAction.MANAGE },
    { resource: AppResource.DEVICES, action: AppAction.MANAGE },
    { resource: AppResource.SHIFTS, action: AppAction.MANAGE },
    { resource: AppResource.LEAVE_REQUESTS, action: AppAction.MANAGE },
    { resource: AppResource.LOCATIONS, action: AppAction.MANAGE },
    { resource: AppResource.ORDER_INTERACTIONS, action: AppAction.MANAGE },
    { resource: AppResource.ORGANIZATIONS, action: AppAction.READ },
    { resource: AppResource.TENANT_GRANTS, action: AppAction.MANAGE },
    { resource: AppResource.WEBAUTHN_CREDENTIALS, action: AppAction.MANAGE },
    { resource: AppResource.WEBAUTHN_REGISTRATION, action: AppAction.CREATE },
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
    { resource: AppResource.LOCATIONS, action: AppAction.MANAGE },
    { resource: AppResource.SYSTEM, action: AppAction.MANAGE },
    // Cloud-spezifische Ressourcen
    { resource: AppResource.CORPORATE_CUSTOMERS, action: AppAction.MANAGE },
    { resource: AppResource.CUSTOMERS, action: AppAction.MANAGE },
    { resource: AppResource.RECIPES, action: AppAction.MANAGE },
    { resource: AppResource.INGREDIENTS, action: AppAction.MANAGE },
    { resource: AppResource.PRICELISTS, action: AppAction.MANAGE },
    { resource: AppResource.INVENTORIES, action: AppAction.MANAGE },
    { resource: AppResource.INCOMING_GOODS, action: AppAction.MANAGE },
    { resource: AppResource.WRITE_OFFS, action: AppAction.MANAGE },
    { resource: AppResource.INVOICES, action: AppAction.MANAGE },
    { resource: AppResource.BUSINESS_DAYS, action: AppAction.MANAGE },
    { resource: AppResource.USER_PREFERENCES, action: AppAction.MANAGE },
    { resource: AppResource.DEVICES, action: AppAction.MANAGE },
    { resource: AppResource.SHIFTS, action: AppAction.MANAGE },
    { resource: AppResource.LEAVE_REQUESTS, action: AppAction.MANAGE },
    { resource: AppResource.ORDER_INTERACTIONS, action: AppAction.MANAGE },
    { resource: AppResource.WEBAUTHN_CREDENTIALS, action: AppAction.MANAGE },
    { resource: AppResource.WEBAUTHN_REGISTRATION, action: AppAction.CREATE },
    AppAbility.CAN_SEE_REPORTS,
    AppAbility.CAN_REFUND,
    AppAbility.CAN_VOID_ORDER,
    AppAbility.CAN_MANAGE_TIME,
    AppAbility.CAN_SEE_POS_PIN,
    AppAbility.CAN_READ_SENSITIVE_USER_DATA,
  ],

  [UserSystemRole.TENANT_MANAGER]: [
    { resource: AppResource.PRODUCTS, action: AppAction.MANAGE },
    { resource: AppResource.PRODUCT_GROUPS, action: AppAction.READ },
    { resource: AppResource.ORDERS, action: [AppAction.CREATE, AppAction.READ, AppAction.DELETE] },
    { resource: AppResource.WORKING_TIMES, action: [AppAction.READ, AppAction.UPDATE] },
    { resource: AppResource.PRE_ORDERS, action: AppAction.MANAGE },
    { resource: AppResource.PRINT_SERVER, action: [AppAction.READ, AppAction.UPDATE] },
    { resource: AppResource.APIKEYS, action: AppAction.READ },
    // Cloud-spezifische Ressourcen
    { resource: AppResource.CORPORATE_CUSTOMERS, action: AppAction.MANAGE },
    { resource: AppResource.CUSTOMERS, action: AppAction.MANAGE },
    { resource: AppResource.RECIPES, action: AppAction.READ },
    { resource: AppResource.INGREDIENTS, action: AppAction.READ },
    { resource: AppResource.PRICELISTS, action: AppAction.MANAGE },
    { resource: AppResource.INVENTORIES, action: AppAction.MANAGE },
    { resource: AppResource.INCOMING_GOODS, action: AppAction.MANAGE },
    { resource: AppResource.WRITE_OFFS, action: AppAction.MANAGE },
    { resource: AppResource.INVOICES, action: [AppAction.READ, AppAction.UPDATE] },
    { resource: AppResource.BUSINESS_DAYS, action: AppAction.MANAGE },
    { resource: AppResource.USER_PREFERENCES, action: AppAction.MANAGE },
    { resource: AppResource.SHIFTS, action: AppAction.MANAGE },
    { resource: AppResource.LEAVE_REQUESTS, action: [AppAction.READ, AppAction.UPDATE] },
    { resource: AppResource.LOCATIONS, action: AppAction.READ },
    { resource: AppResource.ORDER_INTERACTIONS, action: AppAction.MANAGE },
    { resource: AppResource.WEBAUTHN_CREDENTIALS, action: AppAction.MANAGE },
    { resource: AppResource.WEBAUTHN_REGISTRATION, action: AppAction.CREATE },
    AppAbility.CAN_VOID_ORDER,
  ],

  [UserSystemRole.TENANT_STAFF]: [
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
    { resource: AppResource.BUSINESS_DAYS, action: AppAction.READ },
    { resource: AppResource.USER_PREFERENCES, action: AppAction.MANAGE }, // eigene Prefs
    { resource: AppResource.SHIFTS, action: AppAction.READ },
    { resource: AppResource.LEAVE_REQUESTS, action: [AppAction.READ, AppAction.CREATE] },
    { resource: AppResource.LOCATIONS, action: AppAction.READ },
    { resource: AppResource.ORDER_INTERACTIONS, action: [AppAction.READ, AppAction.CREATE] },
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
