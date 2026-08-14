// JIT-Compiler zuerst laden: @angular/material ist partial-compiled; ohne Linker
// (kein analogjs-Plugin in dieser node-Vitest-Config) faellt Angular auf JIT zurueck.
import '@angular/compiler'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Injector, NgZone, runInInjectionContext, signal } from '@angular/core'
import { MatDialog } from '@angular/material/dialog'
import { MatSnackBar } from '@angular/material/snack-bar'
import { TranslateService } from '@ngx-translate/core'
import { of } from 'rxjs'
import {
  DineLocation,
  OrderChannel,
  OrderStatus,
  type AppliedDiscount,
  type OrderLineItem,
} from '@panary/orders/domain'
import {
  ConnectionService,
  DATA_ACCESS_AUTO_LOAD,
  OFFLINE_CACHE,
  OFFLINE_OUTBOX,
  ServiceHelper,
} from '@panary/shared/data-access'

import { LocationService } from '@panary/locations/data-access'
import { OrderService } from './order.service'

// Geprueft wird `createOrder` — also die Payload, die den Server erreicht.
// Der Schwerpunkt liegt auf der vorab vergebenen `_id`: Sie ist der einzige Weg,
// eine Rabattcode-Einloesung ihrer Bestellung zuzuordnen (ADR 0032). Vorher stand
// dort `orderId: null`, und genau diese Weitergabe hatte kein Netz.
//
// Aufbau wie `products/data-access/.../product.service.spec.ts`: echte Instanz ohne
// TestBed, alle inject()-Tokens als useValue-Mocks in einem eigenen Injector.
// Alles je Test angelegt (code-style.md §10) — inklusive der Fake-Timer, die den
// `setInterval` aus dem Konstruktor stilllegen.

interface SetupOptions {
  /** true = Offline-Pfad (Outbox + Cache bereit, Verbindung nicht authentifiziert). */
  offline?: boolean
}

const makeLineItem = (topic: string): OrderLineItem =>
  ({
    _id: `li-${topic}`,
    topic,
    amount: 1,
    price: 1,
    quantity: 1,
    modifiers: [],
  }) as unknown as OrderLineItem

function setup(options: SetupOptions = {}) {
  // Ohne Fake-Timer laeuft der `setInterval` aus calculateRemainingTimeInterval()
  // ueber das Testende hinaus weiter.
  vi.useFakeTimers()
  onTestFinished(() => {
    vi.useRealTimers()
  })

  const createCalls: Array<{ payload: Record<string, unknown>; params: unknown }> = []
  const enqueued: Array<Record<string, unknown>> = []
  const upserted: Array<{ store: string; rows: unknown[] }> = []

  const feathersOrderService = {
    create: (payload: Record<string, unknown>, params: unknown) => {
      createCalls.push({ payload, params })
      return Promise.resolve({ ...payload, _id: payload['_id'] ?? 'server-vergeben', dailySequenceNumber: 42 })
    },
    find: () => Promise.resolve({ total: 0, data: [], limit: 0, skip: 0 }),
  }

  const connectionState = signal({ status: options.offline ? 'disconnected' : 'authenticated' })

  const injector = Injector.create({
    providers: [
      {
        provide: ConnectionService,
        useValue: {
          orderService: feathersOrderService,
          connectionState,
          isAuthenticated: () => !options.offline,
        },
      },
      {
        provide: LocationService,
        useValue: {
          activeLocation: () => ({
            _id: 'loc-1',
            tenantId: 'tenant-1',
            // Ohne currentBusinessDay ist loadDocuments() ein No-op — der Test
            // interessiert sich fuer die Payload, nicht fuer den Nachlade-Pfad.
            settings: { printSettings: { showDialogAfterOrder: false } },
          }),
        },
      },
      { provide: ServiceHelper, useValue: { handleError: vi.fn() } },
      { provide: MatSnackBar, useValue: { open: () => ({ afterDismissed: () => of(undefined) }) } },
      { provide: MatDialog, useValue: { open: vi.fn() } },
      { provide: TranslateService, useValue: { instant: (key: string) => key } },
      { provide: NgZone, useValue: { run: (fn: () => unknown) => fn() } },
      { provide: DATA_ACCESS_AUTO_LOAD, useValue: false },
      {
        provide: OFFLINE_OUTBOX,
        useValue: options.offline
          ? {
              isReady: () => true,
              enqueue: (entry: Record<string, unknown>) => {
                enqueued.push(entry)
                return Promise.resolve()
              },
              pendingEntityIds: () => Promise.resolve([]),
            }
          : null,
      },
      {
        provide: OFFLINE_CACHE,
        useValue: options.offline
          ? {
              isReady: () => true,
              upsertMany: (store: string, rows: unknown[]) => {
                upserted.push({ store, rows })
                return Promise.resolve()
              },
              readAll: () => Promise.resolve([]),
              replaceAll: () => Promise.resolve(),
              get: () => Promise.resolve(undefined),
            }
          : null,
      },
    ],
  })

  const service = runInInjectionContext(injector, () => new OrderService())
  return { service, createCalls, enqueued, upserted }
}

