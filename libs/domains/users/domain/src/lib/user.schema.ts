// libs/domains/users/domain/src/lib/user.schema.ts
import { querySyntax, Static, StringEnum, Type } from '@feathersjs/typebox'

//#region Enums & Konstanten (Wiederverwendbar)
export const UserStatus = {
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
  REJECTED: 'REJECTED',
} as const

export enum UserSystemRole {
  // --- Plattform Ebene (Panary Intern) ---
  PLATFORM_OWNER = 'platform:owner', // Gott-Modus
  PLATFORM_ADMIN = 'platform:admin', // Entwickler / DevOps
  PLATFORM_SUPPORT = 'platform:support', // Support-Mitarbeiter

  // --- Tenant Ebene (Kunden) ---
  TENANT_OWNER = 'tenant:owner', // Inhaber des Cafés
  TENANT_MANAGER = 'tenant:manager', // Filialleiter
  TENANT_TECHNICIAN = 'tenant:technician', // Techniker (Admin-ähnliche Rechte)
  TENANT_STAFF = 'tenant:staff', // Kellner / Kassierer

  // --- DEVICE ROLES (Maschinen-User) ---
  DEVICE_POS = 'device:pos-client', // Stationäre Kasse
  DEVICE_KDS = 'device:kds', // Küchen-Monitor
  DEVICE_TABLET = 'device:tablet', // Mobiles Bestellgerät
  DEVICE_KIOSK = 'device:kiosk', // Selbstbedienungsterminal
}

export const DiscountType = {
  PERCENT: 'percent',
  AMOUNT: 'amount',
} as const
//#endregion

//#region Das Haupt-Datenmodell (Schema)
export const userSchema = Type.Object(
  {
    // Die globale Public ID (String).
    // Ersetzt das ObjectId Objekt. Muss ein String sein!
    _id: Type.String({ pattern: '^[0-9a-fA-F]{24}$' }),

    // Cloud-Referenzen sind Strings (ehemals ObjectId)
    tenantId: Type.Union([Type.String(), Type.Null()], { default: null }),
    activeLocationId: Type.Union([Type.String(), Type.Null()], { default: null }),
    allowedLocationIds: Type.Array(Type.String()),
    stampingId: Type.Union([Type.String(), Type.Null()]),

    // Zeitstempel
    createdAt: Type.String({ format: 'date-time' }), // SQLite speichert Dates am besten als Millisekunden (Number) oder ISO-String
    updatedAt: Type.String({ format: 'date-time' }),

    // Status & Rolle
    status: StringEnum(Object.values(UserStatus)),
    role: StringEnum(Object.values(UserSystemRole), { default: UserSystemRole.TENANT_STAFF }),

    // POS Spezifika
    staffRole: Type.Optional(Type.String()), // z.B. 'waiter'
    isPosUser: Type.Optional(Type.Boolean({ default: false })),
    posPin: Type.Optional(Type.String({ minLength: 4, maxLength: 6 })), // Pattern prüfung machen wir im Validator
    hasPosPin: Type.Optional(Type.Boolean()), // Virtuelles Feld — vom externalResolver gesetzt, nie in DB gespeichert
    employeeNumber: Type.Optional(Type.String({ minLength: 6, maxLength: 6 })),

    // Persönliche Daten
    loginname: Type.String({ minLength: 2, maxLength: 30 }),
    firstName: Type.String({ default: '' }),
    lastName: Type.String({ default: '' }),
    email: Type.Optional(Type.String({ format: 'email' })),
    password: Type.String(), // Wird im API-Layer gehasht

    // Einstellungen
    allowStaffMealOrders: Type.Optional(Type.Boolean({ default: false })),
    discountDetails: Type.Optional(
      Type.Object({
        discountType: StringEnum(Object.values(DiscountType)),
        discount: Type.Number(),
      }),
    ),
    autoLogOff: Type.Optional(Type.Boolean({ default: true })),
    mustChangePassword: Type.Optional(Type.Boolean({ default: false })),

    startBreakAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    permissions: Type.Array(Type.String(), { default: [] }),
  },
  { $id: 'User', additionalProperties: false },
)

// TypeScript Typ für das volle User Objekt
export type User = Static<typeof userSchema>
//#endregion

//#region Schema für das Erstellen (POST)
// Wir picken nur die Felder, die der Client senden darf
// Beim Create erforderlich: loginname, password
// tenantId wird vom multiTenancy-Hook gesetzt, nicht vom Client
export const userDataSchema = Type.Intersect(
  [
    // Pflichtfelder beim Create
    Type.Pick(userSchema, ['loginname', 'password']),
    // Optionale Felder (haben Defaults oder sind im Schema bereits Optional)
    Type.Partial(
      Type.Pick(userSchema, [
        'tenantId',
        'activeLocationId',
        'allowStaffMealOrders',
        'allowedLocationIds',
        'autoLogOff',
        'discountDetails',
        'email',
        'employeeNumber',
        'firstName',
        'isPosUser',
        'lastName',
        'mustChangePassword',
        'permissions',
        'posPin',
        'role',
        'staffRole',
        'stampingId',
        'startBreakAt',
      ]),
    ),
  ],
  { $id: 'UserData', additionalProperties: false },
)
export type UserData = Static<typeof userDataSchema>
//#endregion

//#region Schema für Updates (PATCH)
export const userPatchSchema = Type.Partial(userDataSchema, {
  $id: 'UserPatch',
})
export type UserPatch = Static<typeof userPatchSchema>
//#endregion

//#region Schema für Suchanfragen (Query)
export const userQueryProperties = Type.Pick(
  userSchema,
  [
  '_id',
  'tenantId',
  'activeLocationId',
  'email',
  'employeeNumber',
  'firstName',
  'lastName',
  'loginname',
  'role',
  'staffRole',
  'isPosUser',
  'stampingId',
  'status',
])
export const userQuerySchema = Type.Intersect(
  [
    querySyntax(userQueryProperties),
    // Zusätzliche Filter hier erlauben falls nötig
    Type.Object({}, { additionalProperties: false }),
  ],
  { additionalProperties: false },
)

export type UserQuery = Static<typeof userQuerySchema>
//#endregion
