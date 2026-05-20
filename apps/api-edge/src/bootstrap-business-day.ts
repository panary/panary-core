import { logger } from '@panary/shared-backend'
import type { Application } from './declarations'
import {
  hasActiveOrders,
  isLocalRotationAllowed,
  rotateBusinessDay,
  shouldAutoRotate,
  type LocationRecord,
} from './utils/business-day.utils'

/**
 * Stellt sicher, dass jede Location einen aktuellen Geschaeftstag hat.
 * Idempotent: Erstellt nur dann einen neuen Geschaeftstag, wenn keiner
 * existiert oder das Datum veraltet ist.
 *
 * Cloud-Managed-Hybrid (siehe ADR): Lokale Rotation laeuft nur, wenn
 * - `systemMode === 'standalone'` (statische Config) UND
 * - `isLocalRotationAllowed(app)` (kein CONNECTED-Pairing oder aktiver
 *   Operator-Override).
 *
 * Im CONNECTED-Modus uebernimmt der business-days-Pull-Worker die
 * Tagesgenerierung von der Cloud — der Boot-Pfad darf dann KEINEN lokalen
 * Tag anlegen (vermeidet die fruehere ID-Divergenz Edge↔Cloud).
 */
export async function autoEnsureBusinessDay(app: Application): Promise<void> {
  const systemMode = app.get('system')?.mode || 'standalone'
  if (systemMode !== 'standalone') return

  if (!(await isLocalRotationAllowed(app))) {
    logger.info(
      '[AutoBusinessDay] Boot-Rotation uebersprungen — Edge ist mit der Cloud gepairt. ' +
        'Geschaeftstage werden via business-days-Pull-Worker von der Cloud uebernommen.',
    )
    return
  }

  const knex = app.get('sqliteClient')
  const today = new Date().toISOString().slice(0, 10)

  const locations = await knex('locations').select('_id', 'tenantId', 'currentBusinessDay')

  for (const raw of locations) {
    // currentBusinessDay ist als JSON-Text in SQLite gespeichert
    let currentBusinessDay: LocationRecord['currentBusinessDay'] = null

    if (raw.currentBusinessDay) {
      try {
        currentBusinessDay =
          typeof raw.currentBusinessDay === 'string'
            ? JSON.parse(raw.currentBusinessDay)
            : raw.currentBusinessDay
      } catch {
        currentBusinessDay = null
      }
    }

    const location: LocationRecord = {
      _id: raw._id,
      tenantId: raw.tenantId,
      currentBusinessDay,
    }

    if (!shouldAutoRotate(currentBusinessDay, today)) {
      logger.info(`[AutoBusinessDay] Geschaeftstag fuer Location ${location._id} ist aktuell (${today}).`)
      continue
    }

    // Rotation blockieren wenn noch aktive Bestellungen im alten Geschaeftstag vorhanden
    if (currentBusinessDay?.businessDayId) {
      const blocked = await hasActiveOrders(app, currentBusinessDay.businessDayId)

      if (blocked) {
        logger.warn(
          `[AutoBusinessDay] Rotation fuer Location ${location._id} uebersprungen — aktive Bestellung(en) im Geschaeftstag ${currentBusinessDay.businessDayId}.`,
        )
        continue
      }
    }

    await rotateBusinessDay(app, location, today)
  }
}
