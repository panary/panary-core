import { HookContext, NextFunction } from '../declarations'
import { authenticate } from '@feathersjs/authentication'
import { authorize } from './authorize.hook'

// Hier definieren wir die Optionen für unseren Hook
interface SecureOptions {
  publicServices: string[]
}

export const secureByDefault =
  (options: SecureOptions) => async (context: HookContext, next: NextFunction) => {
    const { publicServices } = options

    // 1. CHECK: Ist der Service öffentlich? (Allow-List)
    if (publicServices.includes(context.path)) {
      // Wenn ja, überspringen wir Auth & RBAC und machen direkt weiter.
      return next()
    }

    // 2. KETTE: Authenticate -> Authorize -> Next
    // Wir müssen die Hooks verschachteln, damit sie nacheinander ablaufen.

    // Der 'authenticate' Hook erwartet (context, next).
    // Als 'next' geben wir ihm unseren 'authorize' Hook.
    const authHook = authenticate('jwt')

    await authHook(context, async () => {
      // Wenn Authentifizierung erfolgreich war, kommt er hier rein.

      // Jetzt rufen wir 'authorize' auf.
      const rbacHook = authorize()

      // Als 'next' geben wir ihm die ECHTE next-Funktion der App.
      await rbacHook(context, next)
    })
  }
