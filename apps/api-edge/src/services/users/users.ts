// For more information about this file see https://dove.feathersjs.com/guides/cli/service.html
import { authenticate } from '@feathersjs/authentication'

import { hooks as schemaHooks } from '@feathersjs/schema'

import {
  userDataResolver,
  userDataValidator,
  userExternalResolver,
  userPatchResolver,
  userPatchValidator,
  userQueryResolver,
  userQueryValidator,
  userResolver,
} from './users.schema'

import type { Application } from '../../declarations'
import type { User } from './users.class'
import { authorize } from '@panary/shared-backend'
import { multiTenancy } from '@panary/shared-backend'
import { getJsonFieldHooks } from '@panary/shared-backend'
import { createServiceAdapter } from '@panary/shared/data-access/server'
import { restrictUserSelfPatch } from '../../hooks/restrict-user-self-patch.hook'
import { restrictPermissionGrants } from '../../hooks/restrict-permission-grants.hook'
import { restrictDeviceAccessMode } from '../../hooks/restrict-device-access-mode.hook'
import { resolveDeviceAccessScope } from '../../hooks/device-access-mode.util'
import { isLoginBlockedByStatus } from '../../utils/user-login-status'

const USER_JSON_FIELDS = ['discountDetails', 'allowedLocationIds', 'permissions']
import { DatabaseType } from '@panary/shared-common'
import { BadRequest, Conflict, Forbidden, NotAuthenticated, TooManyRequests } from '@feathersjs/errors'
import bcrypt from 'bcryptjs'
import { checkChangePinRequest } from '@panary/users/domain'
import { clearPinFailures, getPinLockoutSeconds, logger, recordPinFailure } from '@panary/shared-backend'
import { triggerImmediateCycle } from '../../workers/cloud-sync-scheduler.worker'
import { SyncRunTrigger } from '@panary/sync/domain'

export const usersPath = 'users'
export const usersMethods = [
  'find',
  'get',
  'create',
  'patch',
  'remove',
  'checkin',
  'checkout',
  'startBreak',
  'endBreak',
  'verifyPin',
  'changePin',
] as const

export type { UserService } from './users.class'
export * from './users.schema'

