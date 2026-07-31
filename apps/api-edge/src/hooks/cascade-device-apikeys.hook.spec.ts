import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@panary/shared-backend', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

import { logger } from '@panary/shared-backend'

import { captureDeviceForCascade, cascadeRemoveDeviceApikeys } from './cascade-device-apikeys.hook'

import type { HookContext } from '../declarations'

const makeApp = (opts: {
  device?: { deviceId?: string; apiKeyId?: string }
  deviceGetThrows?: boolean
  apikeys?: Array<{ _id: string }>
  apikeyFindThrows?: boolean
  removeThrowsFor?: string[]
}) => {
  const deviceGet = opts.deviceGetThrows
    ? vi.fn().mockRejectedValue(new Error('not found'))
    : vi.fn().mockResolvedValue(opts.device ?? { deviceId: 'dev-1', apiKeyId: 'key-1' })

  const apikeyFind = opts.apikeyFindThrows
    ? vi.fn().mockRejectedValue(new Error('403'))
    : vi.fn().mockResolvedValue({ data: opts.apikeys ?? [] })

  const apikeyPatch = vi.fn().mockResolvedValue({})
  const apikeyRemove = vi.fn().mockImplementation(async (id: string) => {
    if (opts.removeThrowsFor?.includes(id)) throw new Error('remove failed')
    return {}
  })

  const app = {
    service: (path: string) => {
      if (path === 'devices') return { get: deviceGet }
      if (path === 'apikeys') return { find: apikeyFind, patch: apikeyPatch, remove: apikeyRemove }
      throw new Error(`unerwarteter Service: ${path}`)
    },
  }

  return { app, deviceGet, apikeyFind, apikeyPatch, apikeyRemove }
}

const makeContext = (app: unknown, opts: { id?: string | null; cascadeDevice?: unknown; user?: unknown } = {}) =>
  ({
    // `in` statt `??`: ein explizites `id: null` muss durchkommen — genau der Fall,
    // den der Guard im Hook abfaengt.
    id: 'id' in opts ? opts.id : 'rec-1',
    app,
    params: { cascadeDevice: opts.cascadeDevice, user: opts.user },
  }) as unknown as HookContext

const removedIds = (remove: ReturnType<typeof vi.fn>) => remove.mock.calls.map(call => call[0]).sort()

beforeEach(() => {
  vi.clearAllMocks()
})

describe('captureDeviceForCascade', () => {
  it('legt deviceId und apiKeyId auf params ab', async () => {
    const { app } = makeApp({ device: { deviceId: 'dev-1', apiKeyId: 'key-1' } })
    const context = makeContext(app)

    await captureDeviceForCascade(context)

    expect((context.params as { cascadeDevice?: unknown }).cascadeDevice).toEqual({
      deviceId: 'dev-1',
      apiKeyId: 'key-1',
    })
  })

  it('degradiert bei einem Lookup-Fehler, statt den remove zu blockieren', async () => {
    const { app } = makeApp({ deviceGetThrows: true })
    const context = makeContext(app)

    await expect(captureDeviceForCascade(context)).resolves.toBe(context)
    expect((context.params as { cascadeDevice?: unknown }).cascadeDevice).toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'device.cascade_capture_failed' }))
  })

  it('ignoriert einen remove ohne id', async () => {
    const { app, deviceGet } = makeApp({})
    await captureDeviceForCascade(makeContext(app, { id: null }))
    expect(deviceGet).not.toHaveBeenCalled()
  })
})

