import { describe, expect, it } from 'vitest'

import { findStaleOpenDayIds, type OpenDayCandidate } from './stale-open-days'

const day = (over: Partial<OpenDayCandidate> & { _id: string }): OpenDayCandidate => ({
  date: '2026-10-16',
  status: 'open',
  locationId: 'loc-1',
  openedAt: '2026-10-16T06:00:00.000Z',
  ...over,
})

describe('findStaleOpenDayIds', () => {
  // Szenario aus core#737: lokaler Auto-Rotate-Tag (frueher eroeffnet) und
  // danach der Cloud-Tag per openDay — gleiches Datum.
  const lokal = day({ _id: 'lokal', openedAt: '2026-10-16T07:00:00.000Z' })
  const cloud = day({ _id: 'cloud', openedAt: '2026-10-16T09:00:00.000Z' })

  it('markiert bei gleichem Datum den aelteren openedAt — in beiden Reihenfolgen (core#737)', () => {
    expect([...findStaleOpenDayIds([cloud, lokal])]).toEqual(['lokal'])
    expect([...findStaleOpenDayIds([lokal, cloud])]).toEqual(['lokal'])
  })

  it('der Tag aus currentBusinessDay ist nie verwaist, auch wenn er aelter ist', () => {
    const current = new Set(['lokal'])
    expect([...findStaleOpenDayIds([cloud, lokal], current)]).toEqual(['cloud'])
    expect([...findStaleOpenDayIds([lokal, cloud], current)]).toEqual(['cloud'])
  })

  it('ein juengeres Datum schlaegt einen spaeteren openedAt', () => {
    const gestern = day({ _id: 'gestern', date: '2026-10-15', openedAt: '2026-10-16T23:00:00.000Z' })
    expect([...findStaleOpenDayIds([gestern, cloud])]).toEqual(['gestern'])
  })

  it('gruppiert nach Filiale und ignoriert geschlossene Tage', () => {
    const andereFiliale = day({ _id: 'loc-2-tag', locationId: 'loc-2' })
    const geschlossen = day({ _id: 'zu', status: 'closed', openedAt: '2026-10-16T10:00:00.000Z' })
    expect(findStaleOpenDayIds([cloud, andereFiliale, geschlossen]).size).toBe(0)
  })
})
