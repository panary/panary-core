import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
  Pipe,
  PipeTransform,
  signal,
  ViewChild,
  WritableSignal,
} from '@angular/core'
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog'
import { MatMenuModule } from '@angular/material/menu'
import { FormsModule } from '@angular/forms'
import { CommonModule } from '@angular/common'
import { animate, style, transition, trigger } from '@angular/animations'
// UUID als String-Alias (node:crypto UUID ist ein branded type – für Migration vereinfacht)
type UUID = string

import { ProductGroupSchema, ProductGroupService } from '@panary-core/product-groups/data-access'
import { ItemType, ProductSchema, ProductService } from '@panary-core/products/data-access'
import {
  calculateArticlePrice,
  calculateArticlePriceWithoutExtras,
  calculateCombinationPrice,
  calculateSumPrice,
  CustomerPaymentInfo,
  DineLocation,
  getCombinations,
  getUnbundledLineItems,
  OrderChannel,
  OrderInteraction,
  OrderInteractionService,
  OrderLineItemSchema,
  OrderService,
  StaffPaymentInfo,
} from '@panary-core/orders/data-access'
import { Discount } from '@panary-core/orders/domain'
import { PreOrderService } from '@panary-core/pre-orders/data-access'
import { LocationService } from '@panary-core/locations/data-access'
import { AuthService } from '@panary-core/auth/data-access'
import { User, UserService } from '@panary-core/users/data-access'
import { ConnectionService } from '@panary-core/shared/data-access'
import { DeviceConfigService } from '@panary-core/shared/data-access-config'
import { CorporateCustomer } from '@panary-core/corporate-customers/domain'
import { PreOrderQuickDialogComponent } from './pre-order-quick-dialog.component'
import { TranslateModule, TranslateService } from '@ngx-translate/core'
// TODO: CorporateCustomerService fehlt noch in @panary-core/corporate-customers/data-access — nach Migration einbinden
// TODO: AppButtonDirective fehlt noch in panary-core — nach Migration einbinden
// TODO: ConfirmActionDialog fehlt noch in panary-core — nach Migration in @panary-core/shared/ui-dialogs einbinden
// TODO: isLightColor fehlt noch in panary-core — nach Migration in @panary-core/shared/util-theme einbinden
// TODO: PreOrderDialogComponent fehlt noch als eigene Lib in panary-core

/** Inline-Implementierung von AbsPipe bis @panary-core/shared/pipes migriert ist */
@Pipe({ name: 'abs', standalone: true, pure: true })
export class AbsPipe implements PipeTransform {
  transform(value: number): number {
    return Math.abs(value)
  }
}

@Component({
  selector: 'app-order-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AbsPipe,
    CommonModule,
    FormsModule,
    MatMenuModule,
    TranslateModule,
  ],
  templateUrl: './order-dialog.component.html',
  styleUrls: ['./order-dialog.component.scss'],
  animations: [
    trigger('changeInfoBoxText', [
      transition('* => *', [
        style({ transform: 'translateX(0)' }),
        animate(75, style({ transform: 'translateX(0)' })),
        animate(150, style({ transform: 'translateX(5px)' })),
        animate(75, style({ transform: 'translateX(-3px)' })),
        animate(75, style({ transform: 'translateX(5px)' })),
        animate(150, style({ transform: 'translateX(0)' })),
      ]),
    ]),
  ],
})
export class OrderDialogComponent implements OnInit, AfterViewInit, OnDestroy {
  /** INJECTIONS */
  protected readonly productGroupService: ProductGroupService = inject(ProductGroupService)
  protected readonly productService: ProductService = inject(ProductService)
  protected readonly orderService: OrderService = inject(OrderService)
  // TODO: CorporateCustomerService nach Migration aktivieren
  // protected readonly corporateCustomerService: CorporateCustomerService = inject(CorporateCustomerService)
  protected readonly locationService: LocationService = inject(LocationService)
  protected readonly authService: AuthService = inject(AuthService)
  protected readonly translateService: TranslateService = inject(TranslateService)
  protected readonly userService: UserService = inject(UserService)
  protected readonly matDialogRef: MatDialogRef<OrderDialogComponent> = inject(MatDialogRef<OrderDialogComponent>)
  protected readonly matDialog: MatDialog = inject(MatDialog)
  protected readonly orderInteractionService: OrderInteractionService = inject(OrderInteractionService)
  protected readonly deviceConfigService: DeviceConfigService = inject(DeviceConfigService)
  protected readonly preOrderService: PreOrderService = inject(PreOrderService)

  /** VIEW CHILDREN */
  // TODO: @ViewChild durch viewChild()-Signal ersetzen, sobald AfterViewInit-Logik migriert ist
  @ViewChild('productGroupContainer') productGroupContainer!: ElementRef
  #cdr = inject(ChangeDetectorRef)

  /** PRIVATE PROPERTIES */
  private _timer: ReturnType<typeof setInterval> | undefined

  #functionButtonExternalId: UUID = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxx01'
  #recordingDate: Date = new Date()
  #lineItems: Array<OrderLineItemSchema> = []
  #orderOpenedAt: Date = new Date()
  #orderInteractions: Array<OrderInteraction> = []
  private _articlesToCombine: Array<number> = []
  private _isBlocked = false
  private _customer: CorporateCustomer | undefined = undefined
  private _currentUser: User | undefined = undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _functionButtons: any[] = []
  private _infoBoxBackgroundColor = '#f1f5f9'
  private _infoBoxText = 'Bitte wählen Sie eine Produktkategorie!'
  private _infoBoxTextColor = 'black'
  private _lastParentId: string | null | undefined = undefined
  private _pager: number | undefined = undefined
  private _priceVisibility = false
  private _productionTime = 0
  private _productionTimes: Array<number>
  private _selectedProductIndex: number | null = null
  private _selectedCombinationIndex: [number | null, number | null] = [null, null]
  private _staffMealOrder = false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _productButtons: any[] = []
  private _table: string | undefined = undefined
  private _dineLocation: typeof DineLocation[keyof typeof DineLocation] | undefined = undefined
  private _withoutExtra = false

  // Bundle/Menü-Flow State
  #completedGroups = new Set<string>()

  private _combineAllId = 'combineAllArticles'
  private _combineAllName = 'Alle Artikel kombinieren'
  private _combineId = 'combineArticles'
  private _combineName = 'Kombinieren'
  private _combiTopic: UUID = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxx02'
  private _deleteCombinationId = 'deleteCombintation'
  private _deleteCombinationName = 'Kombination löschen?'
  private _deleteCustomerId = 'deleteCustomer'
  private _deleteCustomerName = 'Kunde löschen?'
  private _deleteOrderId = 'deleteOrder'
  private _deleteOrderName = 'Bestellung löschen?'
  private _extraTopic = 'Extras'
  private _productionTimeTopic: UUID = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxx03'
  private _resolveCombinationId = 'resolveCombination'
  private _resolveCombinationName = 'Kombination auflösen?'
  private _skipExtraId = 'skipExtra'
  private _skipExtraName = 'ABBRUCH'
  private _skipSauceId = 'skipSauce'
  private _skipSauceName = 'WEITER'
  private _skipSuccessorId = 'skipSuccessor'
  private _skipSuccessorName = 'SKIP'
  private _tableTopic: UUID = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxx04'
  private _withoutExtraId = 'withoutExtra'
  private _numpadNumber: number | undefined = undefined
  private _numpadValue = ''
  private _resizeObserver: ResizeObserver | undefined

