// cloudManaged()-Hook: blockiert externe Schreibzugriffe auf einen Service,
// sobald die Edge mit der Cloud gepaart ist. Wird auf `locations` registriert,
// damit Standort-Stammdaten (Öffnungszeiten, Feiertage, Tische, Pager) nach
// Pairing ausschließlich in der Cloud bearbeitet werden. Interne Aufrufe
// (Sync-Pull/Bootstrap mit `provider: undefined`) sowie reine Read-Methoden
// bleiben erlaubt — sonst würde der Cloud→Edge-Pull selbst geblockt.
//
// **Emergency-Override** (ADR `emergency-override-adr.md`):
// Bei `cloud-connection.emergencyOverride=true` werden **ausschließlich**
// Patches, deren Diff sich nur auf `settings.printSettings` bezieht, am Edge
// zugelassen. Andere Bereiche (Öffnungszeiten, Tische, …) bleiben gesperrt —
// kleinste Angriffsfläche für Divergenzen.

import { Forbidden } from '@feathersjs/errors'
import type { NextFunction } from '@feathersjs/feathers'
import {
  PairingStatus,
  type CloudConnection,
} from '@panary/cloud-connection/domain'

import type { HookContext } from '../declarations'

const WRITE_METHODS = new Set(['create', 'update', 'patch', 'remove'])

const getActiveCloudConnection = async (
  app: HookContext['app'],
): Promise<CloudConnection | null> => {
  try {
    const result = await (app.service('cloud-connection') as any).find({
      provider: undefined,
      paginate: false,
      query: { pairingStatus: PairingStatus.CONNECTED, $limit: 1 },
    })
    const list = Array.isArray(result) ? result : []
    return list[0] ?? null
  } catch {
    // Fail-open: wenn der cloud-connection-Service nicht erreichbar ist (z.B.
    // beim allerersten Boot vor Service-Registrierung), nicht blockieren.
    return null
  }
}

/**
 * Liefert true, wenn der Patch ausschließlich `settings.printSettings`
 * modifiziert — der einzige Bereich, der im Emergency-Override schreibbar ist.
 *
 * Akzeptiert sowohl `data.settings.printSettings = {...}` (kompletter Block
 * ersetzt) als auch `data.settings = { ..., printSettings: {...} }` mit
 * weiteren `settings`-Keys. Letzteres ist heikel: wir verbieten es, weil die
 * Setting-Merge-Logik im Frontend immer `{ ...currentSettings, printSettings }`
 * als kompletten Block schickt — andere Felder in `settings` deuten auf einen
 * Drift hin (Bug oder Angriffsvektor).
 */
const isPrinterOnlyPatch = (data: unknown): boolean => {
  if (!data || typeof data !== 'object') return false
  const obj = data as Record<string, unknown>
  // Erwartung: nur `settings` als Top-Level-Key. Andere Felder (z.B. `name`,
  // `address`) bedeuten, dass mehr als nur Drucker mutiert werden soll.
  if (Object.keys(obj).length !== 1 || !('settings' in obj)) return false
  const settings = obj['settings']
  if (!settings || typeof settings !== 'object') return false
  // `settings.printSettings` muss vorhanden sein; alle anderen `settings.*`-
  // Felder werden im Override durchgewinkt, weil das Frontend stets den ganzen
  // settings-Block sendet (Pflicht für nicht-Drucker-Settings: User darf sie
  // nicht via UI ändern können, weil der Hook diese UIs gesperrt hält). Aber
  // wir prüfen, ob sich gegenüber dem aktuellen Stand IRGENDWAS außerhalb von
  // printSettings unterscheidet — das wird in `record-emergency-override.hook`
  // gemacht (After-Hook hat Zugriff auf Vorher/Nachher). Hier reicht der
  // strukturelle Check, dass `printSettings` vorhanden ist.
  return 'printSettings' in (settings as Record<string, unknown>)
}

/**
 * Wirft `Forbidden`, sobald ein extern initiiertes `create/update/patch/remove`
 * auf den Service gerichtet ist UND die Edge eine aktive Cloud-Verbindung hat.
 *
 * Vor dem Pairing (oder nach Disconnect) bleiben lokale Edits zulaessig, damit
 * der Setup-Client und Recovery-Flows funktionieren.
 *
 * Im Notfall-Modus (`connection.emergencyOverride=true`) sind reine
 * `settings.printSettings`-Patches erlaubt. Der Override-After-Hook
 * persistiert sie in `pending-local-overrides` (nicht in der Sync-Outbox).
 */
export const cloudManaged =
  () =>
  async (context: HookContext, next: NextFunction): Promise<void> => {
    const isExternalWrite =
      context.params.provider && WRITE_METHODS.has(context.method)
    if (!isExternalWrite) {
      await next()
      return
    }
    const connection = await getActiveCloudConnection(context.app)
    if (!connection) {
      // Nicht gepaart oder Verbindung disconnected — lokale Writes erlaubt.
      await next()
      return
    }

    if (
      connection.emergencyOverride &&
      context.path === 'locations' &&
      context.method === 'patch' &&
      isPrinterOnlyPatch(context.data)
    ) {
      // Markierung für den After-Hook `record-emergency-override.hook`, der
      // die Diff in `pending-local-overrides` schreibt — statt in die
      // Sync-Outbox, die der Cloud blind alle Edits pushen würde.
      ;(context.params as Record<string, unknown>)['isEmergencyOverride'] = true
      await next()
      return
    }

    throw new Forbidden(
      'Diese Daten werden in der Cloud verwaltet und können am Edge nur gelesen werden. ' +
        'Änderungen bitte in der Cloud-Admin-Oberfläche vornehmen.',
      { code: 'CLOUD_MANAGED' },
    )
  }
