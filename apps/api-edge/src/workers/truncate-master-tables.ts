import { logger } from '@panary/shared-backend'
import { SyncOutboxStatus } from '@panary/sync/domain'

import type { Application } from '../declarations'

const collectAllIds = async (app: Application, service: string, tenantId: string): Promise<string[]> => {
  const result = await app.service(service as any).find({
    provider: undefined,
    paginate: false,
    query: { tenantId, $select: ['_id'] },
  } as any)
  const list = Array.isArray(result) ? result : []
  return list.map(row => (row as { _id: string })._id)
}

// Nicht-terminale Outbox-Eintraege — alles, was noch gepusht werden koennte
// (`rejected` per Operator-`reEnqueue`).
const OPEN_OUTBOX_STATUSES = [SyncOutboxStatus.PENDING, SyncOutboxStatus.IN_FLIGHT, SyncOutboxStatus.REJECTED]

/**
 * Verwirft die offenen Outbox-Auftraege eines geleerten Service. Sie beschreiben
 * Edge-Staende, die der Operator mit `confirmDataLoss` aufgegeben hat. Bisher
 * verdraengte das REMOVE des Truncate sie per Coalescing — seit es entfaellt
 * (#660), wuerden sie nach dem Bootstrap gepusht und den gerade uebernommenen
 * Cloud-Stand per bedingungslosem Upsert ueberschreiben.
 */
const supersedeOpenOutboxEntries = async (app: Application, service: string): Promise<void> => {
  const result = await app.service('sync-outbox' as any).patch(
    null as any,
    {
      status: SyncOutboxStatus.SUPERSEDED,
      terminalAt: new Date().toISOString(),
      lastError: 'Verworfen: Bootstrap pull-cloud-to-edge hat die Edge-Daten dieses Service ersetzt',
    },
    { provider: undefined, query: { service, status: { $in: OPEN_OUTBOX_STATUSES } } } as any,
  )
  const count = Array.isArray(result) ? result.length : 0
  if (count > 0) {
    logger.info({
      message: `TRUNCATE: ${count} offene Outbox-Auftraege verworfen`,
      event: 'sync.bootstrap.outbox_superseded',
      service,
      count,
    })
  }
}

/**
 * Leert die Stammdaten-Tabellen eines Mandanten vor dem destruktiven
 * Bootstrap-Modus `pull-cloud-to-edge`. Wirft, sobald ein Service NICHT leer
 * wird — der Aufrufer bricht den Bootstrap daraufhin ab.
 *
 * Der frueher genutzte Bulk-`remove(null, { query })` scheitert an fast allen
 * Services: nur `products` traegt `multi: ['create','patch','remove']`, die
 * uebrigen stehen auf `multi: []` (bzw. gar keinem) und der Feathers-Adapter
 * antwortet mit „Can not remove multiple entries". Am 2026-08-12 lief der
 * Bootstrap deshalb fuer sieben von acht Services ohne jede Loeschung durch,
 * degradierte still auf `upsert` und meldete am Ende „erfolgreich" — obwohl
 * der Operator `confirmDataLoss` bestaetigt hatte. Sichtbar wurde es erst an
 * der Folge: „Location hat 2 gleichzeitig offene Geschaeftstage" (#183).
 *
 * `multi: ['remove']` waere der naheliegende, aber falsche Fix — der Adapter
 * unterscheidet nicht zwischen internem und externem Aufruf, ein
 * `DELETE /users` ohne id wuerde damit alle Tenant-User loeschen. Stattdessen:
 * Bulk versuchen (schneller Pfad fuer `products`), sonst einzeln loeschen.
 *
 * Die Verifikation nach jedem Service ist der eigentliche Schutz — sie faengt
 * auch Loeschungen ab, die ein Service-Hook still verweigert.
 *
 * `skipSyncOutbox`: Ohne den Marker nahm `recordSyncOutbox` jede Loeschung
 * eines Transaktions-Pfads (`users`) als REMOVE in die Outbox auf — der
 * Bootstrap „Cloud → Edge“ haette damit die Bestands-User in der Cloud
 * geloescht, also genau die Daten, die er uebernehmen soll (#660).
 *
 * Eigenes Modul statt Inline im Runner, damit es ohne dessen Service-Kette
 * (Validatoren, Report-Helper) testbar bleibt — analog `sync-allowlist.ts`.
 */
export const truncateMasterTables = async (
  app: Application,
  tenantId: string,
  services: ReadonlyArray<string>,
): Promise<void> => {
  for (const service of services) {
    try {
      await app
        .service(service as any)
        .remove(null as any, { provider: undefined, skipSyncOutbox: true, query: { tenantId } } as any)
    } catch {
      // Erwartet bei `multi: []` — der Einzel-Remove ist der Regelpfad, kein Notfall.
      const ids = await collectAllIds(app, service, tenantId)
      for (const id of ids) {
        await app.service(service as any).remove(id, { provider: undefined, skipSyncOutbox: true } as any)
      }
    }

    const remaining = await collectAllIds(app, service, tenantId)
    if (remaining.length > 0) {
      logger.error({
        message: 'TRUNCATE waehrend pull-cloud-to-edge unvollstaendig — Bootstrap wird abgebrochen',
        event: 'sync.bootstrap.truncate_failed',
        service,
        remainingCount: remaining.length,
      })
      throw new Error(
        `[service=${service}] TRUNCATE unvollstaendig: ${remaining.length} Datensaetze verblieben. ` +
          `Der Modus pull-cloud-to-edge setzt einen geleerten Edge voraus — Bootstrap abgebrochen, ` +
          `damit kein gemischter Datenbestand als "erfolgreich" gilt. Das DB-Backup vor dem Bootstrap ist unberuehrt.`,
      )
    }

    await supersedeOpenOutboxEntries(app, service)
  }
}