// A configure function that registers the service and its hooks via `app.configure`
export const users = (app: Application) => {
  const paginate = app.get('paginate')

  // 1. Determine DB type
  const systemConfig = app.get('system') || {}
  const dbType = systemConfig.dbType || DatabaseType.SQLITE

  let Model: any

  // 2. Load model (SQLite or MongoDB)
  if (dbType === DatabaseType.SQLITE) {
    Model = app.get('sqliteClient')
  } else {
    // If we are in cloud mode, we load the Mongoose model.
    // Note: The file 'users.model' may not exist in the Edge project,
    // which is okay because Edge almost always runs in SQLite mode.
    // For clean code, we could use a dynamic import here or
    // move the model to the lib. For now, the placeholder is sufficient.
    // Model = require('./users.model').default(app)
  }

  // 3. Create service instance via the factory
  // The factory directly returns a KnexService or MongoDBService instance.
  const service = createServiceAdapter<User>(app, {
    name: 'users',
    Model,
    paginate,
    id: '_id',
  }) as any

  // Custom method: checkin — creates a working-time entry and stamps the user
  service.checkin = async (data: string | { userId: string }) => {
    const userId = typeof data === 'string' ? data : data.userId
    const user = await app.service('users').get(userId, { provider: undefined })
    if (user.stampingId) throw new Conflict('Benutzer ist bereits eingestempelt')

    // Determine businessDay from the user's active location
    let businessDay: string | undefined
    try {
      if (user.activeLocationId) {
        const location = await app.service('locations').get(user.activeLocationId, { provider: undefined })
        businessDay = location.currentBusinessDay?.date
      }
    } catch {
      // Fallback: no businessDay
    }
    if (!businessDay) {
      businessDay = new Date().toISOString().slice(0, 10)
    }

    const workingTime = await app.service('working-times').create(
      {
        userId,
        businessDay,
        checkinDate: new Date().toISOString(),
        tenantId: user.tenantId,
        locationId: user.activeLocationId || null,
      } as any,
      { provider: undefined },
    )
    return app.service('users').patch(userId, { stampingId: workingTime._id }, { provider: undefined })
  }

  // Custom method: checkout — closes the working-time entry and clears the stamp
  service.checkout = async (data: string | { userId: string }) => {
    const userId = typeof data === 'string' ? data : data.userId
    const user = await app.service('users').get(userId, { provider: undefined })
    if (!user.stampingId) throw new Conflict('Benutzer ist nicht eingestempelt')
    const now = new Date().toISOString()
    await app
      .service('working-times')
      .patch(user.stampingId, { checkoutDate: now, originCheckoutDate: now }, { provider: undefined })
    return app.service('users').patch(userId, { stampingId: null, startBreakAt: null }, { provider: undefined })
  }

  // Custom method: startBreak — records break start time on the user
  service.startBreak = async (data: string | { userId: string }) => {
    const userId = typeof data === 'string' ? data : data.userId
    const user = await app.service('users').get(userId, { provider: undefined })
    if (!user.stampingId) throw new Conflict('Benutzer ist nicht eingestempelt')
    if (user.startBreakAt) throw new Conflict('Benutzer ist bereits in der Pause')
    return app.service('users').patch(userId, { startBreakAt: new Date().toISOString() }, { provider: undefined })
  }

  // Custom method: endBreak — appends break to working-time and clears break start
  service.endBreak = async (data: string | { userId: string }) => {
    const userId = typeof data === 'string' ? data : data.userId
    const user = await app.service('users').get(userId, { provider: undefined })
    if (!user.stampingId) throw new Conflict('Benutzer ist nicht eingestempelt')
    if (!user.startBreakAt) throw new Conflict('Benutzer ist nicht in der Pause')
    const workingTime = await app.service('working-times').get(user.stampingId, { provider: undefined })
    const updatedBreaks = [
      ...(Array.isArray(workingTime.breaks) ? workingTime.breaks : []),
      { from: user.startBreakAt, to: new Date().toISOString() },
    ]
    await app.service('working-times').patch(user.stampingId, { breaks: updatedBreaks }, { provider: undefined })
    return app.service('users').patch(userId, { startBreakAt: null }, { provider: undefined })
  }

  // Custom method: verifyPin — serverseitige POS-PIN-Verifizierung
  // Gibt den User (ohne sensible Felder) zurück, wenn der PIN korrekt ist.
  service.verifyPin = async (data: { userId: string; pin: string }) => {
    const { userId, pin } = data
    if (!userId || !pin) throw new NotAuthenticated('userId und pin sind erforderlich')

    // Eine 4-stellige PIN spannt nur 10.000 Kombinationen auf, bcrypt laeuft mit
    // Cost 6 — der Vollraum waere sonst in etwa einer Minute durchprobiert. Die
    // Sperre laeuft von selbst wieder aus, damit ein vertippter Mitarbeiter
    // nicht dauerhaft von der Kasse ausgesperrt wird.
    const lockedFor = getPinLockoutSeconds(userId)
    if (lockedFor !== null) {
      throw new TooManyRequests(`Zu viele Fehlversuche. Bitte in ${lockedFor} Sekunden erneut versuchen.`)
    }

    // Interner Aufruf — umgeht resolveExternal, damit posPin-Hash geladen wird
    const user = await app.service('users').get(userId, { provider: undefined })

    // #187: Nicht aktive Konten kommen auch per PIN nicht durch. Der
    // Listen-Filter (userQueryResolver) blendet sie im Login-Screen zwar aus,
    // aber `verifyPin` braucht nur eine `userId` und ist ueber den
    // Geraete-Socket direkt erreichbar — dieselbe Begruendung, aus der
    // restrict-device-access-mode.hook.ts existiert.
    //
    // Wortgleiche Meldung und mitlaufender Fehlversuchs-Zaehler wie dort: ein
    // eigener Text („Konto archiviert") waere das Oracle, das die einheitliche
    // Ablehnung gerade verhindern soll. Der Klartext-Grund steht im Log.
    if (isLoginBlockedByStatus(user)) {
      logger.warn({
        message: 'PIN-Anmeldung abgelehnt: Konto ist nicht aktiv',
        event: 'security.pin_login_inactive_user',
        entityId: userId,
        userStatus: user.status,
      })
      recordPinFailure(userId)
      throw new NotAuthenticated('PIN ungueltig')
    }

    // Einheitliche Meldung fuer "kein PIN gesetzt" und "PIN falsch": die
    // Unterscheidung waere ein Existenz-Oracle fuer jeden am Terminal.
    if (!user.posPin || !(await bcrypt.compare(pin, user.posPin))) {
      recordPinFailure(userId)
      throw new NotAuthenticated('PIN ungueltig')
    }
    clearPinFailures(userId)

    // Sensible Felder entfernen
    const { posPin: _pin, password: _pw, ...safeUser } = user as any
    return safeUser
  }

  // Custom method: changePin — POS-PIN-Selbstwechsel am Terminal.
  //
  // Braucht eine eigene Methode, weil sich der POS-Client als GERAET
  // authentifiziert (virtueller User `device:<deviceId>`, siehe
  // allowApiKey-Hook): ein regulaerer `patch` scheitert an
  // restrictUserSelfPatch (FOREIGN_RECORD), und `users:UPDATE` fuer die
  // Geraete-Rolle waere ein Freibrief fuer beliebige User-Patches.
  //
  // `currentPin` ist deshalb Pflicht — er ist die einzige Bindung an die
  // Person hinter dem Terminal.
  service.changePin = async (
    data: { userId: string; currentPin: string; newPin: string },
    params?: { user?: { _id?: string; role?: string; tenantId?: string } },
  ) => {
    const { userId, currentPin, newPin } = data ?? ({} as typeof data)

    const violation = checkChangePinRequest(params?.user, { userId, currentPin, newPin })
    if (violation) {
      if (violation.reason === 'FOREIGN_RECORD') throw new Forbidden(violation.message)
      throw new BadRequest(violation.message)
    }

    const lockedFor = getPinLockoutSeconds(userId)
    if (lockedFor !== null) {
      throw new TooManyRequests(`Zu viele Fehlversuche. Bitte in ${lockedFor} Sekunden erneut versuchen.`)
    }

    // Interner Aufruf — umgeht resolveExternal, damit der posPin-Hash geladen wird.
    const user = await app.service('users').get(userId, { provider: undefined })

    // multiTenancy() ist bei Custom-Methods ein No-Op (stempelt/filtert nur
    // create/update/patch bzw. find/get/remove) — der Tenant-Scope muss hier
    // explizit geprueft werden, sonst koennte ein Terminal einen fremden
    // Mandanten adressieren.
    const actorTenantId = (params?.user as { tenantId?: string } | undefined)?.tenantId
    if (actorTenantId && user.tenantId !== actorTenantId) {
      throw new Forbidden('Benutzer gehoert nicht zum eigenen Mandanten')
    }

    // #187: gleiche Sperre wie in verifyPin — ein nicht aktives Konto soll sich
    // auch keinen neuen PIN setzen koennen. Meldung wortgleich mit dem falschen
    // PIN unten (siehe restrict-device-access-mode.hook.ts).
    if (isLoginBlockedByStatus(user)) {
      logger.warn({
        message: 'PIN-Wechsel abgelehnt: Konto ist nicht aktiv',
        event: 'security.pin_change_inactive_user',
        entityId: userId,
        userStatus: user.status,
      })
      recordPinFailure(userId)
      throw new NotAuthenticated('Aktuelle PIN ist falsch')
    }

    if (!user.posPin || !(await bcrypt.compare(currentPin, user.posPin))) {
      recordPinFailure(userId)
      // Einheitliche Meldung: "kein PIN gesetzt" vs. "PIN falsch" waere ein
      // Existenz-Oracle fuer jeden, der am Terminal steht.
      throw new NotAuthenticated('Aktuelle PIN ist falsch')
    }
    clearPinFailures(userId)

    // Adapter-API statt rohem Knex-Write (code-style.md §6): nur so laufen
    // Validator, Resolver (bcrypt-Hashing des neuen PINs) und der
    // sync-outbox-Recorder.
    //
    // WICHTIG: hier NIEMALS `fromSync: true` mitgeben. Das wuerde
    //  a) den bcrypt-Resolver ueberspringen  -> Klartext-PIN in der DB
    //  b) den Outbox-Eintrag unterdruecken   -> der naechste Cloud-Pull holt
    //     den alten Hash zurueck und der Wechsel waere wieder weg.
    const updated = await app
      .service('users')
      .patch(userId, { posPin: newPin, mustChangePosPin: false }, { provider: undefined })

    // Push moeglichst sofort, statt bis zum naechsten Scheduler-Tick (Default
    // 300 s) zu warten: bis der neue Hash in der Cloud liegt, kann ein
    // Cloud-seitiges Update des Users den alten PIN zurueckspielen (der
    // Pull-Apply kennt kein Last-Write-Wins). Fire-and-forget — ein
    // fehlgeschlagener Sync darf den PIN-Wechsel nicht scheitern lassen,
    // der Outbox-Eintrag bleibt ohnehin bestehen.
    void triggerImmediateCycle(app, SyncRunTrigger.MANUAL).catch(() => undefined)

    const { posPin: _newPin, password: _pwd, ...safeUser } = updated as any
    return safeUser
  }

  // 4. Register the service - as any, since the Factory returns KnexService OR MongoDBService
  app.use(usersPath, service as any, {
    methods: usersMethods,
    events: [],
  })

  const jsonHooks = getJsonFieldHooks(app, USER_JSON_FIELDS)

  // 5. Register hooks
  app.service(usersPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        authorize(),
        multiTenancy({ isolateLocation: false }),

        schemaHooks.resolveExternal(userExternalResolver),
        schemaHooks.resolveResult(userResolver),
      ],
    },
    before: {
      // resolveDeviceAccessScope VOR den Schema-Hooks: Der Fail-closed-Fall
      // (Geraet ohne Datensatz) muss als 403 durchwerfen. Aus dem Resolver
      // heraus verpackt Feathers ihn zu einem 400 „Error resolving data".
      all: [
        resolveDeviceAccessScope,
        schemaHooks.validateQuery(userQueryValidator),
        schemaHooks.resolveQuery(userQueryResolver),
      ],
      find: [],
      get: [],
      create: [
        restrictPermissionGrants,
        schemaHooks.validateData(userDataValidator),
        schemaHooks.resolveData(userDataResolver),
        ...jsonHooks.before,
      ],
      patch: [
        restrictUserSelfPatch,
        restrictPermissionGrants,
        schemaHooks.validateData(userPatchValidator),
        schemaHooks.resolveData(userPatchResolver),
        ...jsonHooks.before,
      ],
      remove: [],
      // Geraete-Zuweisung: Das users.find-Scoping bestimmt nur, was der
      // Login-Screen anzeigt. Diese beiden Methoden sind ueber den
      // Geraete-Socket direkt erreichbar und brauchen deshalb ihre eigene
      // Pruefung — vor dem bcrypt-Vergleich in der Methode.
      verifyPin: [restrictDeviceAccessMode],
      changePin: [restrictDeviceAccessMode],
    },
    after: {
      all: [...jsonHooks.after],
    },
    error: {
      all: [],
    },
  })
}

// NOTE: The 'declare module' block has been REMOVED HERE.
// We'll clean this up in declarations.ts.
