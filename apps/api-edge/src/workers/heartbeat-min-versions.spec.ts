import { beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@panary/shared-backend'

import { persistMinVersions, readMinVersions } from './heartbeat-min-versions'

vi.mock('@panary/shared-backend', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test-Mock der Feathers-App.
const makeApp = (_patch: (id: string, data: unknown) => unknown): any => ({
  service: (path: string) => {
    if (path !== 'cloud-connection') throw new Error(`unexpected service ${path}`)
    return { _patch }
  },
})

describe('readMinVersions', () => {
  it('Antwort ohne Felder: beide null („keine Mindestversion")', () => {
    expect(readMinVersions({})).toEqual({ requiredEdgeMinVersion: null, requiredPosMinVersion: null })
    expect(readMinVersions(null)).toEqual({ requiredEdgeMinVersion: null, requiredPosMinVersion: null })
  })

  it('Antwort mit Feldern: beide Werte', () => {
    expect(readMinVersions({ requiredEdgeMinVersion: '26.10.1', requiredPosMinVersion: '26.9.4' })).toEqual({
      requiredEdgeMinVersion: '26.10.1',
      requiredPosMinVersion: '26.9.4',
    })
  })

  it('nur ein Feld gesetzt: das andere bleibt null', () => {
    expect(readMinVersions({ requiredPosMinVersion: '26.9.4' })).toEqual({
      requiredEdgeMinVersion: null,
      requiredPosMinVersion: '26.9.4',
    })
  })

  it('traut dem ungeprüften Cast nicht: Zahl, leerer Text und zu langer Text sind „keine"', () => {
    const body = { requiredEdgeMinVersion: 26 as unknown as string, requiredPosMinVersion: '  ' }
    expect(readMinVersions(body)).toEqual({ requiredEdgeMinVersion: null, requiredPosMinVersion: null })
    expect(readMinVersions({ requiredEdgeMinVersion: 'x'.repeat(51) }).requiredEdgeMinVersion).toBeNull()
    expect(readMinVersions({ requiredEdgeMinVersion: 'x'.repeat(50) }).requiredEdgeMinVersion).toHaveLength(50)
  })
})

describe('persistMinVersions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('speichert neue Werte', async () => {
    const patch = vi.fn(async () => ({}))
    await persistMinVersions(makeApp(patch), { _id: 'c1' }, { requiredEdgeMinVersion: '26.10.1' })
    expect(patch).toHaveBeenCalledWith('c1', { requiredEdgeMinVersion: '26.10.1', requiredPosMinVersion: null })
  })

  it('löscht gespeicherte Werte, wenn die Cloud keine mehr nennt (von Hand zurückgenommen)', async () => {
    const patch = vi.fn(async () => ({}))
    await persistMinVersions(
      makeApp(patch),
      { _id: 'c1', requiredEdgeMinVersion: '26.10.1', requiredPosMinVersion: '26.9.4' },
      {},
    )
    expect(patch).toHaveBeenCalledWith('c1', { requiredEdgeMinVersion: null, requiredPosMinVersion: null })
  })

  it('schreibt nichts, wenn sich nichts geändert hat', async () => {
    const patch = vi.fn()
    await persistMinVersions(
      makeApp(patch),
      { _id: 'c1', requiredEdgeMinVersion: '26.10.1', requiredPosMinVersion: null },
      { requiredEdgeMinVersion: '26.10.1' },
    )
    expect(patch).not.toHaveBeenCalled()
  })

  it('FAILURE-ISOLATION: wirft nie, sondern loggt — der Heartbeat bleibt erfolgreich', async () => {
    const patch = vi.fn(async () => {
      throw new Error('SQLITE_BUSY')
    })
    await expect(
      persistMinVersions(makeApp(patch), { _id: 'c1' }, { requiredEdgeMinVersion: '26.10.1' }),
    ).resolves.toBeUndefined()
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'sync.heartbeat.min_versions_failed' }),
    )
  })
})
