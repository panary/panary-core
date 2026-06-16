import { inject, Injectable, signal } from '@angular/core'
import { MatSnackBar } from '@angular/material/snack-bar'
import { TranslateService } from '@ngx-translate/core'
import { BaseService, ConnectionService, OFFLINE_OUTBOX } from '@panary/shared/data-access'
import { CacheEntity, OfflineOutboxPort } from '@panary/shared-common'
import { PreOrder, PreOrderStatus } from '@panary/pre-orders/domain'
import { Params, Service } from '@feathersjs/feathers'
import { Order } from '@panary/orders/data-access'
import { LocationService } from '@panary/locations/data-access'
import { Observer } from 'rxjs'
import { uuidv7 } from 'uuidv7'

interface PreOrdersCustomService extends Service<PreOrder> {
  convert(id: string): Promise<Order>
}

type PreOrderCreateData = Omit<PreOrder, '_id' | 'locationId' | 'tenantId'>

@Injectable({
  providedIn: 'root',
})
export class PreOrderService extends BaseService<PreOrder> {
  protected override entityLabelKey = 'ENTITY.PRE_ORDER'
  // Transaktional gecached → offline lesbar (Liste) + offline anlegbar (Outbox).
  protected override cachePolicy = 'transactional' as const
  protected override cacheStoreName = 'pre-orders'

  #outbox: OfflineOutboxPort | null = inject(OFFLINE_OUTBOX, { optional: true })
  #locationService = inject(LocationService)
  #connection = inject(ConnectionService)
  #snackBar = inject(MatSnackBar)
  #translate = inject(TranslateService)

  protected override loadDocuments(): void {
    throw new Error('Method not implemented.')
  }

  protected override fileReaderOnLoad(
    _fileReader: FileReader,
    _observer: Observer<unknown>,
    _context: {
      errorMessages: string[]
      warnMessages: string[]
      successCount: number
      multi: boolean
    },
  ): void {
    throw new Error('Method not implemented.')
  }

  #documents = signal<PreOrder[]>([])
  #isLoading = signal<boolean>(false)

  public documents = this.#documents.asReadonly()
  public isLoading = this.#isLoading.asReadonly()

  constructor() {
    super(inject(ConnectionService).preOrdersService, 'preOrdersService')
  }

  /** Online → Server; offline → optimistisch in Cache + Outbox (Connect-Tier). */
  override async create(
    data: PreOrderCreateData | PreOrderCreateData[],
    params: Params = {},
  ): Promise<PreOrder | PreOrder[]> {
    if (!Array.isArray(data) && this.#shouldQueueOffline()) {
      return this.#enqueueOfflinePreOrder(data)
    }
    return super.create(data, params)
  }

  /**
   * Konvertiert eine Pre-Order in eine echte Order (server-Custom-Method). Offline nicht
   * möglich — die Konvertierung braucht den Server (legt eine Order an, re-stampt etc.).
   */
  async convert(id: string): Promise<Order> {
    if (this.#shouldQueueOffline()) {
      this.#snackBar.open(this.#translate.instant('PRE_ORDERS.CONVERT_OFFLINE_BLOCKED'), 'OK', { duration: 4000 })
      throw new Error('OFFLINE_CONVERT_BLOCKED')
    }
    return (this.service as unknown as PreOrdersCustomService).convert(id)
  }

  #shouldQueueOffline(): boolean {
    return (
      this.#connection.connectionState().status !== 'authenticated' &&
      !!this.#outbox?.isReady() &&
      !!this.cacheStore?.isReady()
    )
  }

  /**
   * Legt eine Pre-Order offline an: client-`_id` (uuidv7) → idempotenter Replay
   * (Resolver: `_id = value || uuidv7()`), optimistisch in Cache + Outbox. Kein TSE/
   * keine Belegnummer (Pre-Orders sind nicht fiskalisch) — die Order entsteht erst beim
   * (online) `convert`.
   */
  async #enqueueOfflinePreOrder(data: PreOrderCreateData): Promise<PreOrder> {
    const location = this.#locationService.activeLocation()
    const now = new Date().toISOString()
    const preOrder: PreOrder = {
      ...(data as PreOrder),
      _id: uuidv7(),
      tenantId: location?.tenantId ?? '',
      locationId: location?._id ?? '',
      status: data.status ?? PreOrderStatus.PENDING,
      createdAt: now,
      updatedAt: now,
    }

    await this.cacheStore?.upsertMany('pre-orders', [preOrder as unknown as CacheEntity])
    await this.#outbox?.enqueue({
      _id: uuidv7(),
      service: 'pre-orders',
      op: 'create',
      entityId: preOrder._id,
      payload: preOrder,
      occurredAt: now,
    })
    return preOrder
  }
}
