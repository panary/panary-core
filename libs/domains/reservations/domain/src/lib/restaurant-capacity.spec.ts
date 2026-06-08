import { describe, expect, it } from 'vitest'

import { computeCapacity, type MinimalApp } from './restaurant-capacity'

interface Table {
  _id: string
  seats: number
  isActive: boolean
  locationId: string
}

interface Reservation {
  _id: string
  partySize: number
  reservedSlotId: string
  reservedFor: string
  status: 'pending' | 'confirmed' | 'cancelled' | 'no-show'
  locationId: string
}

interface Slot {
  _id: string
  weekday: number
  maxConcurrentReservations: number
  isActive: boolean
  locationId: string
}

function makeApp(opts: {
  tables: Table[]
  reservations: Reservation[]
  slots: Slot[]
}): MinimalApp {
  return {
    service(path: string) {
      return {
        async find(args: { query: Record<string, unknown> }) {
          if (path === 'reservation-tables') {
            return opts.tables.filter(
              t => t.locationId === args.query['locationId'] && t.isActive === args.query['isActive'],
            )
          }
          if (path === 'reservations') {
            const range = (args.query['reservedFor'] ?? {}) as { $gte?: string; $lt?: string }
            const status = (args.query['status'] ?? {}) as { $in?: string[] }
            return opts.reservations.filter(
              r =>
                r.locationId === args.query['locationId'] &&
                (!status.$in || status.$in.includes(r.status)) &&
                (!range.$gte || r.reservedFor >= range.$gte) &&
                (!range.$lt || r.reservedFor < range.$lt),
            )
          }
          if (path === 'reservable-slots') {
            return opts.slots.filter(
              s =>
                s.locationId === args.query['locationId'] &&
                s.isActive === args.query['isActive'] &&
                s.weekday === args.query['weekday'],
            )
          }
          throw new Error(`Unexpected service: ${path}`)
        },
      }
    },
  }
}

const LOCATION = '0192d1c0-0000-7000-8000-000000000004'
const DATE = new Date('2026-06-15T12:00:00.000Z') // 2026-06-15 ist ein Montag (UTC), getUTCDay = 1