describe('cascadeRemoveDeviceApikeys', () => {
  it('loescht die ueber deviceId gefundenen Schluessel', async () => {
    const { app, apikeyRemove } = makeApp({ apikeys: [{ _id: 'key-1' }, { _id: 'key-2' }] })
    const context = makeContext(app, { cascadeDevice: { deviceId: 'dev-1' } })

    await cascadeRemoveDeviceApikeys(context)

    expect(removedIds(apikeyRemove)).toEqual(['key-1', 'key-2'])
  })

  // apiKeyId setzt ein best-effort-Hook, dessen Fehler nur geloggt wird — die
  // Rueckwaerts-Referenz ueber deviceId ist die verlaessliche Quelle, apiKeyId
  // faengt den Fall ab, in dem sie fehlt.
  it('bildet die Vereinigungsmenge aus deviceId-Treffern und apiKeyId', async () => {
    const { app, apikeyRemove } = makeApp({ apikeys: [{ _id: 'key-1' }] })
    const context = makeContext(app, { cascadeDevice: { deviceId: 'dev-1', apiKeyId: 'key-verwaist' } })

    await cascadeRemoveDeviceApikeys(context)

    expect(removedIds(apikeyRemove)).toEqual(['key-1', 'key-verwaist'])
  })

  it('loescht jeden Schluessel genau einmal', async () => {
    const { app, apikeyRemove } = makeApp({ apikeys: [{ _id: 'key-1' }] })
    const context = makeContext(app, { cascadeDevice: { deviceId: 'dev-1', apiKeyId: 'key-1' } })

    await cascadeRemoveDeviceApikeys(context)

    expect(apikeyRemove).toHaveBeenCalledTimes(1)
  })

  // Entwerten vor Loeschen: scheitert der remove, ist der Schluessel wenigstens
  // inaktiv und authentifiziert nicht weiter.
  it('setzt active:false vor dem remove', async () => {
    const { app, apikeyPatch, apikeyRemove } = makeApp({ apikeys: [{ _id: 'key-1' }] })
    const context = makeContext(app, { cascadeDevice: { deviceId: 'dev-1' } })

    await cascadeRemoveDeviceApikeys(context)

    expect(apikeyPatch).toHaveBeenCalledWith('key-1', { active: false }, expect.objectContaining({ provider: undefined }))
    expect(apikeyPatch.mock.invocationCallOrder[0]).toBeLessThan(apikeyRemove.mock.invocationCallOrder[0])
  })

  it('widerruft die uebrigen Schluessel, wenn einer fehlschlaegt', async () => {
    const { app, apikeyRemove } = makeApp({
      apikeys: [{ _id: 'key-1' }, { _id: 'key-2' }],
      removeThrowsFor: ['key-1'],
    })
    const context = makeContext(app, { cascadeDevice: { deviceId: 'dev-1' } })

    await expect(cascadeRemoveDeviceApikeys(context)).resolves.toBe(context)

    expect(removedIds(apikeyRemove)).toEqual(['key-1', 'key-2'])
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ event: 'device.cascade_apikeys_failed' }))
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'device.cascade_apikeys', revokedCount: 1, failedCount: 1 }),
    )
  })

  // Ohne Actor steigt recordAuditEvent aus — der Widerruf fehlte dann im
  // Audit-Trail, obwohl AUDIT_RESOURCE_MAP apikeys.remove als API_KEY_REVOKE kennt.
  it('reicht params.user an die apikeys-Calls durch', async () => {
    const actor = { _id: 'u-1', role: 'tenant:owner' }
    const { app, apikeyPatch, apikeyRemove } = makeApp({ apikeys: [{ _id: 'key-1' }] })
    const context = makeContext(app, { cascadeDevice: { deviceId: 'dev-1' }, user: actor })

    await cascadeRemoveDeviceApikeys(context)

    expect(apikeyPatch).toHaveBeenCalledWith('key-1', expect.anything(), expect.objectContaining({ user: actor }))
    expect(apikeyRemove).toHaveBeenCalledWith('key-1', expect.objectContaining({ user: actor }))
  })

  it('faellt bei einem Lookup-Fehler auf apiKeyId zurueck', async () => {
    const { app, apikeyRemove } = makeApp({ apikeyFindThrows: true })
    const context = makeContext(app, { cascadeDevice: { deviceId: 'dev-1', apiKeyId: 'key-1' } })

    await cascadeRemoveDeviceApikeys(context)

    expect(removedIds(apikeyRemove)).toEqual(['key-1'])
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'device.cascade_lookup_failed' }))
  })

  it('macht nichts, wenn der Vorab-Lookup nichts hinterlassen hat', async () => {
    const { app, apikeyFind, apikeyRemove } = makeApp({})
    const context = makeContext(app, { cascadeDevice: undefined })

    await cascadeRemoveDeviceApikeys(context)

    expect(apikeyFind).not.toHaveBeenCalled()
    expect(apikeyRemove).not.toHaveBeenCalled()
  })
})
