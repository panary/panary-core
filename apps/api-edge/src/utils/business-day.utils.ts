import { uuidv7 } from 'uuidv7'
import { logger } from '@panary-core/shared-backend'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Feathers context.app hat generischen Typ Application<any, any>
type FeathersApp = any

/**
 * Minimaler Typ fuer Location-Daten, die fuer die Rotation benoetigt werden.
 * Vermeidet Abhaengigkeit vom vollen Location-Schema bei internen Aufrufen.
 */
export interface LocationRecord {
  _id: string
  tenantId: string
  currentBusinessDay?: {
    businessDayId: string
    date: string
  } | null
}

/**
 * Prueft, ob im aktuellen Geschaeftstag noch aktive Bestellungen existieren.
 * Gibt `true` zurueck, wenn die Rotation blockiert werden soll.
 */
export async function hasActiveOrders(app: FeathersApp, businessDayId: string): Promise<boolean> {
  const result = await app.service('orders').find({
    query: {
      businessDayId,
      status: 'active',
      $limit: 0,
    },
    provider: undefined,
    paginate: { default: 0, max: 0 },
  })

  const total = typeof result === 'object' && result !== null && 'total' in result ? (result as { total: number }).total : 0
  return total > 0
}

/**
 * Schliesst den alten Geschaeftstag, erstellt einen neuen und aktualisiert die Location.
 * Wird sowohl beim Bootstrap als auch beim Order-Hook verwendet.
 *
 * Nutzt Feathers Service API fuer `orders` und `locations`.
 * Fuer `businessdays` wird Knex direkt verwendet, da kein Feathers-Service registriert ist.
 *
 * @returns Die neue businessDayId
 */
export async function rotateBusinessDay(
  app: FeathersApp,
  location: LocationRecord,
  today: string,
): Promise<string> {
  const knex = app.get('sqliteClient')
  const now = new Date().toISOString()
  const newId = uuidv7()

  // Vorherigen Geschaeftstag schliessen (kein Feathers-Service fuer businessdays vorhanden)
  if (location.currentBusinessDay?.businessDayId) {
    await knex('businessdays')
      .where({ _id: location.currentBusinessDay.businessDayId })
      .update({ isOpen: false, closedAt: now, updatedAt: now })
  }

  // Neuen Geschaeftstag erstellen
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

  // Location mit neuem Geschaeftstag aktualisieren (interner Aufruf ohne Provider)
  await app.service('locations').patch(
    location._id,
    { currentBusinessDay: { businessDayId: newId, date: today } },
    { provider: undefined },
  )

  logger.info(
    `[AutoBusinessDay] Neuer Geschaeftstag ${newId} fuer Location ${location._id} eroeffnet (${today}).`,
  )

  return newId
}

/**
 * Prueft ob ein Geschaeftstag-Wechsel noetig ist (Datum veraltet oder kein BD vorhanden).
 */
export function shouldAutoRotate(
  currentBusinessDay: LocationRecord['currentBusinessDay'],
  today: string,
): boolean {
  return !currentBusinessDay || currentBusinessDay.date !== today
}

/**
 * Berechnet die absolute Differenz in Tagen zwischen zwei Daten.
 */
export function getDifferenceInDays(date1: Date, date2: Date): number {
  const oneDayInMs = 1000 * 60 * 60 * 24
  const utc1 = Date.UTC(date1.getFullYear(), date1.getMonth(), date1.getDate())
  const utc2 = Date.UTC(date2.getFullYear(), date2.getMonth(), date2.getDate())

  return Math.floor(Math.abs(utc2 - utc1) / oneDayInMs)
}
