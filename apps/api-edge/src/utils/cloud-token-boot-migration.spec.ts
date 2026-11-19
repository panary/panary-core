import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@panary/shared-backend', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { logger } from '@panary/shared-backend'

import { runCloudTokenBootMigration } from './cloud-token-boot-migration'
import { __resetCloudTokenCipherCache, decryptCloudToken, encryptCloudToken } from './cloud-token-cipher'

const KEY = 'vitest-token-key-0123456789abcdef-not-a-secret'
const OTHER_KEY = 'vitest-other-key-0123456789abcdef-not-a-secret'

const warn = logger.warn as unknown as ReturnType<typeof vi.fn>
const error = logger.error as unknown as ReturnType<typeof vi.fn>
const info = logger.info as unknown as ReturnType<typeof vi.fn>

const events = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.map(([entry]) => (entry as { event: string }).event)

const setKey = (key: string | undefined) => {
  if (key === undefined) delete process.env['EDGE_TOKEN_ENCRYPTION_KEY']
  else process.env['EDGE_TOKEN_ENCRYPTION_KEY'] = key
  __resetCloudTokenCipherCache()
}

const makeApp = (rows: Array<{ _id: string; cloudToken?: string | null }>, patchError?: Error) => {
  const patch = vi.fn(async (id: string, data: { cloudToken: string }) => {
    if (patchError) throw patchError
    const row = rows.find(r => r._id === id)
    if (row) row.cloudToken = data.cloudToken
    return row
  })
  const find = vi.fn(async () => rows)
  const app = { service: () => ({ find, _patch: patch }) }
  return { app, patch, find }
}

