import { logger } from '@panary-core/shared-backend'
import { BusinessDayStatus } from '@panary-core/businessdays/domain'
import { PairingStatus, CloudConnection } from '@panary-core/cloud-connection/domain'

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
 * Zentraler Gate-Check fuer das Cloud-Managed-Hybrid (siehe ADR
 * business-days-cloud-managed): Im CONNECTED-Modus ist die Cloud
 * Source-of-Truth fuer den BusinessDay-Lifecycle — lokales
 * `rotateBusinessDay()` ist dann verboten.
 *
 * Gibt `true` zurueck, wenn lokale Rotation ERLAUBT ist:
 *  - kein aktives CONNECTED-Pairing (Standalone), ODER
 *  - Operator-Override aktiv (`offlineOverrideActiveUntil` in der Zukunft).
 *
 * Wird sowohl vom Boot-Pfad (`autoEnsureBusinessDay`) als auch vom
 * Order-Hook (`restrict-order-to-business-day`) genutzt — eine einzige
 * Wahrheit, kein Drift zwischen den beiden Auto-Rotate-Einstiegspunkten.
 */
export async function isLocalRotationAllowed(app: FeathersApp): Promise<boolean> {
  let connection: CloudConnection | null = null
  try {
    const result = await app.service('cloud-connection').find({
      provider: undefined,
      paginate: false,
      query: { pairingStatus: PairingStatus.CONNECTED, $limit: 1 },
    })
    const list = Array.isArray(result) ? result : []
    connection = (list[0] as CloudConnection | undefined) ?? null
  } catch {
    // cloud-connection nicht lesbar → defensiv: lokale Rotation erlauben
    // (Standalone-Annahme, damit Edge bei DB-Problemen nicht haengt).
    return true
  }

  if (!connection) return true // kein Pairing → Standalone

  const until = connection.offlineOverrideActiveUntil
  if (until) {
    const untilMs = new Date(until).getTime()
    if (Number.isFinite(untilMs) && untilMs > Date.now()) return true // Override aktiv
  }

  return false // CONNECTED ohne Override → Cloud verwaltet den Lifecycle
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
 * Schliesst den alten Geschaeftstag, erstellt einen neuen und aktualisiert
 * die Location. Wird im Standalone-Modus (kein Cloud-Pairing) sowie im
 * Operator-Override-Fallback (Cloud unreachable) verwendet.
 *
 * Nutzt **ausschliesslich die Feathers-Service-API** — fruehere Versionen
 * haben `knex('businessdays').insert(...)` direkt aufgerufen und damit den
 * Service-Layer (inkl. Resolver + `cloudManaged`-Hook) umgangen. Im
 * Hybrid-Modus blockiert der Hook bei aktivem Pairing externe Schreib-
 * versuche; interne Aufrufe (`provider: undefined` + `isEmergencyOverride`)
 * passieren weiter durch.
 *
 * @returns Die neue businessDayId
 */
export async function rotateBusinessDay(
  app: FeathersApp,
  location: LocationRecord,
  today: string,
): Promise<string> {
  const now = new Date().toISOString()

  // Vorherigen Geschaeftstag schliessen — gleicher Service-Pfad, keine
  // Knex-Direct-Updates mehr. `isEmergencyOverride: true` ist nur fuer den
  // Override-Pfad noetig; im Standalone-Modus (kein CONNECTED) waere auch
  // `provider: undefined` allein ausreichend — fuer Defensive setzen wir
  // beide Flags konsistent. `status` + `isOpen` + `closedAt` halten das
  // Backward-Compat-Feld und das neue Status-Feld konsistent.
  if (location.currentBusinessDay?.businessDayId) {
    await app.service('businessdays').patch(
      location.currentBusinessDay.businessDayId,
      { status: BusinessDayStatus.CLOSED, isOpen: false, closedAt: now },
      { provider: undefined, isEmergencyOverride: true },
    )
  }

  // Neuen Geschaeftstag erstellen. Das `businessDayDataSchema` erlaubt nur
  // { _id, tenantId, locationId, date, openedBy, operationMode,
  // openingFloatCents } — `status`/`isOpen`/`openedAt` setzt der
  // `businessDayDataResolver` serverseitig. Daher hier NUR die erlaubten
  // Felder schicken, sonst `additionalProperties`-Reject.
  const created = (await app.service('businessdays').create(
    {
      tenantId: location.tenantId,
      locationId: location._id,
      date: today,
    },
    { provider: undefined, isEmergencyOverride: true },
  )) as { _id: string }
  const newId = created._id

  // Location mit neuem Geschaeftstag aktualisieren.
  await app.service('locations').patch(
    location._id,
    { currentBusinessDay: { businessDayId: newId, date: today } },
    { provider: undefined, isEmergencyOverride: true },
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
