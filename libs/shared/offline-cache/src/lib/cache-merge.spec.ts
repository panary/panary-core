import { describe, expect, it } from 'vitest'

import { mergeRecords, normalizeToRecords } from './cache-merge'

describe('normalizeToRecords', () => {
  it('gibt ein Array unverändert zurück', () => {
    expect(normalizeToRecords([{ _id: 'a' }, { _id: 'b' }]).map(r => r._id)).toEqual(['a', 'b'])
  })

  it('extrahiert `data` aus einem Feathers-Paginated-Ergebnis', () => {
    const paginated = { total: 1, limit: 10, skip: 0, data: [{ _id: 'a' }] }
    expect(normalizeToRecords(paginated).map(r => r._id)).toEqual(['a'])
  })

  it('wickelt ein Einzelobjekt in ein Array', () => {
    expect(normalizeToRecords({ _id: 'a' }).map(r => r._id)).toEqual(['a'])
  })

  it('liefert ein leeres Array für null/undefined/leere Werte', () => {
    expect(normalizeToRecords(null)).toEqual([])
    expect(normalizeToRecords(undefined)).toEqual([])
    expect(normalizeToRecords(42)).toEqual([])
  })
})

describe('mergeRecords', () => {
  it('upsert ergänzt neue und ersetzt bestehende per _id', () => {
    const result = mergeRecords(
      [{ _id: 'a', updatedAt: '1' }],
      [{ _id: 'a', updatedAt: '2' }, { _id: 'b', updatedAt: '1' }],
      'upsert',
    )
    expect(result.length).toBe(2)
    expect(result.find(r => r._id === 'a')?.updatedAt).toBe('2')
  })

  it('upsert behält die Insert-Reihenfolge stabil', () => {
    const result = mergeRecords([{ _id: 'a' }, { _id: 'b' }], [{ _id: 'a' }], 'upsert')
    expect(result.map(r => r._id)).toEqual(['a', 'b'])
  })

  it('remove entfernt die genannten IDs', () => {
    const result = mergeRecords([{ _id: 'a' }, { _id: 'b' }], [{ _id: 'a' }], 'remove')
    expect(result.map(r => r._id)).toEqual(['b'])
  })
})
