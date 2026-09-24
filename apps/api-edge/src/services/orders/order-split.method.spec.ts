import { describe, expect, it, vi } from 'vitest'

// Nur den Logger ersetzen — das Modul liefert ausserdem assertCallerOwnsRecord,
// das der Eigentums-Check der Methode braucht (und der hier mitgeprueft wird).
vi.mock('@panary/shared-backend', async importOriginal => ({
  ...(await importOriginal<typeof import('@panary/shared-backend')>()),
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

import { OrderSplitErrorCode, OrderStatus, computeOrderTax } from '@panary/orders/domain'
import { createOrderSplitMethod } from './order-split.method'

/**
 * Eine Verdrahtungs-Spec, keine Policy-Spec.
 *
 * 🚨 Ein Test, der nur die Domain-Funktion prueft, bleibt gruen, wenn jemand den
 * Aufruf aus der Methode entfernt. Deshalb faehrt diese Spec `orders.split`
 * selbst und prueft, WAS an den Services ankommt — insbesondere, dass `patch`
 * NIE `lineItems` traegt (A5) und dass der Eigentums-Check VOR jedem Write
 * greift (ADR 0046).
 */
const TENANT = '11111111-1111-1111-1111-111111111111'
const FREMD = '22222222-2222-2222-2222-222222222222'
const USER = { _id: 'u-1', tenantId: TENANT, role: 'tenant:staff', locationId: 'loc-1' }

function line(id: string, price: number, amount: number, taxRate: number) {
  return {
    _id: id,
    externalId: `ext-${id}`,
    amount,
    name: id,
    price,
    recipeReferences: [],
    ingredientReferences: [],
    taxInside: taxRate,
    taxOutside: taxRate,
    topic: '',
    productGroupExternalId: 'pg-1',
    bundleNumber: null,
    modifiers: [],
  }
}

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'order-quelle',
    tenantId: TENANT,
    locationId: 'loc-1',
    status: OrderStatus.ACTIVE,
    orderChannel: 'pos',
    dineLocation: 'dine-in',
    settlementScope: 'Tisch 7',
    table: 'Tisch 7',
    businessDayId: 'bd-1',
    recordingDate: '2026-09-24T10:00:00.000Z',
    createdAt: '2026-09-24T10:00:00.000Z',
    dailySequenceNumber: 42,
    lineItems: [line('l1', 10.7, 1, 7), line('l2', 11.9, 1, 19), line('l3', 5.35, 1, 7)],
    ...overrides,
  }
}

// Jede App-Instanz wird IM Test angelegt, nie im describe-Scope: Ein Nachzuegler
// aus einem abgebrochenen Test schriebe sonst in die Aufzeichnung des naechsten
// (Regel testing.md §10).
function makeApp(opts: { order?: Record<string, unknown>; receiptCount?: number } = {}) {
  const stored = opts.order ?? makeOrder()
  const orderGet = vi.fn().mockResolvedValue(stored)
  const orderCreate = vi.fn().mockImplementation(async (data: any) => ({ ...data }))
  const orderPatch = vi.fn().mockImplementation(async (id: string, data: any) => ({ ...stored, ...data }))
  const receiptFind = vi.fn().mockResolvedValue({ total: opts.receiptCount ?? 0 })
  const referenceCreate = vi.fn().mockResolvedValue({})
  const interactionCreate = vi.fn().mockResolvedValue({})

  const services: Record<string, Record<string, unknown>> = {
    orders: { get: orderGet, create: orderCreate, patch: orderPatch },
    receipts: { find: receiptFind },
    'order-references': { create: referenceCreate },
    'order-interactions': { create: interactionCreate },
  }

  const app = {
    service: (path: string) => {
      const svc = services[path]
      if (!svc) throw new Error(`unerwarteter Service: ${path}`)
      return svc
    },
  }

  return { app, stored, orderGet, orderCreate, orderPatch, receiptFind, referenceCreate, interactionCreate }
}

const call = (app: unknown, data: unknown, params: unknown = { user: USER }) =>
  createOrderSplitMethod(app as never)(data as never, params as never)

describe('orders.split — Schutzschichten', () => {
  it('lehnt einen fremden Mandanten ab, BEVOR irgendetwas geschrieben wird', async () => {
    const h = makeApp({ order: makeOrder({ tenantId: FREMD }) })
    await expect(call(h.app, { orderId: 'order-quelle', lineItems: [{ lineItemRowId: 'l2' }] })).rejects.toThrow()

    // 🚨 Der Nachweis ist der DATENBANKZUSTAND, nicht der Statuscode: Feathers
    // rollt nichts zurueck, ein Check nach dem Create liesse die Zielbestellung
    // stehen. Ein reiner 403-Test waere gruen geblieben.
    expect(h.orderCreate).not.toHaveBeenCalled()
    expect(h.orderPatch).not.toHaveBeenCalled()
  })

  it('verraet den Zustand fremder Datensaetze nicht — der Eigentums-Check steht vor der Statusmeldung', async () => {
    const h = makeApp({ order: makeOrder({ tenantId: FREMD, status: OrderStatus.COMPLETED }) })
    await expect(call(h.app, { orderId: 'order-quelle', lineItems: [{ lineItemRowId: 'l2' }] })).rejects.not.toThrow(
      /abgeschlossen/,
    )
  })

  it('lehnt ab, wenn bereits ein Beleg ausgestellt wurde (A6)', async () => {
    const h = makeApp({ receiptCount: 1 })
    await expect(call(h.app, { orderId: 'order-quelle', lineItems: [{ lineItemRowId: 'l2' }] })).rejects.toThrow(
      /Beleg ausgestellt/,
    )
    expect(h.orderCreate).not.toHaveBeenCalled()
  })

  it('reicht den Domain-Fehlercode nach aussen durch, statt still abzulehnen', async () => {
    const h = makeApp({ order: makeOrder({ status: OrderStatus.COMPLETED }) })
    try {
      await call(h.app, { orderId: 'order-quelle', lineItems: [{ lineItemRowId: 'l2' }] })
      expect.unreachable()
    } catch (error) {
      expect((error as any).data?.code).toBe(OrderSplitErrorCode.SOURCE_NOT_SPLITTABLE)
    }
  })
})

describe('orders.split — Schreibpfad', () => {
  it('legt die Zielbestellung ueber create an und erbt den Abrechnungskreis', async () => {
    const h = makeApp()
    await call(h.app, { orderId: 'order-quelle', lineItems: [{ lineItemRowId: 'l2' }] })

    expect(h.orderCreate).toHaveBeenCalledTimes(1)
    const created = h.orderCreate.mock.calls[0][0]
    expect(created.settlementScope).toBe('Tisch 7')
    expect(created.lineItems).toHaveLength(1)
    expect(created.lineItems[0].externalId).toBe('ext-l2')
    expect(created.lineItems[0]._id).not.toBe('l2')
    // A10 — eigene Vorgangs-Startzeit, NICHT die der Quelle.
    expect(created.recordingDate).not.toBe('2026-09-24T10:00:00.000Z')
    // `create` laeuft durch die Hook-Kette; die Belegnummer stempelt
    // `assignDailySequenceNumber()`, nicht die Methode.
    expect(created.dailySequenceNumber).toBe(0)
  })

  it('stempelt businessDayId NICHT selbst — die Zielbestellung erbt restrictOrderToBusinessDay()', async () => {
    const h = makeApp()
    await call(h.app, { orderId: 'order-quelle', lineItems: [{ lineItemRowId: 'l2' }] })

    // 🚨 Diese Erwartung ist der Nagel, nicht die Formalie: `restrictOrderToBusinessDay()`
    // laeuft NUR im `before.create` (`orders.ts`), nicht im Patch. Zielbestellungen
    // entstehen deshalb bewusst ueber `create` und erben die Pruefung inklusive
    // Auto-Rotation. Wer sie hier von Hand stempelte, umginge den Guard, ohne dass
    // etwas fehlschluege — der Test faellt dann stattdessen um.
    expect(h.orderCreate.mock.calls[0][0].businessDayId).toBeUndefined()
  })

  it('patcht die Quelle NIE mit lineItems — die Sperre aus A5 bleibt unangetastet', async () => {
    const h = makeApp()
    await call(h.app, { orderId: 'order-quelle', lineItems: [{ lineItemRowId: 'l2' }] })

    expect(h.orderPatch).toHaveBeenCalledTimes(1)
    const [, patch, params] = h.orderPatch.mock.calls[0]
    expect(patch).not.toHaveProperty('lineItems')
    expect(patch.splitOff).toHaveLength(1)
    expect(patch.splitOff[0].lineItemRowId).toBe('l2')
    // Die Freigabe des sonst gestrippten Feldes haengt an beiden Bedingungen.
    expect(params.provider).toBeUndefined()
    expect(params.orderSplit).toBe(true)
  })

  it('summiert den Rundungsrest, statt ihn zu ueberschreiben (A14)', async () => {
    const h = makeApp({ order: makeOrder({ splitRoundingRemainderCents: 3 }) })
    await call(h.app, { orderId: 'order-quelle', lineItems: [{ lineItemRowId: 'l2' }] })

    const [, patch] = h.orderPatch.mock.calls[0]
    expect(patch.splitRoundingRemainderCents).toBe(3)
  })

  it('schreibt eine Vorgangs-Referenz mit refType Split und gesetztem targetOrderId', async () => {
    const h = makeApp()
    await call(h.app, { orderId: 'order-quelle', lineItems: [{ lineItemRowId: 'l2' }] })

    expect(h.referenceCreate).toHaveBeenCalledTimes(1)
    const ref = h.referenceCreate.mock.calls[0][0]
    expect(ref.refType).toBe('Split')
    expect(ref.sourceOrderId).toBe('order-quelle')
    // Anders als beim Storno IST hier ein Zielvorgang entstanden.
    expect(ref.targetOrderId).toBeTruthy()
  })

  it('schreibt Journal-Ereignisse mit der stabilen Zeilen-ID, nicht dem Array-Index', async () => {
    const h = makeApp()
    await call(h.app, { orderId: 'order-quelle', lineItems: [{ lineItemRowId: 'l2' }] })

    const types = h.interactionCreate.mock.calls.map(c => c[0].type)
    expect(types).toEqual(['order-split', 'order-split-target', 'item-moved'])
    const moved = h.interactionCreate.mock.calls[2][0]
    expect(moved.lineItemRowId).toBe('l2')
    expect(moved.lineItemId).toBeUndefined()
  })

  it('schreibt ohne Bediener KEIN Journal-Ereignis — ein Eintrag ohne „wer" beantwortet nichts', async () => {
    const h = makeApp()
    await call(h.app, { orderId: 'order-quelle', lineItems: [{ lineItemRowId: 'l2' }] }, { provider: undefined })

    expect(h.interactionCreate).not.toHaveBeenCalled()
    // Der Geschaeftspfad laeuft trotzdem durch.
    expect(h.orderCreate).toHaveBeenCalledTimes(1)
  })

  it('laesst den Split nicht an einer fehlgeschlagenen Referenz scheitern (nicht blockierend, §146a)', async () => {
    const h = makeApp()
    ;(h.referenceCreate as any).mockRejectedValue(new Error('kaputt'))

    await expect(call(h.app, { orderId: 'order-quelle', lineItems: [{ lineItemRowId: 'l2' }] })).resolves.toBeTruthy()
    expect(h.orderPatch).toHaveBeenCalledTimes(1)
  })
})

describe('orders.split — Summenprobe ueber den ganzen Pfad', () => {
  it('Brutto Quelle + Brutto Ziel === Brutto vor dem Split', () => {
    const source = makeOrder() as any
    const before = computeOrderTax(structuredClone(source))

    const rest = computeOrderTax({
      ...source,
      splitOff: [{ _id: 's', targetOrderId: 't', lineItemRowId: 'l2', amount: 1, grossCents: 1190, splitAt: 'x' }],
    })
    const ziel = computeOrderTax({ ...source, lineItems: [source.lineItems[1]], splitOff: [] })

    expect(Math.round(rest.brutto * 100) + Math.round(ziel.brutto * 100)).toBe(Math.round(before.brutto * 100))
    // Gegen die EIMER, nicht gegen die Summe: „Σ netto + Σ steuer === brutto"
    // haelt auch bei falscher Formel.
    expect(ziel.taxes.map(t => t.taxRate)).toEqual([19])
    expect(rest.taxes.map(t => t.taxRate)).toEqual([7])
  })
})
