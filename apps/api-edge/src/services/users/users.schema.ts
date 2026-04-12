// apps/api-edge/src/services/users/users.schema.ts
import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import { passwordHash } from '@feathersjs/authentication-local'
import { uuidv7 } from 'uuidv7'
import bcrypt from 'bcryptjs'
import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '../../validators'
import { logger } from '../../logger'

// Import domain schema
import { userDataSchema, userPatchSchema, userQuerySchema, userSchema, User, UserQuery, UserSystemRole } from '@panary-core/users/domain'
import { UserService } from './users.class'

//#region 1. Main User Resolver (Output)
export const userValidator = getValidator(userSchema, dataValidator)
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
export const userDataResolver = resolve<User, HookContext<UserService>>({
  _id: async value => {
    // IMPORTANT FOR OFFLINE-FIRST:
    // If the tablet/cash register was offline, it has already generated the ID (UUIDv7) locally and sends it in the body.
    // In this case, we accept the value ('value'), otherwise we generate a new ID.
    return value || uuidv7()
  },

  // Automatic password hashing
  password: passwordHash({ strategy: 'local' }),

  // Set timestamp
  createdAt: async () => new Date().toISOString(),
  updatedAt: async () => new Date().toISOString(),

  // POS-PIN hashen (bcrypt, Cost Factor 6 — niedrig, da nur 4-6 Ziffern)
  posPin: async (value: any) => {
    if (!value) return value
    return bcrypt.hashSync(value, 6)
  },

  // Automatisch die Location zuweisen (Edge-Modus: eine Location)
  // Fallback-Kette: 1. expliziter Wert, 2. Location des Erstellers, 3. erste Location aus DB
  activeLocationId: async (value: any, data: any, context: HookContext) => {
    if (value) return value
    const fromUser = context.params.user?.activeLocationId || context.params.user?.locationId
    if (fromUser) return fromUser
    try {
      const locations: any = await context.app.service('locations').find({ query: { $limit: 1, $select: ['_id'] }, paginate: false })
      const list = Array.isArray(locations) ? locations : (locations.data ?? [])
      return list[0]?._id || null
    } catch {
      return null
    }
  },
  allowedLocationIds: async (value: any, data: any, context: HookContext) => {
    if (value && Array.isArray(value) && value.length > 0) return value
    const fromUser = context.params.user?.activeLocationId || context.params.user?.locationId
    if (fromUser) return [fromUser]
    try {
      const locations: any = await context.app.service('locations').find({ query: { $limit: 1, $select: ['_id'] }, paginate: false })
      const list = Array.isArray(locations) ? locations : (locations.data ?? [])
      return list[0]?._id ? [list[0]._id] : []
    } catch {
      return []
    }
  },

  // Generate personnel number
  employeeNumber: async (value, user, context) => {
    if (value) return value // When a number has been sent, we accept it.

    // Help function for 6-digit numbers
    const generateNumber = () => String(Math.floor(100000 + Math.random() * 900000))

    let employeeNumber = generateNumber()
    let attempts = 0

    // Check whether number already exists (max. 10 attempts)
    while (attempts < 10) {
      const existing = (await context.app.service('users').find({
        query: { employeeNumber, $limit: 1 },
        paginate: false
      })) as User[]

      if (existing.length === 0) break
      employeeNumber = generateNumber()
      attempts++
    }

    return employeeNumber
  }
})
//#endregion

//#region 3. Patch-User-Resolver (Update / PATCH)
export const userPatchValidator = getValidator(userPatchSchema, dataValidator)
export const userPatchResolver = resolve<User, HookContext<UserService>>({
  _id: async () => undefined,
  tenantId: async () => undefined,
  createdAt: async () => undefined,
  updatedAt: async () => new Date().toISOString(),
  // Auch beim Update: Passwort hashen, falls es geändert wird
  password: passwordHash({ strategy: 'local' }),
  // POS-PIN hashen, falls er geändert wird
  posPin: async (value: any) => {
    if (!value) return value
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
  // Sicherheit: Nicht-privilegierte User sehen nur sich selbst
  // Device-Rollen (device:pos, device:tablet etc.) sind ausgenommen —
  // sie brauchen die volle User-Liste fuer den Login-Screen.
  // RBAC (authorize + roles.matrix) steuert bereits, was Devices lesen duerfen.
  _id: async (value, user, context) => {
    if (
      context.params.user &&
      !privilegedRoles.includes(context.params.user.role) &&
      !context.params.user.role?.startsWith('device:')
    ) {
      logger.debug({
        message: '[Security] userQueryResolver: Query auf eigene _id eingeschraenkt',
        event: 'security.query_restricted',
        userId: context.params.user._id,
        userRole: context.params.user.role,
        service: context.path,
        method: context.method,
      })
      return context.params.user._id
    }
    return value
  }
})
//#endregion
