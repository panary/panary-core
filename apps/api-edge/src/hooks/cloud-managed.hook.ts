// cloudManaged()-Hook: blockiert externe Schreibzugriffe auf einen Service,
// sobald die Edge mit der Cloud gepaart ist. Wird auf `locations` registriert,
// damit Standort-Stammdaten (Öffnungszeiten, Feiertage, Tische, Pager) nach
// Pairing ausschließlich in der Cloud bearbeitet werden. Interne Aufrufe
// (Sync-Pull/Bootstrap mit `provider: undefined`) sowie reine Read-Methoden
// bleiben erlaubt — sonst würde der Cloud→Edge-Pull selbst geblockt.

import { Forbidden } from '@feathersjs/errors'
import type { NextFunction } from '@feathersjs/feathers'
import { PairingStatus } from '@panary-core/cloud-connection/domain'

import type { HookContext } from '../declarations'

const WRITE_METHODS = new Set(['create', 'update', 'patch', 'remove'])

const isPaired = async (app: HookContext['app']): Promise<boolean> => {
  try {
    const result = await (app.service('cloud-connection') as any).find({
      provider: undefined,
      paginate: false,
      query: { pairingStatus: PairingStatus.CONNECTED, $limit: 1 },
    })
    const list = Array.isArray(result) ? result : []
    return list.length > 0
  } catch {
    // Fail-open: wenn der cloud-connection-Service nicht erreichbar ist (z.B.
    // beim allerersten Boot vor Service-Registrierung), nicht blockieren.
    // Restrict-Logik laeuft dann durch die normalen Authorize-Hooks.
    return false
  }
}

/**
 * Wirft `Forbidden`, sobald ein extern initiiertes `create/update/patch/remove`
 * auf den Service gerichtet ist UND die Edge eine aktive Cloud-Verbindung hat.
 *
 * Vor dem Pairing (oder nach Disconnect) bleiben lokale Edits zulaessig, damit
 * der Setup-Client und Recovery-Flows funktionieren.
 */
export const cloudManaged =
  () =>
  async (context: HookContext, next: NextFunction): Promise<void> => {
    if (
      context.params.provider &&
      WRITE_METHODS.has(context.method) &&
      (await isPaired(context.app))
    ) {
      throw new Forbidden(
        'Diese Daten werden in der Cloud verwaltet und können am Edge nur gelesen werden. ' +
          'Änderungen bitte in der Cloud-Admin-Oberfläche vornehmen.',
        { code: 'CLOUD_MANAGED' },
      )
    }
    await next()
  }