const baseInput = {
  lineItems: [makeLineItem('Brot')],
  orderChannel: OrderChannel.POS,
  productionTime: 10,
  dineLocation: DineLocation.DINE_IN,
  recordingDate: new Date('2026-08-14T12:00:00.000Z'),
}

describe('OrderService.createOrder — vorab vergebene _id', () => {
  it('reicht eine mitgegebene _id unveraendert an den Server durch', async () => {
    // Das ist die Verknuepfung zur Rabattcode-Einloesung: Die Einloesung wurde
    // bereits mit GENAU dieser ID gebucht, bevor es die Bestellung gab.
    const { service, createCalls } = setup()

    await service.createOrder({ ...baseInput, _id: '01920000-0000-7000-8000-000000000abc' })

    expect(createCalls).toHaveLength(1)
    expect(createCalls[0].payload['_id']).toBe('01920000-0000-7000-8000-000000000abc')
  })

  it('ohne _id bleibt die Vergabe beim Server — das Feld fehlt in der Payload', async () => {
    // Kein `_id: undefined`: Ein gesetzter Schluessel mit undefined-Wert wanderte
    // durch die Serialisierung und macht die Absicht am Server unlesbar.
    const { service, createCalls } = setup()

    await service.createOrder(baseInput)

    expect(createCalls).toHaveLength(1)
    expect('_id' in createCalls[0].payload).toBe(false)
  })

  it('offline gewinnt die mitgegebene _id gegen die lokal erzeugte', async () => {
    // Sonst zeigte eine Einloesung auf eine andere ID als die Order, die spaeter
    // aus der Outbox repliziert wird.
    const { service, enqueued, upserted } = setup({ offline: true })

    await service.createOrder({ ...baseInput, _id: '01920000-0000-7000-8000-0000000000ff' })

    expect(enqueued).toHaveLength(1)
    expect(enqueued[0]['entityId']).toBe('01920000-0000-7000-8000-0000000000ff')
    expect((upserted[0].rows[0] as { _id: string })._id).toBe('01920000-0000-7000-8000-0000000000ff')
  })

  it('offline ohne mitgegebene _id wird weiterhin lokal eine erzeugt', async () => {
    const { service, enqueued } = setup({ offline: true })

    await service.createOrder(baseInput)

    expect(enqueued).toHaveLength(1)
    expect(enqueued[0]['entityId']).toBeTruthy()
  })
})

describe('OrderService.createOrder — Payload', () => {
  it('schickt appliedDiscounts nur, wenn welche vorhanden sind', async () => {
    const discount = { _id: 'ad-1', method: 'code', target: 'order' } as unknown as AppliedDiscount

    const withDiscount = setup()
    await withDiscount.service.createOrder({ ...baseInput, appliedDiscounts: [discount] })
    expect(withDiscount.createCalls[0].payload['appliedDiscounts']).toEqual([discount])

    const withEmpty = setup()
    await withEmpty.service.createOrder({ ...baseInput, appliedDiscounts: [] })
    expect('appliedDiscounts' in withEmpty.createCalls[0].payload).toBe(false)
  })

  it('schickt KEIN Legacy-Feld `discount` (ADR 0030) — der Server lehnt es ab', async () => {
    const { service, createCalls } = setup()

    await service.createOrder({
      ...baseInput,
      appliedDiscounts: [{ _id: 'ad-1', method: 'manual' } as unknown as AppliedDiscount],
    })

    expect('discount' in createCalls[0].payload).toBe(false)
  })

  it('sortiert die Positionen alphabetisch nach topic', async () => {
    const { service, createCalls } = setup()

    await service.createOrder({
      ...baseInput,
      lineItems: [makeLineItem('Zwiebelkuchen'), makeLineItem('Apfeltasche'), makeLineItem('Mohnschnecke')],
    })

    const topics = (createCalls[0].payload['lineItems'] as OrderLineItem[]).map(li => li.topic)
    expect(topics).toEqual(['Apfeltasche', 'Mohnschnecke', 'Zwiebelkuchen'])
  })

  it('setzt dailySequenceNumber als Platzhalter -1 — die echte vergibt der Server', async () => {
    const { service, createCalls } = setup()

    await service.createOrder(baseInput)

    expect(createCalls[0].payload['dailySequenceNumber']).toBe(-1)
    expect(createCalls[0].payload['status']).toBe(OrderStatus.ACTIVE)
    expect(createCalls[0].payload['isFinished']).toBe(false)
  })

  it('laesst optionale Felder weg, statt sie mit undefined zu belegen', async () => {
    const { service, createCalls } = setup()

    await service.createOrder(baseInput)

    for (const key of ['pager', 'table', 'customerPaymentInfo', 'staffPaymentInfo', 'creationContext']) {
      expect(key in createCalls[0].payload, key).toBe(false)
    }
  })
})
