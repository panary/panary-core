// Invariante: Jede Quelle des POS-Offline-Cache-Delta-Sync muss `updatedAt` als
// Query-Property führen — sonst lehnt der Query-Validator des Edge-Service die
// Delta-Query (`updatedAt > cursor`) mit 400 „additional property updatedAt" ab.
//
// Warum diese Spec existiert (#306): Der Klassen-Kommentar des Service behauptete bis
// 2026-09-13, `product-groups`, `discounts` und `locations` könnten kein Delta — falsch,
// und zwar schon am Tag, an dem der Kommentar geschrieben wurde. Aufgefallen war es nie,
// weil ein abgelehnter Delta-Pull vom `catch` in `#syncSource()` aufgefangen wird: Der
// Voll-Pull danach liefert korrekte Daten, nur eben jedes Mal die vollständige Menge.
// Ein stiller Dauerschaden ohne Symptom.
//
// Die Kette, die das künftig verhindert, hat zwei Glieder:
//   1. `#sources` ist auf `PosCacheSyncStore` typisiert — eine neue Quelle kompiliert
//      nur, wenn sie in `POS_CACHE_SYNC_STORES` steht.
//   2. Diese Spec verlangt für jeden Namen aus `POS_CACHE_SYNC_STORES` einen Eintrag in
//      `QUERY_PROPERTIES_BY_STORE` und prüft dort `updatedAt`.
// Eine neue Quelle ohne delta-fähiges Schema wird damit rot, statt still zu degradieren.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import type { TObject } from '@feathersjs/typebox'
import { ConnectionService } from '@panary/shared/data-access'
import { OfflineCacheStore } from '@panary/shared/offline-cache'
import { DiscountService } from '@panary/discounts/data-access'
import { LocationService } from '@panary/locations/data-access'
import { OrderService } from '@panary/orders/data-access'
import { ProductService } from '@panary/products/data-access'
import { ProductGroupService } from '@panary/product-groups/data-access'
import { discountQueryProperties } from '@panary/discounts/domain'
import { locationQueryProperties } from '@panary/locations/domain'
import { orderQueryProperties } from '@panary/orders/domain'
import { productQueryProperties } from '@panary/products/domain'
import { productGroupQueryProperties } from '@panary/product-groups/domain'
import { POS_CACHE_SYNC_STORES, PosCacheSyncService, type PosCacheSyncStore } from './pos-cache-sync.service'

/**
 * Store-Name → die Query-Properties, aus denen `querySyntax()` das Query-Schema des
 * Service baut. `Record<PosCacheSyncStore, …>` macht eine fehlende Zeile schon zum
 * Build-Fehler: Der Angular-Unit-Test-Builder kompiliert diese Spec mit, `nx test
 * pos-client` bricht also bereits mit TS2741 ab (gemessen 2026-09-13). Der erste Test
 * prüft dieselbe Vollständigkeit trotzdem zur Laufzeit — er hält die Invariante als
 * Aussage fest und greift auch dann noch, wenn der Typ hier je aufgeweicht wird.
 */
const QUERY_PROPERTIES_BY_STORE: Record<PosCacheSyncStore, TObject> = {
  products: productQueryProperties,
  'product-groups': productGroupQueryProperties,
  discounts: discountQueryProperties,
  locations: locationQueryProperties,
  orders: orderQueryProperties,
}

describe('POS-Cache-Sync — Delta-Fähigkeit der Quellen', () => {
  it('deckt jede Quelle aus POS_CACHE_SYNC_STORES mit einem Query-Schema ab', () => {
    expect([...POS_CACHE_SYNC_STORES].sort()).toEqual(Object.keys(QUERY_PROPERTIES_BY_STORE).sort())
  })

  it.each([...POS_CACHE_SYNC_STORES])('„%s" lässt updatedAt als Query-Property zu', store => {
    const properties = QUERY_PROPERTIES_BY_STORE[store]?.properties

    expect(Object.keys(properties ?? {})).toContain('updatedAt')
  })
})

