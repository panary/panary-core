// Nachversand der Outbox mit Bediener-Token (panary/panary-core#619, ADR 0053, Schritt 3).
//
// Ein offline erfasster Eintrag traegt das Token zum Zeitpunkt der Erfassung. Der
// Nachversand muss genau dieses schicken — nicht das des Bedieners, der gerade
// angemeldet ist, sonst rechnete der Edge die Bestellung dem falschen Menschen zu.
// Ohne Token darf gar kein Schluessel mitgehen: Der rohe Service entfernt kein
// `null`, und der Edge werte es als abgelehntes Token.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { NotificationService } from '@panary/shared/ui-notifications'
import { TranslateService } from '@ngx-translate/core'
import { ConnectionService } from '@panary/shared/data-access'
import { OutboxStore, type OutboxEntry } from '@panary/shared/offline-cache'
import { PosOutboxCashSessionApproval, PosOutboxReplayService } from './pos-outbox-replay.service'

const entry = (overrides: Partial<OutboxEntry>): OutboxEntry => ({
  _id: 'outbox-1',
  service: 'orders',
  op: 'create',
  entityId: 'order-1',
  payload: { _id: 'order-1' },
  occurredAt: '2026-10-05T10:00:00.000Z',
  status: 'pending',
  attempts: 0,
  ...overrides,
})

function setupReplay(entries: OutboxEntry[], options: { patch?: ReturnType<typeof vi.fn>; approve?: boolean } = {}) {
  const connectionState = signal<{ status: string }>({ status: 'authenticated' })
  const create = vi.fn(() => Promise.resolve({}))
  const patch = options.patch ?? vi.fn(() => Promise.resolve({}))
  const approval = {
    request: vi.fn((_cashierId: string) => Promise.resolve(options.approve ?? false)),
    cashierName: (id: string) => (id === 'u-kassierer' ? 'Kim Kasse' : id),
  }
  const notifications = new NotificationService()
  const warning = vi.spyOn(notifications, 'warning')
  const error = vi.spyOn(notifications, 'error')
  const outbox = {
    isReady: () => true,
    pendingCount: () => 0,
    rejectedCount: () => 0,
    // Nur der erste Aufruf liefert Eintraege — ein zweiter Lauf aus dem Connect-`effect()`
    // fände nichts mehr und kann die Zaehlung nicht verdoppeln.
    claimDue: vi.fn().mockResolvedValueOnce(entries).mockResolvedValue([]),
    markAcked: vi.fn(() => Promise.resolve()),
    markRejected: vi.fn(() => Promise.resolve()),
    markRetry: vi.fn((_id: string, _nextAttemptAt: string, _error?: string) => Promise.resolve()),
  }

  TestBed.configureTestingModule({
    providers: [
      PosOutboxReplayService,
      { provide: OutboxStore, useValue: outbox },
      {
        provide: ConnectionService,
        useValue: { connectionState, orderService: { create, patch } },
      },
      { provide: NotificationService, useValue: notifications },
      { provide: TranslateService, useValue: { instant: (key: string) => key } },
      { provide: PosOutboxCashSessionApproval, useValue: approval },
    ],
  })

  return {
    service: TestBed.inject(PosOutboxReplayService),
    create,
    patch,
    outbox,
    approval,
    warning,
    error,
    connectionState,
  }
}

describe('PosOutboxReplayService — Bediener-Token', () => {
  afterEach(() => {
    TestBed.resetTestingModule()
  })

  it('schickt beim Create das Token der Erfassung mit', async () => {
    const { service, create } = setupReplay([entry({ operatorToken: 'tok-erfassung' })])

    await service.replayAll()

    expect(create).toHaveBeenCalledWith({ _id: 'order-1' }, { query: { operatorToken: 'tok-erfassung' } })
  })

  it('schickt beim Patch das Token der Erfassung mit', async () => {
    const { service, patch } = setupReplay([
      entry({ op: 'patch', payload: { status: 'COMPLETED' }, operatorToken: 'tok-erfassung' }),
    ])

    await service.replayAll()

    expect(patch).toHaveBeenCalledWith(
      'order-1',
      { status: 'COMPLETED' },
      { query: { operatorToken: 'tok-erfassung' } },
    )
  })

  it('ohne Token im Eintrag geht kein Token-Schluessel mit', async () => {
    const { service, create } = setupReplay([entry({})])

    await service.replayAll()

    expect(create).toHaveBeenCalledWith({ _id: 'order-1' }, {})
  })
})

