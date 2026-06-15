import { computed, effect, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core'
import { MatDialog } from '@angular/material/dialog'
import { MatSnackBar } from '@angular/material/snack-bar'
import { PrintDialogComponent } from '../components/print-dialog.component'
import { OrderChannel } from '../enums/order-chanel.enum'
import { Id, Paginated, Params } from '@feathersjs/feathers'
import {
  AppliedDiscount,
  CreationContext,
  CustomerPaymentInfo,
  DineLocation,
  Discount,
  Order,
  OrderLineItem,
  OrderStatus,
  StaffPaymentInfo,
  TransactionMethod,
} from '@panary/orders/domain'
import { OrderInteraction } from '@panary/order-interactions/domain'
import { BaseService, ConnectionService, OFFLINE_OUTBOX } from '@panary/shared/data-access'
import { CacheEntity, ExtendedParams, OfflineOutboxPort } from '@panary/shared-common'
import { Observer } from 'rxjs'
import { LocationService } from '@panary/locations/data-access'
import { uuidv7 } from 'uuidv7'

@Injectable({
  providedIn: 'root',
})
export class OrderService extends BaseService<Order> {
  protected override entityLabelKey = 'ENTITY.ORDER'
  protected override cachePolicy = 'transactional' as const
  protected override cacheStoreName = 'orders'

  /** STATIC PROPERTIES */
  protected readonly QUERY_LIMIT: number = 200
  protected readonly SNACKBAR_ACTION: string = 'OK'
  protected readonly SNACKBAR_DURATION: number = 2000

  /** DEPENDENCIES */
  #locationService: LocationService = inject(LocationService)
  protected connectionService: ConnectionService = inject(ConnectionService)
  #outbox: OfflineOutboxPort | null = inject(OFFLINE_OUTBOX, { optional: true })
  #provisionalSequenceCursor = 0
  #matSnackBar: MatSnackBar = inject(MatSnackBar)
  #matDialog: MatDialog = inject(MatDialog)
  #orderIndex = 1
  #productionTimes: Array<number> = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]

  /** PRIVATE PROPERTIES */
  #orders: WritableSignal<Order[]> = signal([])
  #totalOrders: WritableSignal<number> = signal(0)
  #totalFinishedOrders: WritableSignal<number> = signal(0)
  #ordersLastUpdated = signal<Date>(new Date())

  /** PUBLIC PROPERTIES */
  ordersLastUpdated: Signal<Date> = this.#ordersLastUpdated.asReadonly()

  /** GETTER */
  get orders() {
    return this.#orders.asReadonly()
  }

  get ordersActive() {
    return computed(() => this.#orders().filter((order: Order): boolean => order.status !== OrderStatus.COMPLETED))
  }

  get ordersCompleted() {
    return computed(() => this.#orders().filter((order: Order): boolean => order.status !== OrderStatus.ACTIVE))
  }

  get orderIndex() {
    return this.#orderIndex
  }

  get productionTimes() {
    return this.#productionTimes
  }

  get totalOrders() {
    return this.#totalOrders.asReadonly()
  }

  get totalFinishedOrders() {
    return this.#totalFinishedOrders.asReadonly()
  }

  /** CONSTRUCTOR */
  constructor() {
    super(inject(ConnectionService).orderService, 'orderService')

    effect((): void => {
      const isAuthenticated = this.connectionService.isAuthenticated()
      const activeLocation = this.#locationService.activeLocation()

      if (isAuthenticated && activeLocation) {
        this.loadDocuments()
      }
    })

    this.calculateRemainingTimeInterval()
  }

  /** PRIVATE METHODS */
  protected override handleItemCreated(_document: Order) {
    this.#ordersLastUpdated.set(new Date())
    this.loadDocuments()
  }

  protected override handleItemUpdated(_document: Order) {
    this.#ordersLastUpdated.set(new Date())
    this.loadDocuments()
  }

  protected override handleItemRemoved(_document: Order) {
    this.#ordersLastUpdated.set(new Date())
    this.loadDocuments()
  }

  protected override loadDocuments() {
    const currentBusinessDay = this.#locationService.activeLocation()?.currentBusinessDay

    if (!currentBusinessDay) return

    let params: ExtendedParams

    const limit = { $limit: 0 }
    const query = { businessDayId: currentBusinessDay.businessDayId }

    params = { query: { ...query, ...limit } }
    this.find(params).then((response: Paginated<Order> | Order[]): void => {
      this.#totalOrders.set(Array.isArray(response) ? response.length : response.total)
    })

    params = { query: { ...query, ...limit, status: OrderStatus.COMPLETED } }
    this.find(params).then((response: Paginated<Order> | Order[]): void => {
      this.#totalFinishedOrders.set(Array.isArray(response) ? response.length : response.total)
    })

    limit.$limit = this.QUERY_LIMIT
    params = { query: { ...query, ...limit } }
    this.find(params).then((response: Paginated<Order> | Order[]): void => {
      this.#orders.set(Array.isArray(response) ? response : response.data)
      this.calculateRemainingTime()
      this.#matSnackBar.open(`Bestellungen aktualisiert`, OrderService.SNACKBAR_ACTION, {
        duration: OrderService.SNACKBAR_DURATION,
      })
    })
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
  ) {
    /* empty */
  }

  private calculateRemainingTimeInterval() {
    this.calculateRemainingTime()
    setInterval(() => {
      this.calculateRemainingTime()
    }, 60000)
  }

  private calculateRemainingTime(): void {
    this.#orders().forEach((orderItem: Order): void => {
      if (orderItem.status === OrderStatus.COMPLETED) return

      const recordingDate: Date = new Date(orderItem.recordingDate)
      const completionDate: Date = new Date(recordingDate)
      completionDate.setMinutes(completionDate.getMinutes() + orderItem.estimatedDuration)

      if (completionDate < new Date()) {
        orderItem.remainingTime = 0
      } else {
        const diffMs = completionDate.getTime() - new Date().getTime()
        const diffMins = Math.round(((diffMs % 86400000) % 3600000) / 60000)
        orderItem.remainingTime = Math.abs(diffMins)
      }
    })
  }

  private async createOrderAndOpenPrintDialog(
    newOrder: Omit<Order, '_id' | 'locationId' | 'tenantId' | 'createdAt' | 'updatedAt'>,
  ): Promise<number | number[] | undefined | null> {
    return this.#createOrderRecord(newOrder).then((createdOrder: Order | Order[]): number | number[] | undefined | null => {
      if (!createdOrder) return null

      // Eigene Bestellung sofort lokal nachladen. Der Realtime-`created`-Echo
      // ist auf dem erstellenden Gerät nicht verlässlich; ohne dieses Reload
      // bliebe das #orders-Signal stale → Dashboard-Diagramm aktualisiert sich
      // erst nach komplettem Page-Reload. loadDocuments() setzt #orders neu
      // (→ Chart-Effect) und zeigt den „Bestellungen aktualisiert"-Hinweis.
      this.loadDocuments()

      // Druckdialog öffnen, wenn in den Settings aktiviert
      const showDialog = this.#locationService.activeLocation()?.settings?.printSettings?.showDialogAfterOrder ?? true
      if (showDialog) {
        const orderToPrint = createdOrder instanceof Array ? createdOrder[0] : createdOrder
        if (orderToPrint) {
          this.#matDialog.open(PrintDialogComponent, { data: orderToPrint })
        }
      }

      if (createdOrder instanceof Array) {
        return createdOrder.map((order: Order): number => order.dailySequenceNumber)
      } else {
        return createdOrder.dailySequenceNumber
      }
    })
  }

  /** Online → Server; offline → optimistisch in Cache + Outbox (Connect-Tier). */
  async #createOrderRecord(newOrder: Omit<Order, '_id' | 'locationId' | 'tenantId'>): Promise<Order | Order[]> {
    if (this.#shouldQueueOffline()) {
      return this.#enqueueOfflineOrder(newOrder)
    }
    return this.create(newOrder)
  }

  #shouldQueueOffline(): boolean {
    return (
      this.connectionService.connectionState().status !== 'authenticated' &&
      !!this.#outbox?.isReady() &&
      !!this.cacheStore?.isReady()
    )
  }

  /**
   * Legt eine Order offline an: client-`_id` (uuidv7), provisorische Belegnummer +
   * `offlineCreated`-Marker (das Backend überspringt das TSE-Signieren beim Replay,
   * KassenSichV §146a), optimistisch in Cache + Outbox. Der Server re-stampt die finale
   * `dailySequenceNumber` beim Sync.
   */
  async #enqueueOfflineOrder(newOrder: Omit<Order, '_id' | 'locationId' | 'tenantId'>): Promise<Order> {
    const location = this.#locationService.activeLocation()
    const provisional = this.#nextProvisionalSequence()
    const order: Order = {
      ...(newOrder as Order),
      _id: uuidv7(),
      tenantId: location?.tenantId ?? '',
      locationId: location?._id ?? '',
      dailySequenceNumber: provisional,
      provisionalSequenceNumber: provisional,
      offlineCreated: true,
      updatedAt: new Date().toISOString(),
    }

    await this.cacheStore?.upsertMany('orders', [order as unknown as CacheEntity])
    await this.#outbox?.enqueue({
      _id: uuidv7(),
      service: 'orders',
      op: 'create',
      entityId: order._id,
      payload: order,
      occurredAt: order.recordingDate,
    })
    return order
  }

  /** Monoton steigende provisorische Belegnummer (max. gesehene im Cache + lokaler Cursor). */
  #nextProvisionalSequence(): number {
    const maxSeen = this.#orders().reduce((max, order) => Math.max(max, order.dailySequenceNumber ?? 0), 0)
    this.#provisionalSequenceCursor = Math.max(this.#provisionalSequenceCursor, maxSeen) + 1
    return this.#provisionalSequenceCursor
  }

  /**
   * Online → Server; offline → optimistischer Cache-Merge + Outbox (op `patch`), damit
   * der Checkout (Status/Payment) offline funktioniert. Bargeld-Zwang: offline ist keine
   * Karten-/Online-Zahlung möglich (Stripe braucht Netz) → wird abgelehnt.
   */
  override async patch(id: Id | Id[] | null, data: Partial<Order>, params: Params = {}): Promise<Order | Order[]> {
    if (this.#shouldQueueOffline() && typeof id === 'string') {
      return this.#patchOffline(id, data)
    }
    return super.patch(id, data, params)
  }

  async #patchOffline(id: string, data: Partial<Order>): Promise<Order> {
    if (data.payment?.transactions?.some(t => t.method !== TransactionMethod.CASH)) {
      this.#matSnackBar.open('Offline ist nur Barzahlung möglich.', 'OK', { duration: 3000 })
      throw new Error('OFFLINE_CASH_ONLY')
    }

    const existing = (await this.cacheStore?.get('orders', id)) as Order | undefined
    const merged = { ...(existing ?? {}), ...data, _id: id, updatedAt: new Date().toISOString() } as Order

    await this.cacheStore?.upsertMany('orders', [merged as unknown as CacheEntity])
    await this.#outbox?.enqueue({
      _id: uuidv7(),
      service: 'orders',
      op: 'patch',
      entityId: id,
      payload: data,
      occurredAt: new Date().toISOString(),
    })
    return merged
  }

  private markOrdersAsCompleted(): void {
    this.service
      .multiPatchStatus(OrderStatus.COMPLETED, { query: { status: OrderStatus.ACTIVE } })
      .then((orders: Order[]): void => {
        this.#matSnackBar
          .open(`${orders.length} Bestellungen wurden als erledigt markiert`, OrderService.SNACKBAR_ACTION, {
            duration: OrderService.SNACKBAR_DURATION,
          })
          .afterDismissed()
          .subscribe((): void => {
            this.loadDocuments()
          })
      })
      .catch((error: unknown) => this.helper.handleError(this.serviceName, error))
  }

  /** PUBLIC PROPERTIES */
  // Refactored: Removed combinations parameter
  async createOrder(
    lineItems: Array<OrderLineItem>, // combinations: Array<OrderLineItem[]> (Removed)
    orderChanel: typeof OrderChannel[keyof typeof OrderChannel],
    customerDetails: CustomerPaymentInfo | undefined = undefined,
    discountDetails: Discount | undefined = undefined,
    pager: number | undefined = undefined,
    produktionTime: number,
    staffMealDetails: StaffPaymentInfo | undefined = undefined,
    table: string | undefined = undefined,
    dineLocation: typeof DineLocation[keyof typeof DineLocation],
    recordingDate: Date,
    orderInteractions: Array<OrderInteraction> = [],
    creationContext?: CreationContext,
    appliedDiscounts: AppliedDiscount[] | undefined = undefined,
  ): Promise<number | number[] | null | undefined> {
    // businessDayId wird vom Backend automatisch verwaltet (standalone: Auto-Rotate)
    const businessDayId = this.#locationService.activeLocation()?.currentBusinessDay?.businessDayId

    const order: Omit<Order, '_id' | 'locationId' | 'tenantId'> = {
      status: OrderStatus.ACTIVE,
      businessDayId: businessDayId,
      orderChannel: orderChanel,
      dailySequenceNumber: -1,
      dineLocation: dineLocation,

      lineItems: lineItems,
      // combinations: combinations, (Removed)

      estimatedDuration: produktionTime,
      remainingTime: produktionTime,
      recordingDate: recordingDate instanceof Date ? recordingDate.toISOString() : recordingDate,
      isFinished: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    if (pager) order.pager = pager
    if (table) order.table = table
    if (customerDetails) order.customerPaymentInfo = customerDetails
    if (staffMealDetails) order.staffPaymentInfo = staffMealDetails
    if (discountDetails) order.discount = discountDetails
    // appliedDiscounts ist führend für die Tax-Engine; order.discount bleibt als
    // Legacy-Spiegel für Alt-Reader (Aggregator/Bon) gesetzt (Rückwärtskompatibilität).
    if (appliedDiscounts && appliedDiscounts.length > 0) order.appliedDiscounts = appliedDiscounts
    if (orderInteractions.length > 0) (order as Order & { orderInteractions?: OrderInteraction[] }).orderInteractions = orderInteractions
    if (creationContext) order.creationContext = creationContext

    this.sortLineItemsByName(order.lineItems)

    return this.createOrderAndOpenPrintDialog(order)
  }

  private sortLineItemsByName(orderLineItems: OrderLineItem[]): void {
    orderLineItems.sort((a: OrderLineItem, b: OrderLineItem): number => {
      const name1: string = a.topic.toLowerCase()
      const name2: string = b.topic.toLowerCase()

      return name1 > name2 ? 1 : name1 < name2 ? -1 : 0
    })
  }

  complete(id: Id | undefined) {
    if (!id) {
      this.#matSnackBar.open('Bitte geben Sie eine gültige Bestell-Id ein', 'OK', { duration: 2000 })
      return
    }

    return this.patch(id, { status: OrderStatus.COMPLETED })
  }

  async toggleStatus(id: Id | undefined) {
    if (!id) {
      this.#matSnackBar.open('Bitte geben Sie eine gültige Bestell-Id ein', 'OK', { duration: 2000 })
      return
    }

    const order: Order | undefined = this.#orders().find((orderItem: Order): boolean => {
      return orderItem._id === id
    })
    if (!order) {
      this.#matSnackBar.open(`Bestellung mit der Id (${id}) konnte nicht gefunden werden`, 'OK', { duration: 2000 })
      return
    }

    return this.patch(id, {
      status: order.status === OrderStatus.ACTIVE ? OrderStatus.COMPLETED : OrderStatus.ACTIVE,
    })
  }

  markAllOrdersAsDone(): void {
    this.markOrdersAsCompleted()
  }

  refreshOrders(): void {
    this.loadDocuments()
  }
}
