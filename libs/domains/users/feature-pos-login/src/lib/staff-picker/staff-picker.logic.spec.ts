import { describe, expect, it } from 'vitest'
import { shortStaffName, sortStaff } from './staff-picker.logic'

const person = (_id: string, firstName: string, lastName: string) => ({ _id, firstName, lastName })

describe('sortStaff', () => {
  it('sortiert nach Nachname, dann Vorname, und lässt die Eingabe unverändert', () => {
    const input = [person('1', 'Max', 'Müller'), person('2', 'Anna', 'Müller'), person('3', 'Zoe', 'Albrecht')]

    expect(sortStaff(input).map(p => p._id)).toEqual(['3', '2', '1'])
    expect(input.map(p => p._id)).toEqual(['1', '2', '3'])
  })
})

describe('shortStaffName', () => {
  it('hängt das Initial des Nachnamens an den Vornamen', () => {
    expect(shortStaffName(person('1', 'Anna', 'Altstadt'))).toBe('Anna A.')
  })

  it('zeigt ohne Nachnamen nur den Vornamen', () => {
    expect(shortStaffName(person('2', 'Cher', ' '))).toBe('Cher')
  })
})
