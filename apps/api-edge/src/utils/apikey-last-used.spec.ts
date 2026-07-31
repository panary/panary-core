import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetApiKeyLastUsedThrottle, stampApiKeyLastUsed } from './apikey-last-used'

import type { Application } from '../declarations'

// Der Helper laeuft in beiden Auth-Pfaden (WS-Handshake, Print-Server) und ist
// fire-and-forget: die Mechanik (Drosselung, Rollback bei Fehler, kein Write auf
// leere Id) ist die eigentliche Zusicherung — ein durchgerutschter Write pro
// Request wuerde den SQLite-Writer belasten, eine haengende Drossel wuerde das
// Feld dauerhaft veralten lassen.
const makeApp = (patch: (...args: unknown[]) => Promise<unknown>) =>
  ({
    service: () => ({ patch }),
  }) as unknown as Application

/** Laesst die fire-and-forget-Promise im Helper durchlaufen. */
const flush = () => new Promise(resolve => setImmediate(resolve))

describe('stampApiKeyLastUsed', () => {
  beforeEach(() => {
    __resetApiKeyLastUsedThrottle()
    // NUR Date faken: der Helper drosselt ueber Date.now(). Wuerde man auch
    // setImmediate faken, liefe `flush()` nie durch und jeder Test liefe in den
    // Timeout.
    vi.useFakeTimers({ toFake: ['Date'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('schreibt beim ersten Aufruf ueber die Adapter-API mit provider: undefined', async () => {
    const patch = vi.fn().mockResolvedValue({})
    stampApiKeyLastUsed(makeApp(patch), 'key-1')
    await flush()

    expect(patch).toHaveBeenCalledTimes(1)
    const [id, data, params] = patch.mock.calls[0]
    expect(id).toBe('key-1')
    expect(typeof (data as { lastUsedAt: string }).lastUsedAt).toBe('string')
    expect((params as { provider: undefined }).provider).toBeUndefined()
  })

  it('drosselt einen zweiten Aufruf innerhalb des Intervalls', async () => {
    const patch = vi.fn().mockResolvedValue({})
    const app = makeApp(patch)

    stampApiKeyLastUsed(app, 'key-1')
    await flush()
    vi.advanceTimersByTime(4 * 60 * 1000)
    stampApiKeyLastUsed(app, 'key-1')
    await flush()

    expect(patch).toHaveBeenCalledTimes(1)
  })

  it('schreibt nach Ablauf des Intervalls wieder', async () => {
    const patch = vi.fn().mockResolvedValue({})
    const app = makeApp(patch)

    stampApiKeyLastUsed(app, 'key-1')
    await flush()
    vi.advanceTimersByTime(5 * 60 * 1000 + 1)
    stampApiKeyLastUsed(app, 'key-1')
    await flush()

    expect(patch).toHaveBeenCalledTimes(2)
  })

  it('drosselt pro Key, nicht global', async () => {
    const patch = vi.fn().mockResolvedValue({})
    const app = makeApp(patch)

    stampApiKeyLastUsed(app, 'key-1')
    stampApiKeyLastUsed(app, 'key-2')
    await flush()

    expect(patch).toHaveBeenCalledTimes(2)
  })

  it('setzt die Drossel bei einem Schreibfehler zurueck', async () => {
    const patch = vi.fn().mockRejectedValueOnce(new Error('db locked')).mockResolvedValue({})
    const app = makeApp(patch)

    stampApiKeyLastUsed(app, 'key-1')
    await flush()
    // Ohne Rollback waere der naechste Versuch fuer 5 Minuten gesperrt.
    stampApiKeyLastUsed(app, 'key-1')
    await flush()

    expect(patch).toHaveBeenCalledTimes(2)
  })

  it('schreibt nicht ohne apiKeyId', async () => {
    const patch = vi.fn().mockResolvedValue({})
    stampApiKeyLastUsed(makeApp(patch), '')
    await flush()

    expect(patch).not.toHaveBeenCalled()
  })
})
