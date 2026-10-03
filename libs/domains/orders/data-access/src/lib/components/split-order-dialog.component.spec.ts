// JIT-Compiler zuerst laden: @angular/material ist partial-compiled; ohne Linker
// (kein analogjs-Plugin in dieser node-Vitest-Config) faellt Angular auf JIT zurueck.
import '@angular/compiler'
import { describe, expect, it, vi } from 'vitest'
import { Injector, runInInjectionContext, signal } from '@angular/core'
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog'
import {
  OrderSplitErrorCode,
  OrderStatus,
  PaymentState,
  planOrderSplit,
  type Order,
  type OrderSplitSelectionItem,
} from '@panary/orders/domain'
import { OrderService, OrderSplitOfflineError } from '../services/order.service'
import { SplitOrderDialogComponent } from './split-order-dialog.component'

// Geprueft wird die Logik des Dialogs (Auswahl → Operation, Vorschau, Meldungen),
// nicht das Markup. Aufbau wie `order.service.spec.ts`: echte Instanz ohne TestBed,
// alle inject()-Tokens als Mocks in einem eigenen Injector — je Test angelegt
// (testing.md §10).

const EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })

function line(id: string, price: number, amount: number, extra: Record<string, unknown> = {}) {
  return {
    _id: id,
    externalId: `ext-${id}`,
    amount,
    name: id,
    price,
    recipeReferences: [],
    ingredientReferences: [],
    taxInside: 7,
    taxOutside: 7,
    topic: '',
    productGroupExternalId: 'pg-1',
    bundleNumber: null,
    modifiers: [],
    ...extra,
  }
}

const kaese = {
  _id: 'mod-kaese',
  externalId: 'ext-kaese',
  name: 'Extra Käse',
  price: 0.5,
  amount: 1,
  taxInside: 7,
  taxOutside: 7,
}

function makeOrder(overrides: Record<string, unknown> = {}): Order {
  return {
    _id: 'quelle',
    tenantId: 't-1',
    locationId: 'loc-1',
    status: OrderStatus.ACTIVE,
    dineLocation: 'dine-in',
    settlementScope: 'Tisch 7',
    dailySequenceNumber: 12,
    recordingDate: '2026-10-03T10:00:00.000Z',
    payment: { state: PaymentState.PENDING, totalAmount: 0, tipAmount: 0, transactions: [] },
    appliedDiscounts: [],
    lineItems: [
      line('kaffee', 3, 5),
      line('broetchen', 4, 2, { modifiers: [kaese] }),
      line('menue-burger', 9, 1, { bundleNumber: 1 }),
      line('menue-pommes', 3, 1, { bundleNumber: 1 }),
    ],
    ...overrides,
  } as unknown as Order
}

function setup(opts: { order?: Order; split?: (orderId: string, items: OrderSplitSelectionItem[]) => Promise<unknown> } = {}) {
  const order = opts.order ?? makeOrder()
  const orders = signal<Order[]>([order])
  const split = vi.fn(
    opts.split ??
      (async () => ({ sourceOrder: { _id: order._id }, targetOrder: { _id: 'ziel', dailySequenceNumber: 13 } })),
  )
  const close = vi.fn()

  const injector = Injector.create({
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: { order } },
      { provide: MatDialogRef, useValue: { close } },
      { provide: OrderService, useValue: { orders, split } },
    ],
  })
  const dialog = runInInjectionContext(injector, () => new SplitOrderDialogComponent())
  const unit = (key: string) => {
    const u = dialog.units().find(x => x.key === key)
    if (!u) throw new Error(`Einheit ${key} fehlt`)
    return u
  }
  return { dialog, orders, split, close, unit, order }
}

