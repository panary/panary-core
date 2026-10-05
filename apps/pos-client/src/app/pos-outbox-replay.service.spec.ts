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
import { MatSnackBar } from '@angular/material/snack-bar'
import { TranslateService } from '@ngx-translate/core'
import { ConnectionService } from '@panary/shared/data-access'
import { OutboxStore, type OutboxEntry } from '@panary/shared/offline-cache'
import { PosOutboxReplayService } from './pos-outbox-replay.service'

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

function setupReplay(entries: OutboxEntry[]) {
  const create = vi.fn(() => Promise.resolve({}))
  const patch = vi.fn(() => Promise.resolve({}))
  const outbox = {
    isReady: () => true,
    pendingCount: () => 0,
    rejectedCount: () => 0,
    // Nur der erste Aufruf liefert Eintraege — ein zweiter Lauf aus dem Connect-`effect()`
    // fände nichts mehr und kann die Zaehlung nicht verdoppeln.
    claimDue: vi.fn().mockResolvedValueOnce(entries).mockResolvedValue([]),
    markAcked: vi.fn(() => Promise.resolve()),
    markRejected: vi.fn(() => Promise.resolve()),
    markRetry: vi.fn(() => Promise.resolve()),
  }

  TestBed.configureTestingModule({
    providers: [
      PosOutboxReplayService,
      { provide: OutboxStore, useValue: outbox },
      {
        provide: ConnectionService,
        useValue: { connectionState: signal({ status: 'authenticated' }), orderService: { create, patch } },
      },
      { provide: MatSnackBar, useValue: { open: vi.fn() } },
      { provide: TranslateService, useValue: { instant: (key: string) => key } },
    ],
  })

  return { service: TestBed.inject(PosOutboxReplayService), create, patch }
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
