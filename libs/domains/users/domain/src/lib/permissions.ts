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
