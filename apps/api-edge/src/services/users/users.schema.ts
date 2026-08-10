// apps/api-edge/src/services/users/users.schema.ts
import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import { passwordHash } from '@feathersjs/authentication-local'
import { uuidv7 } from 'uuidv7'
import { randomInt } from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '@panary/shared-backend'
import { logger } from '@panary/shared-backend'

// Import domain schema
import { userDataSchema, userPatchSchema, userQuerySchema, User, UserQuery, UserSystemRole } from '@panary/users/domain'
import { intersectAllowedIds } from '@panary/devices/domain'
import { UserService } from './users.class'
import { getDeviceAccessScope } from '../../hooks/device-access-mode.util'

//#region 1. Main User Resolver (Output)
export const userResolver = resolve<User, HookContext<UserService>>({
  // Passwort-Feld NICHT hier entfernen — das macht der externalResolver.
  // Der userResolver läuft auch bei internen Aufrufen (z.B. LocalStrategy),
  // die das Passwort für den bcrypt-Vergleich brauchen.
})
export const userExternalResolver = resolve<User, HookContext<UserService>>({
  // Sensible Felder NIEMALS an den Client senden!
  password: async () => undefined,
  // PIN-Hash nie senden, aber Hinweis ob ein PIN gesetzt ist
  posPin: async () => undefined,
  hasPosPin: async (value: any, user: any) => !!user.posPin,
})
//#endregion

//#region Create User Resolver (Input / POST)
export const userDataValidator = getValidator(userDataSchema, dataValidator)

// Modul-Scope: passwordHash-Resolver einmal instanziieren — beim Sync-Apply
// rufen wir ihn NICHT auf, sonst wuerde der bereits gehashte Cloud-Wert
// noch einmal gehashed (hash-of-hash → Login broken).
const _passwordHashFn = passwordHash({ strategy: 'local' })

// Helper: erkennt sync-replikative Aufrufe (Pull-Apply / Bootstrap).
// Worker setzen `params.fromSync = true`, damit Auto-Generation und Re-Hash
// von der Sync-Seite uebersprungen wird.
const isFromSync = (context: HookContext): boolean => Boolean((context.params as { fromSync?: boolean }).fromSync)

export const userDataResolver = resolve<User, HookContext<UserService>>({
  _id: async (value, _row, context) => {
    if (isFromSync(context)) return value
    // IMPORTANT FOR OFFLINE-FIRST:
    // If the tablet/cash register was offline, it has already generated the ID (UUIDv7) locally and sends it in the body.
    // In this case, we accept the value ('value'), otherwise we generate a new ID.
    return value || uuidv7()
  },

  // Automatic password hashing — beim Sync ueberspringen (Hash kommt aus Cloud).
  password: async (value, row, context) => {
    if (!value) return value
    if (isFromSync(context)) return value
    return _passwordHashFn(value, row, context)
  },

  // Set timestamp — beim Sync den Cloud-Wert uebernehmen, sonst broken
  // updatedAt-Vergleich beim naechsten Pull (LWW-Logik).
  createdAt: async (value, _row, context) => (isFromSync(context) ? value : new Date().toISOString()),
  updatedAt: async (value, _row, context) => (isFromSync(context) ? value : new Date().toISOString()),

  // POS-PIN hashen (bcrypt, Cost Factor 6 — niedrig, da nur 4-6 Ziffern).
  // Sync-Apply: nicht hashen — Cloud sendet bereits den Hash.
  posPin: async (value: any, _row: any, context: HookContext) => {
    if (!value) return value
    if (isFromSync(context)) return value
    return bcrypt.hashSync(value, 6)
  },

  // Automatisch die Location zuweisen (Edge-Modus: eine Location)
  // Fallback-Kette: 1. expliziter Wert, 2. Location des Erstellers, 3. erste Location aus DB
  activeLocationId: async (value: any, data: any, context: HookContext) => {
    if (isFromSync(context)) return value
    if (value) return value
    const fromUser = context.params.user?.activeLocationId || context.params.user?.locationId
    if (fromUser) return fromUser
    try {
      const locations: any = await context.app
        .service('locations')
        .find({ query: { $limit: 1, $select: ['_id'] }, paginate: false })
      const list = Array.isArray(locations) ? locations : (locations.data ?? [])
      return list[0]?._id || null
    } catch {
      return null
    }
  },
  allowedLocationIds: async (value: any, data: any, context: HookContext) => {
    if (isFromSync(context)) return value
    if (value && Array.isArray(value) && value.length > 0) return value
    const fromUser = context.params.user?.activeLocationId || context.params.user?.locationId
    if (fromUser) return [fromUser]
    try {
      const locations: any = await context.app
        .service('locations')
        .find({ query: { $limit: 1, $select: ['_id'] }, paginate: false })
      const list = Array.isArray(locations) ? locations : (locations.data ?? [])
      return list[0]?._id ? [list[0]._id] : []
    } catch {
      return []
    }
  },

  // Generate personnel number
  employeeNumber: async (value, user, context) => {
    if (isFromSync(context)) return value
    if (value) return value // When a number has been sent, we accept it.

    // Kryptografisch sichere 6-stellige Zahl — employeeNumber ist Sole-Credential
    // fuer Time-Clock-Aktionen, daher kein Math.random() (vorhersagbar/seedbar).
    const generateNumber = () => String(randomInt(100000, 1_000_000))

    let employeeNumber = generateNumber()
    let attempts = 0

    // Check whether number already exists (max. 10 attempts)
    while (attempts < 10) {
      const existing = (await context.app.service('users').find({
        query: { employeeNumber, $limit: 1 },
        paginate: false,
      })) as User[]

      if (existing.length === 0) break
      employeeNumber = generateNumber()
      attempts++
    }

    return employeeNumber
  },
})
//#endregion

