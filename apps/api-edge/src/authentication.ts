// apps/api-edge/src/authentication.ts
import { AuthenticationService, JWTStrategy } from '@feathersjs/authentication'
import { LocalStrategy } from '@feathersjs/authentication-local'
import type { Application } from './declarations'

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
}

export const authentication = (app: Application) => {
  const authentication = new AuthenticationService(app)

  authentication.register('jwt', new JWTStrategy())
  authentication.register('local', new InternalLocalStrategy())

  app.use('authentication', authentication)
}
