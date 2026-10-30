import {
  AfterViewInit,
  afterRenderEffect,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
  input,
  linkedSignal,
  output,
  Pipe,
  PipeTransform,
  signal,
  ViewChild,
  viewChild,
  WritableSignal,
} from '@angular/core'
import { formatEurCents } from '@panary/shared/util-helpers'
import { MatDialog } from '@angular/material/dialog'
import { firstValueFrom } from 'rxjs'
import { ConfirmDialogComponent, type ConfirmDialogData, EurPipe, IconComponent } from '@panary/shared/ui-common'
import { MatMenuModule } from '@angular/material/menu'
import { A11yModule } from '@angular/cdk/a11y'
import { NotificationService, type NotificationRef } from '@panary/shared/ui-notifications'
import { FormsModule } from '@angular/forms'
import { CommonModule } from '@angular/common'
// UUID als String-Alias (node:crypto UUID ist ein branded type – für Migration vereinfacht)
type UUID = string

/** Wie eine Bestellung in der Kasse endete — `closed`-Output, ausgewertet von der Route (core#828). */
export type KasseCloseReason = 'order-placed' | 'preorder-created' | 'cancelled'

/** Warenkorb beim Öffnen des Anpassen-Panels — „Abbrechen" stellt ihn wieder her (#699). */
interface CartSnapshot {
  states: Array<{
    item: OrderLineItem
    modifiers: OrderLineItem['modifiers']
    modifierScope: OrderLineItem['modifierScope']
  }>
  selection: BoardSelection
}

import { ProductGroup, ProductGroupService } from '@panary/product-groups/data-access'
import { ItemType, ProductSchema } from '@panary/products/domain'
import { ProductService } from '@panary/products/data-access'
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
  OrderLineItem,
  OrderCheckoutService,
  OrderService,
  StaffPaymentInfo,
  calculateModifierPrice,
  menuComponentSurcharge,
} from '@panary/orders/data-access'
import {
  AppliedDiscount,
  Discount,
  computeOrderTax,
  isSplittableLine,
  lineConfigKey,
  mergeIdenticalLines,
  modifiersCountPerUnit,
  splitOffPieces,
} from '@panary/orders/domain'
import { Discount as ManagedDiscount } from '@panary/discounts/domain'
import {
  DiscountCodeService,
  DiscountService,
  codeResultMessage,
  type CodeCheckResult,
} from '@panary/discounts/data-access'
import { uuidv7 } from 'uuidv7'
import { PreOrderService } from '@panary/pre-orders/data-access'
import { LocationService } from '@panary/locations/data-access'
import { defaultOrderChannel, toggledOrderChannel, type PosOrderChannel } from './order-channel'
import { AuthService } from '@panary/auth/data-access'
import { PosHandednessService, User, UserService } from '@panary/users/data-access'
import { ConnectionService, TenantSuspensionService } from '@panary/shared/data-access'
import { DeviceConfigService } from '@panary/shared/data-access-config'
import { CorporateCustomer } from '@panary/corporate-customers/domain'
import {
  buildQuickPreOrderPayload,
  PreOrderQuickDialogComponent,
  type PreOrderQuickResult,
} from './pre-order-quick-dialog.component'
import { DiscountPickerDialogComponent } from './discount-picker-dialog.component'
import { PromoCodeDialogComponent } from './promo-code-dialog.component'
import { buildCodeAppliedDiscount, evaluatePromoCodeGate, redeemCodeForOrder } from './promo-code'
import {
  LINE_DISCOUNT_BLOCKED_NO_SELECTION,
  type LineDiscountMap,
  buildLineAppliedDiscounts,
  evaluateLineDiscountGate,
  pruneLineDiscounts,
  removeLineDiscount,
  setLineDiscount,
} from './line-discount'
import {
  PosButton,
  PosButtonUiState,
  PosProductButton,
  extraNotModifierMessage,
  isModifierButton,
  toPosButton,
} from './pos-button.model'
import { BundleFlow } from './bundle-flow'
import { KasseDraftRegistry } from './kasse-draft-registry'
import { splitGroupBar } from './group-bar'
import {
  type CartPing,
  cartPingClass,
  nextCartPing,
  revealCartLine,
  revealCartSelection,
  watchCartUserScroll,
} from './cart-scroll'
import { type ClosingStep, type ClosingStepView, closingStepViews, closingSteps } from './closing-flow'
import {
  ALL_MODIFIERS_GROUP_ID,
  type CustomizeModel,
  REMOVED_INGREDIENT_PREFIX,
  buildCustomizeModel,
  opensCustomizeAutomatically,
  toggleIngredientRemoval,
  type CustomizeScope,
} from './product-customize'
import { type CustomizeOptionEvent, ProductCustomizePanelComponent } from './product-customize-panel.component'
import { CashPaymentComponent } from './cash-payment.component'
import {
  ensureClosedDayApproval,
  promptCashSessionAuthorization,
  promptClosedDayApprovalFromError,
  type CashSessionPromptLocation,
} from '@panary/businessdays/feature-pos-closing-dialog'
import { BusinessDayService } from '@panary/businessdays/data-access'
import {
  BoardSelection,
  nextBoardSelection,
  previousBoardSelection,
  toggleCombinationSelection,
} from './board-selection'
import { TranslateModule, TranslateService } from '@ngx-translate/core'
import { CorporateCustomerService } from '@panary/corporate-customers/data-access'
// TODO: AppButtonDirective fehlt noch in panary-core — nach Migration einbinden
// TODO: ConfirmActionDialog fehlt noch in panary-core — nach Migration in @panary/shared/ui-dialogs einbinden
// TODO: isLightColor fehlt noch in panary-core — nach Migration in @panary/shared/util-theme einbinden
// TODO: PreOrderDialogComponent fehlt noch als eigene Lib in panary-core

/** Inline-Implementierung von AbsPipe bis @panary/shared/pipes migriert ist */
@Pipe({ name: 'abs', standalone: true, pure: true })
export class AbsPipe implements PipeTransform {
  transform(value: number): number {
    return Math.abs(value)
  }
}

/** Leerlauf-Text der früheren Infozeile — als Hinweis wäre er nur Rauschen (core#908). */
const IDLE_INFO_TEXT = 'Bitte wählen Sie eine Produktkategorie'
const IDLE_INFO_TEXTS: ReadonlySet<string> = new Set([IDLE_INFO_TEXT, `${IDLE_INFO_TEXT}!`])
/** Standzeit des Hinweises; ein Fehler bleibt länger, weil er meist erklärt, warum ein Tipp nichts tat. */
const NOTICE_MS = 4000
const NOTICE_DANGER_MS = 6000

/** „Alle Modifier" bucht wie das frühere Extras-Raster unter dem allgemeinen Extra-Thema, nicht unter einer Optionsgruppe. */
function extraTopicOf(event: CustomizeOptionEvent): string | undefined {
  return event.groupId === ALL_MODIFIERS_GROUP_ID ? undefined : event.groupName
}

/** Format, das das Order-Schema für `componentExternalId` verlangt (#1127). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Wird eine Menü-Komponente durch eine andere ersetzt, gehen die Modifier mit, die zu ihr gewählt wurden (#1127):
 * Die Mayonnaise der Pommes gehört nicht zum Salat, der sie ersetzt.
 */
function dropComponentModifiers(
  line: OrderLineItem,
  previous: { externalId?: string } | null | undefined,
  next: { externalId?: string },
): void {
  const ref = previous?.externalId
  if (!ref || ref === next.externalId) return
  line.modifiers = line.modifiers.filter(mod => mod.componentExternalId !== ref)
}

/**
 * Die eine Meldung nach dem Abschicken (core#1087). Vorher standen „Bestellung wurde erstellt“,
 * „Bestellungen aktualisiert“ und „Bestellung abgeschickt · Neue Bestellung“ zugleich über dem Druckdialog.
 */
export const ORDER_PLACED_MESSAGE = 'Bestellung abgeschickt'

@Component({
  selector: 'app-order-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IconComponent,
    A11yModule,
    AbsPipe,
    CommonModule,
    EurPipe,
    FormsModule,
    MatMenuModule,
    CashPaymentComponent,
    ProductCustomizePanelComponent,
    TranslateModule,
  ],
  templateUrl: './order-dialog.component.html',
  styleUrls: ['./order-dialog.component.scss'],
})
export class OrderDialogComponent implements OnInit, AfterViewInit, OnDestroy {
  /** INJECTIONS */
  protected readonly productGroupService: ProductGroupService = inject(ProductGroupService)
  protected readonly productService: ProductService = inject(ProductService)
  protected readonly orderService: OrderService = inject(OrderService)
  readonly #checkout = inject(OrderCheckoutService)
  protected readonly corporateCustomerService: CorporateCustomerService = inject(CorporateCustomerService)
  protected readonly locationService: LocationService = inject(LocationService)
  protected readonly authService: AuthService = inject(AuthService)
  protected readonly translateService: TranslateService = inject(TranslateService)
  protected readonly userService: UserService = inject(UserService)
  readonly #posHandedness = inject(PosHandednessService)
  protected readonly matDialog: MatDialog = inject(MatDialog)
  // Meldeweg für alles, was das Abschließen der Bestellung überleben muss — die Infobox
  // gehört zur Bestellung und ist mit ihr weg (siehe #placeOrder, Rabattcode-Fehlschlag).
  readonly #notifications = inject(NotificationService)
  readonly #businessDays = inject(BusinessDayService)
  protected readonly orderInteractionService: OrderInteractionService = inject(OrderInteractionService)
  protected readonly deviceConfigService: DeviceConfigService = inject(DeviceConfigService)
  protected readonly preOrderService: PreOrderService = inject(PreOrderService)
  protected readonly discountService: DiscountService = inject(DiscountService)

  /** VIEW CHILDREN */
  // TODO: @ViewChild durch viewChild()-Signal ersetzen, sobald AfterViewInit-Logik migriert ist
  @ViewChild('productGroupContainer') productGroupContainer!: ElementRef
  /** Unsichtbare Messzeile mit allen Gruppen — liefert die Breiten, nach denen die Leiste aufteilt (core#908). */
  private readonly productGroupMeasure = viewChild<ElementRef<HTMLElement>>('productGroupMeasure')
  /** Steuerleiste der markierten Zeile — es steht höchstens eine im Warenkorb (core#1021). */
  private readonly selectionToolbar = viewChild<ElementRef<HTMLElement>>('selectionToolbar')
  /** Die scrollende Positionsliste des Warenkorbs (core#1116). */
  private readonly cartList = viewChild<ElementRef<HTMLElement>>('cartList')
  #cdr = inject(ChangeDetectorRef)
  readonly discountCodeService = inject(DiscountCodeService)

  /** PRIVATE PROPERTIES */
  private _timer: ReturnType<typeof setInterval> | undefined

  #functionButtonExternalId: UUID = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxx01'
  #recordingDate: Date = new Date()
  #lineItems: Array<OrderLineItem> = []
  #orderOpenedAt: Date = new Date()
  #orderInteractions: Array<OrderInteraction> = []
  /**
   * Wurde in dieser Bestellung je ein Artikel gebucht? Bleibt stehen, auch wenn alles wieder
   * gelöscht ist — das X fragt dann trotzdem nach (#795): Wer getippt hat, war mitten in einer
   * Bestellung, und ein Fehltipp aufs X soll sie nicht still verwerfen.
   */
  #hadInput = false
  /**
   * Laufende Nummer des zuletzt angebotenen „Rückgängig". Die Snackbar trägt die
   * Nummer, unter der sie geöffnet wurde; stimmt sie beim Klick nicht mehr mit
   * dieser überein, ist das Angebot verfallen (Bestellung abgeschickt, Warenkorb
   * geleert, neueres Angebot) und der Klick tut nichts.
   */
  #undoSerial = 0
  /** Die Snackbar des letzten „Rückgängig"-Angebots — `#invalidateUndo` schließt nur sie. */
  #undoRef: NotificationRef | null = null
  /** Zeilenindex → Stückzahl, die in die neue Kombination geht (#795: Kachel zählt hoch). */
  private _articlesToCombine = new Map<number, number>()
  private _isBlocked = false
  private _customer: CorporateCustomer | undefined = undefined
  /** Signal statt Feld: Der Nutzer kommt verzögert (Refetch), und die Spiegelung muss ihm folgen. */
  readonly #currentUser = signal<User | undefined>(undefined)
  private get _currentUser(): User | undefined {
    return this.#currentUser()
  }
  private set _currentUser(user: User | undefined) {
    this.#currentUser.set(user)
  }
  private _functionButtons: PosButton[] = []
  private _functionBlockLabel = ''
  private _infoBoxText = `${IDLE_INFO_TEXT}!`
  private _lastParentId: string | null | undefined = undefined
  private _pager: number | undefined = undefined
  private _priceVisibility = false
  private _productionTime = 0
  private _productionTimes: Array<number>
  private _selectedProductIndex: number | null = null
  private _selectedCombinationIndex: [number | null, number | null] = [null, null]
  private _staffMealOrder = false
  // Manuell am POS gewählter Order-Rabatt (Cloud-gepflegte Definition). Wird beim
  // placeOrder zu einem appliedDiscount-Snapshot; Personalessen-Rabatt stempelt zusätzlich staffPaymentInfo.
  readonly selectedManualDiscount = signal<ManagedDiscount | null>(null)

  // Geprüfter, noch NICHT eingelöster Rabattcode. Die Einlösung passiert erst in
  // placeOrder — ein Abbruch nach der Eingabe darf den Code nicht verbrauchen
  // (bei usageLimit: 1 wäre er unwiederbringlich weg). ADR 0032.
  readonly appliedCodeDiscount = signal<CodeCheckResult | null>(null)

  // Positionsrabatte, je Zeile höchstens einer (Schlüssel: lineItem._id).
  // Werden beim placeOrder zu `target: 'line'`-Snapshots; den Betrag rechnet
  // ausschliesslich computeOrderTax.
  readonly lineDiscounts = signal<LineDiscountMap>({})

  /**
   * Vertriebskanal der Bestellung.
   *
   * Stand bis panary/panary-core#133 hart auf `TELEPHONE` — deshalb meldete
   * jeder Tagesabschluss „Telefon 100 %, POS 0 %", auch im Modus POS-Kasse,
   * und der `posCents`-Bucket des Aggregators war strukturell immer 0.
   *
   * Bewusst eine **Auswahl** statt einer Ableitung aus dem Betriebsmodus: Der
   * Dialog nimmt an der Kasse auch Telefonbestellungen auf. Eine reine
   * Kontext-Ableitung hätte die dann als POS gezählt und den Fehler nur
   * umgedreht. Vorbelegt wird trotzdem nach Betriebsmodus, damit der
   * Regelfall ohne zusätzlichen Griff stimmt.
   */
  readonly orderChannel = linkedSignal<string | undefined, PosOrderChannel>({
    // Quelle ist der Modus als `computed`-Wert, nicht der Standort: Ein Refresh des Standorts liefert ein neues
    // Objekt mit demselben Modus. Das `computed` meldet dann nichts weiter und die Wahl des Kassierers bleibt
    // stehen (ein `linkedSignal` mit der bloßen Funktion setzt bei jedem Lauf zurück). Kommt der Standort erst
    // nach dem Aufbau (Neuladen auf `/kasse`, core#878), wechselt der Modus von „fehlt" auf „pos-cashier".
    source: computed(() => this.locationService.activeLocation()?.operationMode),
    computation: operationMode => defaultOrderChannel(operationMode),
  })
  private _productButtons: PosButton[] = []
  private _table: string | undefined = undefined
  /** Schritt der Abschlusskette, den das Raster gerade zeigt (core#1069). */
  #closingStep: ClosingStep | null = null
  #lastViewKey = ''
  private _dineLocation: (typeof DineLocation)[keyof typeof DineLocation] | undefined = undefined

  /**
   * Anpassen-Panel (#639): das Modell der gerade angepassten Zeile, `null` = Raster.
   * `#customizeLine` hält die Zeile selbst, nicht ihren Index — die Kombinationen
   * werden je Aufruf neu gebaut, ein Index könnte nach einer Änderung woanders zeigen.
   * `#customizeSnapshot` sind die Modifier beim Öffnen, „Abbrechen" stellt sie wieder her.
   */
  readonly customizeModel = signal<CustomizeModel | null>(null)
  #customizeLine: OrderLineItem | null = null

  /**
   * Bezahlansicht (core#831): die Bestellung ist angelegt und wartet auf Bar-Kassieren.
   * `total` ist die Summe in Euro, wie sie die Primärtaste zeigte; `orderId` die vorab vergebene ID.
   */
  readonly payment = signal<{ orderId: string; total: number } | null>(null)
  /** Der Abschluss läuft gerade (Server-Aufruf, ggf. Kassen-Freigabe). */
  readonly paying = signal(false)

  /**
   * Eine Bestellung wird gerade angelegt. Im Bezahl-Fall bleibt der Warenkorb über den Server-Roundtrip stehen
   * (die Bezahlansicht braucht die ID der angelegten Bestellung): Ein zweiter Tipp auf INNEN/Sofort läse dieselben
   * Positionen und legte eine zweite Bestellung an. Vorher leerte `deleteOrder()` den Warenkorb synchron.
   */
  readonly placing = signal(false)

  /**
   * Ein Sheet ist offen oder eine Bestellung wird angelegt — Anpassen, Bezahlen, Anlegen: Primärtaste, Ziffern,
   * Gruppenleiste und „Übersicht" sind gesperrt.
   */
  readonly sheetOpen = computed(() => this.customizeModel() !== null || this.payment() !== null || this.placing())

  /**
   * Einlösung eines Rabattcodes, deren Bestellung noch nicht angelegt ist. Scheitert das Anlegen, bleibt der
   * Warenkorb stehen und der nächste Versuch nutzt dieselbe Einlösung und dieselbe ID — sonst würde der Code
   * ein zweites Mal verbraucht (ein Einmalcode wäre weg, die erste Einlösung zeigte auf eine Bestellung, die es
   * nie gab).
   */
  #redeemedForRetry: { orderId: string; applied: AppliedDiscount } | null = null