describe('SplitOrderDialogComponent — Einheiten', () => {
  it('bietet Kombinationen als EINE Einheit an, nie ihre Zeilen einzeln', () => {
    const { dialog } = setup()
    expect(dialog.units().map(u => u.key)).toEqual(['line:kaffee', 'line:broetchen', 'bundle:1'])
    expect(dialog.units().find(u => u.key === 'bundle:1')?.lines.map(l => l._id)).toEqual([
      'menue-burger',
      'menue-pommes',
    ])
  })

  it('erlaubt Teilmengen nur ohne Extras — eine Zeile mit Modifier wandert nur ganz', () => {
    const { unit } = setup()
    expect(unit('line:kaffee').partial).toBe(true)
    expect(unit('line:broetchen').partial).toBe(false)
  })

  it('zeigt nach einem früheren Split nur noch die Restmenge (effectiveLineItems)', () => {
    const { unit } = setup({
      order: makeOrder({
        splitOff: [
          {
            _id: 'so-1',
            targetOrderId: 'alt',
            lineItemRowId: 'kaffee',
            amount: 2,
            grossCents: 600,
            splitAt: '2026-10-03T10:05:00.000Z',
          },
        ],
      }),
    })
    expect(unit('line:kaffee').max).toBe(3)
  })
})

describe('SplitOrderDialogComponent — Auswahl und Vorschau', () => {
  it('übersetzt eine Teilmenge in { lineItemRowId, amount }', () => {
    const { dialog, unit } = setup()
    dialog.setQuantity(unit('line:kaffee'), 2)
    expect(dialog.selection()).toEqual([{ lineItemRowId: 'kaffee', amount: 2 }])
  })

  it('schickt eine Kombination als alle ihre Zeilen OHNE Menge — die volle Restmenge wandert', () => {
    const { dialog, unit } = setup()
    dialog.setQuantity(unit('bundle:1'), 1)
    expect(dialog.selection()).toEqual([{ lineItemRowId: 'menue-burger' }, { lineItemRowId: 'menue-pommes' }])
  })

  it('klemmt die Menge auf [0, Restmenge]', () => {
    const { dialog, unit } = setup()
    dialog.setQuantity(unit('line:kaffee'), 99)
    expect(dialog.quantityOf('line:kaffee')).toBe(5)
    dialog.setQuantity(unit('line:kaffee'), -3)
    expect(dialog.quantityOf('line:kaffee')).toBe(0)
  })

  it('Vorschau == planOrderSplit — cent-genau dieselbe Rechnung wie der Edge', () => {
    const { dialog, unit, order } = setup()
    dialog.setQuantity(unit('line:kaffee'), 2)
    const plan = planOrderSplit(order, [{ lineItemRowId: 'kaffee', amount: 2 }], {
      targetOrderId: 'x',
      splitAt: '2026-10-03T10:10:00.000Z',
      newId: () => 'id',
    })

    expect(dialog.preview()).toEqual({
      state: 'ok',
      sourceFormatted: EUR.format(plan.sourceTaxSnapshot.brutto),
      targetFormatted: EUR.format(plan.targetTaxSnapshot.brutto),
    })
  })

  it('Modifier wandert mit und skaliert NICHT mit der Menge: 2 × 4,00 € + 0,50 € = 8,50 €', () => {
    const { dialog, unit } = setup()
    dialog.setQuantity(unit('line:broetchen'), unit('line:broetchen').max)
    const p = dialog.preview()
    expect(p.state).toBe('ok')
    expect(p.state === 'ok' && p.targetFormatted).toBe(EUR.format(8.5))
  })

  it('meldet schon VOR dem Bestätigen, wenn nichts in der Quelle bliebe — Bestätigen gesperrt', () => {
    const { dialog, unit } = setup()
    for (const u of dialog.units()) dialog.setQuantity(unit(u.key), u.max)

    expect(dialog.preview()).toEqual({ state: 'error', messageKey: 'SPLIT_ORDER.ERROR.NOTHING_REMAINS' })
    expect(dialog.messageKey()).toBe('SPLIT_ORDER.ERROR.NOTHING_REMAINS')
    expect(dialog.canConfirm()).toBe(false)
  })
})

