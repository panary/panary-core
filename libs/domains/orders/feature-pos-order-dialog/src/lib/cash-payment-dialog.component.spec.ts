// JIT-Compiler zuerst laden: @angular/material ist partial-compiled (siehe cancel-order-dialog.component.spec).
import '@angular/compiler'
import { describe, expect, it, vi } from 'vitest'
import { Injector, runInInjectionContext, signal } from '@angular/core'
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog'
import { NotificationService } from '@panary/shared/ui-notifications'
import { TranslateService } from '@ngx-translate/core'
import {
  OrderCheckoutService,
  type PayCashCircleResult,
  type PayCashInput,
  type PayCashResult,
} from '@panary/orders/data-access'
import { LocationService } from '@panary/locations/data-access'
import { UserService } from '@panary/users/data-access'
import {
  CASH_PAYMENT_DIALOG_CONFIG,
  CashPaymentDialogComponent,
  type CashPaymentDialogData,
} from './cash-payment-dialog.component'

// core#834: „Abschließen" in Offene Bestellungen öffnet diesen Dialog. Er darf nichts selbst kassieren,
// sondern geht über `OrderCheckoutService.payCash` — dieselbe Logik wie die Bezahlansicht der Kasse.
const DATA: CashPaymentDialogData = { orderId: 'order-1', total: 17.9, cashierId: 'user-1' }

function setup(
  payCash: (input: PayCashInput) => Promise<PayCashResult>,
  data: CashPaymentDialogData = DATA,
  payCashCircle: () => Promise<PayCashCircleResult> = async () => ({
    result: 'paid',
    paid: [],
    skipped: [],
    remaining: [],
  }),
) {
  const payCashMock = vi.fn(payCash)
  const payCashCircleMock = vi.fn(payCashCircle)
  const close = vi.fn()
  const open = vi.fn()
  const notifications = new NotificationService()
  const notify = vi.spyOn(notifications, 'notify')
  const injector = Injector.create({
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: data },
      { provide: MatDialogRef, useValue: { close } },
      { provide: OrderCheckoutService, useValue: { payCash: payCashMock, payCashCircle: payCashCircleMock } },
      { provide: MatDialog, useValue: { open } },
      { provide: LocationService, useValue: { activeLocation: signal(undefined) } },
      { provide: UserService, useValue: { users: signal([]) } },
      { provide: NotificationService, useValue: notifications },
      {
        provide: TranslateService,
        useValue: { instant: (key: string, params?: object) => (params ? `${key} ${JSON.stringify(params)}` : key) },
      },
    ],
  })
  const dialog = runInInjectionContext(injector, () => new CashPaymentDialogComponent()) as unknown as {
    onCollect(): Promise<void>
    onKeepOpen(): void
    paying(): boolean
  }
  return { dialog, payCashMock, payCashCircleMock, close, notify }
}

// core#1142: „Tisch kassieren" — ein Bezahlvorgang über alle offenen Bestellungen eines Kreises.
const CIRCLE: CashPaymentDialogData = {
  circle: {
    table: '4',
    orders: [
      { orderId: 'o-1', total: 12.5 },
      { orderId: 'o-2', total: 3.1 },
    ],
  },
  total: 15.6,
  cashierId: 'user-1',
}