  /** Ist das die Zeile, die das Sheet gerade anpasst — der Warenkorb markiert sie und pulsiert zweimal kurz. */
  isCustomizeLine(line: OrderLineItem): boolean {
    return this.#customizeLine !== null && line === this.#customizeLine
  }
  /**
   * Zustand des ganzen Warenkorbs beim Öffnen des Panels (#699). „Abbrechen" stellt ihn
   * wieder her — seit eine Anpassung eine Zeile aufspalten kann, reichen die Modifier der
   * einen Zeile nicht mehr.
   */
  #customizeCartSnapshot: CartSnapshot | null = null
  /** In dieser Panel-Sitzung abgespaltene Stücke — „Abbrechen" gibt sie an ihre Herkunft zurück. */
  #customizeSplits: Array<{ origin: OrderLineItem; piece: OrderLineItem }> = []
  /**
   * Für wie viele Stück gilt die Anpassung (#699, D2)? Aus dem Warenkorb an einer Zeile mit
   * mehreren Stück: eines (es wird abgespalten). Im Hinzufügen-Ablauf: alle.
   */
  readonly customizeScope = signal<CustomizeScope>('all')
  /** Nach der ersten Änderung ist der Umschalter fest — sonst müsste ein Split zurückgenommen werden. */
  readonly customizeScopeLocked = signal(false)
  /** Blendet im Sheet die Gruppe „Alle Modifier" ein (#1085, vorher ein eigenes Raster). */
  readonly customizeShowAll = signal(false)
  /**
   * Die Zeile, die gerade im Hinzufügen-Ablauf entstanden ist. Ihre Anpassung gilt für alle
   * Stück (D2), auch über das Extras-Raster; jede andere Auswahl beendet diesen Zustand.
   */
  #freshLine: OrderLineItem | null = null
  /** Zuletzt hinzugefügte oder hochgezählte Zeile: Ziel von Mitscrollen und Hervorhebung (core#1116). */
  readonly cartPing = signal<CartPing | null>(null)
  #cartPingTimer: ReturnType<typeof setTimeout> | undefined
  /** Letztes eigenes Wischen im Warenkorb, `Date.now()`. Kein Signal: Es soll nichts neu rendern. */
  #cartUserScrollAt = 0