describe('SplitOrderDialogComponent — Melden statt schweigen', () => {
  it('leere Auswahl: Bestätigen meldet die Leere und ruft den Server NICHT', async () => {
    const { dialog, split, close } = setup()
    expect(dialog.messageKey()).toBeNull()

    await dialog.confirm()

    expect(dialog.messageKey()).toBe('SPLIT_ORDER.ERROR.EMPTY_SELECTION')
    expect(split).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })

  it('sperrt eine abgeschlossene Bestellung mit Meldung', () => {
    const { dialog } = setup({ order: makeOrder({ status: OrderStatus.COMPLETED }) })
    expect(dialog.blockedKey()).toBe('SPLIT_ORDER.ERROR.SOURCE_NOT_SPLITTABLE')
  })

  it('sperrt eine bezahlte Bestellung mit eigener Meldung (#394)', () => {
    const { dialog } = setup({
      order: makeOrder({
        payment: { state: PaymentState.PAID, totalAmount: 30, tipAmount: 0, transactions: [] },
      }),
    })
    expect(dialog.blockedKey()).toBe('SPLIT_ORDER.ERROR.SOURCE_ALREADY_PAID')
  })

  it('reagiert auf den Live-Stand: wird die Bestellung im offenen Dialog abgeschlossen, sperrt er', () => {
    const { dialog, orders, order } = setup()
    expect(dialog.blockedKey()).toBeNull()
    orders.set([{ ...order, status: OrderStatus.COMPLETED } as Order])
    expect(dialog.blockedKey()).toBe('SPLIT_ORDER.ERROR.SOURCE_NOT_SPLITTABLE')
  })

  it('Ablehnung vom Server: Meldung aus dem Fehlercode, Dialog bleibt offen', async () => {
    const { dialog, unit, close } = setup({
      split: async () => {
        throw { code: 409, data: { code: OrderSplitErrorCode.FISCAL_MODE_UNSUPPORTED } }
      },
    })
    dialog.setQuantity(unit('line:kaffee'), 1)
    await dialog.confirm()

    expect(dialog.messageKey()).toBe('SPLIT_ORDER.ERROR.FISCAL_MODE_UNSUPPORTED')
    expect(dialog.submitting()).toBe(false)
    expect(close).not.toHaveBeenCalled()
  })

  it('unbekannter Fehler fällt auf eine allgemeine Meldung zurück, nie auf nichts', async () => {
    const { dialog, unit } = setup({
      split: async () => {
        throw new Error('Netz weg')
      },
    })
    dialog.setQuantity(unit('line:kaffee'), 1)
    await dialog.confirm()
    expect(dialog.messageKey()).toBe('SPLIT_ORDER.ERROR.GENERIC')
  })

  it('offline: eigene Meldung', async () => {
    const { dialog, unit } = setup({
      split: async () => {
        throw new OrderSplitOfflineError()
      },
    })
    dialog.setQuantity(unit('line:kaffee'), 1)
    await dialog.confirm()
    expect(dialog.messageKey()).toBe('SPLIT_ORDER.ERROR.OFFLINE')
  })

  it('eine neue Auswahl räumt die Server-Meldung ab', async () => {
    const { dialog, unit } = setup({
      split: async () => {
        throw new Error('x')
      },
    })
    dialog.setQuantity(unit('line:kaffee'), 1)
    await dialog.confirm()
    dialog.setQuantity(unit('line:kaffee'), 2)
    expect(dialog.messageKey()).toBeNull()
  })
})

describe('SplitOrderDialogComponent — Erfolg', () => {
  it('ruft den Split mit der Auswahl und schließt mit beiden IDs', async () => {
    const { dialog, unit, split, close } = setup()
    dialog.setQuantity(unit('line:kaffee'), 2)
    dialog.setQuantity(unit('bundle:1'), 1)
    await dialog.confirm()

    expect(split).toHaveBeenCalledWith('quelle', [
      { lineItemRowId: 'kaffee', amount: 2 },
      { lineItemRowId: 'menue-burger' },
      { lineItemRowId: 'menue-pommes' },
    ])
    expect(close).toHaveBeenCalledWith({ sourceOrderId: 'quelle', targetOrderId: 'ziel', targetSequenceNumber: 13 })
  })
})
