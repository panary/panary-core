/**
 * Restaurant-Capacity-Helper (D-22).
 *
 * Pure-Function — KEIN eigener Feathers-Service. Aggregiert über drei Services:
 *  - `reservation-tables` — alle aktiven Tische der Location
 *  - `reservations`       — alle Reservierungen am Stichtag mit Status
 *                            `pending` oder `confirmed`
 *  - `reservable-slots`   — alle aktiven Slots für den Wochentag des Stichtags
 *
 * Konvention: Aufruf ausschließlich intern (kein `provider`), damit der
 * `multiTenancy`-Hook tenant-isoliert. `locationId` MUSS aus dem authentifizierten
 * Caller stammen — der Helper validiert NICHT erneut.
 *
 * Berechnungen:
 *  - `totalSeats`        = Summe(seats) aller aktiven Tische
 *  - `reservedSeats`     = Summe(partySize) aller pending+confirmed Reservierungen
 *                          am Stichtag. Cancelled + no-show fallen raus.
 *  - `availableSeats`    = max(0, totalSeats - reservedSeats)
 *  - `slotAvailability[i].remaining` = max(0, slot.maxConcurrentReservations
 *                                            - Anzahl Reservierungen mit
 *                                              reservedSlotId = slot._id)
 *
 * Datum-Filter: UTC-Tagesgrenzen (`YYYY-MM-DDT00:00:00.000Z` bis `…T23:59:59.999Z`).
 * Wochentag: `Date.getUTCDay()` (0 = Sonntag … 6 = Samstag — passt zu D-21 Schema).
 */

export interface CapacityArgs {
  /** uuidv7 der Location, für die die Kapazität berechnet wird. */
  locationId: string
  /** Stichtag — alle Reservierungen mit `reservedFor` im UTC-Tagesfenster. */
  date: Date
}

export interface SlotAvailability {
  slotId: string
  remaining: number
}

export interface CapacityResult {
  totalSeats: number
  reservedSeats: number
  availableSeats: number
  slotAvailability: SlotAvailability[]
}

/**
 * Minimaler App-Vertrag — damit der Helper aus jedem Test/Service heraus aufrufbar
 * ist, ohne `Application<ServiceTypes>` zu importieren. Nur die nötigen Methoden.
 */
export interface MinimalApp {
  service(path: string): {
    find(args: {
      query: Record<string, unknown>
      paginate?: false
      provider?: undefined
    }): Promise<{ data: unknown[] } | unknown[]>
  }
}

interface TableLike {
  seats: number
}

interface ReservationLike {
  partySize: number
  reservedSlotId: string
}

interface SlotLike {
  _id: string
  maxConcurrentReservations: number
}

function unwrap<T>(resp: { data: unknown[] } | unknown[]): T[] {
  return (Array.isArray(resp) ? resp : resp.data) as T[]
}

export async function computeCapacity(args: CapacityArgs, app: MinimalApp): Promise<CapacityResult> {
  // UTC-Tagesfenster — der Filter geht direkt in die Mongo-Query als String-Vergleich
  // (reservedFor ist ISO 8601, lexikografisch sortierbar).
  const dateStr = args.date.toISOString().slice(0, 10)
  const reservedForGte = `${dateStr}T00:00:00.000Z`
  const reservedForLt = `${dateStr}T23:59:59.999Z`
  const weekday = args.date.getUTCDay()

  const tablesResp = await app.service('reservation-tables').find({
    query: { locationId: args.locationId, isActive: true, $limit: 200 },
    paginate: false,
    provider: undefined,
  })
  const tables = unwrap<TableLike>(tablesResp)
  const totalSeats = tables.reduce((sum, t) => sum + t.seats, 0)

  const reservationsResp = await app.service('reservations').find({
    query: {
      locationId: args.locationId,
      status: { $in: ['pending', 'confirmed'] },
      reservedFor: { $gte: reservedForGte, $lt: reservedForLt },
      $limit: 500,
    },
    paginate: false,
    provider: undefined,
  })
  const reservations = unwrap<ReservationLike>(reservationsResp)
  const reservedSeats = reservations.reduce((sum, r) => sum + r.partySize, 0)
  const availableSeats = Math.max(0, totalSeats - reservedSeats)

  const slotsResp = await app.service('reservable-slots').find({
    query: { locationId: args.locationId, isActive: true, weekday, $limit: 50 },
    paginate: false,
    provider: undefined,
  })
  const slots = unwrap<SlotLike>(slotsResp)
  const slotAvailability: SlotAvailability[] = slots.map(s => ({
    slotId: s._id,
    remaining: Math.max(
      0,
      s.maxConcurrentReservations - reservations.filter(r => r.reservedSlotId === s._id).length,
    ),
  }))

  return { totalSeats, reservedSeats, availableSeats, slotAvailability }
}
