import { Injector, runInInjectionContext } from '@angular/core'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@panary/shared/data-access', () => ({ ConnectionService: class ConnectionService {} }))

import { ConnectionService } from '@panary/shared/data-access'

import {
  CodeProxyReason,
  DiscountCodeService,
  codeResultMessage,
  isTechnicalCodeFailure,
} from './discount-code.service'

// cloud#1429: Der Service fing jede Exception als „Cloud nicht erreichbar" ab. Geprüft wird hier
// die Verdrahtung in check()/redeem() — die Zuordnung selbst prüft code-proxy-reason.spec.ts.
function serviceThatThrows(error: unknown): DiscountCodeService {
  const failing = { find: vi.fn().mockRejectedValue(error), create: vi.fn().mockRejectedValue(error) }
  const injector = Injector.create({
    providers: [{ provide: ConnectionService, useValue: { discountCodeRedeemService: failing } }],
  })
  return runInInjectionContext(injector, () => new DiscountCodeService())
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