  // Bundle/Menü-Flow-Logik (OptionGroup-Sequenz, HIGHEST, FIXED_PROPORTIONAL) — plain class, siehe bundle-flow.ts
  readonly #bundleFlow = new BundleFlow({
    findProductById: id => this.productService.findProductById(id),
    findProductByExternalId: externalId => this.productService.findProductByExternalId(externalId),
    topicForProduct: product =>
      this.productGroupService.getProductGroupById(product.categoryIds?.[0] ?? '')?.name ?? '',
  })

  private _combineAllId = 'combineAllArticles'
  private _combineAllName = 'Alle Artikel kombinieren'
  private _combineId = 'combineArticles'
  private _combineName = 'Kombinieren'
  private _combiTopic: UUID = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxx02'
  private _deleteCustomerId = 'deleteCustomer'
  private _deleteCustomerName = 'Kunde löschen?'
  private _deleteOrderId = 'deleteOrder'
  private _deleteOrderName = 'Bestellung leeren'
  private _extraTopic = 'Extras'
  private _productionTimeTopic: UUID = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxx03'
  private _skipSauceId = 'skipSauce'
  private _skipSauceName = 'ÜBERSPRINGEN'
  private _skipSuccessorId = 'skipSuccessor'
  private _skipSuccessorName = 'ÜBERSPRINGEN'
  private _tableTopic: UUID = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxx04'
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
  #customerRequest = 0
  /**
   * Pauschalpreise für Beilage und Getränk eines Menüs. Aus dem Standort abgeleitet statt im Konstruktor
   * kopiert: Ein Neuladen auf `/kasse` baut die Komponente, bevor der Standort geladen ist (core#878).
   */
  get generalSideDishPrice(): number {
    return this.locationService.activeLocation()?.settings?.genericProductSettings?.generalSideDishPrice || 0
  }
  get generalDrinkPrice(): number {
    return this.locationService.activeLocation()?.settings?.genericProductSettings?.generalDrinkPrice || 0
  }
  extras = this.productService.extras

  visibleProductGroups: ProductGroup[] = []
  overflowProductGroups: ProductGroup[] = []

  /**
   * Seite des Warenkorbs: `posHandedness` des angemeldeten Mitarbeiters, ohne Wahl links wie bisher
   * (core#829, Konzept §5 „Spiegelung"). Gespiegelt werden nur Zonen im Grid, nie Inhalte.
   * Eine Wahl im Avatar-Menü wirkt sofort, auch offline (`PosHandednessService`, core#833).
   */
  readonly handedness = computed(() => this.#posHandedness.effective(this.#currentUser()))

  /**
   * Kurzer Hinweis über dem Raster — ersetzt die Infozeile, die eine eigene Zeile über der Gruppenleiste belegte
   * (core#908). Er liegt über dem Raster, verschiebt also keine Kachel unter dem Finger, und blendet sich aus.
   * Leerlauf-Text und das Echo einer gewählten Gruppe bleiben stumm: Das zeigen Leiste und Funktionsblock selbst.
   */
  readonly notice = signal<{ text: string; tone: 'danger' | 'neutral' } | null>(null)
  #noticeTimer: ReturnType<typeof setTimeout> | undefined

  /**
   * Gruppe, deren Produkte das Raster gerade zeigt (core#1068) — die Gruppenleiste hebt sie hervor. Jeder andere
   * Ansichtswechsel läuft durch `clearButtons()` und nimmt die Hervorhebung dort mit.
   */
  readonly activeProductGroupId = signal<string | null>(null)

  /** Liegt die gewählte Gruppe hinter dem Burger, zeigt der Burger ihre Kante (core#1068). */
  activeOverflowGroup(): ProductGroup | undefined {
    const id = this.activeProductGroupId()
    return id ? this.overflowProductGroups.find(group => group._id === id) : undefined
  }

  get combinations(): OrderLineItem[][] {
    return getCombinations({ lineItems: this.#lineItems } as any)
  }

  get unbundledLineItems(): OrderLineItem[] {
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

  /** Was über dem Raster steht: nur die Tasten eines laufenden Ablaufs — der Hauptbildschirm zeigt keine (core#965). */
  get boardFunctionButtons(): readonly PosButton[] {
    return this._functionButtons
  }

  get infoBoxText() {
    return this._infoBoxText
  }

  get functionBlockLabel() {
    return this._functionBlockLabel
  }

  get priceVisibility() {
    return this._priceVisibility
  }

  get selectedProductIndex() {
    return this._selectedProductIndex
  }

  /** Schrittkopf der Abschlusskette (core#1069); leer außerhalb von Pager, Tisch und Fertigungszeit. */
  get closingStepViews(): ClosingStepView[] {
    const steps = closingSteps({
      showPagers: !!this.locationService.showPagers,
      showTables: !!this.locationService.showTables,
      takeOut: this._dineLocation === DineLocation.TAKE_OUT,
    })
    return closingStepViews(steps, this.#closingStep, { pager: this._pager, table: this._table })
  }

  /**
   * Schlüssel der Ansicht im Raster. Ändert er sich, baut das Template den Inhalt neu auf, und er gleitet herein
   * (core#1069). Ein Tipp auf eine Kachel derselben Ansicht ändert ihn nicht — sonst zuckte jedes Buchen.
   */
  get viewKey(): string {
    // Solange das Anpassen-Sheet offen ist, bleibt der Schlüssel stehen: `clearButtons()` beim Öffnen und der Rückweg
    // ins Gruppenraster beim Schließen ergäben sonst zwei Wechsel, und das Raster glitte nach jedem Anpassen herein.
    if (this.customizeModel()) return this.#lastViewKey
    this.#lastViewKey = `${this._functionBlockLabel}|${this.#closingStep ?? ''}|${this.activeProductGroupId() ?? ''}`
    return this.#lastViewKey
  }

  get selectedCombinationIndex() {
    return this._selectedCombinationIndex
  }

  get productGroups(): ProductGroup[] {
    return this.productGroupService.productGroups().filter((productGroup: ProductGroup) => !productGroup.excluded)
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
    // Personalessen ist rabatt-exklusiv: bei bereits gewähltem Rabatt gesperrt.
    // Ausnahme ist ein Personalessen-Rabatt — der erzeugt die Personalessen-
    // Erfassung ohnehin selbst.
    const manual = this.selectedManualDiscount()
    if (manual && !manual.isStaffMeal) return true
    return false
  }

  get disableCustomerButton(): boolean {
    return this._staffMealOrder
  }

  /** Standalone-Modus: Kein Cloud-Sync, keine Firmenkunden */
  #connectionService = inject(ConnectionService)
  #tenantSuspension = inject(TenantSuspensionService)
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
    // Abmelden fragt wie der Seitenwechsel nach, der Inaktivitäts-Logout verwirft (core#828, core#1064).
    const kasse = inject(KasseDraftRegistry)
    inject(DestroyRef).onDestroy(
      kasse.attach({
        hasInput: () => this.#hadInput,
        confirmLeave: async () => {
          if (!(await this.confirmLeave())) return false
          this.#clearForSessionEnd()
          return true
        },
        discard: () => {
          this.#logCancelled()
          this.#clearForSessionEnd()
        },
      }),
    )
    inject(DestroyRef).onDestroy(kasse.attachSheet(this.sheetOpen))

    // Jede neue Markierung rendert ihre eigene Leiste; das Signal folgt ihr, egal über welchen Weg markiert wurde
    // (Zeile, Position oder Kopf einer Kombination). `afterRenderEffect` statt `effect` (core#1047): Ein View-Effekt
    // dieser OnPush-Komponente lief erst im nächsten Durchlauf (Uhr-Takt), gemessen ≈ 1,6 s nach dem Antippen. Nach
    // dem Rendern steht die Leiste im DOM, und gescrollt wird im selben Durchlauf.
    // core#1116: Nach dem Hinzufügen zur betroffenen Zeile, über dieselbe Bewegung. Diese Effekte stehen vor dem der
    // Steuerleiste: Öffnet das Hinzufügen zugleich eine Leiste (Anpassen, Menü-Ablauf), scrollt sie zuletzt und
    // behält das letzte Wort, denn sie steht unter der neuen Zeile.
    afterRenderEffect(onCleanup =>
      onCleanup(watchCartUserScroll(this.cartList()?.nativeElement, () => (this.#cartUserScrollAt = Date.now()))),
    )
    afterRenderEffect(() =>
      revealCartLine(this.cartList()?.nativeElement, this.cartPing(), this.#cartUserScrollAt, Date.now()),
    )
    afterRenderEffect(() => revealCartSelection(this.selectionToolbar()?.nativeElement))

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
            // Sofort aus dem localStorage setzen (enthält die gültige User-uuid). Sonst
            // bliebe _currentUser offline undefined, weil userService.get() ohne
            // Verbindung nicht auflöst (users sind nicht gecacht) → creationContext.createdBy
            // fiele auf '' zurück und der Order-Replay scheiterte an der uuid-Validierung.
            this._currentUser = parsed as User
            this.userService
              .get(parsed._id)
              .then((fetchedUser: User): void => {
                this._currentUser = fetchedUser
              })
              .catch(() => undefined)
          }
        } catch {
          console.error('Failed to parse pos_current_user')
        }
      }
    }

    // Rabatt-Bestand früh laden: der beim Benutzer zugewiesene Personalessen-Rabatt
    // (`staffMealDiscountId`) wird beim Abschicken gegen dieses Signal aufgelöst.
    // Ohne Vorladen wäre es leer, solange der Kassierer den Rabatt-Picker nicht
    // geöffnet hat — das Personalessen liefe dann fälschlich ohne Nachlass durch.
    void this.discountService.loadActivePosDiscounts().catch(() => undefined)

    effect(() => {
      // Produktgruppen-Signal beobachten → Sichtbarkeit neu berechnen
      this.calculateVisibleProductGroups()
    })
  }

  /** PUBLIC PROPERTIES */
  /**
   * Warum die Kasse gerade nicht bucht. Abgeleitet statt einmalig gesetzt: Seit die Kasse eine Route
   * ist (core#828), lädt ein Neuladen auf `/kasse` die Komponente, bevor der Standort da ist. Ein in
   * `ngOnInit` gesetzter Wert blieb dann für immer stehen (core#868).
   *
   * Im Standalone-Modus (Edge-Server) wird der Geschäftstag automatisch verwaltet; der Backend-Hook
   * erstellt bei Bedarf transparent einen neuen. Blockiert wird deshalb nur, solange kein Standort
   * geladen ist — ein fehlender Geschäftstag entsteht beim ersten Order.
   */
  readonly blockingReason = computed<string | null>(() =>
    this.locationService.activeLocation() ? null : 'Standort konnte nicht geladen werden.',
  )

  /**
   * Die Bestellung ist beendet — abgeschickt, als Vorbestellung angelegt oder verworfen.
   * Was danach kommt (frische Kasse, zurück zur Übersicht), entscheidet die Route (core#828).
   */
  readonly closed = output<KasseCloseReason>()

  /**
   * Folgt diese Bestellung in derselben Kasse auf eine abgeschickte? Dann hat sie niemand
   * geöffnet, und ein Verlassen ohne Eingabe ist kein Abbruch — sonst stünde nach jeder Kassensitzung
   * ein leerer `order-cancel` in den OrderInteractions (core#828).
   */
  readonly isFollowUp = input(false)

  /** DINE LOCATION OVERLAY */
  showDineLocationSelection = false

  async ngOnInit(): Promise<void> {
    this._timer = setInterval(() => {
      this.time.set(new Date())
    }, 1000)

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
      // Die Messzeile ändert ihre Breite, wenn Gruppen dazukommen oder die Schrift nachlädt — beides ohne Resize.
      const measure = this.productGroupMeasure()?.nativeElement
      if (measure) this._resizeObserver.observe(measure)
    }
  }

  ngOnDestroy(): void {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect()
    }
    clearTimeout(this.#noticeTimer)
    clearTimeout(this.#cartPingTimer)
    if (this._timer) {
      clearInterval(this._timer)
    }
  }

  calculateVisibleProductGroups() {
    const allGroups = this.productGroups

    const measure = this.productGroupMeasure()?.nativeElement
    // Die Messzeile spiegelt `productGroups` erst nach dem nächsten Rendern; bis dahin gilt die alte Aufteilung
    // nicht als Messung. Ihr ResizeObserver rechnet nach, sobald sie steht.
    if (!this.productGroupContainer?.nativeElement || !measure || measure.children.length !== allGroups.length) {
      // Noch keine Messung: alle zeigen (die Leiste schneidet ab). Danach bleibt die letzte Aufteilung stehen, bis
      // die Messzeile mit den neuen Gruppen gerendert ist — ihre Breite ändert sich, der ResizeObserver rechnet nach.
      if (this.visibleProductGroups.length + this.overflowProductGroups.length === 0) {
        this.visibleProductGroups = allGroups
      }
      return
    }

    // Breiten und Abstände sind rem-basiert und wachsen mit der Dichte. Gerechnet wird mit der Innenbreite —
    // `clientWidth` enthält das Padding und ließe eine Gruppe zu viel in die Zeile.
    const element: HTMLElement = this.productGroupContainer.nativeElement
    const style = getComputedStyle(element)
    const innerWidth =
      element.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0)
    const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
    const chipWidths = Array.from(measure.children, chip => chip.getBoundingClientRect().width)
    const split = splitGroupBar(allGroups, chipWidths, innerWidth, remPx)
    this.visibleProductGroups = split.visible
    this.overflowProductGroups = split.overflow

    this.#cdr.detectChanges()
  }

  /** PRIVATE METHODS */
  private _searchForArticleName() {
    if (!this._numpadNumber) return
    const matches = this.#numpadProducts(this._numpadNumber)
    this._numpadValue = matches.length > 1 ? 'Nummer mehrfach vergeben' : (matches[0]?.name ?? '')
  }

  /**
   * Buchbare Treffer der Artikelnummer — dieselbe Sichtbarkeitsregel wie `#gridProducts`: Was mit
   * `ui.hideOnMainScreen` im Raster fehlt, bucht auch das Numpad nicht als eigenen Artikel (#709).
   * Mehr als ein Treffer heißt doppelt vergebene Nummer; der Aufrufer bucht dann nichts.
   */
  #numpadProducts(index: number): ProductSchema[] {
    return this.productService.findProductsByIndex(index).filter(product => !product.ui?.hideOnMainScreen)
  }

  /** PUBLIC METHODS */
  /**
   * Meldung an den Bediener. Die Farbe entscheidet nur noch, ob der Hinweis rot ist (`'red'`) oder als Echo einer
   * Gruppenwahl (Hex-Gruppenfarbe) stumm bleibt — die farbige Infozeile gibt es seit core#908 nicht mehr.
   */
  setInfoBoxText(value: string, backgroundColor: string | undefined = undefined) {
    this._infoBoxText = value
    this.#showNotice(value, backgroundColor)
  }

  #showNotice(text: string, backgroundColor: string | undefined): void {
    clearTimeout(this.#noticeTimer)
    // Gruppenfarben kommen als Hex; benannte Farben stehen für Meldungen, Rot für Fehler.
    const echoesContext =
      !text || IDLE_INFO_TEXTS.has(text) || backgroundColor?.startsWith('#') || text === this._functionBlockLabel
    if (echoesContext) {
      this.notice.set(null)
      return
    }
    const tone = backgroundColor === 'red' ? 'danger' : 'neutral'
    this.notice.set({ text, tone })
    this.#noticeTimer = setTimeout(
      () => {
        this.notice.set(null)
        this.#cdr.markForCheck()
      },
      tone === 'danger' ? NOTICE_DANGER_MS : NOTICE_MS,
    )
  }

  noActionDefined(subButton: PosButton): void {
    this.setInfoBoxText('Keine Aktion für die Taste "' + subButton.name + '" definiert!', 'red')
  }

  clearButtons(): void {
    // Jeder Ansichtswechsel läuft hier durch — damit schließt er auch das Panel,
    // ohne dass jede der rund zwanzig Ansichten es selbst wissen muss.
    this.customizeModel.set(null)
    this.#customizeLine = null
    this.#customizeCartSnapshot = null
    this.#customizeSplits = []
    this._functionButtons = []
    this._productButtons = []
    this._functionBlockLabel = ''
    this.corporateCustomers = []
    this.#customerRequest++
    this.activeProductGroupId.set(null)
    this.#closingStep = null
  }

  clearNumpad(_skipViewChange = false): void {
    this._numpadNumber = undefined
    this._numpadValue = ''
  }

  deleteOrder() {
    this.#invalidateUndo()
    this.#lineItems = []
    this.#orderOpenedAt = new Date()
    this.#orderInteractions = []
    this.selectedManualDiscount.set(null)
    this.appliedCodeDiscount.set(null)
    this.#redeemedForRetry = null
    this.lineDiscounts.set({})
  }

  unselectProduct() {
    if (this._isBlocked) return
    this.clearButtons()
    this._selectedProductIndex = null
    this._selectedCombinationIndex = [null, null]
    this.setInfoBoxText(IDLE_INFO_TEXT)
  }

  /**
   * Tipp auf eine Warenkorbzeile: wählt sie aus, der zweite Tipp hebt die Auswahl auf (core#829).
   * Darunter klappt die Steuerleiste auf; das Anpassen öffnet erst deren Taste. Bis dahin öffnete
   * der Tipp das Panel sofort und nahm das Raster weg, auch wenn nur die Menge zu ändern war.
   * Ist das Sheet offen, schließt der Tipp es (`#selectFromCart`, core#1086).
   */
  toggleProductSelection(index: number) {
    if (this._isBlocked) return

    this.#freshLine = null
    this.#selectFromCart({
      productIndex: this._selectedProductIndex === index ? null : index,
      combinationIndex: [null, null],
    })
  }

  /** Auswählen und sofort anpassen — dasselbe wie Tipp auf die Zeile plus „Anpassen" in der Steuerleiste. */
  selectProduct(index: number) {
    if (this._isBlocked) return

    this.#freshLine = null
    this._selectedCombinationIndex = [null, null]
    this._selectedProductIndex = this._selectedProductIndex != index ? index : null
    this.#customizeCurrentSelection()
  }

  selectCombinationByIndex(combinationIndex: number, articleIndex: number | null) {
    if (this._isBlocked) return

    // Wie eine freie Zeile: Der Tipp wählt nur aus, angepasst wird über die Steuerleiste (core#829).
    this.#selectFromCart(toggleCombinationSelection(this.boardSelection(), combinationIndex, articleIndex))
  }

  /**
   * Header-Tap: markiert die ganze Kombination; ist sie schon ganz markiert, hebt der Tap die
   * Markierung auf. Von einer markierten Position aus wechselt er auf die ganze Kombination (#795).
   * Lösen und Löschen sitzen seit core#829 in der Steuerleiste unter der Kombination, nicht mehr als
   * Funktionstasten über dem Raster — das Raster bleibt stehen, ein Kacheltap legt in die Kombination (#271).
   */
  toggleCombinationSelection(combinationIndex: number) {
    if (this._isBlocked) return

    const wholeSelected =
      this._selectedCombinationIndex[0] === combinationIndex && this._selectedCombinationIndex[1] === null
    this.#selectFromCart({
      productIndex: null,
      combinationIndex: wholeSelected ? [null, null] : [combinationIndex, null],
    })
    // Nach dem Index, den die Markierung jetzt trägt — das Schließen eines Sheets kann ihn verschoben haben.
    const selected = this._selectedCombinationIndex[0]
    if (!wholeSelected && selected !== null) this.setInfoBoxText(`Kombination ${selected + 1} ausgewählt`)
  }

  /** Stückzahl im Warenkorb für „Gesamt · n Artikel" — Zeilen samt Positionen in Kombinationen. */
  articleCount(): number {
    return this.#lineItems.reduce((sum, line) => sum + line.amount, 0)
  }

  /** Ist die ganze Kombination markiert (nicht nur eine Position)? Dann heißt „Anpassen" „Kombi lösen". */
  isWholeCombinationSelected(): boolean {
    return this._selectedCombinationIndex[0] !== null && this._selectedCombinationIndex[1] === null
  }

  /** Menge der markierten Zeile oder Position für die Steuerleiste — `null` bei einer ganzen Kombination. */
  selectionQuantity(): number | null {
    return this.getCurrentSelectedLineItem()?.amount ?? null
  }

  /** „Anpassen" in der Steuerleiste: Panel bzw. Extras für die markierte Zeile oder Position. */
  customizeSelection(): void {
    this.#customizeCurrentSelection()
  }

  /** „Kombi lösen" in der Steuerleiste: die markierte Kombination wird zu freien Zeilen. */
  resolveSelectedCombination(): void {
    if (this._isBlocked || !this.isWholeCombinationSelected()) return
    this.resolveCombination()
    this.unselectProduct()
  }

  increaseSelectedIndex() {
    if (this._isBlocked) return

    this.applyBoardSelection(
      nextBoardSelection(this.boardSelection(), {
        combinations: this.combinations.length,
        lineItems: this.#lineItems.length,
      }),
    )
  }

  decreaseSelectedIndex() {
    if (this._isBlocked) return

    this.applyBoardSelection(
      previousBoardSelection(this.boardSelection(), {
        combinations: this.combinations.length,
        lineItems: this.#lineItems.length,
      }),
    )
  }

  private boardSelection(): BoardSelection {
    return {
      productIndex: this._selectedProductIndex,
      combinationIndex: [this._selectedCombinationIndex[0], this._selectedCombinationIndex[1]],
    }
  }

  /**
   * Auswahl per Tipp in den Warenkorb (core#1086). Bei offenem Sheet endet die Anpassung wie mit „Fertig“:
   * Die Änderungen bleiben, gleiche Zeilen werden zusammengeführt, das Sheet schließt, und die getippte
   * Zeile ist markiert. Vorher zog das Sheet zur neuen Zeile mit (oder schloss, wenn sie nichts zum
   * Anpassen hatte) — auf der Sunmi war dann nicht zu erkennen, welches Produkt man gerade bearbeitete.
   * Die Pfeiltasten ziehen weiter mit (`#followSelectionInPanel`).
   */
  #selectFromCart(selection: BoardSelection): void {
    if (!this.#customizeLine) {
      this.applyBoardSelection(selection)
      return
    }
    this._selectedProductIndex = selection.productIndex
    this._selectedCombinationIndex = [selection.combinationIndex[0], selection.combinationIndex[1]]
    // Die Markierung hängt an der Zeile, nicht am Index: Das Zusammenführen kann Zeilen davor entfernen.
    const target = this.getCurrentSelectedLineItem()
    // Eine ganze Kombination merkt sich über ihre Zeilen: Das Zusammenführen kann Kombinationen davor
    // auflösen (`#resolveSingletonBundles`), dann zeigte der alte Index daneben. Was in ihr zusammenfällt,
    // geht in einer ihrer eigenen Zeilen auf — die Kombination nennt den Schlüssel der Zeile (`bundleNumber`).
    const combinationLines = this.isWholeCombinationSelected()
      ? [...(this.combinations[selection.combinationIndex[0] ?? -1] ?? [])]
      : []
    this.#freshLine = null
    const follow = this.#mergeLines(target)
    this.#closeCustomize()
    // `#closeCustomize` stellt das Raster der Gruppe wieder her und hebt dabei die Auswahl auf.
    if (follow) {
      this.#selectLine(follow)
    } else if (combinationLines.length > 0) {
      const combination = this.combinations.findIndex(bundle => bundle.some(line => combinationLines.includes(line)))
      if (combination !== -1) this._selectedCombinationIndex = [combination, null]
    }
  }

  private applyBoardSelection(selection: BoardSelection): void {
    this._selectedProductIndex = selection.productIndex
    this._selectedCombinationIndex = [selection.combinationIndex[0], selection.combinationIndex[1]]
    this.#followSelectionInPanel()
  }

  createProductButtons(productGroup: ProductGroup) {
    if (this._isBlocked) return

    this.clearButtons()
    this.activeProductGroupId.set(productGroup._id)
    this.setInfoBoxText(productGroup.name, productGroup.color)
    this._selectedProductIndex = null
    // VM-Kopien statt Store-Referenzen — der Dialog darf Cache-Objekte nicht mutieren
    this._productButtons = this.#gridProducts(productGroup._id, productGroup.externalId).map(product => {
      const button = toPosButton(product)
      button.callback = () => {
        this.increaseLineItem(button)
      }
      return button
    })
  }

  /**
   * Produkte einer Gruppe für das Raster — ohne die mit `ui.hideOnMainScreen` (#697). Das Feld
   * markiert Modifier, die nur innerhalb von Menüs und Optionsgruppen existieren; im Raster
   * standen sie neben den Gerichten. Optionsgruppen, Anpassen-Panel und „Alle Modifier" lesen
   * den Katalog direkt und zeigen sie weiter.
   */
  #gridProducts(groupId: string, groupExternalId?: string | null): ProductSchema[] {
    return this.productService
      .getProductsByGroupId(groupId, groupExternalId)
      .filter(product => !product.ui?.hideOnMainScreen)
  }

  setProductButtonsByGroupId(groupId: string | undefined) {
    if (!groupId) return this.unselectProduct()

    const group: ProductGroup | undefined = this.productGroupService.getProductGroupById(groupId)

    if (!group) return this.unselectProduct()

    this.createProductButtons(group)
    this.setInfoBoxText(group.name, group.color)
    this.clearButtons()
    // Rückweg ins Gruppenraster nach Modifier-, Menü- und Kombi-Abläufen: Das Raster zeigt wieder die Gruppe.
    this.activeProductGroupId.set(group._id)
    this._selectedProductIndex = null
    this._selectedCombinationIndex = [null, null]
    this._lastParentId = undefined
    // VM-Kopien statt Store-Referenzen — der Dialog darf Cache-Objekte nicht mutieren
    this._productButtons = this.#gridProducts(group._id, group.externalId).map(product => {
      const button = toPosButton(product)
      button.callback = () => {
        this.increaseLineItem(button)
      }
      return button
    })
  }

  setProductionTimeSubbuttons() {
    if (this._isBlocked) return
    this.clearButtons()
    if (this.lineItems.length === 0 && this.combinations.length === 0) {
      this.setInfoBoxText('Bitte fügen Sie zunächst mindestens ein Artikel der Bestellung hinzu!', 'red')
      return
    }
    // INNEN fragt nicht mehr nach einer Fertigungszeit (#343): Was am Tisch bleibt,
    // geht sofort raus. `estimatedDuration === 0` ist die abgestimmte Kodierung fuer
    // „sofort" — es gibt bewusst kein eigenes Feld dafuer.
    //
    // Die Abzweigung sitzt HIER und nicht in `selectDineLocation`, weil fuenf
    // Aufrufstellen in diese Methode muenden: `selectDineLocation` ohne Pager, beide
    // Ausgaenge der Tischwahl (`setTableSubbuttons`) und beide der Pagerwahl
    // (`setPagerSubbuttons`). Nur am gemeinsamen Endpunkt bleibt die Pager-/Tisch-
    // Kette vollstaendig erhalten — eine Abzweigung weiter vorn haette sie gekappt.
    //
    // Eine FEHLENDE Auswahl zaehlt mit: `placeOrder` bucht sie ohnehin als DINE_IN
    // (`dineLocation: !this._dineLocation ? DineLocation.DINE_IN : …`). Ohne diesen
    // Zweig zeigte der Dialog ein Minutenraster fuer eine Bestellung, die als INNEN
    // in der Datenbank landet.
    if (!this._dineLocation || this._dineLocation === DineLocation.DINE_IN) {
      this._productionTime = 0
      void this.placeOrder()
      return
    }

    this.setInfoBoxText('Wie lange beträgt die Produktions-ZEIT?')

    // SOFORT steht im Funktionsblock, NICHT als erste Kachel im Minutenraster.
    // Das Raster ist Touch-Bedienung unter Zeitdruck: Eine vorangestellte Kachel
    // wuerde jeden Minutenwert um eine Position verschieben, und der Griff nach
    // „15 min" landete auf „10 min". Im Funktionsblock sitzt SOFORT gut erreichbar
    // oben links, waehrend die Minutenkacheln exakt dort bleiben, wo sie waren.
    this._functionButtons.push({
      _id: 'productionTimeImmediate',
      externalId: this.#functionButtonExternalId,
      locationId: this.userService.currentUser()?.activeLocationId || '',
      tenantId: this.authService.tenantId()?.toString() || '',
      index: 0,
      name: 'Sofort',
      isFunctionButton: true,
      productionTime: 0,
      variant: 'confirm',
      iconName: 'lightning',
      callback: () => {
        this._productionTime = 0
        void this.placeOrder()
      },
    })
    this._functionBlockLabel = 'Fertigungszeit'
    this.#closingStep = 'time'

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
          void this.placeOrder()
        },
      })
    })
  }

  setTaxRateSubbuttons(): void {
    if (this._isBlocked) return

    this.clearButtons()

    // Fertigungszeit auf den Anfangswert zuruecksetzen. Heute kann hier nichts
    // stehenbleiben — jeder Dialogaufruf ist eine frische Instanz (`MatDialog.open`
    // ohne `data`), und `_productionTime` wird sonst nur im Minuten-Callback gesetzt.
    // Der Reset ist trotzdem gesetzt, weil dies der Einstieg in den Abschluss ist:
    // Sobald es einen Weg zurueck in diese Auswahl gibt, entscheidet genau diese
    // Zeile, ob eine verworfene Minutenwahl an der naechsten Bestellung klebt.
    this._productionTime = 0

    if (this.lineItems.length === 0 && this.combinations.length === 0) {
      this.setInfoBoxText('Bitte fügen Sie zunächst mindestens ein Artikel der Bestellung hinzu!', 'red')
      return
    }

    this.showDineLocationSelection = true
  }

  selectDineLocation(location: 'INSIDE' | 'OUTSIDE'): void {
    this.showDineLocationSelection = false
    this._dineLocation = location === 'INSIDE' ? DineLocation.DINE_IN : DineLocation.TAKE_OUT
    // Neue Kette, neue Wahl: Ein abgebrochener Versuch ließ Pager und Tisch sonst stehen — die Bestellung trug sie
    // still mit, und seit core#1069 zeigte sie auch der Schrittkopf.
    this._pager = undefined
    this._table = undefined

    if (this.locationService.showPagers) {
      this.setPagerSubbuttons()
    } else {
      this.setProductionTimeSubbuttons()
    }
  }

  openPreOrderDialog() {
    this.showDineLocationSelection = false

    const dialogRef = this.matDialog.open(PreOrderQuickDialogComponent, {
      width: '51.25rem',
      maxWidth: '95vw',
      // Border + Schatten gehören auf das ÄUSSERE Panel (nicht aufs innere Root-Div):
      // dessen `overflow-hidden` würde sonst die Border-/Schatten-Ecken des Kindes
      // wegschneiden. Auf dem Panel selbst werden Rand + Schatten voll gerendert.
      panelClass: ['!rounded-2xl', 'overflow-hidden', 'border', 'border-line', 'shadow-2xl'],
      // Backdrop weichzeichnen + abdunkeln (Light + Dark), damit sich die neue
      // Dialog-Ebene klar vom darunterliegenden Bestelldialog abhebt.
      backdropClass: 'pre-order-blur-backdrop',
    })

    dialogRef.afterClosed().subscribe(async (result: (PreOrderQuickResult & { date: Date }) | undefined) => {
      if (!result) return

      const payload = buildQuickPreOrderPayload(result, this.lineItems)

      try {
        await this.preOrderService.create(payload)
        // Erfolg: die GESAMTE Bestellung beenden (nicht nur den Vorbestell-Dialog).
        this.closed.emit('preorder-created')
      } catch (e) {
        // Fehler (z. B. außerhalb der Öffnungszeiten) INLINE im Bestelldialog
        // anzeigen — der BaseService-Toast oben rechts wird beim Fokus auf den
        // zentrierten Dialog leicht übersehen. Dialog bleibt bewusst OFFEN, damit
        // der Nutzer die Uhrzeit korrigieren kann (die lineItems bleiben erhalten).
        const msg = (e as { message?: string })?.message || 'Vorbestellung konnte nicht erstellt werden.'
        this.setInfoBoxText(msg, 'red')
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
    this._functionBlockLabel = 'Tisch auswählen'
    this.#closingStep = 'table'
    this._functionButtons.push({
      _id: 'noTables',
      externalId: this.#functionButtonExternalId,
      locationId: this.userService.currentUser()?.activeLocationId || '',
      tenantId: this.authService.tenantId()?.toString() || '',
      index: 1,
      name: 'KEIN TISCH',
      isFunctionButton: true,
      variant: 'skip',
      iconName: 'arrow-right',
      callback: () => {
        this._table = undefined
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
        iconName: 'table',
        kindLabel: 'Tisch',
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
    this._functionBlockLabel = 'Pager auswählen'
    this.#closingStep = 'pager'
    this._functionButtons.push({
      _id: 'noPagers',
      externalId: this.#functionButtonExternalId,
      locationId: this.userService.currentUser()?.activeLocationId || '',
      tenantId: this.authService.tenantId()?.toString() || '',
      index: 1,
      name: 'KEIN PAGER',
      isFunctionButton: true,
      variant: 'skip',
      iconName: 'arrow-right',
      callback: () => {
        this._pager = undefined
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
        iconName: 'device-mobile',
        kindLabel: 'Pager',
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
    // Bis #795 ein zweiter roter Mülleimer neben „Markierung löschen" — niemand wusste, welcher
    // was tut. „Kombination löschen" ist entfallen: Das erledigt der Mülleimer an der markierten
    // Kombination, und zwar mit Rückgängig.
    this.setInfoBoxText('Was möchten Sie tun?')
    this._functionBlockLabel = 'Weitere Aktionen'
    this._functionButtons.push({
      _id: this._deleteOrderId,
      externalId: this.#functionButtonExternalId,
      locationId: this.userService.currentUser()?.activeLocationId || '',
      tenantId: this.authService.tenantId()?.toString() || '',
      index: 3,
      name: this._deleteOrderName,
      isFunctionButton: true,
      variant: 'cancel',
      iconName: 'broom',
      callback: () => this.#confirmClearOrder(),
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
        variant: 'cancel',
        iconName: 'user-minus',
        callback: () => {
          this._customer = undefined
          this.clearButtons()
        },
      })
    }
  }

  /**
   * Merkt sich die Id des aktuell gewählten Artikels (Liste oder Kombination) als
   * Parent für Menü-Folgeschritte. Ohne Auswahl: Fehlermeldung + false.
   */
  private rememberSelectedParentId(): boolean {
    if (this._selectedProductIndex !== null) {
      this._lastParentId = this.#lineItems[this._selectedProductIndex]._id
      return true
    }
    if (this._selectedCombinationIndex[0] !== null && this._selectedCombinationIndex[1] !== null) {
      this._lastParentId = this.combinations[this._selectedCombinationIndex[0]][this._selectedCombinationIndex[1]]._id
      return true
    }
    this.setInfoBoxText('Bitte wählen Sie zunächst einen Artikel aus.', 'red')
    return false
  }

  private lastParentProduct(): ProductSchema | undefined {
    if (this._lastParentId === undefined) return undefined
    return this.productService.findProductById(this._lastParentId)
  }

  /**
   * Gemeinsames Gerüst der Menü-Slot-Schritte (Beilage/Soße/Getränk): Buttons
   * leeren, Parent-Artikel merken, Slot-Frage anzeigen, optional eine
   * Skip-Funktionstaste und pro Produkt-Id eine VM-Kopie mit Slot-Flags rendern.
   */
  private setMenuSlotButtons(
    ids: Array<UUID> | undefined,
    slot: {
      infoText: string
      blockLabel?: string
      flags: PosButtonUiState
      onSelect: (copy: PosProductButton) => void
      buildFunctionButtons?: (parentButton: ProductSchema | undefined) => PosButton[]
    },
  ): void {
    this.clearButtons()
    if (!this.rememberSelectedParentId()) return
    this.setInfoBoxText(slot.infoText)
    this._functionBlockLabel = slot.blockLabel ?? ''
    if (slot.buildFunctionButtons) {
      this._functionButtons.push(...slot.buildFunctionButtons(this.lastParentProduct()))
    }
    ids?.forEach((value: UUID): void => {
      const product: ProductSchema | undefined = this.productService.findProductByExternalId(value)
      if (!product) return
      const copy = toPosButton(product, slot.flags)
      copy.callback = () => slot.onSelect(copy)
      this._productButtons.push(copy)
    })
  }

  setMenuSideDishButtons(sideDishElements: Array<UUID> | undefined = undefined): void {
    this.setMenuSlotButtons(sideDishElements, {
      infoText: 'Welche Beilage möchten Sie hinzufügen?',
      blockLabel: 'Beilage auswählen',
      flags: { isMenuSideDish: true, isMenuSubButton: true },
      onSelect: copy => {
        const parentButton = this.lastParentProduct()
        if (copy.isMenuSideDish !== undefined && copy.isMenuSideDish) {
          this.setMenuSideDish(copy)
          if ((parentButton as any)?.isMenuSideDishSauce !== null && (parentButton as any)?.isMenuSideDishSauce) {
            this.setMenuSauceButtons((parentButton as any)?.sauces)
          }
        }
      },
    })
  }

  setMenuSauceButtons(ids: Array<UUID> | undefined = undefined) {
    this.setMenuSlotButtons(ids, {
      infoText: 'Welche Soße möchten Sie hinzufügen?',
      blockLabel: 'Soße auswählen',
      flags: { isMenuSideDishSauce: true, isExtra: false, isMenuSubButton: true },
      onSelect: copy => this.setMenuSideDishSauce(copy),
      buildFunctionButtons: parentButton => [
        {
          // ABBRUCH steigt hart aus dem Menü-Schritt aus; bereits gesetzte Slots bleiben,
          // der Warenkorb markiert das Menü als unvollständig (isMenuComplete).
          _id: 'cancelMenuSauce',
          externalId: this.#functionButtonExternalId,
          locationId: this.userService.currentUser()?.activeLocationId || '',
          tenantId: this.authService.tenantId()?.toString() || '',
          name: 'ABBRUCH',
          index: -2,
          isFunctionButton: true,
          isExtra: false,
          variant: 'cancel',
          iconName: 'x',
          callback: () => {
            this._isBlocked = false
            this.setProductButtonsByGroupId((parentButton as any)?.categoryIds?.[0])
          },
        },
        {
          _id: this._skipSauceId,
          externalId: this.#functionButtonExternalId,
          locationId: this.userService.currentUser()?.activeLocationId || '',
          tenantId: this.authService.tenantId()?.toString() || '',
          name: this._skipSauceName,
          index: -1,
          isFunctionButton: true,
          isExtra: false,
          variant: 'skip',
          iconName: 'arrow-right',
          callback: () => {
            if (
              parentButton &&
              (parentButton as any).itemType === ItemType.mainDish &&
              (parentButton as any).isMenuDrink
            ) {
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
        },
      ],
    })
  }

  setMenuDrinkButtons(ids: Array<UUID> | undefined = undefined) {
    this.setMenuSlotButtons(ids, {
      infoText: 'Welches Getränk möchten Sie hinzufügen?',
      blockLabel: 'Getränk auswählen',
      flags: { isMenuDrink: true, isMenuSubButton: true },
      onSelect: copy => {
        const parentButton = this.lastParentProduct()
        this.setMenuDrink(copy)
        this._isBlocked = false
        this.setProductButtonsByGroupId((parentButton as any)?.categoryIds?.[0])
      },
    })
  }

  /**
   * „Anpassen" für die markierte Zeile oder Position: immer das Sheet (#1085). Bis dahin nahm ein
   * Produkt ohne abwählbare Zutat und ohne Optionsgruppe ein altes Extras-Raster („Extras auswählen"
   * mit ABBRUCH und „Alle Modifier anzeigen") — dieselbe Taste zeigte je nach Produkt zwei Ansichten.
   */
  #customizeCurrentSelection(): void {
    if (this._isBlocked) return

    if (this.#lineItems.length === 0 && this.combinations.length === 0) {
      this.setInfoBoxText('Bitte wählen Sie zunächst einen Artikel aus.', 'red')
      return
    }
    if (this.isWholeCombinationSelected()) {
      this.setInfoBoxText('Extras können nur für normale Artikel hinzugefügt werde. Nicht für Kombinationen.', 'red')
      return
    }
    const line = this.getCurrentSelectedLineItem()
    if (!line) {
      this.setInfoBoxText('Bitte wählen Sie zunächst einen Artikel aus.', 'red')
      return
    }
    this.openCustomizePanel(line)
  }

  /** „Alle Modifier" im Sheet: alle Modifier des Katalogs ohne die für diese Zeile ausgeschlossenen. */
  #allModifiersFor(line: OrderLineItem): ProductSchema[] {
    return this.productService
      .extras()
      .filter(
        (product: ProductSchema) =>
          !(line.parentId && (product as any).excludedButtons?.includes(line.parentId)) &&
          !(line.externalId && (product as any).excludedSubButtons?.includes(line.externalId)),
      )
  }

  // ──────────────────────────────────────────────────────────────────────
  // Anpassen-Panel (#639)
  // ──────────────────────────────────────────────────────────────────────

  /** Katalogprodukt einer Zeile — `externalId` zuerst, `_id` nur für Bestandszeilen (siehe BundleFlow). */
  #productOfLine(line: OrderLineItem): ProductSchema | undefined {
    return (
      (line.externalId ? this.productService.findProductByExternalId(line.externalId) : undefined) ??
      this.productService.findProductById(line._id)
    )
  }

  /**
   * Die Auswahl hat gewechselt, während das Panel offen war (Kombinations-Position, Pfeile).
   * Das Panel zieht mit, statt die alte Zeile zu zeigen — sonst landeten Zutaten und Extras
   * auf zwei verschiedenen Zeilen. Ohne Auswahl schließt es.
   */
  #followSelectionInPanel(): void {
    if (!this.#customizeLine) return
    this.#freshLine = null
    const line = this.getCurrentSelectedLineItem()
    if (line === this.#customizeLine) return
    if (line) {
      this.openCustomizePanel(line)
    } else {
      this.clearButtons()
      this.setInfoBoxText(IDLE_INFO_TEXT)
    }
  }

  /**
   * Zeigt statt des Rasters das Panel für die Zeile; merkt sich den Warenkorb für „Abbrechen".
   * Eine vorherige Sitzung an einer anderen Zeile endet hier — ihre Zeilen werden zusammengeführt,
   * bevor die neue beginnt (#699, D3).
   */
  openCustomizePanel(line: OrderLineItem): void {
    const wasFresh = line === this.#freshLine
    const target = (this.#customizeLine && this.#customizeLine !== line ? this.#mergeLines(line) : line) ?? line
    this.clearButtons()
    // Das Ziffern-Popup bliebe sonst unter dem Sheet stehen und käme nach dem Schließen unerwartet wieder.
    this.showNumpadPopup = false
    this.#customizeLine = target
    this.#customizeCartSnapshot = this.#snapshotCart()
    this.#customizeSplits = []
    // Frisch ist nur, was nicht in einer vorhandenen Zeile aufgegangen ist — sonst träfe
    // „alle" auch die schon vorher bestellten Stücke.
    const fresh = wasFresh && target === line
    this.customizeScope.set(fresh || target.amount <= 1 ? 'all' : 'one')
    this.customizeScopeLocked.set(false)
    this.customizeShowAll.set(false)
    // Kein Hinweis „… anpassen": Der Sheet-Kopf nennt das Produkt, ein Hinweis darüber verdeckte die Fußleiste (core#909).
    this.#refreshCustomize()
  }

  /** Umschalter „1 Stück | alle n" im Panel — nur vor der ersten Änderung (#699, D2). */
  onCustomizeScopeChanged(scope: CustomizeScope): void {
    if (this.customizeScopeLocked()) return
    this.customizeScope.set(scope)
    this.#refreshCustomize()
  }

  /**
   * Die Zeile, auf die eine Bedienung im Panel wirkt. Gilt die Anpassung für ein Stück einer
   * Zeile mit mehreren, wird es beim ersten Griff abgespalten (#699): Danach trägt das Panel
   * das neue Stück, weitere Griffe ändern nur noch dieses.
   */
  #customizeTarget(): OrderLineItem | null {
    const line = this.#customizeLine
    if (!line) return null
    this.customizeScopeLocked.set(true)
    if (this.customizeScope() !== 'one' || line.amount <= 1) return line
    const piece = this.#splitOffOnePiece(line)
    if (!piece) return line
    this.#customizeSplits.push({ origin: line, piece })
    this.#customizeLine = piece
    return piece
  }

  /**
   * Spaltet ein Stück von der Zeile ab, fügt es direkt dahinter ein und markiert es. Ein
   * Prozent-Positionsrabatt geht mit, ein Festbetrag bleibt an der Restzeile (D5) — er gilt
   * je Zeile, und zweimal abgezogen wäre er falsch.
   */
  #splitOffOnePiece(line: OrderLineItem): OrderLineItem | null {
    const piece = this.#splitOff(line, 1)
    if (piece) this.#selectLine(piece)
    return piece
  }

  /** Spaltet `count` Stück ab und fügt sie direkt hinter der Zeile ein; Rabattregel wie oben (D5). */
  #splitOff(line: OrderLineItem, count: number): OrderLineItem | null {
    if (!isSplittableLine(line)) return null
    const piece = splitOffPieces(line, count, uuidv7())
    if (!piece) return null
    // Ein offenes „Rückgängig" der Menge bezöge sich auf die Zeile vor dem Split (#699).
    this.#invalidateUndo()
    this.#lineItems.splice(this.#lineItems.indexOf(line) + 1, 0, piece)
    const discount = this.lineDiscounts()[line._id]
    if (discount?.valueType === 'percent') {
      this.lineDiscounts.update(current => ({ ...current, [piece._id]: discount }))
    } else if (discount) {
      this.setInfoBoxText(`Positionsrabatt „${discount.name}" bleibt an der Restzeile`)
    }
    return piece
  }

  /** Die markierte Position einer Kombination — `null` bei freier Zeile, ganzer Kombination oder ohne Markierung. */
  #selectedCombinationPosition(): OrderLineItem | null {
    const [combination, article] = this._selectedCombinationIndex
    if (combination === null || article === null) return null
    return this.combinations[combination]?.[article] ?? null
  }

  /** Wie viele Stück „Herauslösen" nimmt: der Multiplikator, höchstens die Stückzahl der Position (#795). */
  #releaseCount(line: OrderLineItem): number {
    return Math.min(Math.max(this.multiplier, 1), line.amount)
  }

  /** Beschriftung der Taste „Herauslösen" mit der Zahl, die sie nimmt — `null`, wenn es nichts zu lösen gibt. */
  releaseLabel(): string | null {
    const line = this.#selectedCombinationPosition()
    return line ? `${this.#releaseCount(line)} herauslösen` : null
  }

  /**
   * Löst Stück der markierten Position aus ihrer Kombination (#795): so viele, wie der
   * Multiplikator zeigt, sonst eins. Das gelöste Stück wird eine freie Zeile und geht in einer
   * gleichen freien Zeile auf; bleibt nur eine Position übrig, löst sich die Kombination auf.
   */
  releaseFromCombination(): void {
    if (this._isBlocked) return
    const line = this.#selectedCombinationPosition()
    if (!line) return
    const count = this.#releaseCount(line)
    const freed = count < line.amount ? this.#splitOff(line, count) : line
    if (!freed) {
      this.setInfoBoxText('Diese Position lässt sich nicht teilen. Nur als Ganzes herauslösen.', 'red')
      return
    }
    this.unselectProduct()
    freed.bundleNumber = null
    this.#invalidateUndo()
    this.#resolveSingletonBundles()
    this.#mergeLines()
    this.numpadReset()
    this.setInfoBoxText(`${count}× ${line.name} aus der Kombination gelöst`)
  }

  /**
   * Führt gleiche Konfigurationen zusammen (#699, D3) und gibt zurück, wo `follow` danach
   * steht — die Zeile selbst oder die, in der sie aufgegangen ist. Die Markierung folgt
   * derselben Zeile, statt an einem Index stehen zu bleiben, der jetzt woanders hinzeigt.
   */
  #mergeLines(follow: OrderLineItem | null = null): OrderLineItem | null {
    const selected = this.getCurrentSelectedLineItem()
    const { lines, mergedInto } = mergeIdenticalLines(this.#lineItems, line => this.#discountKey(line))
    if (mergedInto.size > 0) {
      this.#invalidateUndo()
      this.#lineItems = lines
      this.#pruneOrphanedLineDiscounts()
      this.#resolveSingletonBundles()
      if (this.#freshLine) this.#freshLine = mergedInto.get(this.#freshLine) ?? this.#freshLine
      if (selected) this.#selectLine(mergedInto.get(selected) ?? selected)
    }
    return follow ? (mergedInto.get(follow) ?? follow) : null
  }

  /** Rabatt-Anteil der Zeilenidentität: nur gleiche Prozent-Rabatte führen zusammen (D5). */
  #discountKey(line: OrderLineItem): string {
    const discount = this.lineDiscounts()[line._id]
    if (!discount) return ''
    return discount.valueType === 'percent' ? `p:${discount._id}:${discount.valuePercent}` : `f:${line._id}`
  }

  /** Markiert genau diese Zeile — als Position einer Kombination oder als freie Zeile. */
  #selectLine(line: OrderLineItem): void {
    if (line.bundleNumber !== null && line.bundleNumber !== undefined) {
      const combination = this.combinations.findIndex(bundle => bundle.includes(line))
      if (combination !== -1) {
        this._selectedProductIndex = null
        this._selectedCombinationIndex = [combination, this.combinations[combination].indexOf(line)]
        return
      }
    }
    const index = this.#lineItems.indexOf(line)
    this._selectedCombinationIndex = [null, null]
    this._selectedProductIndex = index === -1 ? null : index
  }

  #snapshotCart(): CartSnapshot {
    return {
      states: this.#lineItems.map(item => ({
        item,
        modifiers: item.modifiers.map(mod => ({ ...mod })),
        modifierScope: item.modifierScope,
      })),
      selection: this.boardSelection(),
    }
  }

  /**
   * Nimmt genau die Wirkung des Panels zurück: abgespaltene Stücke gehen an ihre Herkunft zurück,
   * Modifier und Zählweise der Zeilen vom Öffnen werden wiederhergestellt. Was währenddessen von
   * außen geschah — ein per Numpad hinzugefügtes Produkt, eine Menge aus Spalte 2 — bleibt.
   */
  #restoreCart(snapshot: CartSnapshot): void {
    for (const { origin, piece } of [...this.#customizeSplits].reverse()) {
      if (!this.#lineItems.includes(piece)) continue
      this.#lineItems = this.#lineItems.filter(item => item !== piece)
      if (this.#lineItems.includes(origin)) origin.amount += piece.amount
      this.lineDiscounts.update(current => {
        const { [piece._id]: _removed, ...rest } = current
        return rest
      })
    }
    for (const state of snapshot.states) {
      if (!this.#lineItems.includes(state.item)) continue
      state.item.modifiers = state.modifiers
      state.item.modifierScope = state.modifierScope
    }
    this.applyBoardSelection(snapshot.selection)
  }

  /**
   * Neues Modell für die angepasste Zeile — nach jeder Bedienung im Panel und nach jeder
   * Änderung von außen (Menge in Spalte 2, Undo, Löschen). Gibt es die Zeile nicht mehr,
   * schließt das Panel.
   */
  #refreshCustomize(): void {
    const line = this.#customizeLine
    if (!line) return
    if (!this.#lineItems.includes(line)) {
      this.#closeCustomize()
      return
    }
    const product = this.#productOfLine(line)
    // Die Optionsgruppen eines Menüs sind Menüschritte (BundleFlow), keine Extras.
    const extrasSource = product && this.#bundleFlow.isBundleProduct(product) ? undefined : product
    this.customizeModel.set(
      buildCustomizeModel(
        line,
        extrasSource,
        {
          findProductById: id => this.productService.findProductById(id),
          isModifier: candidate => isModifierButton(candidate),
        },
        this.customizeShowAll() ? this.#allModifiersFor(line) : undefined,
        this._extraTopic,
      ),
    )
    this.#cdr.markForCheck()
  }

  onCustomizeIngredientToggled(ingredientExternalId: string): void {
    const ingredient = this.#customizeLine?.ingredientReferences.find(
      ing => ing.externalId === ingredientExternalId && ing.isRemovable,
    )
    if (!ingredient) return
    const line = this.#customizeTarget()
    if (!line) return
    toggleIngredientRemoval(line, ingredient, this._extraTopic)
    this.#refreshCustomize()
  }

  onCustomizeOptionIncreased(event: CustomizeOptionEvent): void {
    const product = this.productService.findProductById(event.productId)
    const group = this.customizeModel()?.groups.find(g => g.id === event.groupId)
    if (!this.#customizeLine || !product || !group || group.full) return
    const line = this.#customizeTarget()
    if (!line) return
    this.increaseExtra(toPosButton(product), extraTopicOf(event), line)
    this.#refreshCustomize()
  }

  onCustomizeOptionDecreased(event: CustomizeOptionEvent): void {
    const product = this.productService.findProductById(event.productId)
    const booked = this.customizeModel()
      ?.groups.find(g => g.id === event.groupId)
      ?.options.find(option => option.productId === event.productId)?.amount
    // Minus auf ein ungebuchtes Extra ändert nichts — dann auch nichts abspalten.
    if (!this.#customizeLine || !product || !booked) return
    const line = this.#customizeTarget()
    if (!line) return
    this.decreaseExtra(toPosButton(product), extraTopicOf(event), line)
    this.#refreshCustomize()
  }

  onCustomizeFinished(): void {
    if (!this.customizeModel()?.canFinish) return
    this.#freshLine = null
    this.#mergeLines()
    this.#closeCustomize()
  }

  /** Stellt den Warenkorb beim Öffnen wieder her — auch eine abgespaltene Zeile verschwindet (#699). */
  onCustomizeCancelled(): void {
    const snapshot = this.#customizeCartSnapshot
    if (snapshot) this.#restoreCart(snapshot)
    this.#closeCustomize()
  }

  /** „Alle Modifier" im Sheet ein- und ausblenden — für Extras außerhalb der Optionsgruppen des Produkts. */
  onCustomizeShowAllModifiers(): void {
    if (!this.#customizeLine) return
    this.customizeShowAll.update(shown => !shown)
    this.#refreshCustomize()
  }

  /** Zurück zum Raster der Produktgruppe, aus der die Zeile stammt — wie ABBRUCH im Extras-Raster. */
  #closeCustomize(): void {
    const groupId = this.#customizeLine?.parentId
    this.clearButtons()
    this.setProductButtonsByGroupId(groupId)
  }

  /** Abgewählte Zutat („Ohne X") — der Warenkorb zeigt sie als „ohne", nicht als „1x Ohne X". */
  isRemovedIngredient(extra: { name: string; amount: number }): boolean {
    return extra.amount > 0 && extra.name.startsWith(REMOVED_INGREDIENT_PREFIX)
  }

  removedIngredientName(extra: { name: string }): string {
    return extra.name.slice(REMOVED_INGREDIENT_PREFIX.length)
  }

  /**
   * Betrag eines Modifiers im Warenkorb — dieselbe Zahl wie Engine und Bon (#698): Gilt
   * der Modifier je Stück (`modifierScope: 'unit'`), ist es der Aufpreis für alle Stück.
   */
  modifierAmount(line: OrderLineItem, extra: OrderLineItem['modifiers'][number]): number {
    return calculateModifierPrice(line, extra)
  }

  /**
   * Menge eines Modifiers, wie sie abgerechnet wird. Je Stück gebucht („alle 3", #698) gilt er
   * für jedes Stück der Zeile — „1x Ketchup +2,10 €" bei 3 Stück las sich wie ein Rechenfehler (#795).
   * Dieselbe Entscheidung wie der Bon („je 1x"), damit Anzeige und Beleg nicht auseinanderlaufen.
   */
  modifierDisplayAmount(line: OrderLineItem, extra: OrderLineItem['modifiers'][number]): number {
    return modifiersCountPerUnit(line) ? extra.amount * line.amount : extra.amount
  }

  /** Aufpreis-Ausweis einer Menü-Komponente — beim Festpreis-Menü 0 wie auf dem Bon (core#781). */
  menuSurcharge(line: OrderLineItem, component: OrderLineItem['menuDrink'], generalPrice: number): number {
    return menuComponentSurcharge(line, component, generalPrice)
  }

  setSauceSubButtons(ids: Array<string> | undefined = undefined, isInclusive = false, currentIndex = 0) {
    this.clearButtons()

    if (!this.rememberSelectedParentId()) return

    if (isInclusive) {
      this.setInfoBoxText('INKLUSIV: Welche Soße möchten Sie hinzufügen?')
    } else {
      this.setInfoBoxText('Welche Soße möchten Sie hinzufügen?')
    }
    this._functionBlockLabel = 'Soße auswählen'

    const parentButton: ProductSchema | undefined = this.lastParentProduct()
    // ABBRUCH steigt hart aus der Schrittkette aus (keine Folge-Schritte),
    // ohne den bereits erfassten Artikel zu entfernen — konsistent zum Extras-ABBRUCH.
    this.functionButtons.push({
      _id: 'cancelSauce',
      externalId: this.#functionButtonExternalId,
      locationId: this.userService.currentUser()?.activeLocationId || '',
      tenantId: this.authService.tenantId()?.toString() || '',
      name: 'ABBRUCH',
      index: -2,
      isFunctionButton: true,
      isExtra: false,
      variant: 'cancel',
      iconName: 'x',
      callback: () => {
        this._isBlocked = false
        this.setProductButtonsByGroupId((parentButton as any)?.categoryIds?.[0])
      },
    })
    this.functionButtons.push({
      _id: this._skipSauceId,
      externalId: this.#functionButtonExternalId,
      locationId: this.userService.currentUser()?.activeLocationId || '',
      tenantId: this.authService.tenantId()?.toString() || '',
      name: this._skipSauceName,
      index: -1,
      isFunctionButton: true,
      isExtra: false,
      variant: 'skip',
      iconName: 'arrow-right',
      callback: () => {
        if (this._isBlocked) {
          if (parentButton && (parentButton as any).isMenu !== undefined && (parentButton as any).isMenu) {
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
          const copy = toPosButton(sauce)

          copy.price = isInclusive ? 0 : copy.price
          copy.callback = () => {
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

    const byExternId: ProductGroup | undefined = this.productGroupService.getProductGroupByExternId(
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
      variant: 'skip',
      iconName: 'arrow-right',
      callback: () => {
        if (this._isBlocked) return
        this._articlesToCombine = new Map()
        this.setProductButtonsByGroupId((product as any)?.categoryIds?.[0])
      },
    })
    this._functionBlockLabel = byExternId.name
    this.setInfoBoxText(byExternId.name)
    // VM-Kopien statt Store-Referenzen — der Dialog darf Cache-Objekte nicht mutieren
    this._productButtons = this.#gridProducts(byExternId._id, byExternId.externalId).map(successor => {
      const button = toPosButton(successor)
      button.callback = () => {
        this.increaseLineItem(button)
      }
      return button
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
    this._functionBlockLabel = 'Kombination'
    this._functionButtons.push({
      _id: this._combineId,
      externalId: this.#functionButtonExternalId,
      locationId: this.userService.currentUser()?.activeLocationId || '',
      tenantId: this.authService.tenantId()?.toString() || '',
      name: this._combineName,
      index: -3,
      isFunctionButton: true,
      variant: 'confirm',
      iconName: 'arrows-merge',
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
      variant: 'confirm',
      iconName: 'checks',
      callback: () => {
        this.combineAllArticles()
      },
    })
    // „Kombination auflösen" sitzt seit #795 an der markierten Kombination (Header-Tap), nicht mehr hier.
    this.#lineItems.forEach((article, index) => {
      if (this.isLineItemBundled(article)) return
      const subButton: PosButton = {
        _id: 'combiButton' + index.toString(),
        externalId: this.#functionButtonExternalId,
        locationId: this.userService.currentUser()?.activeLocationId || '',
        tenantId: this.authService.tenantId()?.toString() || '',
        acronym: '#',
        name: article.name,
        productGroupExternalId: this._combiTopic,
        index: index + 1,
      }
      // Jeder Tipp ein Stück mehr, nach dem letzten aus (#795) — sonst wanderten aus „3× Schnitzel"
      // immer alle drei in die Kombination.
      subButton.callback = () => {
        const next = (this._articlesToCombine.get(index) ?? 0) + 1
        if (next > article.amount) {
          this._articlesToCombine.delete(index)
          subButton.pressed = false
          subButton.countLabel = undefined
          return
        }
        this._articlesToCombine.set(index, next)
        subButton.pressed = true
        // Eigenes Abzeichen statt Namenszusatz — lange Namen füllen die Kachel schon, die Zahl fiele weg.
        subButton.countLabel = article.amount > 1 ? `${next}/${article.amount}` : undefined
      }
      this._productButtons.push(subButton)
    })
  }

  setMenuSideDish(article: PosProductButton) {
    if (
      (article.isMenuSideDish !== undefined && !article.isMenuSideDish) ||
      (this._selectedProductIndex === null &&
        this._selectedCombinationIndex[0] === null &&
        this._selectedCombinationIndex[1] === null)
    ) {
      return
    }
    let selectedItem: OrderLineItem
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
      topic: this.productGroupService.getProductGroupById(article.productGroupExternalId || '')?.name || '',
    }
  }

  setMenuSideDishSauce(subButtonItem: PosProductButton) {
    if (
      !subButtonItem.isMenuSideDishSauce ||
      (this._selectedProductIndex === null &&
        this._selectedCombinationIndex[0] === null &&
        this._selectedCombinationIndex[1] === null)
    ) {
      return
    }
    this.increaseExtra(subButtonItem)
  }

  setMenuDrink(article: PosProductButton) {
    if (
      !article.isMenuDrink ||
      (this._selectedProductIndex === null &&
        this._selectedCombinationIndex[0] === null &&
        this._selectedCombinationIndex[1] === null)
    ) {
      return
    }

    let selectedItem: OrderLineItem
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
      topic: this.productGroupService.getProductGroupById(article.productGroupExternalId || '')?.name || '',
    }
  }

  increaseQuantity(orderLineItem: OrderLineItem, by = 1): void {
    orderLineItem.amount += by
    this.#refreshCustomize()
  }

  /**
   * Verringert **nur noch**. Bis #269 löschte die Methode bei Menge 1 die Zeile —
   * Löschen und Verringern teilten sich damit ein 28-px-Ziel in der Auswahlfläche.
   * Löschen läuft jetzt ausschließlich über `deleteSelection()` (ADR 0034); bei
   * Menge 1 ist Minus in der Leiste deaktiviert, hier bleibt es ein No-Op.
   */
  decreaseQuantity(orderLineItem: OrderLineItem): void {
    if (orderLineItem.amount > 1) orderLineItem.amount--
    this.#refreshCustomize()
  }

  /**
   * Die Zeilen, auf die Löschen/−/+ in Spalte 2 wirken: die markierte Zeile, die
   * markierte Position einer Kombination — oder alle Positionen der Kombination,
   * wenn ihr Header markiert ist. Leer ohne Markierung.
   */
  private selectedTargets(): OrderLineItem[] {
    const [combination, article] = this._selectedCombinationIndex
    if (combination !== null) {
      const bundle = this.combinations[combination] ?? []
      if (article === null) return bundle
      const item = bundle[article]
      return item ? [item] : []
    }
    if (this._selectedProductIndex !== null) {
      const item = this.#lineItems[this._selectedProductIndex]
      return item ? [item] : []
    }
    return []
  }

  /** Ist eine Markierung da, auf die Löschen und + wirken können? Steuert `[disabled]`. */
  canMutateSelection(): boolean {
    return !this._isBlocked && this.selectedTargets().length > 0
  }

  /**
   * Minus nur, wenn **jede** Zielzeile über 1 steht — sonst müsste es eine davon
   * löschen, und genau diese Doppelwirkung ist mit #269 abgeschafft. Bei einer
   * Kombination mit gemischten Mengen bleibt die Position einzeln markierbar.
   */
  canDecreaseSelection(): boolean {
    const targets = this.selectedTargets()
    return !this._isBlocked && targets.length > 0 && targets.every(item => item.amount > 1)
  }

  increaseSelectedQuantity(): void {
    const targets = this.selectedTargets()
    if (this._isBlocked || targets.length === 0) return

    const before = targets.map(item => ({ item, amount: item.amount }))
    for (const item of targets) this.increaseQuantity(item)
    this.#offerUndo(this.#quantityMessage(targets), () => this.#restoreAmounts(before))
  }

  decreaseSelectedQuantity(): void {
    const targets = this.selectedTargets()
    if (this._isBlocked || targets.length === 0 || !targets.every(item => item.amount > 1)) return

    const before = targets.map(item => ({ item, amount: item.amount }))
    for (const item of targets) this.decreaseQuantity(item)
    this.#offerUndo(this.#quantityMessage(targets), () => this.#restoreAmounts(before))
  }

  /**
   * Löscht die Markierung: eine Zeile, eine Position der Kombination oder die
   * ganze Kombination. Der Lösch-Pfad (Interaction-Event, Rabatt-Aufräumen,
   * Auflösen einer auf eine Position geschrumpften Kombination) liegt in
   * `#removeLineItems`; das Undo nimmt genau diese drei Wirkungen zurück.
   */
  deleteSelection(): void {
    const targets = this.selectedTargets()
    if (this._isBlocked || targets.length === 0) return

    const wholeCombination = this._selectedCombinationIndex[0] !== null && this._selectedCombinationIndex[1] === null
    const restore = this.#removeLineItems(targets)
    this._selectedProductIndex = null
    this._selectedCombinationIndex = [null, null]
    this.#refreshCustomize()

    const message = wholeCombination ? 'Kombination gelöscht' : `Gelöscht: ${targets[0].amount}× ${targets[0].name}`
    this.#offerUndo(message, restore)
  }

  #quantityMessage(targets: OrderLineItem[]): string {
    if (targets.length === 1) return `Menge: ${targets[0].amount}× ${targets[0].name}`
    return `Kombination: Menge ${targets.map(item => `${item.amount}× ${item.name}`).join(', ')}`
  }

  #restoreAmounts(before: Array<{ item: OrderLineItem; amount: number }>): void {
    for (const { item, amount } of before) {
      // Nur Zeilen, die es noch gibt — eine inzwischen gelöschte bleibt gelöscht.
      if (this.#lineItems.includes(item)) item.amount = amount
    }
    this.#refreshCustomize()
  }

  /**
   * Entfernt Zeilen aus dem Warenkorb und gibt die Umkehrung zurück.
   *
   * Drei Wirkungen, alle im Undo abgedeckt:
   * 1. `item-delete`-Interaction je Zeile — das Undo nimmt genau diese Objekte
   *    wieder heraus, sonst zählte die Auswertung ein Storno, das nie stattfand.
   * 2. Verwaiste Positionsrabatte werden geprunt — das Undo legt die Einträge der
   *    entfernten Zeilen zurück, sonst käme die Zeile ohne ihren Rabatt wieder
   *    (Geldfrage, cent-genau verifiziert in #182).
   * 3. Eine Kombination, die auf eine Position schrumpft, wird aufgelöst — das
   *    Undo stellt die `bundleNumber` der Nachbarzeile wieder her.
   *
   * Entfernt wird über die Objektidentität in `#lineItems`. Der frühere Weg über
   * `this.combinations[i].splice(j, 1)` griff ins Leere: `getCombinations` baut
   * die Gruppen bei jedem Aufruf neu, der Splice traf eine Wegwerf-Kopie.
   */
  #removeLineItems(items: readonly OrderLineItem[]): () => void {
    const removed = items
      .map(item => ({ item, index: this.#lineItems.indexOf(item) }))
      .filter(entry => entry.index >= 0)
      .sort((a, b) => a.index - b.index)
    if (removed.length === 0) return () => undefined

    const discountsBefore = this.lineDiscounts()
    const bundleNumbersBefore = this.#lineItems.map(item => ({ item, bundleNumber: item.bundleNumber }))

    const interactions: OrderInteraction[] = removed.map(
      ({ item }) =>
        ({
          type: 'item-delete',
          orderOpenedAt: this.#orderOpenedAt.toISOString(),
          eventAt: new Date().toISOString(),
          eventOffsetMs: new Date().getTime() - this.#orderOpenedAt.getTime(),
          productId: item.externalId || undefined,
          lineItemId: this.#lineItems.indexOf(item),
          deletedQuantity: item.amount,
          businessDayId: this.locationService.currentBusinessDay?.businessDayId?.toString(),
          businessDate: this.locationService.currentBusinessDay?.date,
          userId: this._currentUser?._id?.toString() || '',
        }) as unknown as OrderInteraction,
    )
    this.#orderInteractions.push(...interactions)

    const removedSet = new Set(removed.map(entry => entry.item))
    this.#lineItems = this.#lineItems.filter(item => !removedSet.has(item))
    this.#pruneOrphanedLineDiscounts()
    this.#resolveSingletonBundles()

    return () => {
      for (const { item, index } of removed) {
        this.#lineItems.splice(Math.min(index, this.#lineItems.length), 0, item)
      }
      for (const { item, bundleNumber } of bundleNumbersBefore) item.bundleNumber = bundleNumber
      this.lineDiscounts.update(current => {
        const restored = { ...current }
        for (const { item } of removed) {
          if (discountsBefore[item._id]) restored[item._id] = discountsBefore[item._id]
        }
        return restored
      })
      const undone = new Set(interactions)
      this.#orderInteractions = this.#orderInteractions.filter(event => !undone.has(event))
    }
  }

  /** Löst Kombinationen auf, die nur noch eine Position haben — eine Kombination aus einem Artikel ist keine. */
  #resolveSingletonBundles(): void {
    for (const bundle of this.combinations) {
      if (bundle.length === 1) bundle[0].bundleNumber = null
    }
  }

  /**
   * Bietet „Rückgängig" für die letzte Mengenänderung bzw. das letzte Löschen an.
   *
   * Meldung statt Infobox: Die Infobox überschreibt jeder nächste Schritt
   * (siehe `placeOrder`, #234). Mit `duration`, anders als die Rabattcode-Meldung
   * dort — das ist keine Fehlermeldung, die quittiert werden muss, sondern ein
   * Angebot, das nach kurzer Zeit verfallen darf.
   */
  #offerUndo(message: string, restore: () => void): void {
    const serial = ++this.#undoSerial
    // Höchstens ein Angebot: Ein älteres „Rückgängig" griffe ohnehin nicht mehr (Serial).
    this.#undoRef?.dismiss()
    this.#undoRef = this.#notifications.info(message, {
      action: {
        label: 'Rückgängig',
        run: () => {
          if (serial !== this.#undoSerial) return
          this.#undoSerial++
          restore()
          // Kommt von außerhalb des Templates (Meldungsebene) — OnPush erfährt sonst nichts davon.
          this.#cdr.markForCheck()
        },
      },
    })
  }

  /**
   * Lässt ein offenes „Rückgängig" verfallen — die Bestellung ist weg oder abgeschickt.
   *
   * Schließt nur die eigene Undo-Meldung, nie „die gerade offene": `placeOrder` meldet
   * einen gescheiterten Rabattcode unmittelbar vor `deleteOrder()`, und ein
   * globales Schließen hier schloss genau diese Meldung wieder (core#531).
   */
  #invalidateUndo(): void {
    this.#undoSerial++
    this.#undoRef?.dismiss()
    this.#undoRef = null
  }

  increaseExtra(article: PosProductButton, topic: string | undefined = undefined, target?: OrderLineItem) {
    // Beide Rückwege melden seit #273, statt still zu enden: Ein Tap auf eine
    // Kachel, der nichts tut und nichts sagt, liest sich in der Filiale als
    // „die Kasse hängt" (dieselbe Regel wie ADR 0034, vgl. #269/#271).
    if (!isModifierButton(article)) {
      this.setInfoBoxText(extraNotModifierMessage(article), 'red')
      return
    }

    // `target`: das Panel bucht auf seine Zeile, nicht auf die Auswahl (#639).
    let selectedArticle: OrderLineItem
    if (target) {
      selectedArticle = target
    } else if (this._selectedProductIndex !== null) {
      selectedArticle = this.#lineItems[this._selectedProductIndex]
    } else if (this._selectedCombinationIndex[0] !== null && this._selectedCombinationIndex[1] !== null) {
      selectedArticle = this.combinations[this._selectedCombinationIndex[0]][this._selectedCombinationIndex[1]]
    } else {
      // Das Extras-Raster kann noch stehen, obwohl die Markierung abgeräumt wurde.
      this.setInfoBoxText(LINE_DISCOUNT_BLOCKED_NO_SELECTION, 'red')
      return
    }
    const extraTopic = topic !== undefined ? topic : this._extraTopic
    // Nur Modifier des Hauptartikels: Die Mayo der Pommes (#1127) ist eine andere als die des Burgers.
    const extraIndex = selectedArticle.modifiers.findIndex(extra => {
      return extra._id === article._id && extra.price === article.price && !extra.componentExternalId
    })
    if (extraIndex !== -1 && selectedArticle.modifiers[extraIndex].price === article.price) {
      if (selectedArticle.modifiers[extraIndex].amount < 0) {
        selectedArticle.modifiers[extraIndex].amount = 1
      } else {
        selectedArticle.modifiers[extraIndex].amount += 1
      }
    } else {
      const group = this.#bundleFlow.findOptionGroupByTopic(selectedArticle, extraTopic)
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
        // pricingMode der Herkunftsgruppe (falls HIGHEST) auf das Item stempeln.
        ...(group?.pricingMode === 'HIGHEST' ? { pricingMode: 'HIGHEST' as const } : {}),
      })
      if (group?.pricingMode === 'HIGHEST') {
        this.#bundleFlow.applyHighestPricingToGroup(selectedArticle, extraTopic, group.freeQuantity || 0)
      }
    }
  }

  /**
   * Nimmt ein gebuchtes Extra um eins zurück. Ist es nicht gebucht, passiert nichts —
   * den Marker „OHNE <Extra>" (`amount −1`) legt der Dialog seit #639 nicht mehr an.
   * Bestandsbestellungen tragen ihn weiter, Schema und Bon lesen ihn deshalb noch.
   */
  decreaseExtra(article: PosProductButton, topic: string | undefined = undefined, target?: OrderLineItem) {
    // Seit #273 dieselbe Erkennung wie im PLUS-Modus und dieselbe Meldung statt des stillen Rückwegs.
    if (!isModifierButton(article)) {
      this.setInfoBoxText(extraNotModifierMessage(article), 'red')
      return
    }

    // `target`: das Panel bucht auf seine Zeile, nicht auf die Auswahl (#639).
    let selectedArticle: OrderLineItem
    if (target) {
      selectedArticle = target
    } else if (this._selectedProductIndex !== null) {
      selectedArticle = this.#lineItems[this._selectedProductIndex]
    } else if (this._selectedCombinationIndex[0] !== null && this._selectedCombinationIndex[1] !== null) {
      selectedArticle = this.combinations[this._selectedCombinationIndex[0]][this._selectedCombinationIndex[1]]
    } else {
      this.setInfoBoxText(LINE_DISCOUNT_BLOCKED_NO_SELECTION, 'red')
      return
    }
    const extraTopic = topic !== undefined ? topic : this._extraTopic
    const extraIndex = selectedArticle.modifiers.findIndex(
      extra => extra._id === article._id && extra.amount > 0 && !extra.componentExternalId,
    )
    if (extraIndex === -1) return
    if (selectedArticle.modifiers[extraIndex].amount > 1) {
      selectedArticle.modifiers[extraIndex].amount -= 1
    } else {
      selectedArticle.modifiers.splice(extraIndex, 1)
    }
    // HIGHEST: nach Entfernen/Reduzieren kann sich der Sieger verschieben → neu bewerten.
    const group = this.#bundleFlow.findOptionGroupByTopic(selectedArticle, extraTopic)
    if (group?.pricingMode === 'HIGHEST') {
      this.#bundleFlow.applyHighestPricingToGroup(selectedArticle, extraTopic, group.freeQuantity || 0)
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Bundle/Menü-Flow Helper-Methoden
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Zeigt die Auswahl-Buttons für eine OptionGroup an. `componentExternalId`: Die Gruppe gehört zu einer gewählten
   * Menü-Komponente (Unterschritt „Pommes → Soßen"), dort gewählte Modifier tragen deren Zuordnung (#1127).
   */
  private showOptionGroupButtons(group: any, parentProduct: ProductSchema, componentExternalId?: string): void {
    this.clearButtons()
    this._functionBlockLabel = group.name
    this.setInfoBoxText(group.name)
    this._isBlocked = true

    // Produkte für die Optionen laden
    const products: ProductSchema[] = (group.options || [])
      .map((o: any) => this.productService.findProductById(o.productId))
      .filter(Boolean) as ProductSchema[]

    // ABBRUCH verwirft die angefangene Bundle-Konfiguration komplett:
    // Line-Item entfernen (inkl. item-delete-Interaction), Flow zurücksetzen, zurück zum Raster.
    this._functionButtons.push({
      _id: 'cancel-option-group',
      externalId: this.#functionButtonExternalId,
      locationId: this.userService.currentUser()?.activeLocationId || '',
      tenantId: this.authService.tenantId()?.toString() || '',
      name: 'ABBRUCH',
      index: -3,
      isFunctionButton: true,
      variant: 'cancel',
      iconName: 'x',
      callback: () => {
        this.decreaseLineItem()
        this.#bundleFlow.reset()
        this._isBlocked = false
        this.unselectProduct()
        this.setProductButtonsByGroupId(parentProduct.categoryIds?.[0])
      },
    })

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
        variant: 'skip',
        iconName: 'arrow-right',
        callback: () => {
          this.#bundleFlow.markCompleted(group.id)
          const nextGroup = this.#bundleFlow.getNextMandatoryGroup(parentProduct)
          if (nextGroup) {
            this.showOptionGroupButtons(nextGroup, parentProduct)
          } else {
            this._isBlocked = false
            // Bundle-Flow abgeschlossen
            this.finalizeBundleLine(parentProduct)
            this.setProductButtonsByGroupId(parentProduct.categoryIds?.[0])
          }
        },
      })
    }

    // VM-Kopien statt Store-Referenzen — der Dialog darf Cache-Objekte nicht mutieren
    this._productButtons = products.map(product => {
      const button = toPosButton(product)
      button.callback = () => this.selectOptionGroupItem(button, group, parentProduct, componentExternalId)
      return button
    })

    this.#cdr.markForCheck()
  }

  /** Verarbeitet die Auswahl eines Items aus einer OptionGroup */
  private selectOptionGroupItem(
    selected: ProductSchema,
    group: any,
    parentProduct: ProductSchema,
    componentExternalId?: string,
  ): void {
    const lineItem = this.getCurrentSelectedLineItem()
    if (!lineItem) return

    const genericItem = this.#bundleFlow.toGenericLineItem(selected)

    // Speichern basierend auf Gruppen-Name
    const groupName = (group.name || '').toLowerCase()
    if (groupName.includes('beilage') || groupName.includes('side')) {
      dropComponentModifiers(lineItem, lineItem.menuSideDish, genericItem)
      lineItem.menuSideDish = genericItem
    } else if (groupName.includes('getränk') || groupName.includes('drink')) {
      dropComponentModifiers(lineItem, lineItem.menuDrink, genericItem)
      lineItem.menuDrink = genericItem
    } else {
      // Soßen, Extras etc. als Modifier (freeQuantity berücksichtigen)
      const freeQty = group.freeQuantity || 0
      const currentModCount = lineItem.modifiers.filter(m => m.topic === group.name).length
      if (freeQty > 0 && currentModCount < freeQty) {
        genericItem.price = 0 // Kostenlos innerhalb freeQuantity
      }
      genericItem.topic = group.name
      // Gewählt im Unterschritt einer Komponente → steht auf Karte und Bon unter ihr (#1127). Nur eine UUID: Die
      // Cloud prüft das Feld nach dem Pin-Bump und lehnte die Bestellung sonst endgültig am Sync ab.
      if (componentExternalId && UUID_PATTERN.test(componentExternalId)) {
        genericItem.componentExternalId = componentExternalId
      }
      // pricingMode der Herkunftsgruppe auf das Modifier-Item STEMPELN (Order-Snapshot).
      if (group.pricingMode === 'HIGHEST') genericItem.pricingMode = 'HIGHEST'
      lineItem.modifiers.push(genericItem)
      // HIGHEST: nach jeder Auswahl neu bewerten — nur der höchste kostenpflichtige
      // Aufpreis der Gruppe bleibt wirksam, die übrigen werden auf 0 gesetzt.
      if (group.pricingMode === 'HIGHEST') {
        this.#bundleFlow.applyHighestPricingToGroup(lineItem, group.name, freeQty)
      }
    }

    // FIXED_PROPORTIONAL: zusätzlich generische Komponente mit Normalpreis-Gewicht
    // (Engine-Eingabe). Legacy-Slots bleiben für Anzeige/alte Reader gefüllt.
    if (parentProduct.bundlePricingMode === 'FIXED_PROPORTIONAL') {
      lineItem.components = lineItem.components ?? []
      lineItem.components.push(this.#bundleFlow.toComponent(selected, group))
    }

    this.#bundleFlow.markCompleted(group.id)

    // Prüfen ob das gewählte Produkt selbst OptionGroups hat (z.B. Pommes → Soßen)
    // Zwischen-Schritt: OptionGroups des gewählten Produkts anzeigen,
    // aber den parentProduct beibehalten für den Rückweg
    const subGroups = this.#bundleFlow.pendingGroups(selected)
    if (subGroups.length > 0) {
      this.showOptionGroupButtons(subGroups[0], parentProduct, selected.externalId ?? undefined)
      return
    }

    // Nächste Gruppe des Bundle-Produkts oder Unblock
    const nextGroup = this.#bundleFlow.getNextMandatoryGroup(parentProduct)

    if (nextGroup) {
      this.showOptionGroupButtons(nextGroup, parentProduct)
    } else {
      this._isBlocked = false
      this.finalizeBundleLine(parentProduct)
      this.setProductButtonsByGroupId(parentProduct.categoryIds?.[0])
    }

    this.#cdr.markForCheck()
  }

  /** Gibt das aktuell ausgewählte LineItem zurück (normal oder Kombination) */
  private getCurrentSelectedLineItem(): OrderLineItem | null {
    if (this._selectedCombinationIndex[0] !== null && this._selectedCombinationIndex[1] !== null) {
      return this.combinations[this._selectedCombinationIndex[0]][this._selectedCombinationIndex[1]] ?? null
    }
    if (this._selectedProductIndex !== null) {
      return this.#lineItems[this._selectedProductIndex] ?? null
    }
    return null
  }

  /** Schließt eine FIXED_PROPORTIONAL-Bundle-Zeile ab (Details in BundleFlow.finalizeFixedBundle). */
  private finalizeBundleLine(product: ProductSchema): void {
    const lineItem = this.getCurrentSelectedLineItem()
    if (!lineItem) return
    this.#bundleFlow.finalizeFixedBundle(lineItem, product)
  }

  // ──────────────────────────────────────────────────────────────────────

  increaseLineItem(product: ProductSchema, amount: number | undefined = undefined) {
    const amountToIncrease: number = amount !== undefined ? amount : this.multiplier
    const isBundle = this.#bundleFlow.isBundleProduct(product)

    let topic: string
    const firstCategoryId = product.categoryIds?.[0]
    if (!firstCategoryId) {
      topic = ''
    } else {
      const parentGroup = this.productGroupService.getProductGroupById(firstCategoryId)
      topic = parentGroup?.name ?? ''
    }

    const orderLineItem: OrderLineItem = {
      // Eigene Identität je Zeile, nicht die des Produkts: Zwei gleiche Menüs sind zwei
      // Zeilen, und `computeOrderTax` ordnet Positionsrabatte über genau diese ID einer
      // Zeile zu. Mit der Produkt-ID traf ein Rabatt die Steuer-Atome beider Zeilen.
      // Die Produktidentität steht weiterhin in `externalId` (Duplikat-Check unten).
      _id: uuidv7(),
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
      // FIXED_PROPORTIONAL: neues Komponenten-Modell. `price` ist der FESTPREIS
      // (Verteilungs-Ziel der Engine); die Komponenten (inkl. Hauptgericht) werden
      // beim Bundle-Abschluss in `finalizeBundleLine` gefüllt. ROLLUP/à-la-carte
      // bleiben bei der Legacy-Shape (menuDrink/menuSideDish) → keine Regression.
      bundlePricingMode: product.bundlePricingMode === 'FIXED_PROPORTIONAL' ? 'FIXED_PROPORTIONAL' : undefined,
      components: product.bundlePricingMode === 'FIXED_PROPORTIONAL' ? [] : undefined,
      name: product.name,
      parentId: product.categoryIds?.[0],
      price: product.price || 0,
      ingredientReferences: (product as any).ingredientReferences || [],
      recipeReferences: product.recipeReferences || [],
      taxInside: !product.taxInside ? 19 : product.taxInside,
      taxOutside: !product.taxOutside ? 7 : product.taxOutside,
      topic: topic,
      // Eine Zeile trägt gleiche Stücke, ein Modifier gilt je Stück (#699, ADR 0056).
      modifierScope: 'unit',
    }

    this.resetMultiplier()
    this.resetProductSearch()

    // Duplikat-Check (nur bei nicht-Bundle-Produkten) — auf der PRODUKT-Identität.
    // `_id` ist seit #230 die Zeilen-Identität und je Zeile verschieden; der Vergleich
    // läuft deshalb über `externalId`.
    //
    // ⚠️ Leere `externalId` ist bewusst kein Treffer: Das Feld wird zwar serverseitig
    // vergeben (`value || uuidv7()`), erlaubt im Schema aber `null` — und die Zeile
    // oben macht daraus `''`. Ohne diese Bedingung fielen alle Alt-Produkte ohne
    // `externalId` zu einer einzigen Warenkorbzeile zusammen. Eine zweite Zeile ist
    // hier der harmlosere Ausgang.
    const productKey = orderLineItem.externalId
    // Öffnet das Produkt das Panel von selbst (#639), bekommt jeder Tap eine eigene Zeile:
    // „ein Burger ohne Ketchup, einer normal" braucht zwei Zeilen, und eine Anpassung an einer
    // zusammengelegten Zeile träfe alle Stück. Der Multiplikator bleibt eine Zeile mit Menge.
    const autoCustomize = !isBundle && opensCustomizeAutomatically(product)

    const selectedCombination = this._selectedCombinationIndex[0]
    const bundleNumber = selectedCombination !== null ? this.#bundleNumberOfCombination(selectedCombination) : null

    if (selectedCombination !== null && bundleNumber !== null) {
      // Kombinations-Modus: Der Artikel wird Position der markierten Kombination.
      //
      // Bis #271 pushte dieser Zweig in `this.combinations[i]` — eine Wegwerf-Kopie,
      // `getCombinations` baut die Gruppen je Aufruf neu. Die Zeile war danach nirgends,
      // der Kacheltap ein stiller No-Op. Geschrieben wird deshalb nur noch in
      // `#lineItems`; die Zugehörigkeit trägt die `bundleNumber`, der Positionsindex
      // wird aus der NEU berechneten Kombination gelesen, nicht aus dem `push`.
      //
      // Duplikat-Check nur innerhalb der Kombination — gleiches Verhalten wie im
      // Normalmodus (Menge hoch statt zweiter Zeile). Eine gleiche Zeile außerhalb der
      // Kombination bleibt unberührt: Sie gehört nicht zum Menü.
      const bundle = this.combinations[selectedCombination]
      orderLineItem.bundleNumber = bundleNumber
      const existingInBundle = productKey ? bundle.find(item => this.#sameConfig(item, orderLineItem)) : undefined
      if (!isBundle && !autoCustomize && existingInBundle) {
        this.#pingCartLine(existingInBundle, 'more')
        return this.increaseQuantity(existingInBundle, amountToIncrease)
      }

      this.#lineItems.push(orderLineItem)
      this.#hadInput = true
      this.#freshLine = orderLineItem
      this.#pingCartLine(orderLineItem, 'new')
      const index = this.combinations[selectedCombination].indexOf(orderLineItem)

      if (isBundle && product.optionGroups?.length) {
        this._isBlocked = true
        this._selectedCombinationIndex = [selectedCombination, index]
        this.#bundleFlow.reset()
        // Bundle-Flow gestartet für: product.name
        const firstGroup = this.#bundleFlow.getNextMandatoryGroup(product)
        if (firstGroup) {
          this.showOptionGroupButtons(firstGroup, product)
        }
      } else if (autoCustomize) {
        this._selectedProductIndex = null
        this._selectedCombinationIndex = [selectedCombination, index]
        this.openCustomizePanel(orderLineItem)
      } else if ((product as any).nextProductGroupExternalId !== undefined) {
        this.setSuccessorSubButtons(product)
      }
    } else {
      // Normaler Modus. Zeigt die Markierung auf eine Kombination, die es nicht mehr
      // gibt (aufgelöst, gelöscht), fällt der Tap hierher — und räumt die Markierung ab,
      // statt still auf sie zu bauen.
      if (selectedCombination !== null) this._selectedCombinationIndex = [null, null]

      const existing = productKey ? this.#lineItems.find(item => this.#sameConfig(item, orderLineItem)) : undefined
      if (!isBundle && !autoCustomize && existing) {
        this.#pingCartLine(existing, 'more')
        return this.increaseQuantity(existing, amountToIncrease)
      }

      const index = this.#lineItems.push(orderLineItem) - 1
      this.#hadInput = true
      this.#freshLine = orderLineItem
      this.#pingCartLine(orderLineItem, 'new')

      if (isBundle && product.optionGroups?.length) {
        // Neuer Bundle-Flow: OptionGroups sequentiell abarbeiten
        this._isBlocked = true
        this._selectedProductIndex = index
        this.#bundleFlow.reset()
        // Bundle-Flow gestartet für: product.name
        const firstGroup = this.#bundleFlow.getNextMandatoryGroup(product)
        if (firstGroup) {
          this.showOptionGroupButtons(firstGroup, product)
        }
      } else if (autoCustomize) {
        this._selectedProductIndex = index
        this.openCustomizePanel(orderLineItem)
      }
    }
  }

  /**
   * Merkt die Zeile für Mitscrollen und Hervorhebung vor (core#1116). Nach dem Ausblenden (längste Animation 1,1 s)
   * räumt der Timer sie wieder ab. Sonst spielte ein Umbau der Liste, der die Zeile neu rendert (Kombinieren,
   * Herauslösen), die Animation ein zweites Mal ab.
   */
  #pingCartLine(line: OrderLineItem, kind: CartPing['kind']): void {
    const ping = nextCartPing(this.cartPing(), line._id, kind)
    this.cartPing.set(ping)
    clearTimeout(this.#cartPingTimer)
    this.#cartPingTimer = setTimeout(() => {
      if (this.cartPing() === ping) this.cartPing.set(null)
    }, 1200)
  }

  /** Klasse der Hervorhebung im Warenkorb, siehe `cartPingClass` (core#1116). `[class]` verlangt einen String. */
  cartPingClass(line: OrderLineItem): string {
    return cartPingClass(this.cartPing(), line._id) ?? ''
  }

  /**
   * Gleiche Konfiguration (#699): Ein neu angetipptes Produkt landet nur auf einer Zeile ohne
   * Anpassung — „1× Burger + Käse" bekommt keinen zweiten Burger, sondern es entsteht
   * „1× Burger". Die Reihenfolge im Warenkorb spielt dabei keine Rolle mehr.
   */
  #sameConfig(item: OrderLineItem, candidate: OrderLineItem): boolean {
    const key = lineConfigKey(item, this.#discountKey(item))
    return key !== null && key === lineConfigKey(candidate)
  }

  /** `bundleNumber` der i-ten Kombination — `null`, wenn es sie (nicht mehr) gibt. */
  #bundleNumberOfCombination(index: number): number | null {
    const bundleNumber = this.combinations[index]?.[0]?.bundleNumber
    return bundleNumber === undefined ? null : bundleNumber
  }

  /**
   * Entfernt die markierte Zeile ohne Undo-Angebot — der Pfad für den ABBRUCH
   * eines angefangenen Bundle-Flows. Der Benutzer-Löschweg ist `deleteSelection()`.
   */
  decreaseLineItem() {
    const [combination, article] = this._selectedCombinationIndex
    const item =
      this._selectedProductIndex !== null
        ? this.#lineItems[this._selectedProductIndex]
        : combination !== null && article !== null
          ? this.combinations[combination]?.[article]
          : undefined
    if (!item) {
      this.setInfoBoxText('Bitte wählen Sie zunächst einen Artikel aus.', 'red')
      return
    }

    const bundleNumber = item.bundleNumber
    this.#removeLineItems([item])
    if (this._selectedProductIndex !== null) {
      this._selectedProductIndex = null
      return
    }
    // Die Kombination bleibt markiert, solange es sie noch gibt — ist sie auf eine
    // Position geschrumpft, wurde sie aufgelöst und die Markierung geht mit.
    const bundleRemains = this.combinations.some(bundle => bundle[0]?.bundleNumber === bundleNumber)
    this._selectedCombinationIndex = bundleRemains ? [combination, null] : [null, null]
  }

  combineAllArticles() {
    this._articlesToCombine = new Map(this.lineItems.map((line, index) => [index, line.amount]))
    this.increaseCombination()
  }

  increaseCombination() {
    if (this._articlesToCombine.size <= 1) {
      this.setInfoBoxText('Bitte wählen Sie mindestens zwei Artikel aus.', 'red')
      return
    }

    const existingBundles = this.#lineItems
      .map(i => i.bundleNumber)
      .filter(n => n !== null && n !== undefined) as number[]
    const nextBundleId = existingBundles.length > 0 ? Math.max(...existingBundles) + 1 : 1

    // Erst die Zeilen auflösen, dann spalten — ein Split schiebt die Indizes der folgenden Zeilen.
    const picks = [...this._articlesToCombine]
      .map(([index, count]) => ({ line: this.#lineItems[index], count }))
      .filter(pick => pick.line !== undefined)
    for (const { line, count } of picks) {
      // Nicht teilbare Zeilen (Modifier „je Zeile") gehen als Ganzes — wie vor #795.
      const target = count < line.amount ? (this.#splitOff(line, count) ?? line) : line
      target.bundleNumber = nextBundleId
    }

    this._articlesToCombine = new Map()
    // Die Markierung zeigte auf eine Zeile von vorher, die jetzt Teil der Kombination ist (#1011).
    this._selectedProductIndex = null
    this.productButtons.forEach(subButton => {
      if (subButton.productGroupExternalId === undefined) return
      subButton.pressed = false
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

    this.#removeLineItems(this.combinations[this._selectedCombinationIndex[0]] ?? [])

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

  async placeOrder(): Promise<void> {
    if (this.placing()) return
    this.placing.set(true)
    try {
      await this.#placeOrder()
    } finally {
      this.placing.set(false)
      this.#cdr.markForCheck()
    }
  }

  async #placeOrder(): Promise<void> {
    // Ruhetag laut Öffnungszeiten (#1133): Freigabe VOR dem Anlegen, solange der Warenkorb noch steht.
    // Ohne Freigabe bleibt alles, wie es ist — die Edge würde die Bestellung ohnehin ablehnen.
    if (!(await ensureClosedDayApproval(this.matDialog, this.#businessDays, this.#operationMode()))) {
      this.#notifications.warning(this.translateService.instant('CLOSED_DAY.DECLINED'))
      return
    }

    // Gleiche Konfigurationen als eine Zeile auf den Bon (#699) — falls das Panel über einen
    // Ansichtswechsel statt über „Fertig" verlassen wurde.
    this.#freshLine = null
    this.#mergeLines()
    // Mandant in der Cloud gesperrt: der Bon liefe sicher in den 403. Der Warenkorb bleibt
    // stehen, die Meldung ist ein globales Overlay (core#489).
    if (this.#tenantSuspension.suspended()) {
      this.#notifications.error('Konto gesperrt: bitte den Inhaber kontaktieren')
      return
    }
    let staffMealDetails: StaffPaymentInfo | undefined = undefined
    // Wird nur gesetzt, wenn ein Rabattcode eingelöst wurde — siehe unten.
    let preAssignedOrderId: string | undefined = undefined
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
    }
    if (this._customer && this._customer._id) {
      customerDetails = {
        customerId: this._customer._id,
        customerName: this._customer.name1,
        isPaid: false,
      }
      discountDetails = this.#toDiscount(this._customer.discountDetails) ?? discountDetails
    }

    const manual = this.selectedManualDiscount()

    // Ein manuell gewählter Personalessen-Rabatt macht die Bestellung zum Personalessen
    // (Subventions-Tracking), auch wenn die Personalessen-Taste nicht gedrückt wurde.
    if (manual?.isStaffMeal && this._currentUser && !staffMealDetails) {
      staffMealDetails = {
        userId: this._currentUser._id,
        userName: this._currentUser.firstName + ' ' + this._currentUser.lastName,
        isPaid: false,
      }
    }

    // Einzige Rabattquelle (ADR 0030). `discountDetails` ist ab hier nur noch die
    // Zwischenstufe aus den Kunden-Stammdaten, aus der der Snapshot gebaut wird — an
    // die Order geht ausschließlich `appliedDiscounts`.
    const appliedDiscounts: AppliedDiscount[] = []

    if (staffMealDetails) {
      // Personalessen ist rabatt-exklusiv (assertStaffMealDiscountExclusivity): genau der
      // Personalessen-Rabatt, sonst keiner. Ein manuell gewählter Personalessen-Rabatt
      // hat Vorrang vor der Zuweisung am Benutzer; ein etwaiger Kundenrabatt entfällt.
      const staffMealDiscount = manual?.isStaffMeal
        ? this.#managedToApplied(manual)
        : this.#resolveAssignedStaffMealDiscount()
      if (staffMealDiscount) appliedDiscounts.push(staffMealDiscount)
      discountDetails = undefined
    } else {
      // Positionsrabatte zuerst — die Engine wendet LINE ohnehin vor ORDER an,
      // aber so steht der Snapshot in derselben Reihenfolge, in der er wirkt.
      appliedDiscounts.push(...this.#buildLineDiscountSnapshots())

      if (discountDetails) {
        appliedDiscounts.push(
          this.#toAppliedDiscount(discountDetails, {
            name: this._customer?.name1 ?? 'Rabatt',
            isStaffMeal: false,
            appliedBy: this._currentUser?._id ?? null,
          }),
        )
      }
      if (manual) appliedDiscounts.push(this.#managedToApplied(manual))

      // Erst HIER wird der Code verbraucht — nicht beim Eintippen. Die Cloud
      // prüft dabei erneut gegen den autoritativen Log: Zwischen Eingabe und
      // Abschluss kann eine andere Kasse dasselbe Limit aufgebraucht haben.
      const checked = this.appliedCodeDiscount()
      const retained = this.#redeemedForRetry
      const outcome = retained
        ? ({ status: 'retained' } as const)
        : await redeemCodeForOrder(checked, {
            redeem: ({ code, orderId }) =>
              this.discountCodeService.redeem({
                code,
                orderId,
                customerId: this._customer?._id ?? null,
                amountCents: Math.round(this.calculateSumPrice() * 100),
              }),
            newOrderId: () => uuidv7(),
          })

      if (outcome.status === 'retained' && retained) {
        // Wiederholung nach gescheitertem Anlegen: dieselbe Einlösung, dieselbe ID.
        preAssignedOrderId = retained.orderId
        appliedDiscounts.push(retained.applied)
      } else if (outcome.status === 'redeemed' && checked) {
        // Dieselbe ID geht gleich an createOrder — Einlösung und Bestellung
        // tragen damit denselben Bezug (siehe redeemCodeForOrder).
        preAssignedOrderId = outcome.orderId
        const applied = this.#codeToApplied({ ...checked, ...outcome.redeemed })
        appliedDiscounts.push(applied)
        this.#redeemedForRetry = { orderId: outcome.orderId, applied }
      } else if (outcome.status === 'failed') {
        // Die Bestellung darf daran nicht scheitern: Der Gast steht an der
        // Kasse, die Ware ist erfasst. Sie läuft ohne Code weiter — der Grund
        // muss den Kassierer aber erreichen: Er hat dem Gast einen Nachlass
        // zugesagt, den die Bestellung nicht trägt.
        //
        // Bewusst KEINE Infobox: die überschreibt `unselectProduct()` rund 25
        // Zeilen weiter unten, und das Ende der Bestellung nimmt sie ohnehin mit
        // (#234, belegt in der Spec). Die Meldung liegt auf der globalen Ebene und
        // überlebt beides. Quittierpflichtig (`sticky`) bleibt sie bis zum × stehen
        // — eine Meldung, die von selbst verschwindet, ist im Kassenbetrieb
        // genauso übersehbar wie gar keine.
        this.#notifications.error(`Rabattcode nicht eingelöst: ${codeResultMessage(outcome.reason)}`, { sticky: true })
        this.appliedCodeDiscount.set(null)
      }
    }

    // Bezahlansicht (core#831): Die Bestellung braucht eine ID, auf die das Kassieren danach zeigt. Der
    // Rabattcode-Pfad hat sie schon; sonst wird sie hier vorab vergeben (derselbe Weg wie beim Rabattcode).
    const payNow = this.paysAtCounter()
    const paymentTotal = this.hasDiscountPreview() ? this.discountedTotal() : this.calculateSumPrice()
    const orderId = payNow ? (preAssignedOrderId ?? uuidv7()) : preAssignedOrderId

    const created = this.orderService.createOrder({
      // Nur im Rabattcode- und Bezahl-Fall gesetzt — sonst vergibt der Server (Regelfall).
      _id: orderId,
      lineItems: this.#lineItems,
      orderChannel: this.orderChannel(),
      customerDetails,
      pager: this._pager,
      productionTime: this._productionTime,
      staffMealDetails,
      table: this._table,
      dineLocation,
      recordingDate: this.#recordingDate,
      orderInteractions: this.#orderInteractions,
      // creationContext nur mit gültiger User-uuid bauen — sonst weglassen (Schema:
      // optional/null), statt ein ungültiges createdBy: '' zu senden, das den
      // (Offline-)Create an der uuid-Validierung scheitern lässt.
      creationContext: this._currentUser?._id ? { createdBy: this._currentUser._id.toString() } : undefined,
      appliedDiscounts: appliedDiscounts.length > 0 ? appliedDiscounts : undefined,
    })

    if (payNow && orderId) {
      // Erst wenn die Bestellung steht: Der Druckdialog öffnet im Service direkt nach dem Anlegen (F1), also vor
      // der Bezahlansicht. Scheitert das Anlegen, bleibt der Warenkorb stehen — `handleError` hat gemeldet,
      // und der Kassierer kann es erneut versuchen, ohne die Positionen neu zu tippen.
      try {
        const sequence = await created
        if (sequence === null || sequence === undefined) return
      } catch {
        return
      }
      this.deleteOrder()
      this.unselectProduct()
      this.payment.set({ orderId, total: paymentTotal })
      this.#cdr.markForCheck()
      return
    }

    // Erst bestätigen, wenn der Server (oder offline die Outbox) die Bestellung angenommen hat — das Schließen
    // wartet bewusst nicht darauf. Scheitert das Anlegen, meldet `handleError` den Fehler statt eines Erfolgs.
    void created.then(
      sequence => {
        if (sequence !== null && sequence !== undefined) this.#notifications.success(ORDER_PLACED_MESSAGE)
      },
      () => undefined,
    )
    this.deleteOrder()
    this.unselectProduct()

    this.closed.emit('order-placed')
  }

  /**
   * Läuft an der Kasse ein Barverkauf? Dann heißt die Primärtaste „Bezahlen" und führt in die Bezahlansicht.
   * Nur im Kassenbetrieb (`operationMode !== 'orders-only'`, dieselbe Quelle wie „Offene Bestellungen") und nur
   * für den Kanal Kasse: Telefonbestellungen werden bei Abholung bezahlt, Personalessen und Firmenkunden
   * laufen über eigene Wege (Abrechnung), nicht über die Theke. Ein Personalessen zählt auch, wenn nur der
   * Rabatt „Personalessen" gewählt ist: `placeOrder` speichert dann nur diesen Rabatt und verwirft Zeilenrabatte
   * und Code — die Summe der Vorschau stimmte nicht mit der Bestellung überein.
   */
  paysAtCounter(): boolean {
    return (
      this.locationService.activeLocation()?.operationMode !== 'orders-only' &&
      this.orderChannel() === OrderChannel.POS &&
      !this.isStaffMealOrder &&
      !this.selectedManualDiscount()?.isStaffMeal &&
      !this._customer &&
      this.#cashierId() !== null
    )
  }

  #operationMode(): string | undefined {
    return (this.locationService.activeLocation() as { operationMode?: string } | undefined)?.operationMode
  }

  /** Kassierer wie in „Offene Bestellungen": der angemeldete Mitarbeiter, sonst der Auth-User. */
  #cashierId(): string | null {
    return this._currentUser?._id?.toString() ?? this.authService.user()?._id?.toString() ?? null
  }

  /** „Bar kassieren": bucht Bar über die ganze Summe und schließt die Bestellung ab. */
  async onCollect(): Promise<void> {
    const pending = this.payment()
    const cashierId = this.#cashierId()
    if (!pending || !cashierId || this.paying()) return
    this.paying.set(true)
    try {
      const result = await this.#checkout.payCash({
        orderId: pending.orderId,
        total: pending.total,
        cashierId,
        requestCashSession: id =>
          promptCashSessionAuthorization(
            this.matDialog,
            this.locationService.activeLocation() as CashSessionPromptLocation | undefined,
            this.userService.users(),
            id,
          ),
        requestClosedDayApproval: err => promptClosedDayApprovalFromError(this.matDialog, err, this.#operationMode()),
      })
      if (result === 'paid') {
        this.payment.set(null)
        this.#notifications.success(ORDER_PLACED_MESSAGE)
        this.closed.emit('order-placed')
      } else if (result === 'cash-session-declined') {
        this.#notifications.warning('Kasse nicht freigegeben. Die Bestellung bleibt offen.')
      } else if (result === 'closed-day-declined') {
        this.#notifications.warning(this.translateService.instant('CLOSED_DAY.DECLINED'))
      }
      // `failed`: `handleError` hat schon gemeldet, die Ansicht bleibt für einen neuen Versuch stehen.
    } finally {
      this.paying.set(false)
      this.#cdr.markForCheck()
    }
  }

  /** „Offen lassen": die Bestellung ist angelegt, bezahlt wird später in „Offene Bestellungen" (heutiger Weg). */
  onKeepOpen(): void {
    if (this.paying()) return
    this.payment.set(null)
    this.#notifications.success(ORDER_PLACED_MESSAGE)
    this.closed.emit('order-placed')
  }

  /**
   * Validiert die lose `discountDetails`-Struktur (User/Customer) zu einem typsicheren
   * `Discount`. Ersetzt den früheren `as unknown as Discount`-Cast — ungültige Werte
   * (unbekannter Typ, negativ) werden verworfen statt blind durchgereicht.
   */
  #toDiscount(raw: unknown): Discount | undefined {
    if (!raw || typeof raw !== 'object') return undefined
    const dt = (raw as { discountType?: unknown }).discountType
    const dv = (raw as { discount?: unknown }).discount
    if ((dt === 'percent' || dt === 'amount') && typeof dv === 'number' && dv >= 0) {
      return { discountType: dt, discount: dv }
    }
    return undefined
  }

  /** Baut einen AppliedDiscount-Snapshot (manuell, Order-Level) aus einem Discount. */
  #toAppliedDiscount(
    d: Discount,
    opts: { name: string; isStaffMeal: boolean; appliedBy: string | null },
  ): AppliedDiscount {
    return {
      _id: uuidv7(),
      discountId: null,
      name: opts.name,
      method: 'manual',
      target: 'order',
      valueType: d.discountType,
      valuePercent: d.discountType === 'percent' ? d.discount : 0,
      valueCents: d.discountType === 'amount' ? Math.round(d.discount * 100) : 0,
      computedAmountCents: 0,
      appliedBy: opts.appliedBy,
      appliedAt: new Date().toISOString(),
      isStaffMeal: opts.isStaffMeal,
    }
  }

  /** Baut den AppliedDiscount-Snapshot aus einer Cloud-gepflegten Rabatt-Definition (Order-Level). */
  /**
   * Löst den beim Benutzer zugewiesenen Personalessen-Rabatt
   * (`user.staffMealDiscountId`, gepflegt in der Cloud-Admin-UI) gegen den lokalen
   * Rabatt-Bestand auf.
   *
   * Läuft die Referenz ins Leere — Rabatt archiviert, gelöscht oder am Edge noch
   * nicht synchronisiert —, wird die Bestellung ohne Nachlass als Personalessen
   * erfasst statt abgelehnt: die Erfassung darf an einer Stammdaten-Lücke nicht
   * scheitern. Der Fall ist in der Cloud sichtbar (Archivieren warnt, wenn der
   * Rabatt Mitarbeitern zugewiesen ist).
   */
  #resolveAssignedStaffMealDiscount(): AppliedDiscount | null {
    const assignedId = this._currentUser?.staffMealDiscountId
    if (!assignedId) return null
    const match = this.discountService.activePosDiscounts().find(d => d._id === assignedId)
    if (!match?.isStaffMeal) return null
    return this.#managedToApplied(match)
  }

  #managedToApplied(d: ManagedDiscount): AppliedDiscount {
    return {
      _id: uuidv7(),
      discountId: d._id,
      name: d.name,
      method: 'manual',
      target: 'order',
      valueType: d.valueType,
      valuePercent: d.valueType === 'percent' ? d.valuePercent : 0,
      valueCents: d.valueType === 'amount' ? d.valueCents : 0,
      computedAmountCents: 0,
      appliedBy: this._currentUser?._id ?? null,
      appliedAt: new Date().toISOString(),
      // Explizit zu Boolean casten: SQLite liefert 0/1, und das Order-Schema
      // verlangt hier `Type.Boolean()` — eine durchgereichte 0 liess die ganze
      // Bestellung mit „must be boolean" scheitern. Der Edge-Resolver
      // normalisiert inzwischen schon beim Lesen; dieser Cast ist die zweite
      // Absicherung direkt an der Payload-Grenze, weil ein 400 hier die
      // Bestellannahme blockiert.
      isStaffMeal: !!d.isStaffMeal,
    }
  }

  /**
   * Schaltet den Vertriebskanal zwischen Kasse und Telefon um.
   *
   * Nur diese beiden: `ONLINE` und `APP` entstehen nicht an der Kasse, sie
   * kommen aus der Storefront bzw. der App. Eine Auswahl mit vier Werten hätte
   * an einem Touch-Gerät zwei Werte angeboten, die nie richtig sein können.
   */
  toggleOrderChannel(): void {
    this.orderChannel.update(toggledOrderChannel)
    this.setInfoBoxText(
      this.orderChannel() === OrderChannel.POS ? 'Kanal: Kasse (vor Ort)' : 'Kanal: Telefonbestellung',
    )
  }

  /** Öffnet den Touch-Picker für manuelle POS-Rabatte und übernimmt die Auswahl. */
  openDiscountPicker(): void {
    // Personalessen ist rabatt-exklusiv — der zugewiesene Rabatt gilt, ein zweiter
    // würde serverseitig ohnehin mit 400 abgelehnt (validateStaffMealExclusivity).
    if (this.isStaffMealOrder) {
      this.setInfoBoxText('Personalessen: kein zusätzlicher Rabatt möglich')
      return
    }
    const ref = this.matDialog.open(DiscountPickerDialogComponent, {
      width: '40rem',
      maxWidth: '92vw',
      panelClass: ['!rounded-2xl', 'overflow-hidden'],
      data: { scope: 'order' },
    })
    ref.afterClosed().subscribe((selected: ManagedDiscount | undefined) => {
      if (!selected) return
      this.selectedManualDiscount.set(selected)
      this.#cdr.markForCheck()
    })
  }

  /** Entfernt den manuell gewählten Rabatt wieder. */
  clearManualDiscount(): void {
    this.selectedManualDiscount.set(null)
    this.#cdr.markForCheck()
  }

  /** Die aktuell im Warenkorb markierte Zeile — Ziel des Positionsrabatts. */
  private get selectedLineItem(): OrderLineItem | null {
    const index = this._selectedProductIndex
    if (index === null) return null
    return this.#lineItems[index] ?? null
  }

  /** Kann jetzt ein Positionsrabatt gesetzt werden? Steuert den Knopf-Zustand. */
  canApplyLineDiscount(): boolean {
    return evaluateLineDiscountGate({
      isStaffMealOrder: this.isStaffMealOrder,
      selectedLineItemId: this.selectedLineItem?._id ?? null,
      lineItemIds: this.#lineItems.map(l => l._id),
    }).allowed
  }

  /** Öffnet den Picker für einen Rabatt auf die markierte Position. */
  openLineDiscountPicker(): void {
    const line = this.selectedLineItem
    const gate = evaluateLineDiscountGate({
      isStaffMealOrder: this.isStaffMealOrder,
      selectedLineItemId: line?._id ?? null,
      lineItemIds: this.#lineItems.map(l => l._id),
    })
    if (!gate.allowed || !line) {
      this.setInfoBoxText(gate.message ?? '')
      return
    }
    const ref = this.matDialog.open(DiscountPickerDialogComponent, {
      width: '40rem',
      maxWidth: '92vw',
      panelClass: ['!rounded-2xl', 'overflow-hidden'],
      data: { scope: 'line', lineItemName: line.name },
    })
    ref.afterClosed().subscribe((selected: ManagedDiscount | undefined) => {
      if (!selected) return
      this.lineDiscounts.update(current => setLineDiscount(current, line._id, selected))
      this.setInfoBoxText(`${selected.name} auf ${line.name}`)
      this.#cdr.markForCheck()
    })
  }

  /** Nimmt den Positionsrabatt einer Zeile zurück. */
  clearLineDiscount(lineItemId: string, event?: Event): void {
    event?.stopPropagation()
    this.lineDiscounts.update(current => removeLineDiscount(current, lineItemId))
    this.#cdr.markForCheck()
  }

  /** Trägt mindestens eine Position einen Rabatt? Steuert die Tönung des Knopfes. */
  hasLineDiscounts(): boolean {
    return Object.keys(this.lineDiscounts()).length > 0
  }

  /** Rabatt-Definition einer Zeile — für die Kennzeichnung im Warenkorb. */
  lineDiscountOf(lineItem: OrderLineItem): ManagedDiscount | undefined {
    return this.lineDiscounts()[lineItem._id]
  }

  /** Kurzlabel des Positionsrabatts („20 %" / „1,50 €"). */
  lineDiscountLabel(lineItem: OrderLineItem): string {
    const d = this.lineDiscountOf(lineItem)
    if (!d) return ''
    return d.valueType === 'percent' ? `${d.valuePercent} %` : formatEurCents(d.valueCents)
  }

  /**
   * Öffnet die Touch-Eingabe für Rabattcodes.
   *
   * Codes sind strikt online (ADR 0032) — der Dialog prüft gegen die Cloud und
   * meldet eine fehlende Verbindung als solche, statt sie als „Code ungültig"
   * auszugeben.
   */
  openPromoCodeDialog(): void {
    const gate = evaluatePromoCodeGate({
      isCloudDirect: this.#connectionService.tier() === 'cloud-direct',
      isStaffMealOrder: this.isStaffMealOrder,
      hasManualDiscount: !!this.selectedManualDiscount(),
    })
    if (!gate.allowed) {
      this.setInfoBoxText(gate.message ?? '')
      return
    }
    const ref = this.matDialog.open(PromoCodeDialogComponent, {
      width: '40rem',
      maxWidth: '92vw',
      panelClass: ['!rounded-2xl', 'overflow-hidden'],
    })
    ref.afterClosed().subscribe((checked: CodeCheckResult | undefined) => {
      if (!checked?.ok) return
      this.appliedCodeDiscount.set(checked)
      this.setInfoBoxText(`Rabattcode ${checked.code} übernommen`)
      this.#cdr.markForCheck()
    })
  }

  /** Nimmt den geprüften Code wieder zurück (noch nicht eingelöst — nichts zu stornieren). */
  clearCodeDiscount(): void {
    this.appliedCodeDiscount.set(null)
    this.#cdr.markForCheck()
  }

  /** Snapshot-Eintrag für einen per Code gewährten Rabatt (Logik in promo-code.ts). */
  #codeToApplied(checked: CodeCheckResult): AppliedDiscount {
    return buildCodeAppliedDiscount(checked, { id: uuidv7(), appliedBy: this._currentUser?._id ?? null })
  }

  /**
   * Vorschau-Gesamtbetrag inkl. manuell gewähltem Rabatt bzw. Rabattcode
   * (kanonische Engine). Ohne Rabatt identisch zu calculateSumPrice.
   */
  discountedTotal(): number {
    const manual = this.selectedManualDiscount()
    const code = this.appliedCodeDiscount()
    const lines = this.#buildLineDiscountSnapshots()
    if (!manual && !code && lines.length === 0) return this.calculateSumPrice()
    // Reihenfolge egal — die Engine sortiert selbst nach target (LINE vor ORDER).
    const applied: AppliedDiscount[] = [...lines]
    if (manual) applied.push(this.#managedToApplied(manual))
    if (code) applied.push(this.#codeToApplied(code))
    const order = {
      lineItems: this.#lineItems,
      dineLocation: !this._dineLocation ? DineLocation.DINE_IN : this._dineLocation,
      appliedDiscounts: applied,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
    return computeOrderTax(order).brutto
  }

  /** Ist ein Rabatt (manuell, per Code ODER auf einer Position) aktiv? Steuert die Streichpreis-Anzeige. */
  hasDiscountPreview(): boolean {
    return (
      !!this.selectedManualDiscount() || !!this.appliedCodeDiscount() || Object.keys(this.lineDiscounts()).length > 0
    )
  }

  /**
   * Snapshots aller Positionsrabatte, gefiltert auf Zeilen, die es noch gibt.
   *
   * Die Filterung passiert hier statt nur beim Löschen, weil eine Zeile auch über
   * `decreaseQuantity` oder das Auflösen einer Kombination verschwinden kann —
   * ein Rabatt ohne Zeile brächte eine 0,00-€-Rabattzeile auf den Bon.
   */
  #buildLineDiscountSnapshots(): AppliedDiscount[] {
    const ids = this.#lineItems.map(l => l._id)
    return buildLineAppliedDiscounts(this.lineDiscounts(), ids, {
      newId: () => uuidv7(),
      appliedBy: this._currentUser?._id ?? null,
    })
  }

  /**
   * Wirft Positionsrabatte weg, deren Zeile nicht mehr im Warenkorb steht.
   *
   * Nötig, obwohl `#buildLineDiscountSnapshots` verwaiste Einträge ohnehin
   * überspringt: Sonst wüchse die Map über die Lebensdauer des Dialogs mit
   * Einträgen zu Zeilen, die es nicht mehr gibt, und `hasLineDiscounts()`
   * meldete einen Rabatt, den der Warenkorb nicht zeigt.
   *
   * Bis #230 kam ein zweiter, schwerwiegenderer Grund dazu: Die Zeilen-`_id` war
   * die Produkt-ID, ein neu angelegter gleicher Artikel erbte damit still den
   * Rabatt der gelöschten Zeile. Seit der Umstellung auf `uuidv7` je Zeile kann
   * das nicht mehr passieren — der Aufräumschritt bleibt aus dem ersten Grund.
   */
  #pruneOrphanedLineDiscounts(): void {
    const ids = this.#lineItems.map(l => l._id)
    this.lineDiscounts.update(current => pruneLineDiscounts(current, ids))
  }

  togglePriceVisibility() {
    this._priceVisibility = !this._priceVisibility
  }

  /**
   * Farbcodierung der Funktionstasten nach Wirkung (code-style.md §9):
   * cancel=Rot (verwirft), skip=Amber (lässt weg), confirm=Teal (übernimmt).
   * Getönte Fläche + farbiger Rahmen statt Vollton; pressed nur für echte Toggles
   * (bis #639 die OHNE-Taste, derzeit keine — die Klasse bleibt für den nächsten).
   * Kein `hover:` hier: den Maus-Hover trägt `pnry-hover` am Button, nur mit feinem Zeiger (core#959).
   */
  functionButtonClasses(button: PosButton): string {
    switch (button.variant) {
      case 'cancel':
        return 'bg-red-50 border-red-200 text-red-600 active:bg-red-200 dark:bg-red-900/30 dark:border-red-900/60 dark:text-red-300 dark:active:bg-red-800/60'
      case 'skip':
        return button.pressed
          ? 'bg-amber-200 border-amber-500 text-amber-800 shadow-inner dark:bg-amber-800/60 dark:border-amber-400 dark:text-amber-200'
          : 'bg-amber-50 border-amber-200 text-amber-700 active:bg-amber-200 dark:bg-amber-900/30 dark:border-amber-900/60 dark:text-amber-300 dark:active:bg-amber-800/60'
      case 'confirm':
        return 'bg-accent-soft border-accent-line text-accent-ink active:brightness-90'
      default:
        return 'bg-surface-elevated border-line text-ink active:bg-line'
    }
  }

  getBadgeValue(product: ProductSchema): string | null {
    if ((product as any).isFunctionButton) return null
    return (product as any).index.toString()
  }

  isLineItemBundled(articleItem: OrderLineItem): boolean {
    return articleItem.bundleNumber !== null && articleItem.bundleNumber !== undefined
  }

  calculateArticlePriceWithoutExtras(articleItem: OrderLineItem): number | undefined {
    return calculateArticlePriceWithoutExtras(articleItem)
  }

  calculateArticlePrice(articleItem: OrderLineItem): number {
    return calculateArticlePrice(articleItem)
  }

  calculateSumPrice(): number {
    return calculateSumPrice({ lineItems: this.#lineItems } as any)
  }

  calculateCombinationPrice(articleItems: OrderLineItem[]): number {
    return calculateCombinationPrice(articleItems)
  }

  isMenuComplete(orderArticle: OrderLineItem): boolean {
    if (!orderArticle.isMenu) return true
    // Produkt über `externalId` auflösen — `_id` ist seit #230 die Zeilen-Identität
    // und findet im Katalog nichts mehr (`_id` bleibt Fallback für Bestands-Zeilen).
    const article: ProductSchema | undefined =
      (orderArticle.externalId ? this.productService.findProductByExternalId(orderArticle.externalId) : undefined) ??
      this.productService.findProductById(orderArticle._id)
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

  /** „Übersicht" und „Schließen": Bestellung nach Rückfrage verwerfen und die Kasse verlassen. */
  async leave(): Promise<void> {
    if (await this.confirmLeave()) this.closed.emit('cancelled')
  }

  /**
   * Darf die Kasse verlassen werden? Ohne jede Eingabe sofort, sonst erst nach Rückfrage —
   * gilt fürs X wie für Browser-Zurück und jeden anderen Routenwechsel (core#828). Bei Ja ist
   * die Bestellung als abgebrochen protokolliert.
   */
  async confirmLeave(): Promise<boolean> {
    if (!this.#hadInput) {
      if (!this.isFollowUp()) this.#logCancelled()
      return true
    }
    // Nur die zwei Tasten beenden die Rückfrage — ein Tipp daneben soll weder verwerfen
    // noch versehentlich zurück in die Bestellung führen, ohne dass es jemand merkt.
    const discard = await firstValueFrom(
      this.matDialog
        .open(ConfirmDialogComponent, {
          width: '23.75rem',
          maxWidth: '95vw',
          panelClass: 'rounded-dialog',
          disableClose: true,
          data: {
            title: 'Bestellung verwerfen?',
            message: 'Die eingegebenen Positionen gehen verloren.',
            confirmText: 'Bestellung verwerfen',
            cancelText: 'Weiter bearbeiten',
            confirmVariant: 'danger',
            icon: 'trash',
          } satisfies ConfirmDialogData,
        })
        .afterClosed(),
      { defaultValue: undefined },
    )
    if (discard !== true) return false
    this.#logCancelled()
    return true
  }

  /** Leert den Warenkorb, ohne den Dialog zu schließen — kein Rückgängig, deshalb wie beim X erst nachfragen (#795). */
  #confirmClearOrder(): void {
    if (this.#lineItems.length === 0) {
      this.unselectProduct()
      return
    }
    this.matDialog
      .open(ConfirmDialogComponent, {
        width: '23.75rem',
        maxWidth: '95vw',
        panelClass: 'rounded-dialog',
        disableClose: true,
        data: {
          title: 'Bestellung leeren?',
          message: 'Alle Positionen, Rabatte und Codes werden entfernt.',
          confirmText: 'Bestellung leeren',
          cancelText: 'Abbrechen',
          confirmVariant: 'danger',
          icon: 'broom',
        } satisfies ConfirmDialogData,
      })
      .afterClosed()
      .subscribe(confirmed => {
        if (confirmed !== true) return
        // Voller Reset wie beim X: Rabatte, Code, Positionsrabatte, Undo, Bestellbeginn (core#734)
        this.deleteOrder()
        this.unselectProduct()
      })
  }

  /**
   * Verworfen ist verworfen, auch wenn das Abmelden danach scheitert (offline, Ausstempeln abgelehnt): Die Kasse
   * steht dann leer, statt eine schon als abgebrochen protokollierte Bestellung weiter zu zeigen (core#1064).
   */
  #clearForSessionEnd(): void {
    this.deleteOrder()
    this.unselectProduct()
    this.#hadInput = false
  }

  #logCancelled(): void {
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

    this.#invalidateUndo()
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
    // Eine späte Antwort darf die Liste nicht in eine Ansicht schreiben, die inzwischen gewechselt hat
    // (`clearButtons` zählt `#customerRequest` hoch).
    const request = ++this.#customerRequest
    this.corporateCustomerService.find({ query: { $sort: { name1: 1 }, $limit: 200 } }).then(
      response => {
        if (request !== this.#customerRequest) return
        const customers = Array.isArray(response) ? response : response.data
        this.corporateCustomers = customers
        this.totalCorporateCustomers = Array.isArray(response) ? response.length : response.total
        this.#cdr.markForCheck()
      },
      () => {
        // `BaseService.find` hat den Fehler schon gemeldet.
      },
    )
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

    // Personalessen ist rabatt-exklusiv (assertStaffMealDiscountExclusivity) — ein
    // zuvor gewählter Order-Rabatt entfällt beim Abschluss ohnehin. Ihn hier
    // wegzuräumen macht das sichtbar, statt ihn bis zum Abschluss im Dialog stehen
    // zu lassen und dann stumm zu verwerfen (#234). Gegenrichtung sperrt bereits
    // `openDiscountPicker()`.
    if (this._staffMealOrder && this.selectedManualDiscount()) {
      this.selectedManualDiscount.set(null)
      this.setInfoBoxText('Personalessen: gewählter Rabatt wurde entfernt', 'red')
      this.#cdr.markForCheck()
    }
  }

  numpadAction(number: number): void {
    this.concatMultiplier(number)
    this.concatProductSearch(number)
  }

  private concatMultiplier(number: number) {
    if (this.multiplierFirstStep) {
      // Die erste Ziffer ersetzt die Startmenge 1. Eine 0 ergäbe Menge 0: die nächste Kachel buchte eine Zeile
      // „0×" für 0 €. Als erste Ziffer bleibt sie ohne Wirkung (core#837); 10, 20 … bleiben möglich.
      if (number === 0) return
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

    const matches = this.#numpadProducts(this._numpadNumber)

    if (matches.length > 1) {
      // Bei Doppelvergabe entschied früher die Cache-Reihenfolge still über das gebuchte Produkt.
      this.setInfoBoxText(
        `Artikelnummer ${this._numpadNumber} ist mehrfach vergeben (${matches.map(p => p.name).join(', ')}). Bitte im Raster wählen.`,
        'red',
      )
      // Die Ziffern standen zugleich im Multiplier; ohne Reset bucht die Kachel danach die Nummer als Menge.
      this.numpadReset()
      return
    }

    const article: undefined | ProductSchema = matches[0]

    if (!article) return

    this.increaseLineItem(article, 1)

    const skipViewChange = !(
      (article as any).isMenu ||
      (article as any).showSaucesAfterSelect ||
      (article as any).isMenuDrink ||
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
    return this.productGroups.find((articleGroup: ProductGroup) => articleGroup._id === id)?.color || ''
  }
}
