import { FormatRegistry } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { beforeAll, describe, expect, it } from 'vitest'

import { reservableSlotSchema } from './reservable-slot.schema'
import { reservationSchema } from './reservation.schema'
import { tableSchema } from './table.schema'

// TypeBox liefert keine eingebauten Format-Validatoren — Feathers nutzt AJV.
// Fuer Value.Check muessen wir die Formate lokal registrieren, damit Schema-
// Roundtrip-Tests ohne Feathers-Boot moeglich sind (analog sync-trigger.spec).
beforeAll(() => {
  if (!FormatRegistry.Has('email')) {
    // Pragmatisches RFC-5322-naehe Pattern — der Lib-Konsumer macht die echte
    // Validierung via AJV/Feathers. Hier nur „nicht offensichtlich falsch".
    FormatRegistry.Set('email', value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
  }
})

const validReservation = {
  _id: '0192d1c0-0000-7000-8000-000000000001',
  tenantId: '0192d1c0-0000-7000-8000-000000000002',
  brandId: '0192d1c0-0000-7000-8000-000000000003',
  locationId: '0192d1c0-0000-7000-8000-000000000004',
  customerName: 'Max Mustermann',
  customerEmail: 'max@example.com',
  partySize: 4,
  reservedFor: '2026-06-15T19:00:00.000Z',
  reservedSlotId: '0192d1c0-0000-7000-8000-000000000005',
  status: 'pending',
  createdAt: '2026-06-08T10:00:00.000Z',
  updatedAt: '2026-06-08T10:00:00.000Z',
}

const validSlot = {
  _id: '0192d1c0-0000-7000-8000-000000000010',
  tenantId: '0192d1c0-0000-7000-8000-000000000002',
  brandId: '0192d1c0-0000-7000-8000-000000000003',
  locationId: '0192d1c0-0000-7000-8000-000000000004',
  weekday: 1,
  startTime: '18:00',
  endTime: '22:00',
  durationMinutes: 90,
  maxConcurrentReservations: 5,
  isActive: true,
  createdAt: '2026-06-08T10:00:00.000Z',
  updatedAt: '2026-06-08T10:00:00.000Z',
}

const validTable = {
  _id: '0192d1c0-0000-7000-8000-000000000020',
  tenantId: '0192d1c0-0000-7000-8000-000000000002',
  brandId: '0192d1c0-0000-7000-8000-000000000003',
  locationId: '0192d1c0-0000-7000-8000-000000000004',
  name: 'Tisch 7',
  seats: 4,
  isActive: true,
  createdAt: '2026-06-08T10:00:00.000Z',
  updatedAt: '2026-06-08T10:00:00.000Z',
}

describe('reservationSchema (D-21)', () => {
  it('akzeptiert vollständigen valid Reservation-Datensatz', () => {
    expect(Value.Check(reservationSchema, validReservation)).toBe(true)
  })

  it('akzeptiert optionale Felder (phone, tableId, notes)', () => {
    const withOptional = {
      ...validReservation,
      customerPhone: '+49 30 12345678',
      tableId: '0192d1c0-0000-7000-8000-000000000020',
      notes: 'Vegetarisch, Fensterplatz wenn möglich',
      staffNotes: 'Stammkunde',
    }
    expect(Value.Check(reservationSchema, withOptional)).toBe(true)
  })

  it('lehnt partySize = 0 ab (minimum 1)', () => {
    expect(Value.Check(reservationSchema, { ...validReservation, partySize: 0 })).toBe(false)
  })

  it('lehnt partySize > 50 ab (maximum 50)', () => {
    expect(Value.Check(reservationSchema, { ...validReservation, partySize: 51 })).toBe(false)
  })

  it('lehnt unbekannten Status ab (enum-Validation)', () => {
    expect(Value.Check(reservationSchema, { ...validReservation, status: 'invalid' })).toBe(false)
  })

  it('akzeptiert alle 4 gültigen Status-Werte', () => {
    for (const status of ['pending', 'confirmed', 'cancelled', 'no-show']) {
      expect(Value.Check(reservationSchema, { ...validReservation, status })).toBe(true)
    }
  })

  it('lehnt leeren customerName ab (minLength 1)', () => {
    expect(Value.Check(reservationSchema, { ...validReservation, customerName: '' })).toBe(false)
  })

  it('lehnt invalides E-Mail-Format ab', () => {
    expect(Value.Check(reservationSchema, { ...validReservation, customerEmail: 'kein-mail' })).toBe(
      false,
    )
  })

  it('lehnt unbekannte Properties ab (additionalProperties: false)', () => {
    expect(Value.Check(reservationSchema, { ...validReservation, foreignField: 'x' })).toBe(false)
  })
})

describe('reservableSlotSchema (D-21)', () => {
  it('akzeptiert valid Slot-Datensatz', () => {
    expect(Value.Check(reservableSlotSchema, validSlot)).toBe(true)
  })

  it('lehnt weekday = 7 ab (max 6)', () => {
    expect(Value.Check(reservableSlotSchema, { ...validSlot, weekday: 7 })).toBe(false)
  })

  it('lehnt weekday = -1 ab (min 0)', () => {
    expect(Value.Check(reservableSlotSchema, { ...validSlot, weekday: -1 })).toBe(false)
  })

  it('lehnt invalides Time-Format „25:00" ab', () => {
    expect(Value.Check(reservableSlotSchema, { ...validSlot, startTime: '25:00' })).toBe(false)
  })

  it('lehnt invalides Time-Format „9:00" (ohne führende Null) ab', () => {
    expect(Value.Check(reservableSlotSchema, { ...validSlot, startTime: '9:00' })).toBe(false)
  })

  it('lehnt durationMinutes = 10 ab (min 15)', () => {
    expect(Value.Check(reservableSlotSchema, { ...validSlot, durationMinutes: 10 })).toBe(false)
  })

  it('lehnt maxConcurrentReservations = 0 ab (min 1)', () => {
    expect(Value.Check(reservableSlotSchema, { ...validSlot, maxConcurrentReservations: 0 })).toBe(
      false,
    )
  })

  it('lehnt unbekannte Properties ab', () => {
    expect(Value.Check(reservableSlotSchema, { ...validSlot, foo: 1 })).toBe(false)
  })
})

describe('tableSchema (D-21)', () => {
  it('akzeptiert valid Table-Datensatz', () => {
    expect(Value.Check(tableSchema, validTable)).toBe(true)
  })

  it('akzeptiert optionalen area-String', () => {
    expect(Value.Check(tableSchema, { ...validTable, area: 'Terrasse' })).toBe(true)
  })

  it('lehnt seats = 0 ab (min 1)', () => {
    expect(Value.Check(tableSchema, { ...validTable, seats: 0 })).toBe(false)
  })

  it('lehnt seats = 31 ab (max 30)', () => {
    expect(Value.Check(tableSchema, { ...validTable, seats: 31 })).toBe(false)
  })

  it('lehnt leeren name ab (minLength 1)', () => {
    expect(Value.Check(tableSchema, { ...validTable, name: '' })).toBe(false)
  })

  it('lehnt unbekannte Properties ab', () => {
    expect(Value.Check(tableSchema, { ...validTable, foo: 1 })).toBe(false)
  })
})
