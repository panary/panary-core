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
 * Vertragstyp eines Mitarbeiters. Wird vom Soll-/Ist-Vergleich in der
 * Personalzeit-Statistik und perspektivisch vom Stundenkonto im POS-Edge
 * gelesen. Werte sind UI-agnostisch (Anzeige-Labels in der Cloud-Admin-UI).
 */
export const ContractType = {
  FULLTIME: 'FULLTIME',
  PARTTIME: 'PARTTIME',
  MINIJOB: 'MINIJOB',
  SEASONAL: 'SEASONAL',
} as const
export type ContractType = (typeof ContractType)[keyof typeof ContractType]

/**
 * Vertrags-Sub-Schema. Wird als optionales Feld `contract` in `userSchema`
 * eingebettet und unten als `UserContract`-Typ re-exportiert, damit Konsumenten
 * (Soll-/Ist-Berechnung in panary-cloud, Stundenkonto im POS-Edge) das Modell
 * isoliert importieren koennen.
 */
export const userContractSchema = Type.Object({
  contractType: StringEnum(Object.values(ContractType)),
  /** Vertragliche Wochenstunden (0–60). Vollzeit typisch 40. */
  hoursPerWeek: Type.Number({ minimum: 0, maximum: 60 }),
  /**
   * Tagesplan in Stunden je Wochentag — Reihenfolge Mo, Di, Mi, Do, Fr, Sa, So.
   * Wenn gesetzt, ist der Tagesplan verbindlich; sonst wird hoursPerWeek/5 auf
   * Mo–Fr verteilt (Wochenende = 0). Beispiele:
   *   [8, 8, 8, 8, 8, 0, 0] — Vollzeit klassisch
   *   [8, 8, 0, 8, 4, 0, 0] — Teilzeit (Mi frei, Fr halb)
   *   [6, 6, 6, 6, 6, 6, 0] — 36h-Woche Mo–Sa
   */
  targetHoursPerDay: Type.Optional(
    Type.Array(Type.Number({ minimum: 0, maximum: 24 }), { minItems: 7, maxItems: 7 }),
  ),
  contractStartDate: Type.Optional(Type.String({ format: 'date' })),
  contractEndDate: Type.Optional(Type.String({ format: 'date' })),
})
export type UserContract = Static<typeof userContractSchema>

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

/**
 * User-Felder, die geraetelokaler, transienter Time-Clock-Runtime-Zustand sind
 * und NIEMALS ueber Edge<->Cloud synchronisiert werden duerfen:
 *
 * - `stampingId`:   Referenz auf den aktiven working-time-Eintrag (Einstempelung).
 * - `startBreakAt`: Zeitpunkt des Pausenbeginns (gesetzt = User ist in Pause).
 *
 * Grund: Diese Felder werden ausschliesslich am Edge gesetzt/geleert (Kommen/
 * Gehen/Pause am POS). Werden sie mitsynchronisiert, entsteht ein Deadlock —
 * der Cloud-`stripNullsExcept`-Hook verwirft `null`-Clears, und der
 * bedingungslose Pull-Apply (kein Last-Write-Wins) holt den alten Wert zurueck,
 * sodass sich der Pausen-/Stempel-Status vom Edge aus nie mehr beenden laesst.
 * Die fachliche Pausen-/Arbeitszeit-Historie liegt in `working-times` (eigener
 * Sync-Pfad), nicht in diesen Runtime-Pointern.
 *
 * Genutzt von: Edge-Outbox-Recorder (Push-Payload) + Edge-Sync-Pull-Apply.
 */
export const USER_EDGE_LOCAL_FIELDS = ['stampingId', 'startBreakAt'] as const

/**
 * Entfernt die geraetelokalen Time-Clock-Felder ([[USER_EDGE_LOCAL_FIELDS]]) aus
 * einem User-Record, bevor er Edge<->Cloud synchronisiert wird. Mutiert eine
 * flache Kopie und gibt sie zurueck — das Original bleibt unangetastet.
 */