// panary/panary-core#1123: Offline bar kassiert, aber fuer den Kassierer war keine Kasse eroeffnet. Der Edge lehnt
// den Nachversand mit BD_6004 ab. Wie online fragt der POS die Freigabe an und sendet danach erneut; ohne Freigabe
// bleibt der Eintrag mit einer Meldung liegen, die sagt, was zu tun ist.
describe('PosOutboxReplayService — Kasse fehlt beim Nachversand', () => {
  afterEach(() => {
    TestBed.resetTestingModule()
  })

  const cashPatch = (id: string, cashierId = 'u-kassierer') =>
    entry({
      _id: id,
      op: 'patch',
      payload: { status: 'completed', payment: { transactions: [{ method: 'cash', performedBy: cashierId }] } },
    })
  const cashSessionRequired = () => Object.assign(new Error('Keine Kasse'), { code: 400, data: { code: 'BD_6004' } })

  it('fragt je Kassierer einmal die Freigabe an und sendet danach erneut', async () => {
    const patch = vi.fn().mockRejectedValueOnce(cashSessionRequired()).mockRejectedValueOnce(cashSessionRequired())
    patch.mockResolvedValue({})
    const { service, outbox, approval } = setupReplay([cashPatch('o-1'), cashPatch('o-2')], { patch, approve: true })

    await service.replayAll()

    expect(approval.request.mock.calls).toEqual([['u-kassierer']])
    expect(patch).toHaveBeenCalledTimes(4)
    expect(outbox.markAcked.mock.calls).toEqual([['o-1'], ['o-2']])
    expect(outbox.markRejected).not.toHaveBeenCalled()
  })

  it('ohne Freigabe bleibt der Eintrag mit der Kassen-Meldung liegen, ohne die allgemeine Ablehnung', async () => {
    const patch = vi.fn().mockRejectedValue(cashSessionRequired())
    const { service, outbox, warning, error } = setupReplay([cashPatch('o-1')], { patch, approve: false })

    await service.replayAll()

    expect(patch).toHaveBeenCalledTimes(1)
    expect(outbox.markRejected.mock.calls).toEqual([['o-1', 'SETTINGS.OUTBOX_CASH_SESSION_REQUIRED']])
    expect(warning.mock.calls).toEqual([['SETTINGS.OUTBOX_CASH_SESSION_REQUIRED', { sticky: true }]])
    expect(error).not.toHaveBeenCalled()
  })

  it('fragt bei zwei Kassierern je einmal und sendet nur fuer den freigegebenen', async () => {
    const patch = vi
      .fn()
      .mockRejectedValueOnce(cashSessionRequired())
      .mockRejectedValueOnce(cashSessionRequired())
      .mockResolvedValue({})
    const { service, outbox, approval } = setupReplay([cashPatch('o-1'), cashPatch('o-2', 'u-zweite')], { patch })
    approval.request.mockImplementation((id: string) => Promise.resolve(id === 'u-kassierer'))

    await service.replayAll()

    expect(approval.request.mock.calls).toEqual([['u-kassierer'], ['u-zweite']])
    expect(outbox.markAcked.mock.calls).toEqual([['o-1']])
    expect(outbox.markRejected.mock.calls).toEqual([['o-2', 'SETTINGS.OUTBOX_CASH_SESSION_REQUIRED']])
  })

  it('Verbindung weg vor der Rueckfrage: Eintrag bleibt faellig, keine Ablehnung, kein Dialog', async () => {
    const patch = vi.fn()
    const { service, outbox, approval, warning, connectionState } = setupReplay([cashPatch('o-1')], { patch })
    patch.mockImplementation(() => {
      connectionState.set({ status: 'disconnected' })
      return Promise.reject(cashSessionRequired())
    })

    await service.replayAll()

    expect(approval.request).not.toHaveBeenCalled()
    expect(outbox.markRejected).not.toHaveBeenCalled()
    expect(outbox.markRetry.mock.calls.map(call => call[0])).toEqual(['o-1'])
    expect(warning).not.toHaveBeenCalled()
  })

  it('Verbindung weg waehrend des Dialogs: nicht senden, nicht ablehnen, Eintrag bleibt faellig', async () => {
    const patch = vi.fn().mockRejectedValueOnce(cashSessionRequired()).mockResolvedValue({})
    const { service, outbox, approval, connectionState } = setupReplay([cashPatch('o-1')], { patch })
    approval.request.mockImplementation(() => {
      connectionState.set({ status: 'disconnected' })
      return Promise.resolve(true)
    })

    await service.replayAll()

    expect(patch).toHaveBeenCalledTimes(1)
    expect(outbox.markRejected).not.toHaveBeenCalled()
    expect(outbox.markRetry.mock.calls.map(call => call[0])).toEqual(['o-1'])
  })

  it('andere 400er bleiben terminal abgelehnt, ohne Rueckfrage', async () => {
    const patch = vi.fn().mockRejectedValue(Object.assign(new Error('validation failed'), { code: 400 }))
    const { service, outbox, approval } = setupReplay([cashPatch('o-1')], { patch, approve: true })

    await service.replayAll()

    expect(approval.request).not.toHaveBeenCalled()
    expect(outbox.markRejected.mock.calls).toEqual([['o-1', 'validation failed']])
  })
})
