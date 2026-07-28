import { Forbidden } from '@feathersjs/errors'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@panary/cloud-connection/domain', () => ({
  PairingStatus: { CONNECTED: 'connected', DISCONNECTED: 'disconnected' },
}))

import { cloudManaged } from './cloud-managed.hook'

function makeContext(opts: {
  method?: string
  path?: string
  provider?: string
  data?: unknown
  connection?: Record<string, unknown> | null
  findThrows?: boolean
}): any {
  const find = opts.findThrows
    ? vi.fn().mockRejectedValue(new Error('service not registered'))
    : vi.fn().mockResolvedValue(opts.connection ? [opts.connection] : [])
  return {
    app: { service: () => ({ find }) },
    method: opts.method ?? 'patch',
    path: opts.path ?? 'locations',
    data: opts.data ?? { settings: {} },
    params: { provider: 'provider' in opts ? opts.provider : 'rest' } as Record<string, unknown>,
  }
}

const PAIRED = { _id: 'cc-1', pairingStatus: 'connected' }
const next = () => Promise.resolve()

beforeEach(() => vi.clearAllMocks())

describe('cloudManaged()', () => {
  it('laesst interne Aufrufe durch (kein provider) — sonst wuerde der Cloud-Pull sich selbst blocken', async () => {
    const ctx = makeContext({ provider: undefined, connection: PAIRED })

    await expect(cloudManaged()(ctx, next)).resolves.toBeUndefined()
  })

  it('laesst Reads durch', async () => {
    const ctx = makeContext({ method: 'find', connection: PAIRED })

    await expect(cloudManaged()(ctx, next)).resolves.toBeUndefined()
  })

  it('laesst externe Writes ohne Pairing durch', async () => {
    const ctx = makeContext({ connection: null })

    await expect(cloudManaged()(ctx, next)).resolves.toBeUndefined()
  })

  it('blockt externe Writes bei aktivem Pairing mit CLOUD_MANAGED', async () => {
    const ctx = makeContext({ connection: PAIRED })

    await expect(cloudManaged()(ctx, next)).rejects.toBeInstanceOf(Forbidden)
    await expect(cloudManaged()(makeContext({ connection: PAIRED }), next)).rejects.toMatchObject({
      data: { code: 'CLOUD_MANAGED' },
    })
  })

  // Fail-open ist Absicht: beim allerersten Boot ist der cloud-connection-Service
  // noch nicht registriert — ein harter Block wuerde das Setup verhindern.
  it('faellt bei nicht lesbarer cloud-connection offen', async () => {
    const ctx = makeContext({ findThrows: true })

    await expect(cloudManaged()(ctx, next)).resolves.toBeUndefined()
  })

  describe('Notfall-Modus (ADR 0001)', () => {
    const override = { ...PAIRED, emergencyOverride: true }

    it('laesst einen reinen printSettings-Patch durch und markiert ihn', async () => {
      const ctx = makeContext({
        connection: override,
        data: { settings: { printSettings: { printers: [] } } },
      })

      await expect(cloudManaged()(ctx, next)).resolves.toBeUndefined()
      // Markierung fuer den After-Hook, der die Diff in pending-local-overrides schreibt.
      expect(ctx.params.isEmergencyOverride).toBe(true)
    })

    // Das Frontend sendet stets den kompletten settings-Block; weitere
    // Top-Level-Keys deuten auf Drift oder einen Angriffsversuch hin.
    it('blockt, wenn neben settings weitere Top-Level-Felder gepatcht werden', async () => {
      const ctx = makeContext({
        connection: override,
        data: { name: 'Neue Filiale', settings: { printSettings: {} } },
      })

      await expect(cloudManaged()(ctx, next)).rejects.toBeInstanceOf(Forbidden)
    })

    it('blockt einen settings-Patch ohne printSettings — Tische/Pager bleiben gesperrt', async () => {
      const ctx = makeContext({
        connection: override,
        data: { settings: { tableSettings: { enabled: true, rooms: [] } } },
      })

      await expect(cloudManaged()(ctx, next)).rejects.toBeInstanceOf(Forbidden)
    })

    it('blockt andere Methoden als patch', async () => {
      const ctx = makeContext({
        connection: override,
        method: 'create',
        data: { settings: { printSettings: {} } },
      })

      await expect(cloudManaged()(ctx, next)).rejects.toBeInstanceOf(Forbidden)
    })

    it('blockt andere Services als locations', async () => {
      const ctx = makeContext({
        connection: override,
        path: 'opening-hour-exceptions',
        data: { settings: { printSettings: {} } },
      })

      await expect(cloudManaged()(ctx, next)).rejects.toBeInstanceOf(Forbidden)
    })
  })
})
