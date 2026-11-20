import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@panary/shared-backend'

import { getTokenKeyStatus } from '../utils/cloud-token-cipher'
import { buildTokenKeyHeartbeatBlock } from './heartbeat-token-key'

vi.mock('@panary/shared-backend', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

// Echte Implementierung durchreichen, im Fehlerfall-Test gezielt ueberschreiben.
vi.mock('../utils/cloud-token-cipher', async importOriginal => {
  const original = await importOriginal<typeof import('../utils/cloud-token-cipher')>()
  return { ...original, getTokenKeyStatus: vi.fn(original.getTokenKeyStatus) }
})

describe('buildTokenKeyHeartbeatBlock', () => {
  const original = process.env['EDGE_TOKEN_ENCRYPTION_KEY']

  beforeEach(() => vi.clearAllMocks())

  afterEach(() => {
    if (original === undefined) delete process.env['EDGE_TOKEN_ENCRYPTION_KEY']
    else process.env['EDGE_TOKEN_ENCRYPTION_KEY'] = original
  })

  it('meldet missing ohne Schluessel', () => {
    delete process.env['EDGE_TOKEN_ENCRYPTION_KEY']
    expect(buildTokenKeyHeartbeatBlock()).toEqual({ tokenKey: 'missing' })
  })

  it('meldet missing unter 8 Zeichen', () => {
    process.env['EDGE_TOKEN_ENCRYPTION_KEY'] = 'a'.repeat(7)
    expect(buildTokenKeyHeartbeatBlock()).toEqual({ tokenKey: 'missing' })
  })

  it('meldet weak ab 8 und unter 32 Zeichen', () => {
    process.env['EDGE_TOKEN_ENCRYPTION_KEY'] = 'a'.repeat(8)
    expect(buildTokenKeyHeartbeatBlock()).toEqual({ tokenKey: 'weak' })
    process.env['EDGE_TOKEN_ENCRYPTION_KEY'] = 'a'.repeat(31)
    expect(buildTokenKeyHeartbeatBlock()).toEqual({ tokenKey: 'weak' })
  })

  it('meldet ok ab 32 Zeichen', () => {
    process.env['EDGE_TOKEN_ENCRYPTION_KEY'] = 'a'.repeat(32)
    expect(buildTokenKeyHeartbeatBlock()).toEqual({ tokenKey: 'ok' })
  })

  it('liefert weder Wert noch Laenge', () => {
    const key = 'geheim-'.repeat(8)
    process.env['EDGE_TOKEN_ENCRYPTION_KEY'] = key
    const block = buildTokenKeyHeartbeatBlock()
    expect(Object.keys(block)).toEqual(['tokenKey'])
    expect(JSON.stringify(block)).not.toContain(key)
  })

  it('wirft nie: scheitert die Ermittlung, kommt {} und der Heartbeat laeuft ohne', () => {
    vi.mocked(getTokenKeyStatus).mockImplementationOnce(() => {
      throw new Error('kaputt')
    })

    expect(buildTokenKeyHeartbeatBlock()).toEqual({})
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })
})
