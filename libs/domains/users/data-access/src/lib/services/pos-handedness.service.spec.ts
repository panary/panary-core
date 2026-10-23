// JIT-Compiler zuerst laden: @angular/material ist partial-compiled (ueber @panary/shared/data-access).
import '@angular/compiler'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Injector, runInInjectionContext, signal } from '@angular/core'
import { ConnectionService, POS_OPERATOR_TOKEN_STORAGE_KEY } from '@panary/shared/data-access'
import {
  POS_HANDEDNESS_PENDING_STORAGE_KEY,
  PosHandednessNoOperatorError,
  PosHandednessService,
  type PendingPosHandedness,
} from './pos-handedness.service'

/** Eigener Speicher je Test (testing.md §10.1) statt des geteilten globalen. */
function memoryStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size
    },
  }
}

function setup(state: { online?: boolean; token?: string | null; pending?: PendingPosHandedness[] } = {}) {
  const storage = memoryStorage()
  vi.stubGlobal('localStorage', storage)
  onTestFinished(() => {
    vi.unstubAllGlobals()
  })
  if (state.token !== null) {
    storage.setItem(
      POS_OPERATOR_TOKEN_STORAGE_KEY,
      JSON.stringify({
        operatorToken: state.token ?? 'tok-anna',
        operatorTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    )
  }
  if (state.pending) storage.setItem(POS_HANDEDNESS_PENDING_STORAGE_KEY, JSON.stringify(state.pending))

  const status = signal(state.online === false ? 'disconnected' : 'authenticated')
  const send = vi.fn().mockResolvedValue({})
  const injector = Injector.create({
    providers: [
      {
        provide: ConnectionService,
        useValue: { connectionState: () => ({ status: status() }), userService: { setPosHandedness: send } },
      },
    ],
  })
  const service = runInInjectionContext(injector, () => new PosHandednessService())
  const pending = () =>
    JSON.parse(storage.getItem(POS_HANDEDNESS_PENDING_STORAGE_KEY) ?? '[]') as PendingPosHandedness[]
  return { service, send, status, pending }
}

const anna = { _id: 'u-anna' }

describe('PosHandednessService (core#833)', () => {
  it('ohne eigene Wahl gilt der Datensatz, ohne Datensatz links', () => {
    const { service } = setup()
    expect(service.effective({ _id: 'u-x', posHandedness: 'right' })).toBe('right')
    expect(service.effective({ _id: 'u-y' })).toBe('left')
    expect(service.effective(undefined)).toBe('left')
  })

  it('online: sofort wirksam, mit dem Bediener-Token gesendet, nichts gemerkt', async () => {
    const { service, send, pending } = setup()

    await expect(service.choose(anna._id, 'right')).resolves.toBe('saved')

    expect(service.effective({ ...anna, posHandedness: 'left' })).toBe('right')
    expect(send.mock.calls).toEqual([[{ posHandedness: 'right' }, { query: { operatorToken: 'tok-anna' } }]])
    expect(pending()).toEqual([])
  })

  it('offline: sofort wirksam, mit Token gemerkt, nichts gesendet', async () => {
    const { service, send, pending } = setup({ online: false })

    await expect(service.choose(anna._id, 'right')).resolves.toBe('pending')

    expect(service.effective(anna)).toBe('right')
    expect(send).not.toHaveBeenCalled()
    expect(pending()).toEqual([{ userId: 'u-anna', posHandedness: 'right', operatorToken: 'tok-anna' }])
  })

  it('Verbindungsfehler beim Senden: gemerkt statt zurückgedreht', async () => {
    const { service, send, pending } = setup()
    send.mockRejectedValue(Object.assign(new Error('Timeout'), { code: 408 }))

    await expect(service.choose(anna._id, 'right')).resolves.toBe('pending')

    expect(service.effective(anna)).toBe('right')
    expect(pending().map(entry => entry.userId)).toEqual(['u-anna'])
  })

  it('Ablehnung durch den Edge: zurückgedreht, nicht gemerkt, Fehler geht weiter', async () => {
    const { service, send, pending } = setup()
    send.mockRejectedValue(Object.assign(new Error('NotAuthenticated'), { code: 401 }))

    await expect(service.choose(anna._id, 'right')).rejects.toMatchObject({ code: 401 })

    expect(service.effective({ ...anna, posHandedness: 'left' })).toBe('left')
    expect(pending()).toEqual([])
  })

  it('ohne Bediener-Token: keine Wahl, nichts gesendet', async () => {
    const { service, send } = setup({ token: null })

    await expect(service.choose(anna._id, 'right')).rejects.toBeInstanceOf(PosHandednessNoOperatorError)

    expect(service.effective(anna)).toBe('left')
    expect(send).not.toHaveBeenCalled()
  })

  it('flush sendet jede gemerkte Wahl mit dem Token ihrer Sitzung und vergisst sie danach', async () => {
    const { service, send, pending } = setup({
      token: 'tok-jetzt',
      pending: [
        { userId: 'u-anna', posHandedness: 'right', operatorToken: 'tok-anna' },
        { userId: 'u-bruno', posHandedness: 'left', operatorToken: 'tok-bruno' },
      ],
    })

    await service.flush()

    expect(send.mock.calls).toEqual([
      [{ posHandedness: 'right' }, { query: { operatorToken: 'tok-anna' } }],
      [{ posHandedness: 'left' }, { query: { operatorToken: 'tok-bruno' } }],
    ])
    expect(pending()).toEqual([])
  })

  it('flush: endgültig abgelehnte Wahl verfällt samt lokaler Wirkung, Verbindungsfehler bleibt gemerkt', async () => {
    const { service, send, pending } = setup({
      pending: [
        { userId: 'u-anna', posHandedness: 'right', operatorToken: 'tok-alt' },
        { userId: 'u-bruno', posHandedness: 'right', operatorToken: 'tok-bruno' },
      ],
    })
    send
      .mockRejectedValueOnce(Object.assign(new Error('abgelaufen'), { code: 401 }))
      .mockRejectedValueOnce(Object.assign(new Error('weg'), { code: 503 }))

    await service.flush()

    expect(service.effective({ _id: 'u-anna' })).toBe('left')
    expect(service.effective({ _id: 'u-bruno' })).toBe('right')
    expect(pending().map(entry => entry.userId)).toEqual(['u-bruno'])
  })
})
