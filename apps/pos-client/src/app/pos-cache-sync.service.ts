import { effect, inject, Injectable, untracked } from '@angular/core'
import { normalizeToRecords } from '@panary/shared-common'
import { ConnectionService } from '@panary/shared/data-access'
import { OfflineCacheStore } from '@panary/shared/offline-cache'
import { ProductService } from '@panary/products/data-access'
import { ProductGroupService } from '@panary/product-groups/data-access'
import { DiscountService } from '@panary/discounts/data-access'
import { LocationService } from '@panary/locations/data-access'
import { OrderService } from '@panary/orders/data-access'

/** Eine cachebare Quelle: Store-Name + ein `find()`, das per BaseService write-through cached. */
interface CacheSyncSource {
  readonly store: string
  readonly find: (query: Record<string, unknown>) => Promise<unknown>
}

const SYNC_PAGE_LIMIT = 200

/**
 * Proaktiver Cache-Abgleich beim (Re-)Connect (Phase 3 — Freshness): pro Service
 * ein Delta-Pull (`updatedAt > cursor`) bzw. ein Voll-Bootstrap (kein Cursor). Die
 * `find()`-Aufrufe cachen über den `BaseService` bereits write-through — dieser
 * Service verwaltet nur Cursor, Pagination und den Connect-Trigger.
 *
 * Delta setzt voraus, dass der Service `updatedAt` als Query-Property zulässt
 * (products, orders). Wo nicht (product-groups, discounts, locations), fällt der
 * Pull bei einem Fehler auf einen Voll-Refresh zurück.
 */
@Injectable()
export class PosCacheSyncService {
  readonly #store = inject(OfflineCacheStore)
  readonly #connection = inject(ConnectionService)
  #syncing = false

  readonly #sources: readonly CacheSyncSource[] = [
    sourceOf('products', inject(ProductService)),
    sourceOf('product-groups', inject(ProductGroupService)),
    sourceOf('discounts', inject(DiscountService)),
    sourceOf('locations', inject(LocationService)),
    sourceOf('orders', inject(OrderService)),
  ]

  constructor() {
    // Reagiert auf Cache-Bereitschaft + Authentifizierung; der eigentliche Sync
    // läuft entkoppelt (untracked), damit interne Signal-Reads keinen Loop bauen.
    effect(() => {
      const ready = this.#store.ready()
      const status = this.#connection.connectionState().status
      if (ready && status === 'authenticated') {
        untracked(() => void this.syncAll())
      }
    })
  }

  async syncAll(): Promise<void> {
    if (this.#syncing || !this.#store.isReady()) return
    this.#syncing = true
    try {
      for (const source of this.#sources) {
        try {
          await this.#syncSource(source)
        } catch (error) {
          console.error(`[offline-cache] Sync fehlgeschlagen für "${source.store}":`, error)
        }
      }
    } finally {
      this.#syncing = false
    }
  }

  async #syncSource(source: CacheSyncSource): Promise<void> {
    const cursor = await this.#store.getCursor(source.store)
    try {
      await this.#pull(source, cursor)
    } catch (error) {
      // Delta evtl. nicht unterstützt (updatedAt nicht queryable) → Voll-Refresh-Fallback.
      if (cursor) {
        await this.#pull(source, undefined)
      } else {
        throw error
      }
    }
  }

  async #pull(source: CacheSyncSource, cursor: string | undefined): Promise<void> {
    let skip = 0
    let maxUpdatedAt = cursor ?? ''
    for (;;) {
      const query: Record<string, unknown> = { $sort: { _id: 1 }, $limit: SYNC_PAGE_LIMIT, $skip: skip }
      if (cursor) query['updatedAt'] = { $gt: cursor }

      const records = normalizeToRecords(await source.find(query))
      for (const record of records) {
        if (record.updatedAt && record.updatedAt > maxUpdatedAt) {
          maxUpdatedAt = record.updatedAt
        }
      }
      if (records.length < SYNC_PAGE_LIMIT) break
      skip += SYNC_PAGE_LIMIT
    }
    if (maxUpdatedAt && maxUpdatedAt !== cursor) {
      await this.#store.setCursor(source.store, maxUpdatedAt)
    }
  }
}

function sourceOf(
  store: string,
  service: { find: (params: { query: Record<string, unknown> }) => Promise<unknown> },
): CacheSyncSource {
  return { store, find: query => service.find({ query }) }
}
