import { logger } from './logger'
import { uuidv7 } from 'uuidv7'
import type { Application } from './declarations'

/**
 * Stellt sicher, dass jede Location einen aktuellen Geschäftstag hat.
 * Wird nur im standalone-Modus (Edge-Server) ausgeführt.
 * Idempotent: Erstellt nur dann einen neuen Geschäftstag, wenn keiner existiert oder das Datum veraltet ist.
 */
export async function autoEnsureBusinessDay(app: Application): Promise<void> {
  const systemMode = app.get('system')?.mode || 'standalone'
  if (systemMode !== 'standalone') return

  const knex = app.get('sqliteClient')
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  const now = new Date().toISOString()

  const locations = await knex('locations').select('_id', 'tenantId', 'currentBusinessDay')

  for (const location of locations) {
    let currentBD: { businessDayId: string; date: string } | null = null

    // currentBusinessDay ist als JSON-Text in SQLite gespeichert
    if (location.currentBusinessDay) {
      try {
        currentBD =
          typeof location.currentBusinessDay === 'string'
            ? JSON.parse(location.currentBusinessDay)
            : location.currentBusinessDay
      } catch {
        currentBD = null
      }
    }

    // Geschäftstag ist aktuell — nichts zu tun
    if (currentBD?.date === today) {
      logger.info(`[AutoBusinessDay] Geschäftstag für Location ${location._id} ist aktuell (${today}).`)
      continue
    }

    // Vorherigen Geschäftstag als geschlossen markieren (falls vorhanden)
    if (currentBD?.businessDayId) {
      await knex('businessdays')
        .where({ _id: currentBD.businessDayId })
        .update({ isOpen: false, closedAt: now, updatedAt: now })
    }

    // Neuen Geschäftstag erstellen
    const newId = uuidv7()
    await knex('businessdays').insert({
      _id: newId,
      tenantId: location.tenantId,
      locationId: location._id,
      date: today,
      openedAt: now,
      isOpen: true,
      createdAt: now,
      updatedAt: now,
    })

    // Location mit neuem Geschäftstag aktualisieren
    await knex('locations')
      .where({ _id: location._id })
      .update({
        currentBusinessDay: JSON.stringify({ businessDayId: newId, date: today }),
        updatedAt: now,
      })

    logger.info(`[AutoBusinessDay] Neuer Geschäftstag ${newId} für Location ${location._id} eröffnet (${today}).`)
  }
}
