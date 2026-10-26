import { of } from 'rxjs'
import { describe, expect, it, vi } from 'vitest'
import type { MatDialog } from '@angular/material/dialog'

// Wie in cash-session-prompt.spec: Geprüft wird, was der Helfer dem Dialog übergibt und wie er die Antwort
// deutet, nicht der Dialog selbst. Der Mock hält die Aufrufe je Test (testing.md §10).
const opened: Array<Record<string, unknown>> = []
let answer: unknown = null
vi.mock('./closed-day-approval-dialog.component', () => ({
  openClosedDayApprovalDialog: (_dialog: unknown, data: Record<string, unknown>) => {
    opened.push(data)
    return { afterClosed: () => of(answer) }
  },
}))

import { ensureClosedDayApproval, promptClosedDayApprovalFromError } from './closed-day-prompt'

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