describe('runCloudTokenBootMigration', () => {
  const original = process.env['EDGE_TOKEN_ENCRYPTION_KEY']

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    setKey(KEY)
  })

  afterEach(() => {
    setKey(original)
    vi.restoreAllMocks()
  })

  it('verschluesselt einen Klartext-Token beim Boot und liest ihn danach unveraendert', async () => {
    const rows = [{ _id: 'c1', cloudToken: 'plain-jwt' }]
    const { app, patch } = makeApp(rows)

    const result = await runCloudTokenBootMigration(app)

    expect(result).toMatchObject({ keyStatus: 'ok', rows: 1, encrypted: 1, plaintext: 0, unreadable: 0 })
    expect(patch).toHaveBeenCalledTimes(1)
    expect(rows[0].cloudToken?.startsWith('enc:v1:')).toBe(true)
    expect(decryptCloudToken(rows[0].cloudToken)).toBe('plain-jwt')
    expect(events(info)).toContain('bootstrap.token_encrypted')
    expect(error).not.toHaveBeenCalled()
  })

  it('ist idempotent: ein zweiter Lauf schreibt nichts mehr', async () => {
    const rows = [{ _id: 'c1', cloudToken: 'plain-jwt' }]
    const { app, patch } = makeApp(rows)

    await runCloudTokenBootMigration(app)
    const second = await runCloudTokenBootMigration(app)

    expect(patch).toHaveBeenCalledTimes(1)
    expect(second).toMatchObject({ encrypted: 0, verified: 1 })
  })

  it('laesst einen lesbaren verschluesselten Token unberuehrt', async () => {
    const stored = encryptCloudToken('plain-jwt')
    const rows = [{ _id: 'c1', cloudToken: stored }]
    const { app, patch } = makeApp(rows)

    const result = await runCloudTokenBootMigration(app)

    expect(result).toMatchObject({ verified: 1, unreadable: 0, encrypted: 0 })
    expect(patch).not.toHaveBeenCalled()
    expect(rows[0].cloudToken).toBe(stored)
  })

  it('meldet einen falschen Schluessel laut und faellt nicht auf Klartext zurueck', async () => {
    const stored = encryptCloudToken('plain-jwt')
    setKey(OTHER_KEY)
    const rows = [{ _id: 'c1', cloudToken: stored }]
    const { app, patch } = makeApp(rows)

    const result = await runCloudTokenBootMigration(app)

    expect(result).toMatchObject({ unreadable: 1, verified: 0, encrypted: 0 })
    expect(patch).not.toHaveBeenCalled()
    expect(rows[0].cloudToken).toBe(stored)
    expect(events(error)).toEqual(['bootstrap.token_key_mismatch'])
    const entry = error.mock.calls[0][0] as { message: string; connectionId: string }
    expect(entry.message).toMatch(/nicht entschluesseln/)
    expect(entry.connectionId).toBe('c1')
    expect(JSON.stringify(error.mock.calls)).not.toContain(OTHER_KEY)
  })

  it('meldet einen verschluesselten Token bei fehlendem Schluessel als Fehler', async () => {
    const stored = encryptCloudToken('plain-jwt')
    setKey(undefined)
    const { app, patch } = makeApp([{ _id: 'c1', cloudToken: stored }])

    const result = await runCloudTokenBootMigration(app)

    expect(result).toMatchObject({ keyStatus: 'missing', unreadable: 1 })
    expect(patch).not.toHaveBeenCalled()
    expect(events(error)).toEqual(['bootstrap.token_key_mismatch'])
    expect((error.mock.calls[0][0] as { message: string }).message).toMatch(/EDGE_TOKEN_ENCRYPTION_KEY fehlt/)
  })

  it('laesst Klartext ohne Schluessel stehen und warnt mit Behebungsweg', async () => {
    setKey(undefined)
    const rows = [{ _id: 'c1', cloudToken: 'plain-jwt' }]
    const { app, patch } = makeApp(rows)

    const result = await runCloudTokenBootMigration(app)

    expect(result).toMatchObject({ keyStatus: 'missing', plaintext: 1, encrypted: 0 })
    expect(patch).not.toHaveBeenCalled()
    expect(rows[0].cloudToken).toBe('plain-jwt')
    expect(events(warn)).toEqual(['bootstrap.token_key_missing'])
    expect((warn.mock.calls[0][0] as { message: string }).message).toMatch(/Installer erneut ausfuehren/)
    expect(error).not.toHaveBeenCalled()
  })

  it('warnt auch ohne Schluessel und ohne Token (Edge noch nicht gekoppelt)', async () => {
    setKey(undefined)
    const { app } = makeApp([])

    const result = await runCloudTokenBootMigration(app)

    expect(result).toMatchObject({ keyStatus: 'missing', rows: 0 })
    expect(events(warn)).toEqual(['bootstrap.token_key_missing'])
  })

  it('benennt einen Bestandsschluessel mit 8-31 Zeichen, ersetzt ihn aber nicht', async () => {
    setKey('kurzer-key-12')
    const rows = [{ _id: 'c1', cloudToken: 'plain-jwt' }]
    const { app } = makeApp(rows)

    const result = await runCloudTokenBootMigration(app)

    expect(result).toMatchObject({ keyStatus: 'weak', encrypted: 1 })
    expect(events(warn)).toEqual(['bootstrap.token_key_weak'])
    expect(JSON.stringify(warn.mock.calls)).not.toContain('kurzer-key-12')
    expect(decryptCloudToken(rows[0].cloudToken)).toBe('plain-jwt')
  })

  it('ueberspringt Zeilen ohne Token', async () => {
    const { app, patch } = makeApp([
      { _id: 'c1', cloudToken: null },
      { _id: 'c2', cloudToken: '' },
      { _id: 'c3' },
    ])

    const result = await runCloudTokenBootMigration(app)

    expect(result).toMatchObject({ rows: 0 })
    expect(patch).not.toHaveBeenCalled()
  })

  it('zaehlt ein gescheitertes Zurueckschreiben und wirft nicht', async () => {
    const { app } = makeApp([{ _id: 'c1', cloudToken: 'plain-jwt' }], new Error('SQLITE_BUSY'))

    const result = await runCloudTokenBootMigration(app)

    expect(result).toMatchObject({ failed: 1, encrypted: 0 })
    expect(events(error)).toEqual(['bootstrap.token_encrypt_failed'])
  })

  it('wirft nicht, wenn die Tabelle nicht lesbar ist', async () => {
    const app = {
      service: () => ({
        find: async () => {
          throw new Error('no such table')
        },
      }),
    }

    await expect(runCloudTokenBootMigration(app)).resolves.toBeNull()
    expect(events(warn)).toContain('bootstrap.token_migration_skipped')
  })
})
