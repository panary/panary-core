import { describe, expect, it } from 'vitest'
import { evaluateIdle, POS_IDLE_WARNING_MS, resolveWarningMs } from './idle-evaluator'

const NOW = 1_700_000_000_000
const TIMEOUT_MS = 120_000

const evaluate = (overrides: Partial<Parameters<typeof evaluateIdle>[0]> = {}) =>
  evaluateIdle({
    enabled: true,
    frozen: false,
    timeoutMs: TIMEOUT_MS,
    lastActivityAt: NOW,
    now: NOW,
    ...overrides,
  })

describe('evaluateIdle', () => {
  it('ist abgeschaltet, wenn der Mitarbeiter kein autoLogOff hat', () => {
    const result = evaluate({ enabled: false, lastActivityAt: NOW - 10 * TIMEOUT_MS })
    expect(result.phase).toBe('disabled')
    expect(result.shouldLogout).toBe(false)
  })

  it('loggt eingefroren auch weit über der Frist nicht aus', () => {
    const result = evaluate({ frozen: true, lastActivityAt: NOW - 10 * TIMEOUT_MS })
    expect(result.phase).toBe('frozen')
    expect(result.shouldLogout).toBe(false)
  })

  it('bleibt in der stillen Phase scharf, aber ohne Warnung', () => {
    const result = evaluate({ lastActivityAt: NOW - 30_000 })
    expect(result.phase).toBe('armed')
    expect(result.remainingMs).toBe(90_000)
    expect(result.shouldLogout).toBe(false)
  })

  it('zeigt die Warnung im Vorwarnfenster mit korrekter Restzeit', () => {
    const result = evaluate({ lastActivityAt: NOW - (TIMEOUT_MS - 15_000) })
    expect(result.phase).toBe('warning')
    expect(result.remainingMs).toBe(15_000)
    expect(result.shouldLogout).toBe(false)
  })

  it('wechselt genau an der Vorwarngrenze in die Warnung', () => {
    const atBoundary = evaluate({ lastActivityAt: NOW - (TIMEOUT_MS - POS_IDLE_WARNING_MS) })
    expect(atBoundary.phase).toBe('warning')

    const justBefore = evaluate({ lastActivityAt: NOW - (TIMEOUT_MS - POS_IDLE_WARNING_MS - 1) })
    expect(justBefore.phase).toBe('armed')
  })

  it('loggt auf und über der Frist aus', () => {
    expect(evaluate({ lastActivityAt: NOW - TIMEOUT_MS }).shouldLogout).toBe(true)
    expect(evaluate({ lastActivityAt: NOW - TIMEOUT_MS - 60_000 }).shouldLogout).toBe(true)
  })

  it('behandelt einen Uhr-Rücksprung als frische Aktivität statt als Ablauf', () => {
    const result = evaluate({ lastActivityAt: NOW + 60_000 })
    expect(result.phase).toBe('armed')
    expect(result.remainingMs).toBe(TIMEOUT_MS)
    expect(result.shouldLogout).toBe(false)
  })

  it('friert Vorrang vor einer bereits laufenden Warnung ein', () => {
    const result = evaluate({ frozen: true, lastActivityAt: NOW - (TIMEOUT_MS - 5_000) })
    expect(result.phase).toBe('frozen')
  })
})

describe('resolveWarningMs', () => {
  it('nutzt die volle Vorwarnzeit bei ausreichend langer Frist', () => {
    expect(resolveWarningMs(120_000)).toBe(POS_IDLE_WARNING_MS)
  })

  it('deckelt die Vorwarnzeit bei kurzer Frist auf die Hälfte', () => {
    expect(resolveWarningMs(30_000)).toBe(15_000)
  })
})
