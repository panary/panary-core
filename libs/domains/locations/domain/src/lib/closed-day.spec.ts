import { describe, expect, it } from 'vitest'

import { Ajv, addFormats } from '@feathersjs/schema'
import type { FormatsPluginOptions } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'

import {
  canApproveClosedDay,
  closedDayStatus,
  isClosedOn,
  locationCalendarDate,
  resolveClosedDayPolicy,
  type ClosedDayLocation,
} from './closed-day'
import { generateDefaultLocationSettings } from './default-settings'
import { locationPatchSchema } from './location.schema'

// Montag geschlossen, sonst 10–22 Uhr. 2026-10-26 ist ein Montag.
const regular = [0, 1, 2, 3, 4, 5, 6].map(day => ({ day, open: '10:00', close: '22:00', closed: day === 1 }))

const location = (overrides: Partial<NonNullable<ClosedDayLocation['settings']>> = {}): ClosedDayLocation => ({
  _id: 'loc-1',
  settings: {
    generalSettings: { timezone: 'Europe/Berlin' },
    openingHoursSettings: { enabled: true, regular },
    ...overrides,
  },
})

describe('closedDayStatus', () => {
  it('meldet den gepflegten Ruhetag als geschlossen', () => {
    expect(closedDayStatus(location(), [], new Date('2026-10-26T09:00:00Z'))).toEqual({
      state: 'closed',
      date: '2026-10-26',
      reason: 'regular',
    })
  })

  it('meldet einen Öffnungstag als offen', () => {
    expect(closedDayStatus(location(), [], new Date('2026-10-27T09:00:00Z')).state).toBe('open')
  })

  it('rechnet den Kalendertag in Filialzeit, nicht in UTC', () => {
    // Sonntag 23:30 UTC ist in Berlin (CET) schon Montag 00:30.
    expect(closedDayStatus(location(), [], new Date('2026-10-25T23:30:00Z'))).toMatchObject({
      state: 'closed',
      date: '2026-10-26',
    })
    // Montag 23:30 UTC ist in Berlin schon Dienstag.
    expect(closedDayStatus(location(), [], new Date('2026-10-26T23:30:00Z'))).toMatchObject({
      state: 'open',
      date: '2026-10-27',
    })
  })

  it('bleibt an der Sommerzeit-Grenze auf dem richtigen Tag', () => {
    // Umstellung CEST→CET am So 2026-10-25 um 03:00 Ortszeit (01:00 UTC).
    // Sonntag 22:30 UTC = Sonntag 23:30 CET — noch Sonntag, offen.
    expect(closedDayStatus(location(), [], new Date('2026-10-25T22:30:00Z'))).toMatchObject({
      state: 'open',
      date: '2026-10-25',
    })
    // Frühjahr: So 2026-03-29, 02:00 → 03:00. Sonntag 22:30 UTC = Montag 00:30 CEST.
    expect(closedDayStatus(location(), [], new Date('2026-03-29T22:30:00Z'))).toMatchObject({
      state: 'closed',
      date: '2026-03-30',
    })
  })

  it('gibt der Ausnahme Vorrang vor dem Wochentag — in beide Richtungen', () => {
    const now = new Date('2026-10-26T09:00:00Z')
    expect(
      closedDayStatus(location(), [{ date: '2026-10-26', closed: false, open: '10:00', close: '14:00' }], now),
    ).toEqual({ state: 'open', date: '2026-10-26', reason: 'exception' })

    const tuesday = new Date('2026-10-27T09:00:00Z')
    expect(closedDayStatus(location(), [{ date: '2026-10-27', closed: true }], tuesday)).toEqual({
      state: 'closed',
      date: '2026-10-27',
      reason: 'exception',
    })
  })

  it('verwirft Ausnahmen fremder Filialen und anderer Tage', () => {
    const now = new Date('2026-10-26T09:00:00Z')
    const exceptions = [
      { date: '2026-10-26', closed: false, locationId: 'fremde-filiale' },
      { date: '2026-10-25', closed: false, locationId: 'loc-1' },
    ]
    expect(closedDayStatus(location(), exceptions, now).state).toBe('closed')
  })

  it('urteilt nie „geschlossen", wenn die Öffnungszeiten deaktiviert sind', () => {
    const disabled = location({ openingHoursSettings: { enabled: false, regular } })
    expect(closedDayStatus(disabled, [{ date: '2026-10-26', closed: true }], new Date('2026-10-26T09:00:00Z'))).toEqual(
      { state: 'unknown', date: '2026-10-26', reason: 'opening-hours-disabled' },
    )
    expect(isClosedOn(disabled, [], new Date('2026-10-26T09:00:00Z'))).toBe(false)
    expect(isClosedOn(null, [], new Date('2026-10-26T09:00:00Z'))).toBe(false)
  })

  it('wertet einen fehlenden Wochentag als Pflegefehler, nicht als Ruhetag', () => {
    const gap = location({ openingHoursSettings: { enabled: true, regular: regular.filter(r => r.day !== 1) } })
    expect(closedDayStatus(gap, [], new Date('2026-10-26T09:00:00Z'))).toEqual({
      state: 'unknown',
      date: '2026-10-26',
      reason: 'weekday-missing',
    })
  })

  it('fällt bei unbekannter Zeitzone auf Europe/Berlin zurück statt zu werfen', () => {
    const broken = location({ generalSettings: { timezone: 'Europe/Nirgendwo' } })
    expect(locationCalendarDate(broken, new Date('2026-10-25T23:30:00Z'))).toBe('2026-10-26')
  })
})