// --- Fallback-Verhalten ------------------------------------------------------------
//
// Der `catch` in `#syncSource()` ist NICHT tot — er fängt weiterhin jeden Transportfehler.
// Seine Begründung hat sich aber umgekehrt: Ein Voll-Pull heilt nur einen Cursor, den der
// Query-Validator ablehnt (400/422). Bei Netzwerkfehlern war der nachgesetzte Voll-Pull
// schädlich — er zieht ohne `updatedAt`-Filter die vollständige Menge, also den teuersten
// aller Pulls, genau im Moment der kaputten Leitung, und scheitert mit hoher
// Wahrscheinlichkeit ebenfalls. Geheilt wird das seit #306 vom nächsten Connect: Der
// `effect()` löst `syncAll()` bei jedem `authenticated` erneut aus.

/** Ein Feathers-Fehler trägt seinen HTTP-Status in `code`. */
function errorWithCode(code: number): Error & { code: number } {
  return Object.assign(new Error(`HTTP ${code}`), { code })
}

function setupSync(options: { cursor?: string; productsFind: ReturnType<typeof vi.fn> }) {
  const emptyPage = () => Promise.resolve([])
  const store = {
    ready: signal(true),
    isReady: () => true,
    getCursor: vi.fn((service: string) => Promise.resolve(service === 'products' ? options.cursor : undefined)),
    setCursor: vi.fn(() => Promise.resolve()),
  }

  TestBed.configureTestingModule({
    providers: [
      PosCacheSyncService,
      { provide: OfflineCacheStore, useValue: store },
      // 'disconnected' hält den Connect-`effect()` still — die Tests rufen `syncAll()` selbst.
      { provide: ConnectionService, useValue: { connectionState: signal({ status: 'disconnected' }) } },
      { provide: ProductService, useValue: { find: options.productsFind } },
      { provide: ProductGroupService, useValue: { find: emptyPage } },
      { provide: DiscountService, useValue: { find: emptyPage } },
      { provide: LocationService, useValue: { find: emptyPage } },
      { provide: OrderService, useValue: { find: emptyPage } },
    ],
  })

  return { service: TestBed.inject(PosCacheSyncService), store }
}

/** Die `updatedAt`-Filter der bisherigen `find()`-Aufrufe — `undefined` = Voll-Pull. */
function deltaFiltersOf(find: ReturnType<typeof vi.fn>): unknown[] {
  return find.mock.calls.map(([params]) => (params as { query: Record<string, unknown> }).query['updatedAt'])
}

describe('PosCacheSyncService — Voll-Pull-Fallback', () => {
  afterEach(() => {
    TestBed.resetTestingModule()
    vi.restoreAllMocks()
  })

  it('setzt bei einem Netzwerkfehler KEINEN Voll-Pull nach', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    // Kein `code` — genau das, was ein abgerissener Transport wirft.
    const productsFind = vi.fn(() => Promise.reject(new Error('Network request failed')))
    const { service } = setupSync({ cursor: '2026-09-01T00:00:00.000Z', productsFind })

    await service.syncAll()

    expect(deltaFiltersOf(productsFind)).toEqual([{ $gt: '2026-09-01T00:00:00.000Z' }])
    expect(logged).toHaveBeenCalledTimes(1)
  })

  it('zieht bei einem vom Query-Validator abgelehnten Cursor (400) einmalig voll nach', async () => {
    const productsFind = vi.fn()
    productsFind.mockRejectedValueOnce(errorWithCode(400)).mockResolvedValueOnce([])
    const { service } = setupSync({ cursor: '2026-09-01T00:00:00.000Z', productsFind })

    await service.syncAll()

    expect(deltaFiltersOf(productsFind)).toEqual([{ $gt: '2026-09-01T00:00:00.000Z' }, undefined])
  })

  it('zieht ohne Cursor direkt voll — ohne Umweg über eine scheiternde Delta-Query', async () => {
    const productsFind = vi.fn(() => Promise.resolve([]))
    const { service } = setupSync({ cursor: undefined, productsFind })

    await service.syncAll()

    expect(deltaFiltersOf(productsFind)).toEqual([undefined])
  })
})