export const stripUserEdgeLocalFields = <T extends Record<string, unknown>>(record: T): T => {
  const copy = { ...record }
  for (const field of USER_EDGE_LOCAL_FIELDS) {
    delete copy[field]
  }
  return copy
}
//#endregion

//#region Das Haupt-Datenmodell (Schema)
export const userSchema = Type.Object(
  {
    // Konsistent mit allen anderen Schemas in panary-core: uuidv7.
    _id: Type.String({ format: 'uuid' }),

    // Cloud-Referenzen sind Strings (ehemals ObjectId)
    tenantId: Type.Union([Type.String(), Type.Null()], { default: null }),
    // Referenz auf die globale Identitaet (accounts-Collection, nur Cloud). Bei
    // POS-PIN-Personal `null` (tenant-lokal, kein E-Mail-Login). Am Edge ignoriert
    // (Edge-User-Doc bleibt flach mit eigenem email/password). MUSS hier deklariert
    // sein, weil `additionalProperties:false` sonst per Pull projizierte Memberships
    // mit accountId ablehnen wuerde.
    accountId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    activeLocationId: Type.Union([Type.String(), Type.Null()], { default: null }),
    allowedLocationIds: Type.Array(Type.String({ format: 'uuid' }), { maxItems: 200 }),
    stampingId: Type.Union([Type.String(), Type.Null()]),

    // Zeitstempel
    createdAt: Type.String({ format: 'date-time' }), // SQLite speichert Dates am besten als Millisekunden (Number) oder ISO-String
    updatedAt: Type.String({ format: 'date-time' }),

    // Status & Rolle
    status: StringEnum(Object.values(UserStatus)),
    role: StringEnum(Object.values(UserSystemRole), { default: UserSystemRole.TENANT_STAFF }),

    // POS Spezifika
    staffRole: Type.Optional(Type.String({ maxLength: 50 })), // z.B. 'waiter'
    isPosUser: Type.Optional(Type.Boolean({ default: false })),
    // Beschreibt DB-Realitaet: bcrypt-Hash (60 Zeichen). Die Plain-Text-PIN-
    // Constraint (4-6 Ziffern) gehoert in `userDataSchema`/`userPatchSchema`
    // als Input-Validierung — VOR dem hash-Resolver. Ohne diese Trennung
    // wuerde ein synchronisierter User-Record (Hash) am Ziel abgewiesen.
    posPin: Type.Optional(Type.String({ maxLength: 72 })),
    hasPosPin: Type.Optional(Type.Boolean()), // Virtuelles Feld — vom externalResolver gesetzt, nie in DB gespeichert
    // MFA-Enrollment-Timestamp (OoS-Welle B Item 3): wird vom webauthn-
    // credentials-after-create-Hook gesetzt, sobald der User die erste
    // WebAuthn-Credential registriert. Genutzt vom enforce-mfa-Hook zur
    // Grace-Period-Bestimmung — User mit gesetztem Wert gilt als MFA-faehig.
    mfaEnrolledAt: Type.Optional(Type.String({ format: 'date-time' })),
    employeeNumber: Type.Optional(Type.String({ minLength: 6, maxLength: 6 })),

    // Persönliche Daten
    // loginname ist seit der E-Mail-Identitaets-Umstellung nur noch ein
    // optionaler Anzeige-/Audit-Handle (kein Login-Identifier mehr, keine
    // Uniqueness). Wird serverseitig aus Vor-/Nachname generiert, falls leer.
    loginname: Type.Optional(Type.String({ minLength: 2, maxLength: 30 })),
    firstName: Type.String({ default: '', maxLength: 100 }),
    lastName: Type.String({ default: '', maxLength: 100 }),
    email: Type.Optional(Type.String({ format: 'email', maxLength: 254 })),
    // Optional: Cloud-Membership traegt kein Passwort (liegt am `account`); das
    // flache Edge-User-Doc bekommt den bcrypt-Hash per Sync-Projektion. NICHT
    // entfernen — sonst bricht die Edge-Validierung des projizierten Docs.
    password: Type.Optional(Type.String({ maxLength: 72 })), // Wird im API-Layer gehasht

    // Einstellungen
    allowStaffMealOrders: Type.Optional(Type.Boolean({ default: false })),
    discountDetails: Type.Optional(
      Type.Object({
        discountType: StringEnum(Object.values(DiscountType)),
        discount: Type.Number({ minimum: 0 }),
      }),
    ),
    autoLogOff: Type.Optional(Type.Boolean({ default: true })),
    mustChangePassword: Type.Optional(Type.Boolean({ default: false })),

    startBreakAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    permissions: Type.Array(Type.String({ maxLength: 80 }), { default: [], maxItems: 100 }),

    // HR: Urlaubsanspruch pro Jahr in Werktagen. Optional — wenn nicht gesetzt,
    // wird die Anspruchsberechnung im Frontend ausgeblendet ("Kein Anspruch
    // konfiguriert"). Wert gilt für den aktuellen Vertrag; Carry-over aus dem
    // Vorjahr und vertragsspezifische Anpassungen sind in v1 nicht abgebildet.
    vacationDaysPerYear: Type.Optional(Type.Number({ minimum: 0, maximum: 60 })),

    // HR: Vertragsdaten — Single Source of Truth fuer Soll-/Ist-Vergleich
    // (Cloud-Admin-Personalzeitstatistik) und perspektivisch Stundenkonto im
    // POS-Edge. Optional: bestehende Tenants laufen ohne Vertragsmodell weiter,
    // in der Stats-UI erscheint dann "—" in der Soll-Spalte.
    contract: Type.Optional(userContractSchema),
  },
  { $id: 'User', additionalProperties: false },
)

