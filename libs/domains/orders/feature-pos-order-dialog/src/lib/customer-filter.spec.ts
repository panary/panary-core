import { describe, expect, it } from 'vitest'
import { customerInitial, filterByInitial, pageCount, pageSlice } from './customer-filter'

describe('customerInitial', () => {
  it('führt Klein- und Großbuchstaben sowie Umlaute auf den Grundbuchstaben zurück', () => {
    expect(customerInitial('bäckerei Müller')).toBe('B')
    expect(customerInitial('Ärztehaus')).toBe('A')
    expect(customerInitial('  Öl & Co')).toBe('O')
  })

  it('ordnet Ziffern und Leeres dem Sammelzeichen zu', () => {
    expect(customerInitial('3M GmbH')).toBe('#')
    expect(customerInitial('')).toBe('#')
  })
})

describe('filterByInitial', () => {
  const customers = [{ name1: 'Alpha' }, { name1: 'ärger AG' }, { name1: 'Beta' }]

  it('filtert auf den gewählten Buchstaben', () => {
    expect(filterByInitial(customers, 'A').map(c => c.name1)).toEqual(['Alpha', 'ärger AG'])
  })

  it('liefert ohne Zeichen alle', () => {
    expect(filterByInitial(customers, null)).toEqual(customers)
  })
})

describe('Seitenaufteilung', () => {
  const items = Array.from({ length: 5 }, (_, i) => i)

  it('rechnet mindestens eine Seite', () => {
    expect(pageCount(0, 2)).toBe(1)
    expect(pageCount(5, 2)).toBe(3)
  })

  it('schneidet die Seite zu, die letzte ist kürzer', () => {
    expect(pageSlice(items, 0, 2)).toEqual([0, 1])
    expect(pageSlice(items, 2, 2)).toEqual([4])
  })
})
