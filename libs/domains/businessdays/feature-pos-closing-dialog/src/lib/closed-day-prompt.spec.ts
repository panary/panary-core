import { of } from 'rxjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MatDialog } from '@angular/material/dialog'

// Wie in cash-session-prompt.spec: Geprüft wird, was der Helfer dem Dialog übergibt und wie er die Antwort
// deutet, nicht der Dialog selbst. `opened`/`answer` stehen im Modul-Scope (der Mock ist gehoistet) und werden
// vor jedem Test zurückgesetzt, damit ein Nachzügler keinen späteren Test erreicht (testing.md §10).
const opened: Array<Record<string, unknown>> = []
let answer: unknown = null
vi.mock('./closed-day-approval-dialog.component', () => ({
  openClosedDayApprovalDialog: (_dialog: unknown, data: Record<string, unknown>) => {
    opened.push(data)
    return { afterClosed: () => of(answer) }
  },
}))

import {
  CLOSED_DAY_STATUS_TIMEOUT_MS,
  ensureClosedDayApproval,
  promptClosedDayApprovalFromError,
} from './closed-day-prompt'

beforeEach(() => {
  opened.length = 0
  answer = null
})

const dialog = {} as MatDialog
const status = (over: Record<string, unknown> = {}) => ({
  getClosedDayStatus: vi.fn().mockResolvedValue({
    approvalRequired: true,
    state: 'closed',
    date: '2026-10-26',
    policy: 'block',
    ...over,
  }),
})

describe('ensureClosedDayApproval', () => {
  it('fragt nicht, wenn keine Freigabe nötig ist', async () => {
    opened.length = 0
    await expect(ensureClosedDayApproval(dialog, status({ approvalRequired: false }))).resolves.toBe(true)
    expect(opened).toEqual([])
  })

  it('zeigt den Dialog mit Datum, Regel und Betriebsart und deutet die Antwort', async () => {
    opened.length = 0
    answer = { approved: true }
    await expect(ensureClosedDayApproval(dialog, status(), 'orders-only')).resolves.toBe(true)
    expect(opened).toEqual([{ date: '2026-10-26', policy: 'block', operationMode: 'orders-only' }])

    answer = null
    await expect(ensureClosedDayApproval(dialog, status())).resolves.toBe(false)
  })

  it('ist fail-open, wenn die Vorabfrage scheitert', async () => {
    opened.length = 0
    const failing = { getClosedDayStatus: vi.fn().mockRejectedValue(new Error('offline')) }
    await expect(ensureClosedDayApproval(dialog, failing)).resolves.toBe(true)
    expect(opened).toEqual([])
  })
})

// panary/panary-core#1214: Ein Server ohne `getClosedDayStatus` (Cloud, ältere Edge) antwortet nie. Ohne Timeout
// blieb das Anlegen der Bestellung stumm hängen.
describe('ensureClosedDayApproval — Vorabfrage ohne Antwort (core#1214)', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const never = () => ({ getClosedDayStatus: vi.fn(() => new Promise<never>(() => undefined)) })

  it('lässt nach dem Timeout durch, statt ewig zu warten', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    opened.length = 0

    const result = ensureClosedDayApproval(dialog, never())
    await vi.advanceTimersByTimeAsync(CLOSED_DAY_STATUS_TIMEOUT_MS)

    await expect(result).resolves.toBe(true)
    expect(opened).toEqual([])
  })

  it('wartet vor Ablauf des Timeouts noch', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let settled = false
    const result = ensureClosedDayApproval(dialog, never()).then(value => {
      settled = true
      return value
    })

    await vi.advanceTimersByTimeAsync(CLOSED_DAY_STATUS_TIMEOUT_MS - 1)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toBe(true)
  })

  it('verwirft eine Antwort, die erst nach dem Timeout eintrifft, und öffnet keinen Dialog', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    opened.length = 0
    answer = { approved: true }
    let late: (value: unknown) => void = () => undefined
    const slow = {
      getClosedDayStatus: vi.fn(
        () =>
          new Promise(resolve => {
            late = resolve
          }),
      ),
    }

    const result = ensureClosedDayApproval(dialog, slow as never)
    await vi.advanceTimersByTimeAsync(CLOSED_DAY_STATUS_TIMEOUT_MS)
    await expect(result).resolves.toBe(true)

    late({ approvalRequired: true, state: 'closed', date: '2026-10-26', policy: 'block' })
    await vi.advanceTimersByTimeAsync(0)
    expect(opened).toEqual([])
  })

  it('verändert eine rechtzeitige Antwort nicht: Dialog und Deutung wie bisher', async () => {
    vi.useFakeTimers()
    opened.length = 0
    answer = { approved: true }

    const result = ensureClosedDayApproval(dialog, status(), 'orders-only')
    await vi.advanceTimersByTimeAsync(0)

    await expect(result).resolves.toBe(true)
    expect(opened).toEqual([{ date: '2026-10-26', policy: 'block', operationMode: 'orders-only' }])
  })

  it('räumt den Timer auf, wenn die Antwort rechtzeitig kommt', async () => {
    vi.useFakeTimers()
    opened.length = 0
    answer = null

    await ensureClosedDayApproval(dialog, status({ approvalRequired: false }))

    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('promptClosedDayApprovalFromError', () => {
  it('liest Datum und Regel aus dem BD_6010 des Gates', async () => {
    opened.length = 0
    answer = { approved: true }
    const error = { data: { code: 'BD_6010', date: '2026-10-26', policy: 'block' } }
    await expect(promptClosedDayApprovalFromError(dialog, error, 'pos-cashier')).resolves.toBe(true)
    expect(opened).toEqual([{ date: '2026-10-26', policy: 'block', operationMode: 'pos-cashier' }])
  })

  it('fällt bei unvollständigem Fehler auf manager-approval zurück', async () => {
    opened.length = 0
    answer = { approved: false }
    await expect(promptClosedDayApprovalFromError(dialog, {})).resolves.toBe(false)
    expect(opened[0]).toMatchObject({ date: '', policy: 'manager-approval' })
  })
})