describe('resolveClosedDayPolicy', () => {
  it('liest manager-approval, wenn das Feld fehlt (Bestandsstandort)', () => {
    expect(resolveClosedDayPolicy(location())).toBe('manager-approval')
    expect(resolveClosedDayPolicy(undefined)).toBe('manager-approval')
  })

  it('liest block, wenn es gesetzt ist', () => {
    const blocked = location({ openingHoursSettings: { enabled: true, regular, closedDayPolicy: 'block' } })
    expect(resolveClosedDayPolicy(blocked)).toBe('block')
  })
})

describe('canApproveClosedDay', () => {
  it('lässt unter manager-approval Manager und Inhaber zu', () => {
    expect(canApproveClosedDay('manager-approval', 'tenant:manager')).toBe(true)
    expect(canApproveClosedDay('manager-approval', 'tenant:owner')).toBe(true)
    expect(canApproveClosedDay('manager-approval', 'tenant:staff')).toBe(false)
  })

  it('lässt unter block nur den Inhaber zu', () => {
    expect(canApproveClosedDay('block', 'tenant:owner')).toBe(true)
    expect(canApproveClosedDay('block', 'tenant:manager')).toBe(false)
    expect(canApproveClosedDay('block', undefined)).toBe(false)
  })
})

describe('openingHoursSettings.closedDayPolicy im Schema', () => {
  const formats: FormatsPluginOptions = ['date-time', 'date', 'email', 'uri', 'uuid']
  const validate = getValidator(locationPatchSchema, addFormats(new Ajv({}), formats))

  const withPolicy = (closedDayPolicy?: string) => ({
    settings: {
      ...generateDefaultLocationSettings,
      openingHoursSettings: { ...generateDefaultLocationSettings.openingHoursSettings, closedDayPolicy },
    },
  })

  it('nimmt einen Standort ohne Feld an', async () => {
    await expect(validate({ settings: generateDefaultLocationSettings })).resolves.toBeTruthy()
  })

  it('nimmt beide bekannten Werte an', async () => {
    await expect(validate(withPolicy('manager-approval'))).resolves.toBeTruthy()
    await expect(validate(withPolicy('block'))).resolves.toBeTruthy()
  })

  it('lehnt einen unbekannten Wert ab', async () => {
    await expect(validate(withPolicy('egal'))).rejects.toThrow()
  })
})
