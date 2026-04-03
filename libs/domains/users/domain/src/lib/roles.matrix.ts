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
    { resource: AppResource.SYSTEM, action: AppAction.MANAGE },
    { resource: AppResource.USERS, action: AppAction.MANAGE },
  ],

  [UserSystemRole.PLATFORM_ADMIN]: [
    // Definieren wir erstmal leer oder mit Basis-Rechten
    { resource: AppResource.USERS, action: AppAction.READ },
  ],

  [UserSystemRole.PLATFORM_SUPPORT]: [
    { resource: AppResource.USERS, action: AppAction.READ },
    { resource: AppResource.ORDERS, action: AppAction.READ },
    { resource: AppResource.PRODUCTS, action: AppAction.READ },
    { resource: AppResource.SYSTEM, action: AppAction.READ },
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
    AppAbility.CAN_SEE_REPORTS,
    AppAbility.CAN_REFUND,
    AppAbility.CAN_VOID_ORDER,
  ],

  [UserSystemRole.TENANT_MANAGER]: [
    { resource: AppResource.PRODUCTS, action: AppAction.MANAGE },
    { resource: AppResource.PRODUCT_GROUPS, action: AppAction.READ },
    { resource: AppResource.ORDERS, action: [AppAction.CREATE, AppAction.READ, AppAction.DELETE] },
    { resource: AppResource.WORKING_TIMES, action: [AppAction.READ, AppAction.UPDATE] },
    { resource: AppResource.PRE_ORDERS, action: AppAction.MANAGE },
    { resource: AppResource.PRINT_SERVER, action: [AppAction.READ, AppAction.UPDATE] },
    { resource: AppResource.APIKEYS, action: AppAction.READ },
    AppAbility.CAN_VOID_ORDER,
  ],

  [UserSystemRole.TENANT_STAFF]: [
    { resource: AppResource.PRODUCTS, action: AppAction.READ },
    { resource: AppResource.PRODUCT_GROUPS, action: AppAction.READ },
    { resource: AppResource.ORDERS, action: [AppAction.CREATE, AppAction.READ] },
    { resource: AppResource.WORKING_TIMES, action: AppAction.READ },
    { resource: AppResource.PRE_ORDERS, action: [AppAction.CREATE, AppAction.READ, AppAction.UPDATE] },
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
