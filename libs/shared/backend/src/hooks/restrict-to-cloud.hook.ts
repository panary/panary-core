import type { HookContext } from '../declarations'
import { Forbidden } from '@feathersjs/errors'

/**
 * Before-Hook: Lehnt Anfragen ab, wenn der Edge-Server im Standalone-Modus läuft.
 *
 * Verwendung: Für Services, die nur in der Cloud-/Connected-Version verfügbar sind
 * (z.B. Abschreibungen, Firmenkunden, Synchronisation).
 *
 * Registrierung:
 *   before: { all: [restrictToCloud()] }
 */
export const restrictToCloud = () => async (context: HookContext) => {
  const mode = context.app.get('system')?.mode || 'standalone'

  if (mode === 'standalone') {
    throw new Forbidden('Diese Funktion ist nur in der Cloud-/Connected-Version verfügbar.')
  }
}
