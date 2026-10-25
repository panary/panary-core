// JIT-Compiler zuerst laden: @angular/material ist partial-compiled.
import '@angular/compiler'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Injector, runInInjectionContext, signal } from '@angular/core'
import { PosSessionService } from '@panary/auth/data-access'
import { LocationService } from '@panary/locations/data-access'
import { resolveAutoLogOffTimeoutMs } from '@panary/locations/domain'
import { KasseDraftRegistry } from '@panary/orders/feature-pos-order-dialog'
import { resolveWarningMs } from './idle-evaluator'
import { PosIdleLogoutService } from './pos-idle-logout.service'

const SETTINGS = { autoLogOffTime: 5, autoLogOffTimeUnit: 'min' }
const TIMEOUT_MS = resolveAutoLogOffTimeoutMs(SETTINGS)

/** Jeder Test baut seine eigenen Fakes (testing.md §10). Die Umgebung ist `node`: document und localStorage fehlen. */
function setup(state: { input?: boolean; offline?: boolean } = {}) {
  vi.useFakeTimers()
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('localStorage', { getItem: () => null })
  onTestFinished(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const order: string[] = []
  const session = {
    isOffline: signal(!!state.offline),
    endSession: vi.fn((reason: string) => {
      order.push(`endSession:${reason}`)
      return Promise.resolve(true)
    }),
  }
  const kasse = new KasseDraftRegistry()
  const discard = vi.fn(() => void order.push('discard'))
  kasse.attach({ hasInput: () => !!state.input, confirmLeave: () => Promise.resolve(true), discard })

  const injector = Injector.create({
    providers: [
      { provide: PosSessionService, useValue: session },
      { provide: LocationService, useValue: { genericUserSettings: SETTINGS } },
      { provide: KasseDraftRegistry, useValue: kasse },
    ],
  })
  const service = runInInjectionContext(injector, () => new PosIdleLogoutService())
  service.start()
  onTestFinished(() => service.stop())
  return { service, session, discard, order }
}

describe('PosIdleLogoutService — angefangene Bestellung (core#1064)', () => {
  it('meldet trotz angefangener Bestellung nach Ablauf der Frist ab und verwirft sie vorher', () => {
    const { session, order } = setup({ input: true })

    vi.advanceTimersByTime(TIMEOUT_MS + 1_000)

    expect(session.endSession).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['discard', 'endSession:idle'])
  })

  it('kündigt das Verwerfen in der Vorwarnung an, nur wenn etwas eingegeben ist', () => {
    const withOrder = setup({ input: true })
    vi.advanceTimersByTime(TIMEOUT_MS - resolveWarningMs(TIMEOUT_MS) + 1_000)
    expect(withOrder.service.phase()).toBe('warning')
    expect(withOrder.service.discardsOrder()).toBe(true)
  })

  it('ohne Bestellung: Vorwarnung ohne Verwerfen-Hinweis, Logout ohne Abbruch-Protokoll', () => {
    const { service, discard, session } = setup({ input: false })
    vi.advanceTimersByTime(TIMEOUT_MS - resolveWarningMs(TIMEOUT_MS) + 1_000)
    expect(service.phase()).toBe('warning')
    expect(service.discardsOrder()).toBe(false)

    vi.advanceTimersByTime(resolveWarningMs(TIMEOUT_MS))
    expect(session.endSession.mock.calls).toEqual([['idle']])
    expect(discard).not.toHaveBeenCalled()
  })

  it('offline bleibt die Frist ausgesetzt, auch mit Bestellung', () => {
    const { session, discard } = setup({ input: true, offline: true })
    vi.advanceTimersByTime(TIMEOUT_MS * 3)
    expect(session.endSession).not.toHaveBeenCalled()
    expect(discard).not.toHaveBeenCalled()
  })
})
