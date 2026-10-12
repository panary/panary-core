import { logger } from '@panary/shared-backend'
import type { CloudConnection } from '@panary/cloud-connection/domain'

import type { Application } from '../declarations'

/**
 * Bricht den Bootstrap ab, wenn nach dem Pull der eigene Standort fehlt (#664).
 *
 * `truncateMasterTables` hat ihn unmittelbar vorher geloescht. Verwirft der Apply den
 * Cloud-Record (`sync.bootstrap.pull_records_rejected`), steht der Edge ohne Filiale da:
 * Kasse meldet „Standort konnte nicht geladen werden", jeder Live-Pull scheitert erneut
 * am CREATE. Am 2026-10-08 endete genau das trotzdem als `done`. `failed` laesst den
 * Operator den Bootstrap wiederholen und zeigt die Ursache im Status.
 */
export const assertOwnLocationPulled = async (app: Application, connection: CloudConnection): Promise<void> => {
  const locationId = connection.locationId ?? connection.preflightSnapshot?.cloudLocationId ?? null
  if (!locationId) return
  const location = await app
    .service('locations' as any)
    .get(locationId, { provider: undefined } as any)
    .catch(() => null)
  if (location) return
  logger.error({
    message: 'Bootstrap pull-cloud-to-edge: eigener Standort fehlt nach dem Pull',
    event: 'sync.bootstrap.own_location_missing',
    tenantId: connection.tenantId,
    locationId,
  })
  throw new Error(
    `[service=locations] Der eigene Standort (${locationId}) wurde aus der Cloud geladen, aber am Edge ` +
      `nicht angelegt (Datensatz beim Uebernehmen verworfen, Details im Log „Pull-Apply fehlgeschlagen"). ` +
      `Bootstrap abgebrochen, das DB-Backup vor dem Bootstrap ist unberuehrt.`,
  )
}
