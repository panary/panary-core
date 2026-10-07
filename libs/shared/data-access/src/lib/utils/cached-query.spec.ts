import { describe, expect, it } from 'vitest'
import { applyCachedQuery, filterCachedRecords } from './cached-query'

// core#649: Offline wertet der BaseService die Query gegen die Cache-Liste aus.
const rows = () => [
  { _id: 'a', status: 'ACTIVE', name: 'Cola', index: 3, scheduledFor: '2026-10-07T10:00:00.000Z' },
  { _id: 'b', status: 'ARCHIVED', name: 'Bier', index: 1, scheduledFor: '2026-10-07T12:00:00.000Z' },
  { _id: 'c', status: 'ACTIVE', name: 'Apfel', index: 2, scheduledFor: '2026-10-08T09:00:00.000Z' },
  { _id: 'd', status: 'ACTIVE', name: 'Döner', scheduledFor: undefined },
]

const ids = (list: Array<{ _id: string }>) => list.map(row => row._id)

describe('filterCachedRecords', () => {
  it('filtert auf Gleichheit und ignoriert Steuerfelder', () => {
    expect(ids(filterCachedRecords(rows(), { status: 'ACTIVE', $limit: 1, $sort: { name: 1 } }))).toEqual([
      'a',
      'c',
      'd',
    ])
  })

  it('wertet $in, $nin und $ne aus', () => {
    expect(ids(filterCachedRecords(rows(), { _id: { $in: ['a', 'b'] } }))).toEqual(['a', 'b'])
    expect(ids(filterCachedRecords(rows(), { _id: { $nin: ['a', 'b'] } }))).toEqual(['c', 'd'])
    expect(ids(filterCachedRecords(rows(), { status: { $ne: 'ACTIVE' } }))).toEqual(['b'])
  })

  it('wertet Bereiche aus, fehlende Werte fallen heraus', () => {
    const query = { scheduledFor: { $gte: '2026-10-07T00:00:00.000Z', $lte: '2026-10-07T23:59:59.999Z' } }
    expect(ids(filterCachedRecords(rows(), query))).toEqual(['a', 'b'])
    expect(ids(filterCachedRecords(rows(), { index: { $gt: 1, $lt: 3 } }))).toEqual(['c'])
    expect(ids(filterCachedRecords(rows(), { index: { $gt: 1 } }))).toEqual(['a', 'c'])
    expect(ids(filterCachedRecords(rows(), { index: { $lte: 2 } }))).toEqual(['b', 'c'])
  })

  it('filtert bei unbekanntem Operator nicht (lieber eine Zeile zu viel als eine verschwiegene)', () => {
    expect(ids(filterCachedRecords(rows(), { name: { $like: 'C%' } }))).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('applyCachedQuery', () => {
  it('sortiert, ueberspringt und begrenzt wie der Server', () => {
    const page = (skip: number) =>
      ids(applyCachedQuery(rows(), { status: 'ACTIVE', $sort: { name: 1 }, $skip: skip, $limit: 2 }))

    expect(page(0)).toEqual(['c', 'a'])
    expect(page(2)).toEqual(['d'])
  })

  it('sortiert absteigend', () => {
    expect(ids(applyCachedQuery(rows(), { status: 'ACTIVE', $sort: { index: -1 } }))).toEqual(['a', 'c', 'd'])
  })

  it('$limit: 0 schneidet nicht ab — Aufrufer lesen offline die Summe aus der Laenge', () => {
    expect(applyCachedQuery(rows(), { status: 'ACTIVE', $limit: 0 })).toHaveLength(3)
  })

  it('ohne Query bleibt die Liste vollstaendig und unveraendert', () => {
    const source = rows()
    const result = applyCachedQuery(source, undefined)
    expect(ids(result)).toEqual(['a', 'b', 'c', 'd'])
    expect(result).not.toBe(source)
  })
})