//#region 3. Patch-User-Resolver (Update / PATCH)
export const userPatchValidator = getValidator(userPatchSchema, dataValidator)
export const userPatchResolver = resolve<User, HookContext<UserService>>({
  // Beim Sync-Apply die Cloud-Werte (auch _id/tenantId/createdAt/updatedAt)
  // unveraendert durchreichen — sonst zerstoert das Patch-Resolver die LWW-
  // Sync-Semantik und das Konflikt-Tracking.
  _id: async (value, _row, context) => (isFromSync(context) ? value : undefined),
  tenantId: async (value, _row, context) => (isFromSync(context) ? value : undefined),
  createdAt: async (value, _row, context) => (isFromSync(context) ? value : undefined),
  updatedAt: async (value, _row, context) => (isFromSync(context) ? value : new Date().toISOString()),
  // Auch beim Update: Passwort hashen, falls es geändert wird — beim Sync NICHT.
  password: async (value, row, context) => {
    if (!value) return value
    if (isFromSync(context)) return value
    return _passwordHashFn(value, row, context)
  },
  // POS-PIN hashen, falls er geändert wird — beim Sync NICHT.
  posPin: async (value: any, _row: any, context: HookContext) => {
    if (!value) return value
    if (isFromSync(context)) return value
    return bcrypt.hashSync(value, 6)
  },
})
//#endregion

//#region 4. Query-User-Resolver (Suche / GET)
export const userQueryValidator = getValidator(userQuerySchema, queryValidator)

// Privilegierte Rollen, die alle User sehen dürfen
const privilegedRoles: string[] = [
  UserSystemRole.PLATFORM_OWNER,
  UserSystemRole.PLATFORM_ADMIN,
  UserSystemRole.PLATFORM_SUPPORT,
  UserSystemRole.TENANT_OWNER,
  UserSystemRole.TENANT_MANAGER,
]

export const userQueryResolver = resolve<UserQuery, HookContext>({
  // Sicherheit: Nicht-privilegierte User sehen nur sich selbst.
  //
  // Device-Rollen (device:pos-client, device:tablet etc.) brauchen fuer den
  // Login-Screen mehr als sich selbst — aber nicht mehr zwingend die VOLLE
  // Liste: Auf einem zugewiesenen Geraet (PNRY-FEAT-DEVICE-ASSIGNMENT-001)
  // schrumpft sie auf `assignedUserIds ∪ Freigabe-Rollen`. Weil das hier auf
  // der Query sitzt, greift es fuer `find` UND `get` — der Adapter matcht die
  // Query auch beim get-by-id, sonst waere get-by-id der Umweg um das Scoping.
  //
  // RBAC (authorize + roles.matrix) steuert weiterhin, WAS Devices lesen duerfen.
  _id: async (value, query, context) => {
    const actor = context.params.user
    if (!actor) return value
    if (privilegedRoles.includes(actor.role)) return value

    if (actor.role?.startsWith('device:')) {
      // Aufgeloest hat das der resolveDeviceAccessScope-Hook (before.all) —
      // hier darf nichts mehr werfen, Feathers wuerde es zu einem
      // nichtssagenden 400 „Error resolving data" verpacken.
      const allowedIds = getDeviceAccessScope(context)
      if (allowedIds === null) return value

      logger.debug({
        message: '[Security] userQueryResolver: Query auf zugewiesene Mitarbeiter eingeschraenkt',
        event: 'security.query_restricted_device_assignment',
        userRole: actor.role,
        service: context.path,
        method: context.method,
        allowedCount: allowedIds.length,
      })
      return intersectAllowedIds(value, allowedIds)
    }

    logger.debug({
      message: '[Security] userQueryResolver: Query auf eigene _id eingeschraenkt',
      event: 'security.query_restricted',
      userId: actor._id,
      userRole: actor.role,
      service: context.path,
      method: context.method,
    })
    return actor._id
  },
})
//#endregion
