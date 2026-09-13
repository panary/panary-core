import { effect, inject, Injectable, untracked } from '@angular/core'
import { normalizeToRecords } from '@panary/shared-common'
import { ConnectionService } from '@panary/shared/data-access'
import { OfflineCacheStore } from '@panary/shared/offline-cache'
import { ProductService } from '@panary/products/data-access'
import { ProductGroupService } from '@panary/product-groups/data-access'
import { DiscountService } from '@panary/discounts/data-access'
import { LocationService } from '@panary/locations/data-access'
import { OrderService } from '@panary/orders/data-access'

/**
 * Die Quellen, die der POS-Cache abgleicht. Exportiert und als Literal-Typ geführt, damit
 * die Liste nicht still auseinanderläuft: `#sources` ist auf `PosCacheSyncStore` typisiert
 * (ein neuer Eintrag kompiliert also nur, wenn er hier steht), und
 * `pos-cache-sync.service.spec.ts` belegt für jeden Namen, dass das zugehörige
 * Query-Schema `updatedAt` fuehrt. Ohne diese Kette fällt eine delta-unfähige Quelle erst
 * zur Laufzeit auf — als 400 des Query-Validators, den `#syncSource()` still abfängt.
 */
export const POS_CACHE_SYNC_STORES = ['products', 'product-groups', 'discounts', 'locations', 'orders'] as const

export type PosCacheSyncStore = (typeof POS_CACHE_SYNC_STORES)[number]

/** Eine cachebare Quelle: Store-Name + ein `find()`, das per BaseService write-through cached. */
interface CacheSyncSource {
  readonly store: PosCacheSyncStore
  readonly find: (query: Record<string, unknown>) => Promise<unknown>
}

const SYNC_PAGE_LIMIT = 200

/**
 * Proaktiver Cache-Abgleich beim (Re-)Connect (Phase 3 — Freshness): pro Service
 * ein Delta-Pull (`updatedAt > cursor`) bzw. ein Voll-Bootstrap (kein Cursor). Die
 * `find()`-Aufrufe cachen über den `BaseService` bereits write-through — dieser
 * Service verwaltet nur Cursor, Pagination und den Connect-Trigger.
 *
 * Delta setzt voraus, dass der Service `updatedAt` als Query-Property zulässt — das tun
 * **alle** Quellen in `POS_CACHE_SYNC_STORES`, und die Edge-Services hängen genau diese
 * Domain-Schemas in ihren Query-Validator. Festgehalten wird das von
 * `pos-cache-sync.service.spec.ts`; fällt `updatedAt` aus einem Schema, lehnt der
 * Validator die Delta-Query mit 400 „additional property updatedAt" ab.
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
    if (!cursor) {
      await this.#pull(source, undefined)
      return
    }
    try {
      await this.#pull(source, cursor)
    } catch (error) {
      if (!isRejectedDeltaQuery(error)) throw error
      // Der Server hat die Delta-Query selbst verworfen → einmalig ohne `updatedAt`-Filter
      // nachziehen, damit die Quelle nicht dauerhaft auf einem unbrauchbaren Cursor steht.
      await this.#pull(source, undefined)
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

/**
 * Heilt ein Voll-Pull diesen Fehler? Nur bei einem Bad Request des Query-Validators
 * (400/422) liegt es an der Delta-Query — dann kommt ein Pull ohne `updatedAt`-Filter
 * durch. Netz-, Auth- und Server-Fehler (offline, 401, 5xx) heilt er nicht: Dort wäre
 * der Voll-Pull nur der teurere zweite Fehlschlag, und zwar genau dann, wenn die
 * Leitung ohnehin klemmt. Solche Fehler protokolliert der Aufrufer; der
 * nächste Connect löst `syncAll()` erneut aus.
 */
function isRejectedDeltaQuery(error: unknown): boolean {
  const code = (error as { code?: number } | null)?.code
  return code === 400 || code === 422
}

function sourceOf(
  store: PosCacheSyncStore,
  service: { find: (params: { query: Record<string, unknown> }) => Promise<unknown> },
): CacheSyncSource {
  return { store, find: query => service.find({ query }) }
}
