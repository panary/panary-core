import { logger } from '@panary/shared-backend'
import { BusinessDayStatus } from '@panary/businessdays/domain'
import { PairingStatus, CloudConnection } from '@panary/cloud-connection/domain'

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

  const total =
    typeof result === 'object' && result !== null && 'total' in result ? (result as { total: number }).total : 0
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
export async function rotateBusinessDay(app: FeathersApp, location: LocationRecord, today: string): Promise<string> {
  const now = new Date().toISOString()

  // ALLE offenen Geschaeftstage der Location schliessen — nicht nur den, auf den
  // `location.currentBusinessDay` gerade zeigt.
  //
  // Frueher wurde ausschliesslich das Zeiger-Ziel geschlossen. Driftete der
  // Zeiger einmal (z.B. durch den frueher nicht-deterministischen
  // `reconcileLocationBusinessDay`), blieb der alte Tag fuer immer offen: die
  // naechste Rotation schloss wieder nur das neue Zeiger-Ziel. Ergebnis waren
  // mehrere gleichzeitig offene Tage pro Filiale, die sich ueber die UI nicht
  // mehr abschliessen liessen. `openDay()` hat gegen diesen Zustand einen Guard,
  // `rotateBusinessDay` hatte keinen.
  //
  // Gleicher Service-Pfad wie bisher, keine Knex-Direct-Updates.
  // `isEmergencyOverride: true` ist nur fuer den Override-Pfad noetig; im
  // Standalone-Modus (kein CONNECTED) waere `provider: undefined` allein
  // ausreichend — fuer Defensive setzen wir beide Flags konsistent.
  // `status` + `isOpen` + `closedAt` halten Backward-Compat-Feld und
  // Status-Feld konsistent.
  const openDays = (await app.service('businessdays').find({
    query: { tenantId: location.tenantId, locationId: location._id, status: BusinessDayStatus.OPEN },
    provider: undefined,
    paginate: false,
  })) as Array<{ _id: string }> | { data?: Array<{ _id: string }> }
  const openDayList = Array.isArray(openDays) ? openDays : (openDays?.data ?? [])

  // Der Zeiger kann auf einen Tag zeigen, den die Query nicht liefert (z.B. weil
  // sein Status bereits gewechselt hat) — dann bleibt der bisherige Pfad greifen.
  const idsToClose = new Set(openDayList.map(day => day._id))
  if (location.currentBusinessDay?.businessDayId) {
    idsToClose.add(location.currentBusinessDay.businessDayId)
  }

  if (idsToClose.size > 1) {
    logger.warn({
      message: `[AutoBusinessDay] Location ${location._id} hatte ${idsToClose.size} offene Geschaeftstage — alle werden geschlossen.`,
      event: 'business_day.multiple_open_days',
      tenantId: location.tenantId,
      locationId: location._id,
      openDayCount: idsToClose.size,
    })
  }

  for (const businessDayId of idsToClose) {
    await app
      .service('businessdays')
      .patch(
        businessDayId,
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
  await app
    .service('locations')
    .patch(
      location._id,
      { currentBusinessDay: { businessDayId: newId, date: today } },
      { provider: undefined, isEmergencyOverride: true },
    )

  logger.info(`[AutoBusinessDay] Neuer Geschaeftstag ${newId} fuer Location ${location._id} eroeffnet (${today}).`)

  return newId
}

/**
 * Mindest-Laufzeit, bevor ein Kalendertagswechsel den Geschaeftstag rotieren darf.
 *
 * Ohne sie schneidet der Wechsel den Nachtbetrieb: Ein Tag, der um 18:00 eroeffnet
 * wurde, waere um 00:00 Ortszeit „von gestern" und wuerde mitten im Lauf rotiert —
 * sobald in dem Moment zufaellig keine Bestellung offen ist. **10** ist genau die
 * Laenge des Bezugsfalls 18:00 → 04:00 aus #154; kuerzere Werte schneiden ihn,
 * laengere schieben den regulaeren Tageswechsel unnoetig weit in den Vormittag.
 *
 * Bewusst deutlich unter der Sperrschwelle (26 h, panary-cloud ADR 0047): der Tag
 * rotiert lange bevor das Order-Gate greifen wuerde, die beiden Regeln koennen sich
 * also nicht gegenseitig blockieren.
 *
 * Bekannte, bewusst in Kauf genommene Folge: Ein spaet eroeffneter Tag (z.B. 22:00)
 * rotiert erst am naechsten Vormittag (08:00) statt um Mitternacht. Beginnt dort
 * frueher Service, landen die ersten Bestellungen noch auf dem Vortag. Der Fall
 * braucht eine manuelle Abend-Eroeffnung mit anschliessendem Frueh-Service, ist
 * selbstheilend und bleibt weit von der 26-h-Sperre entfernt. Sollte er auftreten,
 * waere die Erweiterung „ODER lokale Uhrzeit >= Rotationsstunde" der Ausweg.
 */
export const MIN_OPEN_HOURS_BEFORE_ROTATION = 10

/**
 * Laufzeit und Betriebsart des Geschaeftstags. `openHours` ist `null`, wenn kein
 * brauchbarer `openedAt` vorliegt.
 */
export interface BusinessDayRuntime {
  openHours: number | null
  operationMode?: string
}

/**
 * Liest `openedAt`/`operationMode` des Geschaeftstags und rechnet die Laufzeit aus.
 * Eine Quelle fuer beide Konsumenten — den Rotations-Guard und die Altersgrenze
 * des Order-Gates —, damit die beiden nie auf verschiedene Zahlen schauen.
 */
export async function loadBusinessDayRuntime(app: FeathersApp, businessDayId: string): Promise<BusinessDayRuntime> {
  const businessDay = (await app.service('businessdays').get(businessDayId, {
    query: { $select: ['openedAt', 'operationMode'] },
    provider: undefined,
  })) as { openedAt?: string; operationMode?: string }

  if (!businessDay.openedAt) return { openHours: null, operationMode: businessDay.operationMode }

  const openHours = getHoursSince(businessDay.openedAt)
  return {
    openHours: Number.isFinite(openHours) ? openHours : null,
    operationMode: businessDay.operationMode,
  }
}

/**
 * Prueft ob ein Geschaeftstag-Wechsel noetig ist.
 *
 * Zwei Bedingungen, beide muessen zutreffen:
 * 1. Der Kalendertag der **Filiale** hat gewechselt (`today` kommt aus
 *    `businessDateForLocation`, nicht aus `toISOString()` — siehe #154).
 * 2. Der Geschaeftstag laeuft mindestens `MIN_OPEN_HOURS_BEFORE_ROTATION`.
 *
 * `openHours === null` (kein brauchbarer `openedAt`) rotiert wie vor der
 * Mindest-Laufzeit. Die Richtung ist Absicht: ein Tag, der nie rotiert, sammelt
 * Umsatz weiter an, und weil die Altersgrenze denselben fehlenden Zeitstempel
 * ueberspringt (`business_day.age_check_skipped`), wuerde ihn auch das Gate nicht
 * stoppen. Ein Datenfehler darf den Lifecycle nicht anhalten.
 */
export function shouldAutoRotate(
  currentBusinessDay: LocationRecord['currentBusinessDay'],
  today: string,
  openHours?: number | null,
): boolean {
  if (!currentBusinessDay) return true
  if (currentBusinessDay.date === today) return false
  if (openHours === null || openHours === undefined) return true

  return openHours >= MIN_OPEN_HOURS_BEFORE_ROTATION
}

/**
 * Verstrichene Stunden seit einem ISO-Zeitstempel (z.B. `businessDay.openedAt`).
 * Bewusst rollend (echte Zeitspanne) statt kalendertag-basiert — robust gegen
 * UTC-vs-Lokal-Off-by-one nahe Mitternacht.
 */
export function getHoursSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 3_600_000
}
