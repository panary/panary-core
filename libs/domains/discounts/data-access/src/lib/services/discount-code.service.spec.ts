import { Injector, runInInjectionContext } from '@angular/core'
import { describe, expect, it, onTestFinished, vi } from 'vitest'

vi.mock('@panary/shared/data-access', () => ({ ConnectionService: class ConnectionService {} }))

import { ConnectionService } from '@panary/shared/data-access'

import {
  CODE_CHECK_TIMEOUT_MS,
  CodeProxyReason,
  DiscountCodeService,
  codeResultMessage,
  isTechnicalCodeFailure,
} from './discount-code.service'

// cloud#1429: Der Service fing jede Exception als „Cloud nicht erreichbar" ab. Geprüft wird hier
// die Verdrahtung in check()/redeem() — die Zuordnung selbst prüft code-proxy-reason.spec.ts.
function serviceWith(redeemService: unknown, status = 'authenticated'): DiscountCodeService {
  const injector = Injector.create({
    providers: [
      {
        provide: ConnectionService,
        useValue: { discountCodeRedeemService: redeemService, connectionState: () => ({ status }) },
      },
    ],
  })
  return runInInjectionContext(injector, () => new DiscountCodeService())
}

function serviceThatThrows(error: unknown): DiscountCodeService {
  return serviceWith({ find: vi.fn().mockRejectedValue(error), create: vi.fn().mockRejectedValue(error) })
}

describe('DiscountCodeService — Zugangs-Ablehnung (cloud#1429)', () => {
  it('check() meldet 401 als „nicht zugelassen"', async () => {
    const result = await serviceThatThrows({ name: 'NotAuthenticated', code: 401 }).check('SOMMER')
    expect(result).toEqual({ ok: false, reason: CodeProxyReason.NOT_AUTHORIZED })
  })

  it('redeem() meldet 403 als „nicht zugelassen"', async () => {
    const result = await serviceThatThrows({ name: 'Forbidden', code: 403 }).redeem({ code: 'SOMMER' })
    expect(result).toEqual({ ok: false, reason: CodeProxyReason.NOT_AUTHORIZED })
  })

  it('bleibt bei Netzfehlern bei „Cloud nicht erreichbar"', async () => {
    const result = await serviceThatThrows(new Error('socket hang up')).check('SOMMER')
    expect(result).toEqual({ ok: false, reason: CodeProxyReason.CLOUD_UNREACHABLE })
  })

  it('zählt „nicht zugelassen" als technisch und nennt den Support statt der Verbindung', () => {
    expect(isTechnicalCodeFailure(CodeProxyReason.NOT_AUTHORIZED)).toEqual(true)
    expect(codeResultMessage(CodeProxyReason.NOT_AUTHORIZED)).toEqual(
      'Kasse ist für Rabattcodes nicht zugelassen — bitte den Support kontaktieren',
    )
  })
})

// core#808: Bei gestopptem Edge puffert der Socket-Client den Aufruf bis zum Reconnect — das Promise
// blieb offen und der Dialog stand auf „Code wird geprüft…".
describe('DiscountCodeService — getrennte Verbindung (core#808)', () => {
  const pending = () => new Promise<never>(() => undefined)

  it('check() meldet bei getrennter Verbindung sofort „nicht erreichbar", ohne zu senden', async () => {
    const svc = { find: vi.fn(pending), create: vi.fn(pending) }
    const result = await serviceWith(svc, 'disconnected').check('SOMMER')
    expect(result).toEqual({ ok: false, reason: CodeProxyReason.CLOUD_UNREACHABLE })
    expect(svc.find).not.toHaveBeenCalled()
  })

  it('redeem() sendet bei getrennter Verbindung gar nicht erst — der Code bleibt unverbraucht', async () => {
    const svc = { find: vi.fn(pending), create: vi.fn(pending) }
    const result = await serviceWith(svc, 'error').redeem({ code: 'SOMMER' })
    expect(result).toEqual({ ok: false, reason: CodeProxyReason.CLOUD_UNREACHABLE })
    expect(svc.create).not.toHaveBeenCalled()
  })

  it('check() gibt nach der Zeitgrenze auf, wenn die Antwort ausbleibt', async () => {
    vi.useFakeTimers()
    onTestFinished(() => vi.useRealTimers())
    const svc = { find: vi.fn(pending), create: vi.fn(pending) }
    const pendingResult = serviceWith(svc).check('SOMMER')
    await vi.advanceTimersByTimeAsync(CODE_CHECK_TIMEOUT_MS)
    await expect(pendingResult).resolves.toEqual({ ok: false, reason: CodeProxyReason.CLOUD_UNREACHABLE })
  })
})
