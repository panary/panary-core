import { describe, expect, it, vi } from 'vitest'

import { requireDeviceReverification } from './require-device-reverification.hook'

/**
 * `next` je Test anlegen, nicht modulweit (testing.md §10): `next.mock.calls`
 * ist ein Aufzeichnungsarray, und ein geteiltes Handle laesst einen Nachzuegler
 * aus Test 1 in die Zaehlung von Test 2 schreiben. Ein `vi.clearAllMocks()` im
 * `beforeEach` ist genau die Form, die §10 fuer neue Specs ausschliesst.
 * Praezedenzfall im Repo: `print-server/auth.middleware.spec.ts` (#199).
 */
const makeNext = () => vi.fn(() => Promise.resolve())

function makeContext(opts: {
  method?: string
  path?: string
  provider?: string
  requiresReverification?: boolean
}): any {
  return {
    method: opts.method ?? 'create',
    path: opts.path ?? 'orders',
    params: {
      provider: 'provider' in opts ? opts.provider : 'socketio',
      connection: {
        apiKey: true,
        deviceId: 'dev-1',
        deviceRole: 'device:pos-client',
        requiresReverification: opts.requiresReverification ?? true,
        reverificationOfflineSince: '2026-09-01T06:00:00.000Z',
      },
    },
  }
}

describe('requireDeviceReverification()', () => {
  it('sperrt orders.create, solange die Bestaetigung aussteht — der Kern der Durchsetzung', async () => {
    const next = makeNext()
    await expect(requireDeviceReverification()(makeContext({}), next)).rejects.toMatchObject({ code: 503 })
    expect(next).not.toHaveBeenCalled()
  })

  it('sperrt auch orders.patch', async () => {
    const next = makeNext()
    await expect(requireDeviceReverification()(makeContext({ method: 'patch' }), next)).rejects.toMatchObject({
      code: 503,
    })
  })

  it('sperrt fail-closed: eine unbekannte Custom-Method ist ohne Zutun gesperrt', async () => {
    const next = makeNext()
    // Genau dafuer ist die Allowlist da — eine Verbotsliste muesste bei jeder
    // neuen Methode nachgezogen werden, und die vergessene Zeile faellt erst
    // auf, wenn sie jemand ausnutzt.
    await expect(
      requireDeviceReverification()(makeContext({ method: 'irgendwasNeues', path: 'users' }), next),
    ).rejects.toMatchObject({ code: 503 })
  })

  it('traegt den stabilen Fehlercode fuer den Client', async () => {
    const next = makeNext()
    await expect(requireDeviceReverification()(makeContext({}), next)).rejects.toMatchObject({
      data: { code: 'DEVICE_REVERIFICATION_REQUIRED' },
    })
  })

  it('🚨 wirft KEINEN Code, den die Outbox als terminal einstuft', async () => {
    const next = makeNext()
    // `classifyOutboxError` (libs/shared/offline-cache/src/lib/outbox.ts) stuft
    // 400/401/403/422 als `terminal` ein und `markRejected` loescht den Eintrag
    // unwiederbringlich — die offline erfasste Bestellung waere weg. Die
    // Gegenprobe gegen den echten Klassifizierer steht in dessen eigener Spec
    // (outbox.classify.spec.ts); hier wird nur der Code selbst gelockt, weil
    // der Barrel von @panary/shared/offline-cache Angular mitzieht.
    let thrown: { code?: number } | undefined
    await requireDeviceReverification()(makeContext({}), next).catch(err => (thrown = err))

    expect([400, 401, 403, 422]).not.toContain(thrown?.code)
  })

  it.each(['find', 'get'])('laesst Lesen durch (%s) — sonst bliebe der Bildschirm leer', async method => {
    const next = makeNext()
    await expect(requireDeviceReverification()(makeContext({ method }), next)).resolves.toBeUndefined()
    expect(next).toHaveBeenCalledOnce()
  })

  it('laesst verifyPin durch — es IST der Freigabe-Pfad', async () => {
    const next = makeNext()
    await expect(
      requireDeviceReverification()(makeContext({ method: 'verifyPin', path: 'users' }), next),
    ).resolves.toBeUndefined()
    expect(next).toHaveBeenCalledOnce()
  })

  it('laesst ein Geraet ohne ausstehende Bestaetigung unveraendert arbeiten', async () => {
    const next = makeNext()
    await expect(
      requireDeviceReverification()(makeContext({ requiresReverification: false }), next),
    ).resolves.toBeUndefined()
    expect(next).toHaveBeenCalledOnce()
  })

  it('laesst interne Aufrufe durch (kein provider) — Sync-Apply und Worker duerfen nie blockieren', async () => {
    const next = makeNext()
    await expect(requireDeviceReverification()(makeContext({ provider: undefined }), next)).resolves.toBeUndefined()
    expect(next).toHaveBeenCalledOnce()
  })

  it('laesst Verbindungen ohne Connection durch (REST/JWT-Admin)', async () => {
    const next = makeNext()
    const ctx: any = { method: 'create', path: 'orders', params: { provider: 'rest' } }

    await expect(requireDeviceReverification()(ctx, next)).resolves.toBeUndefined()
    expect(next).toHaveBeenCalledOnce()
  })
})
