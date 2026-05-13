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

/**
 * User-Rollen, die NIEMALS via Edge→Cloud-Sync gepusht werden duerfen.
 *
 * - `platform:*` sind Cloud-interne Identitaeten mit Tenant-Bypass — ein
 *   kompromittierter Edge koennte sonst privilegierte Cloud-User anlegen.
 * - `tenant:owner` wird vom Cloud-Admin angelegt (eigene Identitaet/E-Mail).
 *   Der Edge-`admin`-Bootstrap-User ist ein lokaler Backup-Account und
 *   gehoert nicht in die Cloud-Owner-Liste — sonst Login-Konflikte und
 *   verwirrende Doppel-Owner im Cloud-Admin-UI.
 *
 * Diese Konstante wird an drei Stellen genutzt:
 *   1. Edge-Wizard-UI: Checkbox fuer diese Rollen ist deaktiviert.
 *   2. Edge-Bootstrap-Runner: Records werden vor dem Push gefiltert
 *      (verhindert "rejected"-Failure-State trotz erwartetem Reject).
 *   3. Cloud-Sync-Receiver: zweite Verteidigungslinie, lehnt Records ab,
 *      die trotz Edge-Filter durchschlagen (Defense in Depth).
 */
export const SYNC_PUSH_BLOCKED_USER_ROLES: ReadonlySet<UserSystemRole> = new Set([
  UserSystemRole.PLATFORM_OWNER,
  UserSystemRole.PLATFORM_ADMIN,
  UserSystemRole.PLATFORM_SUPPORT,
  UserSystemRole.TENANT_OWNER,
])

export const isSyncPushBlockedRole = (role: string | undefined | null): boolean => {
  if (!role) return false
  return (SYNC_PUSH_BLOCKED_USER_ROLES as ReadonlySet<string>).has(role)
}
//#endregion

//#region Das Haupt-Datenmodell (Schema)
export const userSchema = Type.Object(
  {
    // Konsistent mit allen anderen Schemas in panary-core: uuidv7.
    _id: Type.String({ format: 'uuid' }),

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
    // Beschreibt DB-Realitaet: bcrypt-Hash (60 Zeichen). Die Plain-Text-PIN-
    // Constraint (4-6 Ziffern) gehoert in `userDataSchema`/`userPatchSchema`
    // als Input-Validierung — VOR dem hash-Resolver. Ohne diese Trennung
    // wuerde ein synchronisierter User-Record (Hash) am Ziel abgewiesen.
    posPin: Type.Optional(Type.String()),
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

    // HR: Urlaubsanspruch pro Jahr in Werktagen. Optional — wenn nicht gesetzt,
    // wird die Anspruchsberechnung im Frontend ausgeblendet ("Kein Anspruch
    // konfiguriert"). Wert gilt für den aktuellen Vertrag; Carry-over aus dem
    // Vorjahr und vertragsspezifische Anpassungen sind in v1 nicht abgebildet.
    vacationDaysPerYear: Type.Optional(Type.Number({ minimum: 0, maximum: 60 })),
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
    // Optionale Felder (haben Defaults oder sind im Schema bereits Optional).
    // `posPin` bewusst NICHT hier — wird unten mit Plain-Text-Constraint
    // ueberschrieben (Hauptschema speichert den Hash, hier validieren wir
    // den Klartext-Input).
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
        'role',
        'staffRole',
        'stampingId',
        'startBreakAt',
        'status',
        'vacationDaysPerYear',
      ]),
    ),
    // posPin als Klartext-Constraint (4-6 Ziffern) — wird vom userDataResolver
    // anschliessend zum bcrypt-Hash gewandelt und so in der DB abgelegt. Beim
    // Sync-Pull-Apply liefert die Cloud aber bereits den Hash — der ist
    // typischerweise ~60 Zeichen lang. Damit dieser Pfad nicht abgewiesen wird,
    // erlaubt die Constraint zusaetzlich Strings >= 60 Zeichen (= Hash).
    Type.Object({
      posPin: Type.Optional(
        Type.Union([
          Type.String({ minLength: 4, maxLength: 6 }), // Plain-Text-Eingabe
          Type.String({ minLength: 60 }),              // bcrypt-Hash (Sync-Pfad)
        ]),
      ),
    }),
    // Pflicht fuer Sync-Bootstrap (Edge→Cloud): Edge-Records bringen `_id`,
    // `createdAt`, `updatedAt` mit. Ohne diese Felder im Schema lehnt
    // validateData den ganzen Record ab.
    Type.Partial(Type.Pick(userSchema, ['_id', 'createdAt', 'updatedAt'])),
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
  // Pflicht fuer Sync-Pull (Cloud→Edge): Filtern nach `updatedAt > since` und
  // Sortieren nach `updatedAt` — auch fuer Admin-UI sinnvoll als Sortier-Feld.
  'updatedAt',
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