describe('computeCapacity (D-22)', () => {
  it('leeres Restaurant → totalSeats=0, availableSeats=0, slotAvailability=[]', async () => {
    const app = makeApp({ tables: [], reservations: [], slots: [] })
    const result = await computeCapacity({ locationId: LOCATION, date: DATE }, app)
    expect(result).toEqual({
      totalSeats: 0,
      reservedSeats: 0,
      availableSeats: 0,
      slotAvailability: [],
    })
  })

  it('drei Tische (4+4+6) → totalSeats=14, ohne Reservierungen alle frei', async () => {
    const app = makeApp({
      tables: [
        { _id: 't1', seats: 4, isActive: true, locationId: LOCATION },
        { _id: 't2', seats: 4, isActive: true, locationId: LOCATION },
        { _id: 't3', seats: 6, isActive: true, locationId: LOCATION },
      ],
      reservations: [],
      slots: [],
    })
    const result = await computeCapacity({ locationId: LOCATION, date: DATE }, app)
    expect(result.totalSeats).toBe(14)
    expect(result.reservedSeats).toBe(0)
    expect(result.availableSeats).toBe(14)
  })

  it('zwei Reservierungen (4+6) → reservedSeats=10, availableSeats=4', async () => {
    const app = makeApp({
      tables: [
        { _id: 't1', seats: 4, isActive: true, locationId: LOCATION },
        { _id: 't2', seats: 4, isActive: true, locationId: LOCATION },
        { _id: 't3', seats: 6, isActive: true, locationId: LOCATION },
      ],
      reservations: [
        {
          _id: 'r1',
          partySize: 4,
          reservedSlotId: 's-18',
          reservedFor: '2026-06-15T18:00:00.000Z',
          status: 'pending',
          locationId: LOCATION,
        },
        {
          _id: 'r2',
          partySize: 6,
          reservedSlotId: 's-20',
          reservedFor: '2026-06-15T20:00:00.000Z',
          status: 'confirmed',
          locationId: LOCATION,
        },
      ],
      slots: [],
    })
    const result = await computeCapacity({ locationId: LOCATION, date: DATE }, app)
    expect(result.totalSeats).toBe(14)
    expect(result.reservedSeats).toBe(10)
    expect(result.availableSeats).toBe(4)
  })

  it('cancelled + no-show werden NICHT mitgezählt', async () => {
    // Im Test simulieren wir das Filter-Verhalten realistisch: die mock-find
    // wendet `status.$in` an, sodass cancelled/no-show gar nicht durchgereicht
    // werden — exakt wie die echte Mongo-Service-Layer.
    const app = makeApp({
      tables: [{ _id: 't1', seats: 10, isActive: true, locationId: LOCATION }],
      reservations: [
        {
          _id: 'r-cancelled',
          partySize: 4,
          reservedSlotId: 's-18',
          reservedFor: '2026-06-15T18:00:00.000Z',
          status: 'cancelled',
          locationId: LOCATION,
        },
        {
          _id: 'r-noshow',
          partySize: 6,
          reservedSlotId: 's-19',
          reservedFor: '2026-06-15T19:00:00.000Z',
          status: 'no-show',
          locationId: LOCATION,
        },
        {
          _id: 'r-pending',
          partySize: 2,
          reservedSlotId: 's-18',
          reservedFor: '2026-06-15T18:00:00.000Z',
          status: 'pending',
          locationId: LOCATION,
        },
      ],
      slots: [],
    })
    const result = await computeCapacity({ locationId: LOCATION, date: DATE }, app)
    expect(result.reservedSeats).toBe(2) // nur das pending
    expect(result.availableSeats).toBe(8)
  })

  it('slotAvailability — remaining = max - existing reservations für diesen Slot', async () => {
    const app = makeApp({
      tables: [{ _id: 't1', seats: 20, isActive: true, locationId: LOCATION }],
      reservations: [
        {
          _id: 'r1',
          partySize: 2,
          reservedSlotId: 'slot-18-uhr',
          reservedFor: '2026-06-15T18:00:00.000Z',
          status: 'confirmed',
          locationId: LOCATION,
        },
        {
          _id: 'r2',
          partySize: 4,
          reservedSlotId: 'slot-18-uhr',
          reservedFor: '2026-06-15T18:00:00.000Z',
          status: 'pending',
          locationId: LOCATION,
        },
        {
          _id: 'r3',
          partySize: 3,
          reservedSlotId: 'slot-20-uhr',
          reservedFor: '2026-06-15T20:00:00.000Z',
          status: 'confirmed',
          locationId: LOCATION,
        },
      ],
      slots: [
        {
          _id: 'slot-18-uhr',
          weekday: 1, // Montag
          maxConcurrentReservations: 5,
          isActive: true,
          locationId: LOCATION,
        },
        {
          _id: 'slot-20-uhr',
          weekday: 1,
          maxConcurrentReservations: 5,
          isActive: true,
          locationId: LOCATION,
        },
        {
          _id: 'slot-other-day',
          weekday: 5, // Freitag — sollte gar nicht erscheinen
          maxConcurrentReservations: 5,
          isActive: true,
          locationId: LOCATION,
        },
      ],
    })
    const result = await computeCapacity({ locationId: LOCATION, date: DATE }, app)
    expect(result.slotAvailability).toEqual([
      { slotId: 'slot-18-uhr', remaining: 3 }, // 5 - 2 Reservierungen
      { slotId: 'slot-20-uhr', remaining: 4 }, // 5 - 1 Reservierung
    ])
  })

  it('reservedFor-Filter: andere Tage werden vom Service-Filter ausgeschlossen', async () => {
    const app = makeApp({
      tables: [{ _id: 't1', seats: 10, isActive: true, locationId: LOCATION }],
      reservations: [
        {
          _id: 'r-heute',
          partySize: 2,
          reservedSlotId: 's',
          reservedFor: '2026-06-15T19:00:00.000Z',
          status: 'pending',
          locationId: LOCATION,
        },
        {
          _id: 'r-morgen',
          partySize: 8,
          reservedSlotId: 's',
          reservedFor: '2026-06-16T19:00:00.000Z',
          status: 'pending',
          locationId: LOCATION,
        },
        {
          _id: 'r-gestern',
          partySize: 10,
          reservedSlotId: 's',
          reservedFor: '2026-06-14T19:00:00.000Z',
          status: 'pending',
          locationId: LOCATION,
        },
      ],
      slots: [],
    })
    const result = await computeCapacity({ locationId: LOCATION, date: DATE }, app)
    expect(result.reservedSeats).toBe(2) // nur die heutige
  })

  it('Overflow-Guard: reservedSeats > totalSeats → availableSeats = 0 (kein Negativ)', async () => {
    const app = makeApp({
      tables: [{ _id: 't1', seats: 4, isActive: true, locationId: LOCATION }],
      reservations: [
        {
          _id: 'r1',
          partySize: 10,
          reservedSlotId: 's',
          reservedFor: '2026-06-15T19:00:00.000Z',
          status: 'confirmed',
          locationId: LOCATION,
        },
      ],
      slots: [],
    })
    const result = await computeCapacity({ locationId: LOCATION, date: DATE }, app)
    expect(result.totalSeats).toBe(4)
    expect(result.reservedSeats).toBe(10)
    expect(result.availableSeats).toBe(0)
  })

  it('Slot-remaining clamped auf 0 wenn überbucht', async () => {
    const app = makeApp({
      tables: [],
      reservations: [
        {
          _id: 'r1',
          partySize: 2,
          reservedSlotId: 's',
          reservedFor: '2026-06-15T19:00:00.000Z',
          status: 'confirmed',
          locationId: LOCATION,
        },
        {
          _id: 'r2',
          partySize: 2,
          reservedSlotId: 's',
          reservedFor: '2026-06-15T19:00:00.000Z',
          status: 'confirmed',
          locationId: LOCATION,
        },
        {
          _id: 'r3',
          partySize: 2,
          reservedSlotId: 's',
          reservedFor: '2026-06-15T19:00:00.000Z',
          status: 'confirmed',
          locationId: LOCATION,
        },
      ],
      slots: [
        {
          _id: 's',
          weekday: 1,
          maxConcurrentReservations: 2,
          isActive: true,
          locationId: LOCATION,
        },
      ],
    })
    const result = await computeCapacity({ locationId: LOCATION, date: DATE }, app)
    expect(result.slotAvailability).toEqual([{ slotId: 's', remaining: 0 }])
  })

  it('akzeptiert auch paginated-Response (data-wrapped)', async () => {
    const app: MinimalApp = {
      service(path: string) {
        return {
          async find() {
            if (path === 'reservation-tables') {
              return { data: [{ seats: 5 }] as unknown[] }
            }
            return { data: [] as unknown[] }
          },
        }
      },
    }
    const result = await computeCapacity({ locationId: LOCATION, date: DATE }, app)
    expect(result.totalSeats).toBe(5)
  })
})
