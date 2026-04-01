// apps/api-edge/src/services/users/users.schema.ts
import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import { passwordHash } from '@feathersjs/authentication-local'
import { uuidv7 } from 'uuidv7'
import type { HookContext } from '../../declarations'
import { dataValidator, queryValidator } from '../../validators'

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
  // NEVER send the password back to the client!
  password: async () => undefined
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
  password: passwordHash({ strategy: 'local' })
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
  _id: async (value, user, context) => {
    if (
      context.params.user &&
      !privilegedRoles.includes(context.params.user.role)
    ) {
      return context.params.user._id
    }
    return value
  }
})
//#endregion
