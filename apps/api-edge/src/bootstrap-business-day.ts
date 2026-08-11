import { logger } from '@panary/shared-backend'
import type { Application } from './declarations'
import { businessDateForLocation, type LocationTimezoneSource } from './utils/business-day-date'
import {
  hasActiveOrders,
  isLocalRotationAllowed,
  loadBusinessDayRuntime,
  rotateBusinessDay,
  shouldAutoRotate,
  type LocationRecord,
} from './utils/business-day.utils'

/** `currentBusinessDay` und `settings` liegen als JSON-Text in SQLite. */
function parseJsonColumn<TValue>(raw: unknown): TValue | null {
  if (!raw) return null
  if (typeof raw !== 'string') return raw as TValue
  try {
    return JSON.parse(raw) as TValue
  } catch {
    return null
  }
}

/**
 * Laufzeit des Geschaeftstags fuer den Mindest-Laufzeit-Guard.
 *
 * Anders als im Order-Hook darf ein nicht ladbarer Geschaeftstag hier nichts
 * abbrechen: Der Boot-Pfad laeuft ueber ALLE Locations, ein verwaister Zeiger auf
 * einer Filiale wuerde sonst die Rotation aller uebrigen mitreissen. `null`
 * bedeutet fuer `shouldAutoRotate` „ohne Mindest-Laufzeit entscheiden" — also
 * rotieren, statt den Lifecycle stehen zu lassen.
 */
async function loadOpenHoursOrNull(
  app: Application,
  businessDayId: string,
  locationId: string,
): Promise<number | null> {
  try {
    return (await loadBusinessDayRuntime(app, businessDayId)).openHours
  } catch (err) {
    logger.warn({
      message: '[AutoBusinessDay] Geschaeftstag nicht ladbar — Rotation ohne Mindest-Laufzeit entschieden',
      event: 'business_day.runtime_unreadable',
      locationId,
      businessDayId,
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

/**
 * Stellt sicher, dass jede Location einen aktuellen Geschaeftstag hat.
 * Idempotent: Erstellt nur dann einen neuen Geschaeftstag, wenn keiner
 * existiert oder das Datum veraltet ist.
 *
 * Cloud-Managed-Hybrid (siehe ADR): Lokale Rotation laeuft nur, wenn
 * `isLocalRotationAllowed(app)` — also kein CONNECTED-Pairing oder ein
 * aktiver Operator-Override.
 *
 * Bewusst OHNE `system.mode`-Vorpruefung: der Modus ist eine Reporting-
 * Angabe (Tier fuer /health und mDNS), der Pairing-Zustand ist die
 * fachliche Wahrheit. Beides zu pruefen hiess, dieselbe Frage doppelt zu
 * beantworten — mit dem Risiko, dass eine geaenderte Modus-Herleitung den
 * Boot-Pfad still abschaltet.
 *
 * Im CONNECTED-Modus uebernimmt der business-days-Pull-Worker die
 * Tagesgenerierung von der Cloud — der Boot-Pfad darf dann KEINEN lokalen
 * Tag anlegen (vermeidet die fruehere ID-Divergenz Edge↔Cloud).
 */
export async function autoEnsureBusinessDay(app: Application): Promise<void> {
  // Tier 1 (`mode: 'cloud'`) hat gar keinen Edge-Lifecycle — dort pflegt die
  // Cloud die Geschaeftstage. Das ist die EINZIGE verbleibende Modus-Pruefung
  // hier: sie beantwortet nicht „darf lokal rotiert werden" (das entscheidet
  // das Pairing), sondern „gibt es hier ueberhaupt einen lokalen Lifecycle".
  if (app.get('system')?.mode === 'cloud') return

  if (!(await isLocalRotationAllowed(app))) {
    logger.info(
      '[AutoBusinessDay] Boot-Rotation uebersprungen — Edge ist mit der Cloud gepairt. ' +
        'Geschaeftstage werden via business-days-Pull-Worker von der Cloud uebernommen.',
    )
    return
  }

  const knex = app.get('sqliteClient')
  // EIN Zeitpunkt fuer alle Locations — der Kalendertag wird pro Filiale in
  // deren Zeitzone daraus abgeleitet, nicht pro Schleifendurchlauf neu gemessen.
  const now = new Date()

  const locations = await knex('locations').select('_id', 'tenantId', 'currentBusinessDay', 'settings')

  for (const raw of locations) {
    const currentBusinessDay = parseJsonColumn<NonNullable<LocationRecord['currentBusinessDay']>>(
      raw.currentBusinessDay,
    )
    const settings = parseJsonColumn<NonNullable<LocationTimezoneSource['settings']>>(raw.settings)

    const location: LocationRecord = {
      _id: raw._id,
      tenantId: raw.tenantId,
      currentBusinessDay,
    }

    // Kalendertag in Filial-Lokalzeit statt UTC — sonst wechselt er in CEST um
    // 02:00 Ortszeit mitten im Nachtbetrieb (siehe `business-day-date.ts`).
    const today = businessDateForLocation({ settings }, now)
    const openHours = currentBusinessDay?.businessDayId
      ? await loadOpenHoursOrNull(app, currentBusinessDay.businessDayId, location._id)
      : null

    if (!shouldAutoRotate(currentBusinessDay, today, openHours)) {
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