// TypeScript Typ für das volle User Objekt
export type User = Static<typeof userSchema>
//#endregion

//#region Schema für das Erstellen (POST)
// Wir picken nur die Felder, die der Client senden darf.
// Seit der Identitaets-Umstellung (E-Mail-Login + accounts/Membership-Split) ist
// KEIN Feld mehr Client-Pflicht beim Create: `loginname` wird serverseitig
// generiert, `password` lebt am `account` (Cloud) bzw. kommt per Sync-Projektion
// (Edge), `accountId`/`tenantId` werden serverseitig gestempelt.
export const userDataSchema = Type.Intersect(
  [
    // Optionale Felder (haben Defaults oder sind im Schema bereits Optional).
    // `posPin` bewusst NICHT hier — wird unten mit Plain-Text-Constraint
    // ueberschrieben (Hauptschema speichert den Hash, hier validieren wir
    // den Klartext-Input).
    Type.Partial(
      Type.Pick(userSchema, [
        'loginname',
        'password',
        'accountId',
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
        'contract',
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
          Type.String({ minLength: 60, maxLength: 72 }),              // bcrypt-Hash (Sync-Pfad)
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
  // Pflicht fuer den Account-Login-Lookup (Cloud): `users.find({ accountId })`
  // listet alle Memberships einer Identitaet fuer den Tenant-Picker.
  'accountId',
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
// `$or` wird über Property-Spread an die `querySyntax`-Ausgabe gehängt — die
// Intersect-Variante mit zusätzlichem `Type.Object({$or})` produzierte unter
// TS 6.x ein "type instantiation is excessively deep" (TS2589) im
// `getValidator`-Konsumer. Flat-Object ist semantisch identisch und unter
// dem Tiefen-Limit. AJV validiert `$or`-Items ohnehin lose, daher `Type.Any()`.
const _userQueryBase = querySyntax(userQueryProperties)
export const userQuerySchema = Type.Object(
  {
    ..._userQueryBase.properties,
    $or: Type.Optional(Type.Array(Type.Any())),
  },
  { additionalProperties: false },
)

export type UserQuery = Static<typeof userQuerySchema>
//#endregion
