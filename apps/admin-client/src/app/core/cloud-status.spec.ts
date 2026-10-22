import { ConnectionService } from '@panary/shared/data-access'
import { describe, expect, it } from 'vitest'

import { type CloudConnection, deriveCloudStatus } from './cloud-status'

const NOW = Date.parse('2026-10-22T12:00:00.000Z')
const secondsAgo = (s: number) => new Date(NOW - s * 1000).toISOString()
const conn = (over: Partial<CloudConnection>): CloudConnection => ({ _id: 'c1', pairingStatus: 'connected', ...over })

describe('deriveCloudStatus', () => {
  it('ohne Kopplungsdatensatz und nach dem Entkoppeln: standalone', () => {
    expect(deriveCloudStatus(undefined, NOW)).toBe('standalone')
    expect(deriveCloudStatus(conn({ pairingStatus: 'disconnected' }), NOW)).toBe('standalone')
  })

  it('übernimmt pairing und error unverändert', () => {
    expect(deriveCloudStatus(conn({ pairingStatus: 'pairing' }), NOW)).toBe('pairing')
    expect(deriveCloudStatus(conn({ pairingStatus: 'error' }), NOW)).toBe('error')
  })

  it('gekoppelt mit frischem Kontakt: connected, ab der Schwelle: stale', () => {
    const limit = ConnectionService.CLOUD_CONTACT_STALE_SEC
    expect(deriveCloudStatus(conn({ lastCloudContactAt: secondsAgo(limit) }), NOW)).toBe('connected')
    expect(deriveCloudStatus(conn({ lastCloudContactAt: secondsAgo(limit + 1) }), NOW)).toBe('stale')
  })

  it('gekoppelt ohne je einen Kontakt: stale', () => {
    expect(deriveCloudStatus(conn({ lastCloudContactAt: null }), NOW)).toBe('stale')
  })
})