  /** PUBLIC PROPERTIES */
  time: WritableSignal<Date> = signal(new Date())
  multiplier = 1
  multiplierFirstStep = true
  characters: Array<string> = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))
  corporateCustomers: Array<CorporateCustomer> = []
  totalCorporateCustomers = 0
  generalSideDishPrice = 0
  generalDrinkPrice = 0
  extras = this.productService.extras

  visibleProductGroups: ProductGroupSchema[] = []
  overflowProductGroups: ProductGroupSchema[] = []

  get combinations(): OrderLineItemSchema[][] {
    return getCombinations({ lineItems: this.#lineItems } as any)
  }

  get unbundledLineItems(): OrderLineItemSchema[] {
    return getUnbundledLineItems({ lineItems: this.#lineItems } as any)
  }

  /** GETTER */
  get lineItems() {
    return this.#lineItems
  }

  get productButtons() {
    return this._productButtons
  }

  get functionButtons() {
    return this._functionButtons
  }

  get infoBoxText() {
    return this._infoBoxText
  }

  get infoBoxBackgroundColor() {
    return this._infoBoxBackgroundColor
  }

  get infoBoxTextColor() {
    return this._infoBoxTextColor
  }

  get priceVisibility() {
    return this._priceVisibility
  }

  get selectedProductIndex() {
    return this._selectedProductIndex
  }

  get selectedCombinationIndex() {
    return this._selectedCombinationIndex
  }

  get productGroups(): ProductGroupSchema[] {
    return this.productGroupService.productGroups().filter((productGroup: ProductGroupSchema) => !productGroup.excluded)
  }

  get numbers(): number[] {
    return Array.from(Array(10).keys()).map(x => x)
  }

  get customer(): CorporateCustomer | undefined {
    return this._customer
  }

  set customer(customer: CorporateCustomer | undefined) {
    this._customer = customer
  }

  get currentUser(): User | undefined {
    return this._currentUser
  }

  get isStaffMealOrder(): boolean {
    return this._staffMealOrder
  }

  get pagers(): Array<number | null> {
    return this.locationService.pagers
  }

  get disableStaffMealButton(): boolean {
    if (this._customer) return true
    if (!this._currentUser) return true
    if (!this._currentUser.allowStaffMealOrders) return true
    return !this._currentUser.allowStaffMealOrders
  }

  get disableCustomerButton(): boolean {
    return this._staffMealOrder
  }

  /** Standalone-Modus: Kein Cloud-Sync, keine Firmenkunden */
  #connectionService = inject(ConnectionService)
  isStandaloneMode = computed(() => this.#connectionService.systemMode() === 'standalone')

  /** Numpad-Popup für kleine Screens */
  showNumpadPopup = false

  get isAdmin(): boolean {
    return this.authService.isAdmin()
  }

  get numpadNumber(): number | undefined {
    return this._numpadNumber
  }

  get numpadValue(): string {
    return this._numpadValue
  }

  /** CONSTRUCTOR */
  constructor() {
    if (!this.locationService.currentBusinessDay) {
      // Business day check is handled by checkBusinessDayValidity() in ngOnInit
    }

    this._productionTimes = this.orderService.productionTimes

    const user: undefined | User = this.authService.user()
    if (user) {
      this._currentUser = user
      this.userService.get(user._id).then((fetchedUser: User): void => {
        this._currentUser = fetchedUser
      })
    } else {
      // Fallback für POS: LocalStorage prüfen
      const storedUser = localStorage.getItem('pos_current_user')
      if (storedUser) {
        try {
          const parsed = JSON.parse(storedUser)
          if (parsed._id) {
            this.userService.get(parsed._id).then((fetchedUser: User): void => {
              this._currentUser = fetchedUser
            })
          }
        } catch {
          console.error('Failed to parse pos_current_user')
        }
      }
    }

    if (this.locationService.activeLocation()) {
      this.generalSideDishPrice =
        this.locationService.activeLocation()?.settings?.genericProductSettings?.generalSideDishPrice || 0
      this.generalDrinkPrice =
        this.locationService.activeLocation()?.settings?.genericProductSettings?.generalDrinkPrice || 0
    }

    effect(() => {
      // Produktgruppen-Signal beobachten → Sichtbarkeit neu berechnen
      this.calculateVisibleProductGroups()
    })
  }

  /** PUBLIC PROPERTIES */
  blockingReason: string | null = null

  /** DIALOG DATA */
  readonly data = inject<{ mode?: 'default' | 'admin' }>(MAT_DIALOG_DATA, { optional: true })

  /** DINE LOCATION OVERLAY */
  showDineLocationSelection = false

  async ngOnInit(): Promise<void> {
    this._timer = setInterval(() => {
      this.time.set(new Date())
    }, 1000)

    this.checkBusinessDayValidity()

    if (!this.productGroupService.isLoaded()) {
      await this.productGroupService.loadDocuments()
    }
    this.calculateVisibleProductGroups()
  }

  ngAfterViewInit(): void {
    if (this.productGroupContainer) {
      this._resizeObserver = new ResizeObserver(() => {
        this.calculateVisibleProductGroups()
      })
      this._resizeObserver.observe(this.productGroupContainer.nativeElement)
    }
  }

  ngOnDestroy(): void {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect()
    }
    if (this._timer) {
      clearInterval(this._timer)
    }
  }

  private checkBusinessDayValidity(): void {
    const activeLocation = this.locationService.activeLocation()

    // Im Standalone-Modus (Edge-Server) wird der Geschäftstag automatisch verwaltet.
    // Der Backend-Hook erstellt bei Bedarf transparent einen neuen Geschäftstag.
    // Daher blocken wir die UI nur wenn wirklich keine Location geladen ist.
    if (!activeLocation) {
      this.blockingReason = 'Standort konnte nicht geladen werden.'
      return
    }

    // Kein Geschäftstag vorhanden — im Edge-Modus wird er beim ersten Order auto-erstellt
    if (!activeLocation.currentBusinessDay) {
      this.blockingReason = null
      return
    }

    // Geschäftstag-Datum prüfen (nur Warnung, kein Block)
    this.blockingReason = null
  }

  calculateVisibleProductGroups() {
    const allGroups = this.productGroups

    if (!this.productGroupContainer || !this.productGroupContainer.nativeElement) {
      this.visibleProductGroups = allGroups
      this.overflowProductGroups = []
      return
    }

    const containerWidth = this.productGroupContainer.nativeElement.clientWidth
    const buttonWidth = 95
    const gap = 8
    const expandButtonWidth = 52

    const maxItems = Math.floor((containerWidth + gap) / (buttonWidth + gap))

    if (allGroups.length <= maxItems) {
      this.visibleProductGroups = allGroups
      this.overflowProductGroups = []
    } else {
      const availableWidthForButtons = containerWidth - expandButtonWidth - gap
      const maxVisibleWithOverflow = Math.floor((availableWidthForButtons + gap) / (buttonWidth + gap))

      this.visibleProductGroups = allGroups.slice(0, maxVisibleWithOverflow)
      this.overflowProductGroups = allGroups.slice(maxVisibleWithOverflow)
    }

    this.#cdr.detectChanges()
  }

  /** PRIVATE METHODS */
  private _searchForArticleName() {
    if (!this._numpadNumber) return
    const article = this.productService.findProductByIndex(this._numpadNumber)
    const name = article?.name
    this._numpadValue = name || ''
  }

  /** PUBLIC METHODS */
  setInfoBoxText(value: string, backgroundColor: string | undefined = undefined) {
    switch (backgroundColor) {
      case 'red':
      case 'green':
      case 'blue':
      case 'brown':
      case 'black':
      case 'gray':
      case 'purple':
      case 'olive':
        this._infoBoxTextColor = 'white'
        break

      case undefined:
      default:
        this._infoBoxTextColor = 'black'
        break
    }
    if (backgroundColor) {
      this._infoBoxBackgroundColor = backgroundColor
    } else {
      this._infoBoxBackgroundColor = '#f1f5f9'
    }
    this._infoBoxText = value
  }

  noActionDefined(subButton: ProductSchema): void {
    this.setInfoBoxText('Keine Aktion für die Taste "' + subButton.name + '" definiert!', 'red')
  }

  clearButtons(): void {
    this._functionButtons = []
    this._productButtons = []
    this.corporateCustomers = []
  }

  clearNumpad(_skipViewChange = false): void {
    this._numpadNumber = undefined
    this._numpadValue = ''
  }

  deleteOrder() {
    this.#lineItems = []
    this.#orderOpenedAt = new Date()
    this.#orderInteractions = []
  }

  unselectProduct() {
    if (this._isBlocked) return
    this._withoutExtra = false
    this.clearButtons()
    this._selectedProductIndex = null
    this._selectedCombinationIndex = [null, null]
    this.setInfoBoxText('Bitte wählen Sie eine Produktkategorie')
  }

  toggleProductSelection(index: number) {
    if (this._isBlocked) return

    if (this._selectedProductIndex === index) {
      this.unselectProduct()
    } else {
      this.selectProduct(index)
    }
  }

  selectProduct(index: number) {
    if (this._isBlocked) return

    this._selectedCombinationIndex = [null, null]
    this._selectedProductIndex = this._selectedProductIndex != index ? index : null
    this.setExtraSubButtons()
  }

  selectCombinationByIndex(combinationIndex: number, articleIndex: number | null) {
    if (this._isBlocked) return

    this._selectedProductIndex = null
    if (articleIndex === null) {
      this._selectedCombinationIndex[0] =
        this._selectedCombinationIndex[0] === null || this._selectedCombinationIndex[0] !== combinationIndex
          ? combinationIndex
          : null
    } else {
      this._selectedCombinationIndex[0] = combinationIndex
      this._selectedCombinationIndex[1] =
        this._selectedCombinationIndex[1] === null || this._selectedCombinationIndex[1] !== articleIndex
          ? articleIndex
          : null
    }
  }

  increaseSelectedIndex() {
    if (this._isBlocked) return
    if (this.combinations.length === 0 && this.#lineItems.length === 0) return

    if (this._selectedCombinationIndex[0] === null && this._selectedProductIndex === null) {
      if (this.combinations.length > 0) {
        this._selectedCombinationIndex = [0, null]
      } else {
        this._selectedProductIndex = 0
      }
      return
    }
    if (this._selectedCombinationIndex[0] !== null) {
      if (this._selectedCombinationIndex[0] === this.combinations.length - 1) {
        this._selectedCombinationIndex = [null, null]
        if (this.lineItems.length > 0) {
          this._selectedProductIndex = 0
        }
      } else {
        this._selectedCombinationIndex[0] += 1
      }
      return
    }
    if (this._selectedProductIndex !== null) {
      if (this._selectedProductIndex === this.#lineItems.length - 1) {
        this._selectedProductIndex = null
        this._selectedCombinationIndex = [null, null]
      } else {
        this._selectedProductIndex += 1
      }
    }
  }

  decreaseSelectedIndex() {
    if (this._isBlocked) return
    if (this.combinations.length === 0 && this.#lineItems.length === 0) return

    if (this._selectedCombinationIndex[0] === null && this._selectedProductIndex === null) {
      if (this.lineItems.length > 0) {
        this._selectedProductIndex = this.lineItems.length - 1
      } else {
        this._selectedCombinationIndex = [this.combinations.length - 1, null]
      }
      return
    }
    if (this._selectedCombinationIndex[0] !== null) {
      if (this._selectedCombinationIndex[0] === 0) {
        this._selectedCombinationIndex = [null, null]
        this._selectedProductIndex = null
      } else {
        this._selectedCombinationIndex[0] -= 1
      }
      return
    }
    if (this._selectedProductIndex !== null) {
      if (this._selectedProductIndex === 0) {
        this._selectedProductIndex = null
        if (this.combinations.length > 0) {
          this._selectedCombinationIndex = [this.combinations.length - 1, null]
        }
      } else {
        this._selectedProductIndex -= 1
      }
    }
  }

  createProductButtons(productGroup: ProductGroupSchema) {
    if (this._isBlocked) return

    this.clearButtons()
    this.setInfoBoxText(productGroup.name, productGroup.color)
    this._selectedProductIndex = null
    this._productButtons = this.productService.getProductsByGroupId(productGroup._id)
    this._productButtons.forEach(ProductButton => {
      ;(ProductButton as any).callback = () => {
        this.increaseLineItem(ProductButton)
      }
    })
  }

  setProductButtonsByGroupId(groupId: string | undefined) {
    if (!groupId) return this.unselectProduct()

    const group: ProductGroupSchema | undefined =
      this.productGroupService.getProductGroupById(groupId)

    if (!group) return this.unselectProduct()

    this.createProductButtons(group)
    this.setInfoBoxText(group.name, group.color)
    this.clearButtons()
    this._selectedProductIndex = null
    this._selectedCombinationIndex = [null, null]
    this._lastParentId = undefined
    this._productButtons = this.productService.getProductsByGroupId(group._id)
    this._productButtons.forEach(subButton => {
      ;(subButton as any).callback = () => {
        this.increaseLineItem(subButton)
      }
    })
  }

  setProductionTimeSubbuttons() {
    if (this._isBlocked) return
    this.clearButtons()
    if (this.lineItems.length === 0 && this.combinations.length === 0) {
      this.setInfoBoxText('Bitte fügen Sie zunächst mindestens ein Artikel der Bestellung hinzu!', 'red')
      return
    }
    this.setInfoBoxText('Wie lange beträgt die Produktions-ZEIT?')
    this._productionTimes.forEach((value, index) => {
      this._productButtons.push({
        _id: value.toString() + ' min',
        externalId: this.#functionButtonExternalId,
        locationId: this.userService.currentUser()?.activeLocationId || '',
        tenantId: this.authService.tenantId()?.toString() || '',
        index: index,
        name: value.toString() + ' min',
        productGroupExternalId: this._productionTimeTopic,
        productionTime: value,
        isFunctionButton: true,
        callback: () => {
          this._productionTime = value
          this.placeOrder()
        },
      })
    })
  }

  setTaxRateSubbuttons(): void {
    if (this._isBlocked) return

    this.clearButtons()

    if (this.lineItems.length === 0 && this.combinations.length === 0) {
      this.setInfoBoxText('Bitte fügen Sie zunächst mindestens ein Artikel der Bestellung hinzu!', 'red')
      return
    }

    this.showDineLocationSelection = true
  }

  selectDineLocation(location: 'INSIDE' | 'OUTSIDE'): void {
    this.showDineLocationSelection = false
    this._dineLocation = location === 'INSIDE' ? DineLocation.DINE_IN : DineLocation.TAKE_OUT

    if (this.locationService.showPagers) {
      this.setPagerSubbuttons()
    } else {
      this.setProductionTimeSubbuttons()
    }
  }

  openPreOrderDialog() {
    this.showDineLocationSelection = false

    const dialogRef = this.matDialog.open(PreOrderQuickDialogComponent, {
      width: '720px',
      maxWidth: '95vw',
      panelClass: ['!rounded-2xl', 'overflow-hidden'],
    })

    dialogRef.afterClosed().subscribe(async (result: { date: Date; time: string; name: string; phone: string } | undefined) => {
      if (!result) return

      // Datum + Uhrzeit zu ISO-String kombinieren
      const date = new Date(result.date)
      const [hours, minutes] = result.time.split(':').map(Number)
      date.setHours(hours, minutes, 0, 0)

      const payload = {
        customerContact: {
          name: result.name,
          phone: result.phone || '',
        },
        scheduledFor: date.toISOString(),
        lineItems: [...this.lineItems],
        status: 'pending' as const,
      }

      try {
        await this.preOrderService.create(payload)
        this.matDialogRef.close('preorder-created')
      } catch (e) {
        console.error('Vorbestellung konnte nicht erstellt werden:', e)
      }
    })
  }

  setTableSubbuttons() {
    if (this._isBlocked && !this.locationService.showTables) return

    this.clearButtons()

    if (this.lineItems.length === 0 && this.combinations.length === 0) {
      this.setInfoBoxText('Bitte fügen Sie zunächst mindestens ein Artikel der Bestellung hinzu!', 'red')
      return
    }

    if (this.locationService.tables.length === 0) {
      this.setInfoBoxText('Bitte fügen Sie zunächst mindestens eine Tischnummer in den EINSTELLUNGEN hinzu!', 'red')
    } else {
      this.setInfoBoxText('Auf welchem Tisch befindet sich die Bestellung?')
    }
    this._functionButtons.push({
      _id: 'noTables',
      externalId: this.#functionButtonExternalId,
      locationId: this.userService.currentUser()?.activeLocationId || '',
      tenantId: this.authService.tenantId()?.toString() || '',
      index: 1,
      name: 'KEIN TISCH',
      isFunctionButton: true,
      callback: () => {
        this.setProductionTimeSubbuttons()
      },
    })
    this.locationService.tables.forEach((table, index) => {
      this._productButtons.push({
        _id: table,
        externalId: this.#functionButtonExternalId,
        locationId: this.userService.currentUser()?.activeLocationId || '',
        tenantId: this.authService.tenantId()?.toString() || '',
        index: index,
        icon: 'table_restaurant',
        name: table,
        productGroupExternalId: this._tableTopic,
        table: table,
        isFunctionButton: true,
        callback: () => {
          this._table = table
          this.setProductionTimeSubbuttons()
        },
      })
    })
  }

  setPagerSubbuttons() {
    if (this._isBlocked) return

    this.clearButtons()
    if (this.lineItems.length === 0 && this.combinations.length === 0) {
      this.setInfoBoxText('Bitte fügen Sie zunächst mindestens ein Artikel der Bestellung hinzu!', 'red')
      return
    }
    if (this.locationService.pagers.length === 0) {
      this.setInfoBoxText('Bitte fügen Sie zunächst mindestens eine Pager-Nummer in den EINSTELLUNGEN hinzu!', 'red')
    } else {
      this.setInfoBoxText('Welche Pager-Nummer hat der Tisch?')
    }
    this._functionButtons.push({
      _id: 'noPagers',
      externalId: this.#functionButtonExternalId,
      locationId: this.userService.currentUser()?.activeLocationId || '',
      tenantId: this.authService.tenantId()?.toString() || '',
      index: 1,
      name: 'KEIN PAGER',
      isFunctionButton: true,
      callback: () => {
        this.setProductionTimeSubbuttons()
      },
    })
    this.locationService.pagers.forEach((pager, index) => {
      if (!pager) return
      this._productButtons.push({
        _id: pager.toString(),
        externalId: this.#functionButtonExternalId,
        locationId: this.userService.currentUser()?.activeLocationId || '',
        tenantId: this.authService.tenantId()?.toString() || '',
        index: index,
        icon: 'smartphone',
        name: pager.toString(),
        productGroupExternalId: this._tableTopic,
        table: pager.toString(),
        isFunctionButton: true,
        callback: () => {
          this._pager = pager
          if (this.locationService.showTables) {
            this.setTableSubbuttons()
          } else {
            this.setProductionTimeSubbuttons()
          }
        },
      })
    })
  }

  setDeleteSubbuttons() {
    if (this._isBlocked) return

    this.clearButtons()
    this.setInfoBoxText('Was möchten Sie löschen?')
    this._functionButtons.push({
      _id: this._deleteCombinationId,
      externalId: this.#functionButtonExternalId,
      locationId: this.userService.currentUser()?.activeLocationId || '',
      tenantId: this.authService.tenantId()?.toString() || '',
      index: 1,
      name: this._deleteCombinationName,
      isFunctionButton: true,
      callback: () => {
        this.decreaseCombination()
      },
    })
    this._functionButtons.push({
      _id: this._deleteOrderId,
      externalId: this.#functionButtonExternalId,
      locationId: this.userService.currentUser()?.activeLocationId || '',
      tenantId: this.authService.tenantId()?.toString() || '',
      index: 3,
      name: this._deleteOrderName,
      isFunctionButton: true,
      callback: () => {
        this.#lineItems = []
        return this.unselectProduct()
      },
    })
    if (this._customer) {
      this._functionButtons.push({
        _id: this._deleteCustomerId,
        externalId: this.#functionButtonExternalId,
        locationId: this.userService.currentUser()?.activeLocationId || '',
        tenantId: this.authService.tenantId()?.toString() || '',
        index: 4,
        name: this._deleteCustomerName,
        isFunctionButton: true,
        callback: () => {
          this._customer = undefined
          this.clearButtons()
        },
      })
    }
  }

  setMenuSideDishButtons(sideDishElements: Array<UUID> | undefined = undefined): void {
    this.clearButtons()

    if (this._selectedProductIndex !== null) {
      this._lastParentId = this.#lineItems[this._selectedProductIndex]._id
    } else if (this._selectedCombinationIndex[0] !== null && this._selectedCombinationIndex[1] !== null) {
      this._lastParentId = this.combinations[this._selectedCombinationIndex[0]][this._selectedCombinationIndex[1]]._id
    } else {
      this.setInfoBoxText('Bitte wählen Sie zunächst einen Artikel aus.', 'red')
      return
    }

    this.setInfoBoxText('Welche Beilage möchten Sie hinzufügen?')

    if (sideDishElements && sideDishElements.length > 0) {
      sideDishElements.forEach((value: UUID): void => {
        const sideDish: ProductSchema | undefined = this.productService.findProductByExternalId(value)

        if (sideDish) {
          const copyOfSideDish: ProductSchema = JSON.parse(JSON.stringify(sideDish))
          ;(copyOfSideDish as any).isMenuSideDish = true
          ;(copyOfSideDish as any).isMenuSubButton = true
          ;(copyOfSideDish as any).callback = () => {
            let parentButton: ProductSchema | undefined
            if (this._lastParentId === undefined) {
              parentButton = undefined
            } else {
              parentButton = this.productService.findProductById(this._lastParentId)
            }
            if ((copyOfSideDish as any).isMenuSideDish !== undefined && (copyOfSideDish as any).isMenuSideDish) {
              this.setMenuSideDish(copyOfSideDish)
              if ((parentButton as any)?.isMenuSideDishSauce !== null && (parentButton as any)?.isMenuSideDishSauce) {
                this.setMenuSauceButtons((parentButton as any)?.sauces)
              }
            }
          }
          this._productButtons.push(copyOfSideDish)
        }
      })
    }
  }

  setMenuSauceButtons(ids: Array<UUID> | undefined = undefined) {
    this.clearButtons()

    if (this._selectedProductIndex !== null) {
      this._lastParentId = this.#lineItems[this._selectedProductIndex]._id
    } else if (this._selectedCombinationIndex[0] !== null && this._selectedCombinationIndex[1] !== null) {
      this._lastParentId = this.combinations[this._selectedCombinationIndex[0]][this._selectedCombinationIndex[1]]._id
    } else {
      this.setInfoBoxText('Bitte wählen Sie zunächst einen Artikel aus.', 'red')
      return
    }
    this.setInfoBoxText('Welche Soße möchten Sie hinzufügen?')
    let parentButton: ProductSchema | undefined
    if (this._lastParentId === undefined) {
      parentButton = undefined
    } else {
      parentButton = this.productService.findProductById(this._lastParentId)
    }
    this.functionButtons.push({
      _id: this._skipSauceId,
      externalId: this.#functionButtonExternalId,
      locationId: this.userService.currentUser()?.activeLocationId || '',
      tenantId: this.authService.tenantId()?.toString() || '',
      name: this._skipSauceName,
      index: -1,
      isFunctionButton: true,
      isExtra: false,
      backgroundColor: 'darkcyan',
      fontColor: 'white',
      callback: () => {
        if (parentButton && (parentButton as any).itemType === ItemType.mainDish && (parentButton as any).isMenuDrink) {
          this.setMenuDrinkButtons((parentButton as any)?.drinks)
        } else {
          if (this._selectedProductIndex !== null) {
            this.#lineItems[this._selectedProductIndex].menuDrink = null
          } else if (this._selectedCombinationIndex[0] !== null && this._selectedCombinationIndex[1] !== null) {
            this.combinations[this._selectedCombinationIndex[0]][this._selectedCombinationIndex[1]].menuDrink = null
          }
          this._isBlocked = false
          this.setProductButtonsByGroupId((parentButton as any)?.categoryIds?.[0])
        }
      },
    })
    if (ids !== undefined && ids.length > 0) {
      ids.forEach((value: UUID): void => {
        const sauce: ProductSchema | undefined = this.productService.findProductByExternalId(value)
        if (sauce) {
          const copyOfSauce: ProductSchema = JSON.parse(JSON.stringify(sauce))
          ;(copyOfSauce as any).isMenuSideDishSauce = true
          ;(copyOfSauce as any).isExtra = false
          ;(copyOfSauce as any).isMenuSubButton = true
          ;(copyOfSauce as any).callback = (): void => {
            this.setMenuSideDishSauce(copyOfSauce)
          }
          this._productButtons.push(copyOfSauce)
        }
      })
    }
  }

  setMenuDrinkButtons(ids: Array<UUID> | undefined = undefined) {
    this.clearButtons()

    if (this._selectedProductIndex !== null) {
      this._lastParentId = this.#lineItems[this._selectedProductIndex]._id
    } else if (this._selectedCombinationIndex[0] !== null && this._selectedCombinationIndex[1] !== null) {
      this._lastParentId = this.combinations[this._selectedCombinationIndex[0]][this._selectedCombinationIndex[1]]._id
    } else {
      this.setInfoBoxText('Bitte wählen Sie zunächst einen Artikel aus.', 'red')
      return
    }
    this.setInfoBoxText('Welches Getränk möchten Sie hinzufügen?')

    if (ids !== undefined && ids.length > 0) {
      ids.forEach((value: UUID): void => {
        const drink: ProductSchema | undefined = this.productService.findProductByExternalId(value)

        if (drink) {
          const copyOfDrink: ProductSchema = JSON.parse(JSON.stringify(drink))
          ;(copyOfDrink as any).isMenuDrink = true
          ;(copyOfDrink as any).isMenuSubButton = true
          ;(copyOfDrink as any).callback = (): void => {
            let parentButton: ProductSchema | undefined
            if (this._lastParentId === undefined) {
              parentButton = undefined
            } else {
              parentButton = this.productService.findProductById(this._lastParentId)
            }
            this.setMenuDrink(copyOfDrink)
            this._isBlocked = false
            this.setProductButtonsByGroupId((parentButton as any)?.categoryIds?.[0])
          }
          this._productButtons.push(copyOfDrink)
        }
      })
    }
  }

  setExtraSubButtons(
    ids: Array<UUID> | undefined = undefined,
    groupId: string | undefined = undefined,
    unblock = false,
  ) {
    if (this._isBlocked && !unblock) return

    if (this.#lineItems.length === 0 && this.combinations.length === 0) {
      this.setInfoBoxText('Bitte wählen Sie zunächst einen Artikel aus.', 'red')
      return
    }
    if (
      this._selectedCombinationIndex[0] !== null &&
      this._selectedCombinationIndex[1] === null &&
      this._selectedProductIndex === null
    ) {
      this.setInfoBoxText('Extras können nur für normale Artikel hinzugefügt werde. Nicht für Kombinationen.', 'red')
      return
    }
    if (
      this._selectedProductIndex === null &&
      this._selectedCombinationIndex[0] === null && this._selectedCombinationIndex[1] === null
    ) {
      this.setInfoBoxText('Bitte wählen Sie zunächst einen Artikel aus.', 'red')
      return
    }

    this.clearButtons()
    this._withoutExtra = false
    this.setInfoBoxText('Welche Extras möchten Sie hinzufügen?')

    let parentButton: ProductSchema | undefined

    if (!this._lastParentId) {
      parentButton = undefined
    } else {
      parentButton = this.productService.findProductById(this._lastParentId)
    }

    this.functionButtons.push({
      _id: this._skipExtraId,
      externalId: this.#functionButtonExternalId,
      locationId: this.userService.currentUser()?.activeLocationId || '',
      tenantId: this.authService.tenantId()?.toString() || '',
      name: this._skipExtraName,
      index: -2,
      isFunctionButton: true,
      isExtra: true,
      backgroundColor: 'darkcyan',
      fontColor: 'white',
      callback: () => {
        if (this._isBlocked) {
          if (parentButton && (parentButton as any).itemType === ItemType.mainDish && (parentButton as any).isMenu) {
            this.setMenuSideDishButtons((parentButton as any).sideDishes)
          }
          return
        }
        this.setProductButtonsByGroupId(groupId)
      },
    })
    this.functionButtons.push({
      _id: this._withoutExtraId,
      externalId: this.#functionButtonExternalId,
      locationId: this.userService.currentUser()?.activeLocationId || '',
      tenantId: this.authService.tenantId()?.toString() || '',
      name: 'OHNE',
      index: -1,
      isFunctionButton: true,
      isExtra: true,
      backgroundColor: 'white',
      fontColor: 'black',
      callback: () => {
        if (this._isBlocked) return
        this.toggleWithoutExtra()
      },
    })

    if (ids && ids.length > 0) {
      const extras: Array<ProductSchema> = []

      ids.forEach((externalId: UUID): void => {
        const extra: undefined | ProductSchema = this.productService.findProductByExternalId(externalId)

        if (extra) {
          ;(extra as any).callback = (): void => {
            if ((this._isBlocked && !unblock) || !extra) return

            if (this._withoutExtra) {
              this.decreaseExtra(extra)
            } else {
              this.increaseExtra(extra)
            }
          }
          extras.push(extra)
        }
      })

      this.productButtons.push(
        ...extras.sort((a, b) => {
          return a.name.localeCompare(b.name)
        }),
      )
    } else {
      let parentId: UUID | null | undefined
      let externalId: UUID | null | undefined

      if (this._selectedProductIndex !== null) {
        parentId = this.#lineItems[this._selectedProductIndex].parentId
        externalId = this.#lineItems[this._selectedProductIndex].externalId
      } else {
        if (this._selectedCombinationIndex[0] === null || this._selectedCombinationIndex[1] === null) return

        const combinationIndex: number = this._selectedCombinationIndex[0]
        const articleIndex: number = this._selectedCombinationIndex[1]

        parentId = this.combinations[combinationIndex][articleIndex].parentId
        externalId = this.combinations[combinationIndex][articleIndex].externalId
      }

      // Produkt des ausgewählten LineItems ermitteln
      const selectedProduct = externalId ? this.productService.findProductByExternalId(externalId) : undefined
      const productOptions = selectedProduct?.optionGroups?.flatMap(g => g.options) ?? []

      if (productOptions.length > 0) {
        // Nur die im Produkt definierten Modifier anzeigen
        for (const opt of productOptions) {
          const extra = this.productService.findProductById(opt.productId)
          if (!extra) continue
          ;(extra as any).callback = () => {
            if ((this._isBlocked && !unblock) || !extra) return
            if (this._withoutExtra) {
              this.decreaseExtra(extra)
            } else {
              this.increaseExtra(extra)
            }
          }
          this._productButtons.push(extra)
        }
      } else {
        this.setInfoBoxText('Keine Extras für dieses Produkt hinterlegt.')
      }

      // "Alle Extras"-Button: lädt alle Modifier aus der Datenbank
      this.functionButtons.push({
        _id: 'load-all-extras',
        externalId: this.#functionButtonExternalId,
        locationId: this.userService.currentUser()?.activeLocationId || '',
        tenantId: this.authService.tenantId()?.toString() || '',
        name: 'Alle Extras',
        index: 0,
        isFunctionButton: true,
        isExtra: true,
        backgroundColor: 'slategray',
        fontColor: 'white',
        callback: () => {
          if (this._isBlocked && !unblock) return
          this._productButtons = []
          this.setInfoBoxText('Welche Extras möchten Sie hinzufügen?')
          this.productService.extras().forEach((extra: ProductSchema): void => {
            if ((extra as any).excludedButtons && parentId && (extra as any).excludedButtons.includes(parentId)) {
              return
            } else if (
              (extra as any).excludedSubButtons &&
              externalId &&
              (extra as any).excludedSubButtons.includes(externalId)
            ) {
              return
            } else {
              ;(extra as any).callback = () => {
                if ((this._isBlocked && !unblock) || !extra) return
                if (this._withoutExtra) {
                  this.decreaseExtra(extra)
                } else {
                  this.increaseExtra(extra)
                }
              }
              this._productButtons.push(extra)
            }
          })
        },
      })

      this._lastParentId = parentId
    }

    // Entfernbare Zutaten
    let selectedArticleForIngredients: OrderLineItemSchema | undefined
    if (this._selectedProductIndex !== null) {
      selectedArticleForIngredients = this.#lineItems[this._selectedProductIndex]
    } else if (this._selectedCombinationIndex[0] !== null && this._selectedCombinationIndex[1] !== null) {
      selectedArticleForIngredients =
        this.combinations[this._selectedCombinationIndex[0]][this._selectedCombinationIndex[1]]
    }

    if (selectedArticleForIngredients && selectedArticleForIngredients.ingredientReferences) {
      const removableIngredients = selectedArticleForIngredients.ingredientReferences.filter(ing => ing.isRemovable)

      removableIngredients.forEach(ing => {
        const isRemoved = selectedArticleForIngredients!.modifiers.some(
          e => e.externalId === ing.externalId && e.name.startsWith('Ohne '),
        )

        const button: ProductSchema = {
          _id: (ing.externalId || '').toString(),
          externalId: ing.externalId,
          name: ing.ingredientName,
          pressed: !isRemoved,
          itemType: ItemType.extra,
          price: ing.priceAdjustment || 0,
          productGroupExternalId: this._extraTopic,
        } as unknown as ProductSchema

        ;(button as any).callback = () => {
          this.toggleRemovableIngredient(ing, selectedArticleForIngredients!, button)
        }

        this._productButtons.push(button)
      })
    }
  }

  toggleRemovableIngredient(ingredient: any, lineItem: OrderLineItemSchema, button: ProductSchema) {
    if ((button as any).pressed) {
      ;(button as any).pressed = false
      lineItem.modifiers.push({
        _id: (ingredient.externalId || 'temp_id_' + Date.now()).toString(),
        externalId: ingredient.externalId,
        name: 'Ohne ' + ingredient.ingredientName,
        amount: 1,
        price: ingredient.priceAdjustment || 0,
        parentId: lineItem.externalId,
        taxInside: lineItem.taxInside,
        taxOutside: lineItem.taxOutside,
        topic: this._extraTopic,
        recipeReferences: [],
        ingredientReferences: [],
      })
    } else {
      ;(button as any).pressed = true
      const extraIndex = lineItem.modifiers.findIndex(
        e => e.externalId === ingredient.externalId && e.name.startsWith('Ohne '),
      )
      if (extraIndex !== -1) {
        lineItem.modifiers.splice(extraIndex, 1)
      }
    }
  }

  setSauceSubButtons(ids: Array<string> | undefined = undefined, isInclusive = false, currentIndex = 0) {
    this.clearButtons()

    if (this._selectedProductIndex !== null) {
      this._lastParentId = this.#lineItems[this._selectedProductIndex]._id
    } else if (this._selectedCombinationIndex[0] !== null && this._selectedCombinationIndex[1] !== null) {
      this._lastParentId = this.combinations[this._selectedCombinationIndex[0]][this._selectedCombinationIndex[1]]._id
    } else {
      this.setInfoBoxText('Bitte wählen Sie zunächst einen Artikel aus.', 'red')
      return
    }
    if (isInclusive) {
      this.setInfoBoxText('INKLUSIV: Welche Soße möchten Sie hinzufügen?')
    } else {
      this.setInfoBoxText('Welche Soße möchten Sie hinzufügen?')
    }

    let parentButton: ProductSchema | undefined

    if (this._lastParentId === undefined) {
      parentButton = undefined
    } else {
      parentButton = this.productService.findProductById(this._lastParentId)
    }
    this.functionButtons.push({
      _id: this._skipSauceId,
      externalId: this.#functionButtonExternalId,
      locationId: this.userService.currentUser()?.activeLocationId || '',
      tenantId: this.authService.tenantId()?.toString() || '',
      name: this._skipSauceName,
      index: -1,
      isFunctionButton: true,
      isExtra: false,
      backgroundColor: 'darkcyan',
      fontColor: 'white',
      callback: () => {
        if (this._isBlocked) {
          if (
            parentButton &&
            (parentButton as any).itemType === ItemType.mainDish &&
            (parentButton as any).showExtrasAfterSelect
          ) {
            this.setExtraSubButtons((parentButton as any).extras, (parentButton as any)?.categoryIds?.[0], true)
          } else if (parentButton && (parentButton as any).isMenu !== undefined && (parentButton as any).isMenu) {
            this._isBlocked = true
            this.setMenuSideDishButtons((parentButton as any).sideDishes)
          } else if (parentButton && (parentButton as any).nextProductGroupExternalId !== undefined) {
            this.setSuccessorSubButtons(parentButton)
          }
          return
        }
        this.setProductButtonsByGroupId((parentButton as any)?.categoryIds?.[0])
      },
    })

    if (ids && ids.length > 0) {
      ids.forEach((value, _index) => {
        const sauce: ProductSchema | undefined = this.productService.findProductByExternalId(value)

        if (sauce) {
          const copy: ProductSchema = JSON.parse(JSON.stringify(sauce))

          copy.price = isInclusive ? 0 : copy.price
          ;(copy as any).callback = () => {
            this.increaseExtra(copy, 'Soße')
            const nextIndex = currentIndex - 1
            const nextIsInclusive = nextIndex > 0
            this.setSauceSubButtons(ids, nextIsInclusive, nextIndex)
          }
          this._productButtons.push(copy)
        }
      })
    }
  }

  setSuccessorSubButtons(product: ProductSchema) {
    if (!(product as any).nextProductGroupExternalId) return

    const byExternId: ProductGroupSchema | undefined = this.productGroupService.getProductGroupByExternId(
      (product as any).nextProductGroupExternalId,
    )

    if (!byExternId) {
      this.unselectProduct()
      this.setInfoBoxText('Keine Kombinationstasten gefunden!', 'red')
      return
    }

    this.clearButtons()

    this._functionButtons.push({
      _id: this._skipSuccessorId,
      externalId: this.#functionButtonExternalId,
      locationId: this.userService.currentUser()?.activeLocationId || '',
      tenantId: this.authService.tenantId()?.toString() || '',
      name: this._skipSuccessorName,
      index: 1,
      isFunctionButton: true,
      backgroundColor: 'darkcyan',
      fontColor: 'white',
      callback: () => {
        if (this._isBlocked) return
        this._articlesToCombine = []
        this.setProductButtonsByGroupId((product as any)?.categoryIds?.[0])
      },
    })
    this.setInfoBoxText(byExternId.name)
    this._productButtons = this.productService.getProductsByGroupId(byExternId._id)
    this._productButtons.forEach(subButton => {
      ;(subButton as any).callback = () => {
        this.increaseLineItem(subButton)
      }
    })
  }

  setCombiSubButtons() {
    if (this._isBlocked) return

    this.clearButtons()
    this.setInfoBoxText('Welche Kombination möchten Sie hinzufügen?')
    if (this.#lineItems.length <= 1 && this.combinations.length === 0) {
      this.setInfoBoxText('Für die Kombination werden min. 2 Artikel benötigt.', 'red')
      return
    }
    this._functionButtons.push({
      _id: this._combineId,
      externalId: this.#functionButtonExternalId,
      locationId: this.userService.currentUser()?.activeLocationId || '',
      tenantId: this.authService.tenantId()?.toString() || '',
      name: this._combineName,
      index: -3,
      isFunctionButton: true,
      backgroundColor: 'darkcyan',
      fontColor: 'white',
      callback: () => {
        this.increaseCombination()
      },
    })
    this._functionButtons.push({
      _id: this._combineAllId,
      externalId: this.#functionButtonExternalId,
      locationId: this.userService.currentUser()?.activeLocationId || '',
      tenantId: this.authService.tenantId()?.toString() || '',
      name: this._combineAllName,
      index: -2,
      isFunctionButton: true,
      backgroundColor: 'lightcyan',
      fontColor: 'black',
      callback: () => {
        this.combineAllArticles()
      },
    })
    this._functionButtons.push({
      _id: this._resolveCombinationId,
      externalId: this.#functionButtonExternalId,
      locationId: this.userService.currentUser()?.activeLocationId || '',
      tenantId: this.authService.tenantId()?.toString() || '',
      index: -1,
      name: this._resolveCombinationName,
      isFunctionButton: true,
      backgroundColor: 'crimson',
      fontColor: 'white',
      callback: () => {
        this.resolveCombination()
      },
    })
    this.#lineItems.forEach((article, index) => {
      if (this.isLineItemBundled(article)) return
      const subButton: ProductSchema = {
        _id: 'combiButton' + index.toString(),
        externalId: this.#functionButtonExternalId,
        locationId: this.userService.currentUser()?.activeLocationId || '',
        tenantId: this.authService.tenantId()?.toString() || '',
        acronym: '#',
        name: article.name,
        productGroupExternalId: this._combiTopic,
        ...({ index: index + 1 } as any),
      }
      ;(subButton as any).callback = () => {
        if ((subButton as any).pressed === undefined || !(subButton as any).pressed) {
          ;(subButton as any).pressed = true
          this._articlesToCombine.push((subButton as any).index - 1)
        } else {
          ;(subButton as any).pressed = false
          const idx = this._articlesToCombine.findIndex(articleIndex => articleIndex === (subButton as any).index - 1)
          if (idx !== -1) {
            this._articlesToCombine.splice(idx, 1)
          }
        }
      }
      this._productButtons.push(subButton)
    })
  }

  setMenuSideDish(article: ProductSchema) {
    if (
      ((article as any).isMenuSideDish !== undefined && !(article as any).isMenuSideDish) ||
      (this._selectedProductIndex === null &&
        this._selectedCombinationIndex[0] === null && this._selectedCombinationIndex[1] === null)
    ) {
      return
    }
    let selectedItem: OrderLineItemSchema
    if (this._selectedProductIndex !== null) {
      selectedItem = this.#lineItems[this._selectedProductIndex]
    } else if (this._selectedCombinationIndex[0] !== null && this._selectedCombinationIndex[1] !== null) {
      selectedItem = this.combinations[this._selectedCombinationIndex[0]][this._selectedCombinationIndex[1]]
    } else {
      this.setInfoBoxText('Bitte wählen Sie zunächst einen Artikel aus.', 'red')
      return
    }
    const defaultTaxValue = this.locationService.taxes.A.taxRate

    selectedItem.menuSideDish = {
      _id: article._id,
      externalId: article.externalId ?? '',
      amount: 1,
      name: article.name,
      price: article.price || 0,
      ingredientReferences: (article as any).ingredientReferences || [],
      recipeReferences: article.recipeReferences || [],
      taxInside: article.taxInside || defaultTaxValue,
      taxOutside: article.taxOutside || defaultTaxValue,
      topic:
        this.productGroupService.getProductGroupById((article as any).productGroupExternalId || '')?.name || '',
    }
  }

  setMenuSideDishSauce(subButtonItem: ProductSchema) {
    if (
      !(subButtonItem as any).isMenuSideDishSauce ||
      (this._selectedProductIndex === null &&
        this._selectedCombinationIndex[0] === null && this._selectedCombinationIndex[1] === null)
    ) {
      return
    }
    this.increaseExtra(subButtonItem)
  }

  setMenuDrink(article: ProductSchema) {
    if (
      !(article as any).isMenuDrink ||
      (this._selectedProductIndex === null &&
        this._selectedCombinationIndex[0] === null && this._selectedCombinationIndex[1] === null)
    ) {
      return
    }

    let selectedItem: OrderLineItemSchema
    if (this._selectedProductIndex !== null) {
      selectedItem = this.#lineItems[this._selectedProductIndex]
    } else if (this._selectedCombinationIndex[0] !== null && this._selectedCombinationIndex[1] !== null) {
      selectedItem = this.combinations[this._selectedCombinationIndex[0]][this._selectedCombinationIndex[1]]
    } else {
      this.setInfoBoxText('Bitte wählen Sie zunächst einen Artikel aus.', 'red')
      return
    }

    const defaultTaxValue = this.locationService.taxes.A.taxRate

    selectedItem.menuDrink = {
      _id: article._id,
      externalId: article.externalId ?? '',
      amount: 1,
      name: article.name,
      price: article.price || 0,
      ingredientReferences: (article as any).ingredientReferences || [],
      recipeReferences: article.recipeReferences || [],
      taxInside: article.taxInside || defaultTaxValue,
      taxOutside: article.taxOutside || defaultTaxValue,
      topic:
        this.productGroupService.getProductGroupById((article as any).productGroupExternalId || '')?.name || '',
    }
  }

  increaseQuantity(orderLineItem: OrderLineItemSchema, event: Event | null = null): void {
    if (event) event.stopPropagation()
    orderLineItem.amount++
  }

  decreaseQuantity(orderLineItem: OrderLineItemSchema, event: Event | null = null): void {
    if (event) event.stopPropagation()

    if (orderLineItem.amount > 1) {
      orderLineItem.amount--
    } else {
      this.#lineItems.splice(this.#lineItems.indexOf(orderLineItem), 1)
    }
    this.#orderInteractions.push({
      type: 'item-delete',
      orderOpenedAt: this.#orderOpenedAt.toISOString(),
      eventAt: new Date().toISOString(),
      eventOffsetMs: new Date().getTime() - this.#orderOpenedAt.getTime(),
      productId: orderLineItem.externalId || undefined,
      lineItemId: this.#lineItems.indexOf(orderLineItem) || -1,
      deletedQuantity: 1,
      businessDayId: this.locationService.currentBusinessDay?.businessDayId?.toString(),
      businessDate: this.locationService.currentBusinessDay?.date,
      userId: this._currentUser?._id?.toString() || '',
    } as any)
  }

  increaseCombinationQuantity(index: number, event: Event): void {
    event.stopPropagation()

    for (const lineItem of this.combinations[index]) {
      lineItem.amount++
    }
  }

  decreaseCombinationQuantity(index: number, event: Event): void {
    event.stopPropagation()

    const bundleItems = this.combinations[index]
    if (!bundleItems || bundleItems.length === 0) return

    // Jede Position einzeln verringern, bei 0 entfernen
    const toRemove: any[] = []
    for (const lineItem of bundleItems) {
      if (lineItem.amount > 1) {
        lineItem.amount--
      } else {
        toRemove.push(lineItem)
      }
    }

    // Positionen mit amount 0 aus lineItems entfernen
    if (toRemove.length > 0) {
      const removeIds = new Set(toRemove.map(i => i._id))
      this.#lineItems = this.#lineItems.filter(i => !removeIds.has(i._id))
    }
  }

  increaseExtra(article: ProductSchema, topic: string | undefined = undefined) {
    // Prüfen ob das Produkt ein Modifier/Extra ist (neues + altes Schema)
    const isModifier =
      article.productType === 'MODIFIER' ||
      (article as any).isExtra ||
      (article as any).isMenuSideDishSauce ||
      ((article as any).itemType &&
        ((article as any).itemType === ItemType.sauce || (article as any).itemType === ItemType.extra))
    if (!isModifier) return

    let selectedArticle: OrderLineItemSchema
    if (this._selectedProductIndex !== null) {
      selectedArticle = this.#lineItems[this._selectedProductIndex]
    } else if (this._selectedCombinationIndex[0] !== null && this._selectedCombinationIndex[1] !== null) {
      selectedArticle = this.combinations[this._selectedCombinationIndex[0]][this._selectedCombinationIndex[1]]
    } else {
      return
    }
    const extraTopic = topic !== undefined ? topic : this._extraTopic
    const extraIndex = selectedArticle.modifiers.findIndex(extra => {
      return extra._id === article._id && extra.price === article.price
    })
    if (extraIndex !== -1 && selectedArticle.modifiers[extraIndex].price === article.price) {
      if (selectedArticle.modifiers[extraIndex].amount < 0) {
        selectedArticle.modifiers[extraIndex].amount = 1
      } else {
        selectedArticle.modifiers[extraIndex].amount += 1
      }
    } else {
      selectedArticle.modifiers.push({
        _id: article._id,
        externalId: article.externalId ?? '',
        amount: 1,
        name: article.name,
        icon: article.icon || undefined,
        parentId: article.externalId ?? undefined,
        price: article.price || 0,
        ingredientReferences: (article as any).ingredientReferences || [],
        recipeReferences: article.recipeReferences || [],
        taxInside: article.taxInside || 19,
        taxOutside: article.taxOutside || 19,
        topic: extraTopic,
      })
    }
  }

  decreaseExtra(article: ProductSchema) {
    const isModifier =
      article.productType === 'MODIFIER' ||
      (article as any).itemType === ItemType.extra ||
      (article as any).itemType === ItemType.sauce
    if (!isModifier) return

    let selectedArticle: OrderLineItemSchema
    if (this._selectedProductIndex !== null) {
      selectedArticle = this.#lineItems[this._selectedProductIndex]
    } else if (this._selectedCombinationIndex[0] !== null && this._selectedCombinationIndex[1] !== null) {
      selectedArticle = this.combinations[this._selectedCombinationIndex[0]][this._selectedCombinationIndex[1]]
    } else {
      return
    }
    const extraTopic = this._extraTopic
    const extraIndex = selectedArticle.modifiers.findIndex(extra => extra._id === article._id)
    if (extraIndex === -1) {
      selectedArticle.modifiers.push({
        _id: article._id,
        externalId: article.externalId ?? '',
        amount: -1,
        name: article.name,
        parentId: selectedArticle.externalId ?? undefined,
        price: article.price || 0,
        ingredientReferences: (article as any).ingredientReferences || [],
        recipeReferences: article.recipeReferences || [],
        taxInside: article.taxInside || 19,
        taxOutside: article.taxOutside || 19,
        topic: extraTopic,
      })
    } else {
      if (selectedArticle.modifiers[extraIndex].amount > 1) {
        selectedArticle.modifiers[extraIndex].amount -= 1
      } else if (selectedArticle.modifiers[extraIndex].amount === 1) {
        selectedArticle.modifiers.splice(extraIndex, 1)
      }
    }
    this._withoutExtra = false
    this.setInfoBoxText('Extras auswählen ...', 'lightgray')
  }

  // ──────────────────────────────────────────────────────────────────────
  // Bundle/Menü-Flow Helper-Methoden
  // ──────────────────────────────────────────────────────────────────────

  /** Prüft ob ein Produkt ein BUNDLE mit Pflicht-Optionen ist */
  private isBundleProduct(product: ProductSchema): boolean {
    // Neues Schema: productType + optionGroups
    if (product.productType === 'BUNDLE' && (product.optionGroups?.length ?? 0) > 0) return true
    // Legacy-Fallback: isMenu-Flag
    return (product as any).isMenu === true
  }

  /** Gibt die nächste unvollständige OptionGroup zurück (Pflicht zuerst, dann optional) */
  private getNextMandatoryGroup(product: ProductSchema): any | null {
    if (!product.optionGroups?.length) return null
    // Zuerst Pflicht-Gruppen (minSelections > 0)
    const mandatory = product.optionGroups.find(g =>
      g.minSelections > 0 && !this.#completedGroups.has(g.id),
    )
    if (mandatory) return mandatory
    // Dann optionale Gruppen (minSelections === 0) — mit Skip-Möglichkeit
    return product.optionGroups.find(g =>
      g.minSelections === 0 && !this.#completedGroups.has(g.id),
    ) ?? null
  }

  /** Zeigt die Auswahl-Buttons für eine OptionGroup an */
  private showOptionGroupButtons(group: any, parentProduct: ProductSchema): void {
    this.clearButtons()
    this.setInfoBoxText(group.name)
    this._isBlocked = true

    // Produkte für die Optionen laden
    const products: ProductSchema[] = (group.options || [])
      .map((o: any) => this.productService.findProductById(o.productId))
      .filter(Boolean) as ProductSchema[]

    // Skip-Button nur bei optionalen Gruppen (minSelections === 0)
    if (group.minSelections === 0) {
      this._functionButtons.push({
        _id: 'skip-option-group',
        externalId: this.#functionButtonExternalId,
        locationId: this.userService.currentUser()?.activeLocationId || '',
        tenantId: this.authService.tenantId()?.toString() || '',
        name: 'ÜBERSPRINGEN',
        index: -2,
        isFunctionButton: true,
        backgroundColor: 'darkcyan',
        fontColor: 'white',
        callback: () => {
          this.#completedGroups.add(group.id)
          const nextGroup = this.getNextMandatoryGroup(parentProduct)
          if (nextGroup) {
            this.showOptionGroupButtons(nextGroup, parentProduct)
          } else {
            this._isBlocked = false
            // Bundle-Flow abgeschlossen
            this.setProductButtonsByGroupId(parentProduct.categoryIds?.[0])
          }
        },
      })
    }

    this._productButtons = products as any[]
    this._productButtons.forEach(btn => {
      ;(btn as any).callback = () => this.selectOptionGroupItem(btn as ProductSchema, group, parentProduct)
    })

    this.#cdr.markForCheck()
  }

  /** Verarbeitet die Auswahl eines Items aus einer OptionGroup */
  private selectOptionGroupItem(selected: ProductSchema, group: any, parentProduct: ProductSchema): void {
    const lineItem = this.getCurrentSelectedLineItem()
    if (!lineItem) return

    const genericItem = this.toGenericLineItem(selected)

    // Speichern basierend auf Gruppen-Name
    const groupName = (group.name || '').toLowerCase()
    if (groupName.includes('beilage') || groupName.includes('side')) {
      lineItem.menuSideDish = genericItem
    } else if (groupName.includes('getränk') || groupName.includes('drink')) {
      lineItem.menuDrink = genericItem
    } else {
      // Soßen, Extras etc. als Modifier (freeQuantity berücksichtigen)
      const freeQty = group.freeQuantity || 0
      const currentModCount = lineItem.modifiers.filter(m => m.topic === group.name).length
      if (freeQty > 0 && currentModCount < freeQty) {
        genericItem.price = 0 // Kostenlos innerhalb freeQuantity
      }
      genericItem.topic = group.name
      lineItem.modifiers.push(genericItem)
    }

    this.#completedGroups.add(group.id)

    // Prüfen ob das gewählte Produkt selbst OptionGroups hat (z.B. Pommes → Soßen)
    if (selected.optionGroups?.length) {
      const subGroups = selected.optionGroups.filter(g => !this.#completedGroups.has(g.id))
      if (subGroups.length > 0) {
        // Zwischen-Schritt: OptionGroups des gewählten Produkts anzeigen
        this.showOptionGroupButtons(subGroups[0], parentProduct)
        // Sub-OptionGroup-IDs zum Set hinzufügen damit sie nicht nochmal kommen
        // aber den parentProduct beibehalten für den Rückweg
        return
      }
    }

    // Nächste Gruppe des Bundle-Produkts oder Unblock
    const nextGroup = this.getNextMandatoryGroup(parentProduct)

    if (nextGroup) {
      this.showOptionGroupButtons(nextGroup, parentProduct)
    } else {
      this._isBlocked = false
      this.setProductButtonsByGroupId(parentProduct.categoryIds?.[0])
    }

    this.#cdr.markForCheck()
  }

  /** Gibt das aktuell ausgewählte LineItem zurück (normal oder Kombination) */
  private getCurrentSelectedLineItem(): OrderLineItemSchema | null {
    if (this._selectedCombinationIndex[0] !== null && this._selectedCombinationIndex[1] !== null) {
      return this.combinations[this._selectedCombinationIndex[0]][this._selectedCombinationIndex[1]] ?? null
    }
    if (this._selectedProductIndex !== null) {
      return this.#lineItems[this._selectedProductIndex] ?? null
    }
    return null
  }

  /** Erstellt ein GenericLineItem aus einem Produkt (für menuSideDish, menuDrink, modifiers) */
  private toGenericLineItem(product: ProductSchema): any {
    const parentGroup = this.productGroupService.getProductGroupById(product.categoryIds?.[0] ?? '')
    return {
      _id: product._id,
      externalId: product.externalId ?? '',
      amount: 1,
      name: product.name,
      price: product.price || 0,
      taxInside: product.taxInside || 19,
      taxOutside: product.taxOutside || 7,
      ingredientReferences: (product as any).ingredientReferences || [],
      recipeReferences: product.recipeReferences || [],
      topic: parentGroup?.name ?? '',
    }
  }

  // ──────────────────────────────────────────────────────────────────────

  increaseLineItem(product: ProductSchema, amount: number | undefined = undefined) {
    const amountToIncrease: number = amount !== undefined ? amount : this.multiplier
    const isBundle = this.isBundleProduct(product)

    let topic: string
    const firstCategoryId = product.categoryIds?.[0]
    if (!firstCategoryId) {
      topic = ''
    } else {
      const parentGroup = this.productGroupService.getProductGroupById(firstCategoryId)
      topic = parentGroup?.name ?? ''
    }

    const orderLineItem: OrderLineItemSchema = {
      _id: product._id,
      externalId: product.externalId ?? '',
      acronym: product.acronym,
      productGroupExternalId: product.categoryIds?.[0] ?? '',
      amount: amountToIncrease,
      bundleNumber: null,
      modifiers: [],
      index: product.ui?.index,
      isMenu: isBundle,
      menuDrink: null,
      menuSideDish: null,
      name: product.name,
      parentId: product.categoryIds?.[0],
      price: product.price || 0,
      ingredientReferences: (product as any).ingredientReferences || [],
      recipeReferences: product.recipeReferences || [],
      taxInside: !product.taxInside ? 19 : product.taxInside,
      taxOutside: !product.taxOutside ? 7 : product.taxOutside,
      topic: topic,
    }

    this.resetMultiplier()
    this.resetProductSearch()

    if (this._selectedCombinationIndex[0] !== null) {
      // Kombinations-Modus
      const index = this.combinations[this._selectedCombinationIndex[0]].push(orderLineItem) - 1

      if (isBundle && product.optionGroups?.length) {
        this._isBlocked = true
        this._selectedCombinationIndex[1] = index
        this.#completedGroups = new Set()
        // Bundle-Flow gestartet für: product.name
        const firstGroup = this.getNextMandatoryGroup(product)
        if (firstGroup) {
          this.showOptionGroupButtons(firstGroup, product)
        }
      } else if ((product as any).nextProductGroupExternalId !== undefined) {
        this.setSuccessorSubButtons(product)
      }
    } else {
      // Normaler Modus
      // Duplikat-Check (nur bei nicht-Bundle-Produkten)
      if (!isBundle && this.#lineItems.find(item => item._id === orderLineItem._id)) {
        return this.increaseQuantity(this.#lineItems.find(item => item._id === orderLineItem._id)!)
      }

      const index = this.#lineItems.push(orderLineItem) - 1

      if (isBundle && product.optionGroups?.length) {
        // Neuer Bundle-Flow: OptionGroups sequentiell abarbeiten
        this._isBlocked = true
        this._selectedProductIndex = index
        this.#completedGroups = new Set()
        // Bundle-Flow gestartet für: product.name
        const firstGroup = this.getNextMandatoryGroup(product)
        if (firstGroup) {
          this.showOptionGroupButtons(firstGroup, product)
        }
      }
    }
  }

  decreaseLineItem() {
    if (this._selectedProductIndex !== null) {
      const deletedItem = this.#lineItems[this._selectedProductIndex]
      this.#lineItems.splice(this._selectedProductIndex, 1)
      this._selectedProductIndex = null

      this.#orderInteractions.push({
        type: 'item-delete',
        orderOpenedAt: this.#orderOpenedAt.toISOString(),
        eventAt: new Date().toISOString(),
        eventOffsetMs: new Date().getTime() - this.#orderOpenedAt.getTime(),
        productId: deletedItem.externalId || undefined,
        lineItemId: this._selectedProductIndex || -1,
        deletedQuantity: deletedItem.amount,
        businessDayId: this.locationService.currentBusinessDay?.businessDayId?.toString(),
        businessDate: this.locationService.currentBusinessDay?.date,
        userId: this._currentUser?._id?.toString() || '',
      } as any)
    } else if (this._selectedCombinationIndex[0] !== null && this._selectedCombinationIndex[1] !== null) {
      const deletedItem = this.combinations[this._selectedCombinationIndex[0]][this._selectedCombinationIndex[1]]
      this.combinations[this._selectedCombinationIndex[0]].splice(this._selectedCombinationIndex[1], 1)
      this._selectedCombinationIndex[1] = null

      this.#orderInteractions.push({
        type: 'item-delete',
        orderOpenedAt: this.#orderOpenedAt.toISOString(),
        eventAt: new Date().toISOString(),
        eventOffsetMs: new Date().getTime() - this.#orderOpenedAt.getTime(),
        productId: deletedItem.externalId || undefined,
        deletedQuantity: deletedItem.amount,
        businessDayId: this.locationService.currentBusinessDay?.businessDayId?.toString(),
        businessDate: this.locationService.currentBusinessDay?.date,
        userId: this._currentUser?._id?.toString() || '',
      } as any)

      if (this.combinations[this._selectedCombinationIndex[0]].length === 1) {
        this.resolveCombination()
      }
    } else {
      this.setInfoBoxText('Bitte wählen Sie zunächst einen Artikel aus.', 'red')
    }
  }

  combineAllArticles() {
    this._articlesToCombine = this.lineItems.map((_, index) => index)
    this.increaseCombination()
  }

  increaseCombination() {
    if (this._articlesToCombine.length <= 1) {
      this.setInfoBoxText('Bitte wählen Sie mindestens zwei Artikel aus.', 'red')
      return
    }

    const existingBundles = this.#lineItems
      .map(i => i.bundleNumber)
      .filter(n => n !== null && n !== undefined) as number[]
    const nextBundleId = existingBundles.length > 0 ? Math.max(...existingBundles) + 1 : 1

    this._articlesToCombine.forEach(articleIndex => {
      if (this.#lineItems[articleIndex]) {
        this.#lineItems[articleIndex].bundleNumber = nextBundleId
      }
    })

    this._articlesToCombine = []
    this.productButtons.forEach(subButton => {
      if ((subButton as any).productGroupExternalId === undefined) return
      ;(subButton as any).pressed = false
    })

    if (this.lineItems.length <= 1) {
      this.unselectProduct()
    } else {
      this.setCombiSubButtons()
    }
  }

  decreaseCombination() {
    if (this.combinations.length === 0) {
      this.setInfoBoxText('Keine KOMBINATIONEN vorhanden.', 'red')
      return
    }
    if (this._selectedCombinationIndex[0] === null) {
      this.setInfoBoxText('Bitte wählen Sie zunächst eine KOMBINATION aus.', 'red')
      return
    }

    const deletedCombination = this.combinations[this._selectedCombinationIndex[0]]

    deletedCombination.forEach((item, i) => {
      this.#orderInteractions.push({
        type: 'item-delete',
        orderOpenedAt: this.#orderOpenedAt.toISOString(),
        eventAt: new Date().toISOString(),
        eventOffsetMs: new Date().getTime() - this.#orderOpenedAt.getTime(),
        productId: item.externalId || undefined,
        lineItemId: i,
        deletedQuantity: item.amount,
        businessDayId: this.locationService.currentBusinessDay?.businessDayId?.toString(),
        businessDate: this.locationService.currentBusinessDay?.date,
        userId: this._currentUser?._id?.toString() || '',
      } as any)
    })

    const bundleId = deletedCombination[0].bundleNumber
    this.#lineItems = this.#lineItems.filter(item => item.bundleNumber !== bundleId)

    this._selectedCombinationIndex = [null, null]
  }

  resolveCombination() {
    if (this.combinations.length === 0) {
      this.setInfoBoxText('Keine KOMBINATIONEN vorhanden.', 'red')
      return
    }
    if (this._selectedCombinationIndex[0] === null) {
      this.setInfoBoxText('Bitte wählen Sie zunächst eine KOMBINATION aus.', 'red')
      return
    }

    const bundle = this.combinations[this._selectedCombinationIndex[0]]
    if (!bundle || bundle.length === 0) return

    const bundleId = bundle[0].bundleNumber

    this.#lineItems.forEach(item => {
      if (item.bundleNumber === bundleId) {
        item.bundleNumber = null
      }
    })

    this._selectedCombinationIndex = [null, null]
  }

  placeOrder() {
    let staffMealDetails: StaffPaymentInfo | undefined = undefined
    let discountDetails: Discount | undefined = undefined
    let customerDetails: CustomerPaymentInfo | undefined = undefined

    const dineLocation = !this._dineLocation ? DineLocation.DINE_IN : this._dineLocation

    if (dineLocation === DineLocation.TAKE_OUT) {
      this._pager = undefined
      this._table = undefined
    }
    if (this.isStaffMealOrder && this._currentUser) {
      staffMealDetails = {
        userId: this._currentUser._id,
        userName: this._currentUser.firstName + ' ' + this._currentUser.lastName,
        isPaid: false,
      }
      if (this._currentUser.discountDetails) {
        discountDetails = this._currentUser.discountDetails as unknown as Discount
      }
    }
    if (this._customer && this._customer._id) {
      customerDetails = {
        customerId: this._customer._id,
        customerName: this._customer.name1,
        isPaid: false,
      }

      if (this._customer.discountDetails) {
        discountDetails = this._customer.discountDetails as unknown as Discount
      }
    }
    const orderIndex = this.orderService.createOrder(
      this.#lineItems,
      OrderChannel.TELEPHONE,
      customerDetails,
      discountDetails,
      this._pager,
      this._productionTime,
      staffMealDetails,
      this._table,
      dineLocation,
      this.#recordingDate,
      this.#orderInteractions,
      {
        createdBy: this._currentUser?._id?.toString() || '',
      },
    )

    this.deleteOrder()
    this.unselectProduct()

    this.matDialogRef.close(orderIndex)
  }

  togglePriceVisibility() {
    this._priceVisibility = !this._priceVisibility
  }

  toggleWithoutExtra() {
    if (this._withoutExtra) {
      this._withoutExtra = false
      this.setInfoBoxText('Mit ausgewählt!')
    } else {
      this._withoutExtra = true
      this.setInfoBoxText('Ohne ausgewählt!')
    }
  }

  getBadgeValue(product: ProductSchema): string | null {
    if ((product as any).isFunctionButton) return null
    return (product as any).index.toString()
  }

  isLineItemBundled(articleItem: OrderLineItemSchema): boolean {
    return articleItem.bundleNumber !== null && articleItem.bundleNumber !== undefined
  }

  calculateArticlePriceWithoutExtras(articleItem: OrderLineItemSchema): number | undefined {
    return calculateArticlePriceWithoutExtras(articleItem, this.generalSideDishPrice, this.generalDrinkPrice)
  }

  calculateArticlePrice(articleItem: OrderLineItemSchema): number {
    return calculateArticlePrice(articleItem, this.generalSideDishPrice, this.generalDrinkPrice)
  }

  calculateSumPrice(): number {
    return calculateSumPrice(
      { lineItems: this.#lineItems } as any,
      this.generalSideDishPrice,
      this.generalDrinkPrice,
    )
  }

  calculateCombinationPrice(articleItems: OrderLineItemSchema[]): number {
    return calculateCombinationPrice(articleItems, this.generalSideDishPrice, this.generalDrinkPrice)
  }

  isMenuComplete(orderArticle: OrderLineItemSchema): boolean {
    if (!orderArticle.isMenu) return true
    const article: ProductSchema | undefined = this.productService.findProductById(orderArticle._id)
    if (!article) return true
    if (
      ((article as any).isMenuSideDish && !orderArticle.menuSideDish) ||
      ((article as any).isMenuDrink && !orderArticle.menuDrink)
    ) {
      return false
    }
    return true
  }

  pass(): void {
    return
  }

  dialogClose() {
    // TODO: ConfirmActionDialog nach Migration aktivieren
    // Derzeit direkte Schließung ohne Bestätigung (Platzhalter bis ConfirmActionDialog migriert ist)
    this.orderInteractionService
      .create({
        type: 'order-cancel',
        orderOpenedAt: this.#orderOpenedAt.toISOString(),
        eventAt: new Date().toISOString(),
        eventOffsetMs: new Date().getTime() - this.#orderOpenedAt.getTime(),
        hadLineItems: this.#lineItems.length > 0,
        lineItemCountAtCancel: this.#lineItems.length,
        totalQuantityAtCancel: this.#lineItems.reduce((sum, item) => sum + item.amount, 0),
        businessDayId: this.locationService.currentBusinessDay?.businessDayId?.toString(),
        businessDate: this.locationService.currentBusinessDay?.date,
        userId: this._currentUser?._id?.toString() || '',
      })
      .then()

    this.matDialogRef.close(false)
  }

  resetCharacterFilter() {
    this.setCustomerSubButtons()
  }

  applyCharacterFilter(_character: string): void {
    // TODO: Zeichenfilter für Firmenkunden implementieren
  }

  handleCustomerPageEvent(_event: { pageIndex: number; pageSize: number }): void {
    // TODO: Paginierung für Firmenkunden implementieren
  }

  setCustomerSubButtons(): void {
    this.clearButtons()
    // TODO: CorporateCustomerService nach Migration aktivieren
    // this.corporateCustomerService.find({ query: { $sort: { name1: 1 } } }).then(response => {
    //   if (Array.isArray(response)) {
    //     this.corporateCustomers = response
    //     this.totalCorporateCustomers = response.length
    //   } else {
    //     this.corporateCustomers = response.data
    //     this.totalCorporateCustomers = response.total
    //   }
    // })
    console.warn('CorporateCustomerService: noch nicht migriert – TODO')
  }

  setCustomer(customer: CorporateCustomer) {
    if (!customer._id) return
    this.customer = customer
    this.clearButtons()
  }

  setAsStaffMealOrder(): void {
    this.clearButtons()
    // TODO: ConfirmActionDialog nach Migration aktivieren
    // Derzeit direkte Aktivierung ohne Bestätigungsdialog
    this._staffMealOrder = !this._staffMealOrder
  }

  numpadAction(number: number): void {
    this.concatMultiplier(number)
    this.concatProductSearch(number)
  }

  private concatMultiplier(number: number) {
    if (this.multiplierFirstStep) {
      this.multiplier = number
      this.multiplierFirstStep = false
      return
    }
    const multiplier = this.multiplier.toString() + number.toString()
    this.multiplier = Number(multiplier)
  }

  private concatProductSearch(number: number): void {
    if (this._numpadNumber === undefined) {
      this._numpadNumber = number
    } else {
      this._numpadNumber = this._numpadNumber * 10 + number
    }
    this._searchForArticleName()
  }

  applyProductSearch() {
    if (this._numpadNumber === undefined) return

    const article: undefined | ProductSchema = this.productService.findProductByIndex(this._numpadNumber)

    if (!article) return

    this.increaseLineItem(article, 1)

    const skipViewChange = !(
      (article as any).isMenu ||
      (article as any).showSaucesAfterSelect ||
      (article as any).isMenuDrink ||
      ((article as any).showExtrasAfterSelect !== undefined && (article as any).showExtrasAfterSelect) ||
      (article as any).nextProductGroupExternalId !== undefined
    )
    this.clearNumpad(skipViewChange)
  }

  numpadReset(): void {
    this.resetMultiplier()
    this.resetProductSearch()
  }

  private resetMultiplier() {
    this.multiplier = 1
    this.multiplierFirstStep = true
  }

  private resetProductSearch(): void {
    this._numpadNumber = undefined
    this._numpadValue = ''
  }

  getArticleGroupBackgroundColor(id: string | undefined): string {
    return this.productGroups.find((articleGroup: ProductGroupSchema) => articleGroup._id === id)?.color || ''
  }
}
