// apps/api-edge/src/authentication.ts
import { AuthenticationService, JWTStrategy } from '@feathersjs/authentication'
import { LocalStrategy } from '@feathersjs/authentication-local'
import { NotAuthenticated } from '@feathersjs/errors'
import type { Application } from './declarations'
import { recordAuthFailure, recordAuthSuccess } from './hooks/record-auth-audit-event.hook'
import { isLoginBlockedByStatus, LOGIN_BLOCKED_MESSAGE } from './utils/user-login-status'

declare module './declarations' {
  interface ServiceTypes {
    authentication: AuthenticationService
  }
}

// Überschreibt findEntity, damit der interne User-Lookup beim Login
// immer ohne provider (= interner Aufruf) läuft und nicht durch
// authorize() blockiert wird (FeathersJS spreadt sonst den Original-provider).
// LocalStrategy spreadt die Original-Params (inkl. provider: 'rest') in beide internen
// users-Aufrufe: findEntity (Lookup by Username) und getEntity (Laden des finalen Objekts).
// Beide müssen provider: undefined erhalten, damit authorize() den Aufruf als intern
// erkennt und den users:READ-Check überspringt.
class InternalLocalStrategy extends LocalStrategy {
  override async findEntity(username: string, params: any) {
    return super.findEntity(username, { ...params, provider: undefined })
  }

  override async getEntity(result: any, params: any) {
    return super.getEntity(result, { ...params, provider: undefined })
  }

  // #187: Ein nicht aktives Konto darf kein Token bekommen. Die Pruefung sitzt
  // NACH dem Passwort-Vergleich von super.authenticate() — ein vorgezogener
  // Check waere ein Existenz-Oracle: „Konto nicht aktiv" ohne gueltiges
  // Passwort verraet, dass es den Account gibt.
  override async authenticate(authentication: any, params: any) {
    const result = await super.authenticate(authentication, params)
    const entityKey = (this.configuration as { entity?: string }).entity
    const entity = entityKey ? (result as any)[entityKey] : undefined
    if (isLoginBlockedByStatus(entity)) {
      throw new NotAuthenticated(LOGIN_BLOCKED_MESSAGE)
    }
    return result
  }
}

/**
 * #187: Sperrt nicht aktive Konten sessionwirksam aus.
 *
 * Der Guard gehoert in die JWT-Strategy und nicht in einen Hook, weil die
 * Strategy das User-Entity ohnehin **bei jedem Request** frisch laedt: Ein
 * bereits ausgestelltes Token verliert damit sofort seine Wirkung, statt bis
 * zum Ablauf weiterzugelten. Ohne das lief eine offene POS-Sitzung nach der
 * Archivierung unveraendert weiter (nachgemessen: HTTP 200).
 *
 * Gegenstueck zu `CloudJWTStrategy` in api-cloud/src/authentication.ts.
 */
class EdgeJWTStrategy extends JWTStrategy {
  override async authenticate(authentication: any, params: any) {
    const result = await super.authenticate(authentication, params)
    const entityKey = (this.configuration as { entity?: string }).entity
    const entity = entityKey ? (result as any)[entityKey] : undefined
    if (isLoginBlockedByStatus(entity)) {
      throw new NotAuthenticated(LOGIN_BLOCKED_MESSAGE)
    }
    return result
  }
}

export const authentication = (app: Application) => {
  const authentication = new AuthenticationService(app)

  authentication.register('jwt', new EdgeJWTStrategy())
  authentication.register('local', new InternalLocalStrategy())

  app.use('authentication', authentication)

  // Audit-Hooks: LOGIN bei Erfolg, LOGIN_FAILED bei NotAuthenticated.
  // Wir koppeln das hier (statt in app.ts), damit der Auth-Service als
  // einziger den Hook bekommt — recordAuditEvent (App-Level) waere
  // ungeeignet, weil Audit-Events bei externen Provider-Aufrufen unerwuenscht
  // schreiben wuerden (und Auth wird vor jedem Service-Call geprueft).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(app.service('authentication') as any).hooks({
    after: {
      create: [recordAuthSuccess],
    },
    error: {
      create: [recordAuthFailure],
    },
  })
}
