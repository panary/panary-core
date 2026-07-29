import { describe, expect, it } from 'vitest'

import { deviceExternalResolver, deviceQueryResolver } from './devices.schema'

import type { HookContext } from '../../declarations'
import type { DeviceService } from './devices.class'

// READ-Self-Scoping (PNRY-FEAT-POS-UI-SCALE-001): nicht-privilegierte Leser
// (insb. DEVICE_POS) werden im Query-Resolver auf die eigene deviceId
// gezwungen; der External-Resolver strippt apiKeyId/metadata. Privilegierte
// Rollen und interne Aufrufe bleiben unveraendert.
const makeContext = (opts: {
  provider?: string
  user?: unknown
  authentication?: unknown
}): HookContext<DeviceService> =>
  ({
    params: { provider: opts.provider, user: opts.user, authentication: opts.authentication },
  }) as unknown as HookContext<DeviceService>

// Virtueller Device-User, wie ihn der allowApiKey-Hook aufbaut.
const posDeviceUser = {
  _id: 'device:dev-1',
  role: 'device:pos-client',
  tenantId: 't-1',
  locationId: 'loc-1',
}

const sampleDevice = {
  _id: 'rec-1',
  deviceId: 'dev-1',
  name: 'POS Counter 1',
  apiKeyId: 'key-1',
  metadata: { userAgent: 'ua', ipAddress: '10.0.0.5' },
}

describe('deviceQueryResolver — READ-Self-Scoping', () => {
  it('interner Call (kein provider) → Query unveraendert', async () => {
    const resolved = await deviceQueryResolver.resolve({ deviceId: 'dev-9' }, makeContext({}))
    expect(resolved.deviceId).toBe('dev-9')
  })

  it('privilegierte Rolle (tenant:owner) → Query unveraendert (auch ohne deviceId-Filter)', async () => {
    const context = makeContext({ provider: 'socketio', user: { _id: 'u-1', role: 'tenant:owner' } })
    const resolved = await deviceQueryResolver.resolve({}, context)
    expect(resolved.deviceId).toBeUndefined()
  })

  it('platform:*-Rolle → Query unveraendert (Bypass-Semantik analog multiTenancy)', async () => {
    const context = makeContext({ provider: 'rest', user: { _id: 'u-2', role: 'platform:support' } })
    const resolved = await deviceQueryResolver.resolve({ deviceId: 'dev-7' }, context)
    expect(resolved.deviceId).toBe('dev-7')
  })

  it('DEVICE_POS ohne Filter → wird auf die eigene deviceId gezwungen', async () => {
    const context = makeContext({ provider: 'socketio', user: posDeviceUser })
    const resolved = await deviceQueryResolver.resolve({}, context)
    expect(resolved.deviceId).toBe('dev-1')
  })

  it('DEVICE_POS mit fremder deviceId in der Query → Enumeration wird ueberschrieben', async () => {
    const context = makeContext({
      provider: 'socketio',
      user: posDeviceUser,
      authentication: { payload: { deviceId: 'dev-1' } },
    })
    const resolved = await deviceQueryResolver.resolve({ deviceId: 'dev-fremd' }, context)
    expect(resolved.deviceId).toBe('dev-1')
  })

  it('nicht-privilegiert ohne ableitbare Geraete-Identitaet → Ablehnung (fail-closed)', async () => {
    const context = makeContext({ provider: 'rest', user: { _id: 'u-3', role: 'tenant:staff' } })
    // Der Feathers-Resolver wrappt Property-Fehler in einen BadRequest —
    // entscheidend ist die Ablehnung selbst plus die transportierte Forbidden-Ursache.
    const rejection = await deviceQueryResolver.resolve({}, context).then(
      () => null,
      e => e as Error & { data?: unknown },
    )
    expect(rejection).not.toBeNull()
    expect(JSON.stringify({ message: rejection?.message, data: rejection?.data })).toContain(
      'nur fuer das eigene Geraet',
    )
  })
})

describe('deviceExternalResolver — sensible Felder', () => {
  it('DEVICE_POS → apiKeyId und metadata werden gestrippt, Rest bleibt', async () => {
    const context = makeContext({ provider: 'socketio', user: posDeviceUser })
    const resolved = await deviceExternalResolver.resolve(sampleDevice, context)
    expect(resolved.apiKeyId).toBeUndefined()
    expect(resolved.metadata).toBeUndefined()
    expect(resolved.name).toBe('POS Counter 1')
    expect(resolved.deviceId).toBe('dev-1')
  })

  it('privilegierte Rolle (tenant:owner) → apiKeyId und metadata bleiben erhalten', async () => {
    const context = makeContext({ provider: 'rest', user: { _id: 'u-1', role: 'tenant:owner' } })
    const resolved = await deviceExternalResolver.resolve(sampleDevice, context)
    expect(resolved.apiKeyId).toBe('key-1')
    expect(resolved.metadata).toEqual({ userAgent: 'ua', ipAddress: '10.0.0.5' })
  })
})