describe('CashPaymentDialogComponent (core#834)', () => {
  it('kassiert über payCash mit Bestellung, Summe und Kassierer und schließt mit true', async () => {
    const { dialog, payCashMock, close } = setup(async () => 'paid')
    await dialog.onCollect()
    expect(payCashMock).toHaveBeenCalledTimes(1)
    expect(payCashMock.mock.calls[0][0]).toMatchObject({ orderId: 'order-1', total: 17.9, cashierId: 'user-1' })
    expect(close).toHaveBeenCalledWith(true)
    expect(dialog.paying()).toBe(false)
  })

  it('bleibt bei einem abgelehnten Abschluss offen, ohne Meldung (handleError hat gemeldet)', async () => {
    const { dialog, close, notify } = setup(async () => 'failed')
    await dialog.onCollect()
    expect(close).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
    expect(dialog.paying()).toBe(false)
  })

  it('meldet eine verweigerte Kassen-Freigabe und bleibt offen', async () => {
    const { dialog, close, notify } = setup(async () => 'cash-session-declined')
    await dialog.onCollect()
    expect(close).not.toHaveBeenCalled()
    expect(notify.mock.calls.map(([type, message]) => [type, message])).toEqual([
      ['warning', 'ORDER_DIALOG.PAYMENT_CASH_SESSION_DECLINED'],
    ])
  })

  it('ein zweiter Tipp während des Abschlusses löst keinen zweiten payCash aus', async () => {
    let release: (r: PayCashResult) => void = () => undefined
    const { dialog, payCashMock } = setup(() => new Promise<PayCashResult>(resolve => (release = resolve)))
    const first = dialog.onCollect()
    await dialog.onCollect()
    expect(payCashMock).toHaveBeenCalledTimes(1)
    release('paid')
    await first
  })

  it('„Offen lassen" schließt mit false und kassiert nichts', () => {
    const { dialog, payCashMock, close } = setup(async () => 'paid')
    dialog.onKeepOpen()
    expect(close).toHaveBeenCalledWith(false)
    expect(payCashMock).not.toHaveBeenCalled()
  })

  // Sichttest core#890: Materials Vorgabe max-width 560px schnitt die Ansicht rechts ab (Betrag, Gutschein, Ziffern).
  it('hebt die Material-Obergrenze von 560px auf und lässt Backdrop/ESC nicht schließen', () => {
    expect(CASH_PAYMENT_DIALOG_CONFIG.maxWidth).toBe('94vw')
    expect(CASH_PAYMENT_DIALOG_CONFIG.width).toBe('min(46rem, 94vw)')
    expect(CASH_PAYMENT_DIALOG_CONFIG.disableClose).toBe(true)
  })
})

describe('CashPaymentDialogComponent — Tisch kassieren (core#1142)', () => {
  it('kassiert den Kreis über payCashCircle, nicht über payCash, und schließt mit true', async () => {
    const { dialog, payCashMock, payCashCircleMock, close } = setup(async () => 'paid', CIRCLE)
    await dialog.onCollect()
    expect(payCashMock).not.toHaveBeenCalled()
    expect(payCashCircleMock.mock.calls[0]).toEqual([
      expect.objectContaining({ orders: CIRCLE.circle.orders, cashierId: 'user-1' }),
    ])
    expect(close).toHaveBeenCalledWith(true)
  })

  it('bleibt offen, solange noch nichts gebucht ist, wie bei einer einzelnen Bestellung', async () => {
    const { dialog, close, notify } = setup(
      async () => 'paid',
      CIRCLE,
      async () => ({
        result: 'cash-session-declined',
        paid: [],
        skipped: [],
        remaining: ['o-1', 'o-2'],
      }),
    )
    await dialog.onCollect()
    expect(close).not.toHaveBeenCalled()
    expect(notify.mock.calls.map(([type, message]) => [type, message])).toEqual([
      ['warning', 'ORDER_DIALOG.PAYMENT_CASH_SESSION_DECLINED'],
    ])
  })

  it('schließt nach einem Teil-Abbruch und nennt quittierpflichtig, was nicht gebucht ist', async () => {
    const { dialog, close, notify } = setup(
      async () => 'paid',
      CIRCLE,
      async () => ({
        result: 'failed',
        paid: ['o-1'],
        skipped: [],
        remaining: ['o-2'],
      }),
    )
    await dialog.onCollect()
    expect(close).toHaveBeenCalledWith(false)
    const [type, message, options] = notify.mock.calls[0]
    expect(type).toBe('warning')
    expect(message).toContain('ORDER_DIALOG.PAYMENT_TABLE_PARTIAL')
    expect(message).toContain('"paid":1')
    expect(message).toContain('"count":2')
    expect(message).toMatch(/"rest":"3,10/)
    expect(options).toMatchObject({ sticky: true })
  })
})
