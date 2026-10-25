// JIT-Compiler zuerst laden: @angular/material ist partial-compiled; ohne Linker
// (kein analogjs-Plugin in dieser node-Vitest-Config) faellt Angular auf JIT zurueck.
import '@angular/compiler'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import {
  ChangeDetectorRef,
  DestroyRef,
  Injector,
  runInInjectionContext,
  signal,
  ɵAfterRenderManager,
  ɵChangeDetectionScheduler,
  ɵEffectScheduler,
} from '@angular/core'
import { MatDialog } from '@angular/material/dialog'
import { NotificationService } from '@panary/shared/ui-notifications'
import { TranslateService } from '@ngx-translate/core'
import { of } from 'rxjs'

import { OrderCheckoutService, OrderInteractionService, OrderService } from '@panary/orders/data-access'
import type { AppliedDiscount } from '@panary/orders/domain'
import { ProductGroupService } from '@panary/product-groups/data-access'
import { ProductService } from '@panary/products/data-access'
import type { ProductSchema } from '@panary/products/domain'
import { DiscountCodeService, DiscountService } from '@panary/discounts/data-access'
import type { Discount as ManagedDiscount } from '@panary/discounts/domain'
import { AuthService } from '@panary/auth/data-access'
import { PosHandednessService, UserService } from '@panary/users/data-access'
import { resolvePosHandedness } from '@panary/users/domain'
import { LocationService } from '@panary/locations/data-access'
import { PreOrderService } from '@panary/pre-orders/data-access'
import { ConnectionService, TenantSuspensionService } from '@panary/shared/data-access'
import { DeviceConfigService } from '@panary/shared/data-access-config'

import { KasseDraftRegistry } from './kasse-draft-registry'
import { OrderDialogComponent } from './order-dialog.component'

/**
 * Charakterisierungs-Specs der Rabatt- und Checkout-Verdrahtung (#231).
 *
 * Geprueft wird ausdruecklich **nicht** die Rabatt-Logik — die liegt in
 * `line-discount.ts` / `promo-code.ts` und hat dort eigene Specs. Hier steht die
 * Frage, ob die Komponente diese Extrakte an allen Stellen **aufruft**, an denen
 * sie es muss: Reset beim Loeschen, Gates vor dem Oeffnen der Picker, und der
 * Snapshot-Bau in `placeOrder`. Das faellt sonst erst am Bon auf.
 *
 * Aufbau wie `orders/data-access/.../order.service.spec.ts`: echte Instanz ohne
 * TestBed, alle `inject()`-Tokens als `useValue`-Mocks in einem eigenen Injector.
 * Kein TestBed, weil diese Lib mit `environment: 'node'` laeuft — TestBed braeuchte
 * jsdom plus Test-Environment-Setup, also mehr Gerüst als Tests (#231, ADR 0011).
 *
 * Alles je Test angelegt (`.claude/rules/code-style.md` §10): `setup()` erzeugt
 * Injector, Mocks und Aufzeichnungsobjekte pro Aufruf, nichts liegt im
 * `describe`-Scope.
 */

interface SetupOptions {
  /** Ergebnis von `discountService.activePosDiscounts()` — Quelle des zugewiesenen Personalessen-Rabatts. */
  activeDiscounts?: ManagedDiscount[]
  /** `staffMealDiscountId` des angemeldeten Benutzers. */
  staffMealDiscountId?: string
  /** Antwort auf `discountCodeService.redeem()` — Standard: Einloesung gelingt. */
  redeemResult?: Record<string, unknown>
  /** Produkte, aus denen `findProductById`/`findProductByExternalId` aufloesen (#273). */
  catalog?: ProductSchema[]
  /** `ConnectionService.tier()` — Standard: Kasse am Edge (cloud#1429). */
  tier?: 'cloud-direct' | 'standalone' | 'edge-with-cloud' | 'unknown'
  /** `posHandedness` des angemeldeten Mitarbeiters — fehlt es, gilt links (core#829). */
  posHandedness?: 'left' | 'right'
  /** `locationService.activeLocation` — Standard: Filiale schon geladen. Ein Signal spielt das Nachladen nach (core#868). */
  activeLocation?: () => unknown
  /**
   * `operationMode` der Filiale. Standard `orders-only`: Die bestehenden placeOrder-Specs prüfen den Weg ohne
   * Bezahlansicht; der Kassenbetrieb (`pos-cashier`) schaltet sie ein (core#831).
   */
  operationMode?: string
  /** Antwort von `OrderCheckoutService.payCash` — Standard: bezahlt. */
  payCashResult?: 'paid' | 'cash-session-declined' | 'failed'
  /** Was `OrderService.createOrder` liefert — `null` spielt ein gescheitertes Anlegen nach. */
  createOrderResult?: number | null
  /** Die ersten n Aufrufe von `createOrder` scheitern (Netzfehler) — danach gilt `createOrderResult`. */
  createOrderFailures?: number
  /** `createOrder` bleibt offen, bis der Test `releaseCreate()` ruft — spielt den Server-Roundtrip nach. */
  holdCreate?: boolean
}

const CURRENT_USER_ID = '018f0000-0000-7000-8000-000000000001'

/** Rabatt-Definition, wie sie die Cloud liefert (nur die im Snapshot benutzten Felder). */
const managedDiscount = (over: Partial<ManagedDiscount> = {}): ManagedDiscount =>
  ({
    _id: 'disc-20',
    name: '20 % Rabatt',
    valueType: 'percent',
    valuePercent: 20,
    valueCents: 0,
    isStaffMeal: false,
    ...over,
  }) as unknown as ManagedDiscount

/**
 * Produkt fuer `increaseLineItem`. `isMenu: true` macht daraus ein Bundle
 * (Legacy-Pfad in `BundleFlow.isBundleProduct`) — dort ist der Duplikat-Check
 * ausgesetzt, zwei Aufrufe ergeben also zwei Zeilen.
 */
const product = (id: string, over: Partial<ProductSchema> = {}): ProductSchema =>
  ({
    _id: id,
    externalId: `ext-${id}`,
    name: `Artikel ${id}`,
    price: 10,
    categoryIds: ['cat-1'],
    taxInside: 19,
    taxOutside: 7,
    ...over,
  }) as unknown as ProductSchema

function setup(options: SetupOptions = {}) {
  const createdOrders: Array<Record<string, unknown>> = []
  /** Aufrufe von `OrderCheckoutService.payCash` — die Bezahlansicht kassiert nur darüber (core#831). */
  const payCashCalls: Array<Record<string, unknown>> = []
  /** Offene `createOrder`-Aufrufe (`holdCreate`) — je Test eigene Liste (testing.md §10). */
  const heldCreates: Array<() => void> = []
  const redeemCalls: Array<Record<string, unknown>> = []
  const openedDialogs: Array<{ data?: unknown; disableClose?: boolean }> = []
  /** Was der `closed`-Output gemeldet hat — die Route entscheidet daraus, wie es weitergeht (core#828). */
  const closeCalls: unknown[] = []
  const kasseDraft = new KasseDraftRegistry()
  /** Protokollierte Interaktionen (Abbruch u. a.) — `orderInteractionService.create`. */
  const interactions: Array<Record<string, unknown>> = []
  /** Echte Meldungsquelle (core#1026) — der einzige Meldeweg, der den Dialogschluss ueberlebt. */
  const notifications = new NotificationService()
  /** Was gemeldet wurde, in Aufrufreihenfolge. */
  const notices: Array<{ message: string; action?: string; sticky: boolean }> = []
  /** Die gezeigten Meldungen — `triggerAction()` spielt den Klick auf „Rueckgaengig" nach. */
  const noticeRefs: Array<{ triggerAction: () => void; readonly dismissed: boolean }> = []
  const notify = notifications.notify.bind(notifications)
  vi.spyOn(notifications, 'notify').mockImplementation((type, message, options) => {
    notices.push({ message, action: options?.action?.label, sticky: options?.sticky === true })
    const ref = notify(type, message, options)
    noticeRefs.push({
      triggerAction: () => notifications.runAction(ref.id),
      get dismissed() {
        return !notifications.notifications().some(n => n.id === ref.id)
      },
    })
    return ref
  })
  /** Was `matDialog.open()` als Auswahl zurueckgibt — pro Test gesetzt. */
  const dialogResult = { value: undefined as unknown }

  /** Mandantensperre der Cloud (core#489) — pro Test per `suspended.set(true)` gesetzt. */
  const suspended = signal(false)

  /** Wahl im Avatar-Menü (core#833) — pro Test per `chosenHandedness.set('right')` gesetzt. */
  const chosenHandedness = signal<'left' | 'right' | undefined>(undefined)

  const currentUser = {
    _id: CURRENT_USER_ID,
    firstName: 'Anna',
    lastName: 'Alt',
    staffMealDiscountId: options.staffMealDiscountId,
    posHandedness: options.posHandedness,
  }

  const injector = Injector.create({
    providers: [
      {
        provide: OrderService,
        useValue: {
          productionTimes: [0, 5, 10],
          createOrder: (payload: Record<string, unknown>) => {
            createdOrders.push(payload)
            if (createdOrders.length <= (options.createOrderFailures ?? 0)) {
              return Promise.reject(new Error('Netz'))
            }
            const result = options.createOrderResult === undefined ? 0 : options.createOrderResult
            if (!options.holdCreate) return Promise.resolve(result)
            return new Promise(resolve => heldCreates.push(() => resolve(result)))
          },
        },
      },
      {
        provide: OrderCheckoutService,
        useValue: {
          payCash: (input: Record<string, unknown>) => {
            payCashCalls.push(input)
            return Promise.resolve(options.payCashResult ?? 'paid')
          },
        },
      },
      {
        provide: DiscountService,
        useValue: {
          loadActivePosDiscounts: () => Promise.resolve(),
          activePosDiscounts: () => options.activeDiscounts ?? [],
        },
      },
      {
        provide: DiscountCodeService,
        useValue: {
          redeem: (input: Record<string, unknown>) => {
            redeemCalls.push(input)
            return Promise.resolve(options.redeemResult ?? { ok: true, code: input['code'] })
          },
        },
      },
      {
        provide: AuthService,
        useValue: { user: () => currentUser, isAdmin: () => false, tenantId: () => 'tenant-1' },
      },
      {
        provide: UserService,
        useValue: { get: () => Promise.resolve(currentUser), currentUser: () => currentUser },
      },
      {
        provide: LocationService,
        useValue: {
          // Ohne aktive Filiale blockiert `blockingReason` die Kasse —
          // hier reicht die Minimalform, der Geschaeftstag spielt fuer Rabatte keine Rolle.
          activeLocation:
            options.activeLocation ??
            (() => ({ _id: 'loc-1', settings: {}, operationMode: options.operationMode ?? 'orders-only' })),
          currentBusinessDay: { businessDayId: 'bd-1', date: '2026-08-14' },
        },
      },
      {
        provide: ProductGroupService,
        useValue: {
          isLoaded: () => true,
          loadDocuments: () => Promise.resolve(),
          productGroups: signal([]),
          getProductGroupById: () => ({ name: 'Speisen' }),
        },
      },
      {
        provide: ProductService,
        useValue: {
          extras: signal([]),
          // Schließen des Anpassen-Panels führt zurück ins Raster der Produktgruppe (#639).
          getProductsByGroupId: () => [],
          findProductById: (id: string) => (options.catalog ?? []).find(p => p._id === id),
          findProductByExternalId: (externalId: string) =>
            (options.catalog ?? []).find(p => p.externalId === externalId),
          // Ziffernblock-Suche nach Artikelnummer — im Test ohne Treffer (#795: Multiplikator).
          findProductsByIndex: () => [],
        },
      },
      {
        provide: MatDialog,
        useValue: {
          open: (_component: unknown, config?: { data?: unknown; disableClose?: boolean }) => {
            openedDialogs.push({ data: config?.data, disableClose: config?.disableClose })
            return { afterClosed: () => of(dialogResult.value) }
          },
        },
      },
      { provide: KasseDraftRegistry, useValue: kasseDraft },
      { provide: NotificationService, useValue: notifications },
      {
        provide: OrderInteractionService,
        useValue: {
          create: (payload: Record<string, unknown>) => {
            interactions.push(payload)
            return Promise.resolve()
          },
        },
      },
      { provide: PreOrderService, useValue: {} },
      { provide: DeviceConfigService, useValue: {} },
      {
        provide: ConnectionService,
        useValue: { systemMode: () => 'connected', tier: () => options.tier ?? 'edge-with-cloud' },
      },
      { provide: TenantSuspensionService, useValue: { suspended } },
      {
        provide: PosHandednessService,
        useValue: { effective: (user: unknown) => chosenHandedness() ?? resolvePosHandedness(user as never) },
      },
      { provide: TranslateService, useValue: { instant: (key: string) => key } },
      // Ausserhalb einer gerenderten Komponente gibt es keinen echten
      // ChangeDetectorRef — markForCheck ist hier ohne Wirkung und ohne Belang.
      { provide: ChangeDetectorRef, useValue: { markForCheck: () => undefined, detectChanges: () => undefined } },
      // Der `effect()` im Konstruktor beobachtet die Produktgruppen-Sichtbarkeit und
      // braucht die Scheduler des Framework-Injectors, die ein `Injector.create` nicht
      // mitbringt (NG0201). Die Stubs halten den Effect ruhig: Er wird angelegt, aber
      // nie ausgefuehrt — die Rabatt-Verdrahtung haengt nicht an ihm.
      { provide: ɵChangeDetectionScheduler, useValue: { notify: () => undefined } },
      {
        provide: ɵEffectScheduler,
        useValue: { add: () => undefined, schedule: () => undefined, remove: () => undefined },
      },
      // `afterRenderEffect` (Warenkorb-Scroll, core#1047) meldet sich beim AfterRenderManager an — derselbe Fall wie
      // die Scheduler oben: angelegt, nie ausgefuehrt, weil hier nichts rendert.
      {
        provide: ɵAfterRenderManager,
        useValue: { impl: { register: () => undefined, unregister: () => undefined }, execute: () => undefined },
      },
      { provide: DestroyRef, useValue: { onDestroy: () => () => undefined } },
    ],
  })

  // Direkt instanziieren statt `createComponent` (Muster: device-assignment.spec):
  // geprueft wird die Verdrahtung, nicht das Rendering. `private`/`protected` sind
  // nur TS-Sichtbarkeiten; zur Laufzeit sind die Member da.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component = runInInjectionContext(injector, () => new OrderDialogComponent()) as any
  component.closed.subscribe((reason: unknown) => closeCalls.push(reason))

  return {
    component,
    createdOrders,
    payCashCalls,
    releaseCreate: () => heldCreates.splice(0).forEach(release => release()),
    redeemCalls,
    openedDialogs,
    closeCalls,
    kasseDraft,
    interactions,
    notices,
    noticeRefs,
    dialogResult,
    suspended,
    chosenHandedness,
  }
}

/** Legt `count` Zeilen desselben Bundle-Produkts an und gibt die `_id`s zurueck. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addBundleLines(component: any, count: number, id = 'p-menu'): string[] {
  for (let i = 0; i < count; i++) component['increaseLineItem'](product(id, { isMenu: true } as never))
  return component['lineItems'].map((l: { _id: string }) => l._id)
}

/**
 * Setzt einen Positionsrabatt auf die Zeile an `index`.
 *
 * Die Zeilen-ID wird gelesen, nicht geraten: Seit #230 ist sie eine `uuidv7` und
 * nicht mehr die Produkt-ID, unter der ein Test sie vorher direkt ablegen konnte.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function discountLine(component: any, index: number, discount: ManagedDiscount = managedDiscount()): string {
  const id = component['lineItems'][index]._id as string
  component['lineDiscounts'].update((current: Record<string, ManagedDiscount>) => ({ ...current, [id]: discount }))
  return id
}

describe('OrderDialog — Reset-Pfade der Positionsrabatte', () => {
  it('deleteOrder() raeumt manuellen Rabatt, Code UND Positionsrabatte weg', () => {
    const { component } = setup()
    component.increaseLineItem(product('p-1'))
    component.selectedManualDiscount.set(managedDiscount())
    component.appliedCodeDiscount.set({ ok: true, code: 'SOMMER' })
    discountLine(component, 0)

    component.deleteOrder()

    expect(component.selectedManualDiscount()).toBeNull()
    expect(component.appliedCodeDiscount()).toBeNull()
    expect(component.lineDiscounts()).toEqual({})
  })

  it('der Funktionsknopf „Bestellung leeren" setzt Rabatt, Code und Positionsrabatte zurueck (core#734)', () => {
    const { component, dialogResult } = setup()
    dialogResult.value = true // Rückfrage seit #795 bestätigt
    component.increaseLineItem(product('p-1'))
    component.selectedManualDiscount.set(managedDiscount())
    component.appliedCodeDiscount.set({ ok: true, code: 'SOMMER' })
    discountLine(component, 0)

    component.setDeleteSubbuttons()
    const button = component.functionButtons.find((b: { _id?: string }) => b._id === 'deleteOrder') as
      { callback?: () => unknown } | undefined
    button?.callback?.()

    expect(component.lineItems).toEqual([])
    expect(component.selectedManualDiscount()).toBeNull()
    expect(component.appliedCodeDiscount()).toBeNull()
    expect(component.lineDiscounts()).toEqual({})
  })

  it('deleteSelection() nimmt die Zeile UND ihren Rabatt mit', () => {
    // Bis #269 tat das `decreaseQuantity()` bei Menge 1 — Loeschen und Verringern
    // teilten sich ein Ziel. Der Loesch-Pfad liegt jetzt allein hier (ADR 0034).
    const { component } = setup()
    component.increaseLineItem(product('p-1'))
    discountLine(component, 0)
    component.selectProduct(0)

    component.deleteSelection()

    expect(component.lineItems).toHaveLength(0)
    expect(component.lineDiscounts()).toEqual({})
  })

  it('decreaseSelectedQuantity() laesst den Rabatt stehen, solange die Zeile bleibt', () => {
    const { component } = setup()
    component.increaseLineItem(product('p-1'))
    component.increaseLineItem(product('p-1')) // Duplikat-Check erhoeht die Menge
    const id = discountLine(component, 0)
    component.selectProduct(0)

    component.decreaseSelectedQuantity()

    expect(component.lineItems).toHaveLength(1)
    expect(component.lineItems[0].amount).toBe(1)
    expect(component.lineDiscounts()[id]).toBeDefined()
  })

  it('decreaseLineItem() raeumt den Rabatt der geloeschten Zeile weg', () => {
    const { component } = setup()
    component.increaseLineItem(product('p-1'))
    component.increaseLineItem(product('p-2'))
    discountLine(component, 0)
    const bleibt = discountLine(component, 1)
    component.selectProduct(0)

    component.decreaseLineItem()

    expect(component.lineDiscounts()).toEqual({ [bleibt]: expect.anything() })
  })

  it('decreaseCombination() raeumt die Rabatte aller Zeilen der Kombination weg', () => {
    const { component } = setup()
    component.increaseLineItem(product('p-1'))
    component.increaseLineItem(product('p-2'))
    discountLine(component, 0)
    discountLine(component, 1)
    component.combineAllArticles()
    component['_selectedCombinationIndex'] = [0, null]

    component.decreaseCombination()

    expect(component.lineItems).toHaveLength(0)
    expect(component.lineDiscounts()).toEqual({})
  })

  it('der geloeschte Artikel bringt seinen Rabatt beim Neuanlegen NICHT zurueck', () => {
    // Die Zeilen-`_id` ist die Produkt-ID (#230) — ohne das Wegraeumen beim Loeschen
    // traefe der alte Rabatt die neue Zeile, ohne dass ihn jemand gesetzt hat.
    const { component } = setup()
    component.increaseLineItem(product('p-1'))
    discountLine(component, 0)
    component.selectProduct(0)
    component.deleteSelection()

    component.increaseLineItem(product('p-1'))

    expect(component.lineDiscounts()).toEqual({})
    expect(component.lineDiscountOf(component.lineItems[0])).toBeUndefined()
  })
})

/**
 * Mengensteuerung und Loeschen laufen seit #269 ueber die Funktionsleiste (Spalte 2)
 * und wirken auf die Markierung (ADR 0034). Geprueft wird die Verdrahtung: was die
 * Tasten bei welcher Markierung tun, wann sie deaktiviert sind, und dass „Rueckgaengig"
 * alle drei Wirkungen des Loeschens zuruecknimmt — Zeile, Positionsrabatt UND das
 * `item-delete`-Ereignis. Letzteres ist nur ueber `placeOrder` sichtbar (`#`-Feld).
 */
describe('OrderDialog — Funktionsleiste: Menge und Loeschen auf die Markierung (#269)', () => {
  it('ohne Markierung sind alle drei Tasten deaktiviert und die Methoden No-Ops', () => {
    const { component, notices } = setup()
    component.increaseLineItem(product('p-1'))

    expect(component.canMutateSelection()).toBe(false)
    expect(component.canDecreaseSelection()).toBe(false)

    component.increaseSelectedQuantity()
    component.decreaseSelectedQuantity()
    component.deleteSelection()

    expect(component.lineItems).toHaveLength(1)
    expect(component.lineItems[0].amount).toBe(1)
    expect(notices).toHaveLength(0)
  })

  it('+ auf die markierte Zeile erhoeht die Menge und bietet „Rueckgaengig" an', () => {
    const { component, notices, noticeRefs } = setup()
    component.increaseLineItem(product('p-1'))
    component.selectProduct(0)

    component.increaseSelectedQuantity()

    expect(component.lineItems[0].amount).toBe(2)
    expect(notices).toEqual([{ message: 'Menge: 2× Artikel p-1', action: 'Rückgängig', sticky: false }])

    noticeRefs[0].triggerAction()

    expect(component.lineItems[0].amount).toBe(1)
  })

  it('ein verfallenes „Rueckgaengig" tut nichts mehr', () => {
    // Zwei Faelle: ein neueres Angebot loest das aeltere ab, und nach dem Leeren
    // des Warenkorbs (placeOrder ruft deleteOrder) darf nichts zurueckkommen.
    const { component, noticeRefs } = setup()
    component.increaseLineItem(product('p-1'))
    component.selectProduct(0)
    component.increaseSelectedQuantity() // -> 2
    component.increaseSelectedQuantity() // -> 3

    noticeRefs[0].triggerAction() // das aeltere Angebot

    expect(component.lineItems[0].amount).toBe(3)

    component.deleteOrder()
    noticeRefs[1].triggerAction()

    expect(component.lineItems).toHaveLength(0)
  })

  it('ein neues „Rueckgaengig" schliesst das aeltere — es steht hoechstens eines (core#1026)', () => {
    const { component, noticeRefs } = setup()
    component.increaseLineItem(product('p-1'))
    component.selectProduct(0)
    component.increaseSelectedQuantity() // -> 2
    component.increaseSelectedQuantity() // -> 3

    expect(noticeRefs.map(ref => ref.dismissed)).toEqual([true, false])
  })

  it('Minus bei Menge 1 ist deaktiviert und loescht NICHT', () => {
    const { component, notices } = setup()
    component.increaseLineItem(product('p-1'))
    component.selectProduct(0)

    expect(component.canMutateSelection()).toBe(true)
    expect(component.canDecreaseSelection()).toBe(false)

    component.decreaseSelectedQuantity()

    expect(component.lineItems).toHaveLength(1)
    expect(component.lineItems[0].amount).toBe(1)
    expect(notices).toHaveLength(0)
  })

  it('„Rueckgaengig" nach dem Loeschen bringt die Zeile MIT Rabatt zurueck und nimmt das item-delete mit', async () => {
    const { component, createdOrders, noticeRefs } = setup()
    component.increaseLineItem(product('p-1'))
    component.increaseLineItem(product('p-2'))
    const id = discountLine(component, 0)
    component.selectProduct(0)

    component.deleteSelection()

    expect(component.lineItems.map((l: { name: string }) => l.name)).toEqual(['Artikel p-2'])
    expect(component.lineDiscounts()).toEqual({})

    noticeRefs[0].triggerAction()

    // An der alten Stelle, nicht hinten angehaengt.
    expect(component.lineItems.map((l: { name: string }) => l.name)).toEqual(['Artikel p-1', 'Artikel p-2'])
    expect(component.lineItems[0]._id).toBe(id)
    expect(component.lineDiscounts()[id]).toBeDefined()

    await component.placeOrder()

    // Sonst zaehlte die Auswertung ein Storno, das nie stattfand.
    expect(createdOrders[0]['orderInteractions']).toEqual([])
  })

  it('ein NICHT zurueckgenommenes Loeschen hinterlaesst genau ein item-delete', async () => {
    const { component, createdOrders } = setup()
    component.increaseLineItem(product('p-1'))
    component.increaseLineItem(product('p-1')) // Menge 2
    component.selectProduct(0)

    component.deleteSelection()
    await component.placeOrder()

    const interactions = createdOrders[0]['orderInteractions'] as Array<Record<string, unknown>>
    expect(interactions.map(i => [i['type'], i['productId'], i['deletedQuantity']])).toEqual([
      ['item-delete', 'ext-p-1', 2],
    ])
  })

  it('markierte Kombination: + wirkt auf alle Positionen, Loeschen entfernt sie ganz', () => {
    const { component, noticeRefs } = setup()
    component.increaseLineItem(product('p-1'))
    component.increaseLineItem(product('p-2'))
    component.combineAllArticles()
    component.toggleCombinationSelection(0)

    component.increaseSelectedQuantity()

    expect(component.lineItems.map((l: { amount: number }) => l.amount)).toEqual([2, 2])

    component.deleteSelection()

    expect(component.lineItems).toHaveLength(0)

    noticeRefs[1].triggerAction()

    expect(component.lineItems).toHaveLength(2)
    expect(component.combinations).toHaveLength(1)
  })

  it('Kombination mit gemischten Mengen: Minus ist gesperrt, statt eine Position zu loeschen', () => {
    const { component } = setup()
    component.increaseLineItem(product('p-1'))
    component.increaseLineItem(product('p-1')) // Menge 2
    component.increaseLineItem(product('p-2')) // Menge 1
    component.combineAllArticles()
    component.toggleCombinationSelection(0)

    expect(component.canDecreaseSelection()).toBe(false)

    component.decreaseSelectedQuantity()

    expect(component.lineItems.map((l: { amount: number }) => l.amount)).toEqual([2, 1])
  })

  it('markierte Position IN der Kombination: Tasten wirken nur auf sie', () => {
    const { component, noticeRefs } = setup()
    component.increaseLineItem(product('p-1'))
    component.increaseLineItem(product('p-2'))
    component.combineAllArticles()
    component['_selectedCombinationIndex'] = [0, 1]

    component.increaseSelectedQuantity()

    expect(component.lineItems.map((l: { amount: number }) => l.amount)).toEqual([1, 2])

    component.deleteSelection()

    // Die auf eine Position geschrumpfte Kombination ist aufgeloest …
    expect(component.lineItems.map((l: { name: string }) => l.name)).toEqual(['Artikel p-1'])
    expect(component.combinations).toHaveLength(0)
    expect(component.lineItems[0].bundleNumber).toBeNull()

    noticeRefs[1].triggerAction()

    // … und nach „Rueckgaengig" wieder da, mit beiden Positionen.
    expect(component.combinations).toHaveLength(1)
    expect(component.combinations[0].map((l: { name: string }) => l.name)).toEqual(['Artikel p-1', 'Artikel p-2'])
  })

  it('der Header-Tap markiert die ganze Kombination, auch von einer Position aus; der zweite hebt sie auf (#795)', () => {
    const { component } = setup()
    component.increaseLineItem(product('p-1'))
    component.increaseLineItem(product('p-2'))
    component.combineAllArticles()
    component['_selectedCombinationIndex'] = [0, 1]

    component.toggleCombinationSelection(0)

    // Bis #795 hob der Tap hier die Markierung auf — am Gerät sah das aus, als täte
    // der Kopf nichts.
    expect(component.selectedCombinationIndex).toEqual([0, null])
    expect(component.canMutateSelection()).toBe(true)

    const vorher = component.functionButtons
    component.toggleCombinationSelection(0)

    expect(component.selectedCombinationIndex).toEqual([null, null])
    // Seit core#829 räumt das Aufheben nichts ab: Raster und Funktionstasten bleiben stehen.
    expect(component.functionButtons).toBe(vorher)
  })

  it('decreaseLineItem() (ABBRUCH im Bundle-Flow) entfernt auch eine Position in der Kombination', () => {
    // Bis #269 spleisste der Pfad in eine Wegwerf-Kopie von `getCombinations` — die
    // Zeile blieb still im Warenkorb, nur das item-delete wurde geschrieben.
    const { component } = setup()
    component.increaseLineItem(product('p-1'))
    component.increaseLineItem(product('p-2'))
    component.increaseLineItem(product('p-3'))
    component.combineAllArticles()
    component['_selectedCombinationIndex'] = [0, 1]

    component.decreaseLineItem()

    expect(component.lineItems.map((l: { name: string }) => l.name)).toEqual(['Artikel p-1', 'Artikel p-3'])
    expect(component.combinations).toHaveLength(1)
    expect(component.selectedCombinationIndex).toEqual([0, null])
  })
})

/**
 * Kacheltap bei markierter Kombination (#271). Bis dahin pushte `increaseLineItem`
 * in die Wegwerf-Kopie aus `getCombinations` — der Artikel war danach nirgends,
 * gemessen am 2026-09-12: drei Taps, zwei Zeilen. Geprueft wird, dass die Zeile in
 * `#lineItems` landet, die `bundleNumber` der Kombination traegt, und dass der
 * Bundle-Flow in der Kombination auf der tatsaechlich angelegten Zeile arbeitet.
 */
describe('OrderDialog — Kacheltap bei markierter Kombination (#271)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function combinedPair(component: any): void {
    component.increaseLineItem(product('p-1'))
    component.increaseLineItem(product('p-2'))
    component.combineAllArticles()
    component.toggleCombinationSelection(0)
  }

  it('der Artikel wird Position der markierten Kombination', () => {
    const { component } = setup()
    combinedPair(component)

    component.increaseLineItem(product('p-3'))

    expect(component.lineItems.map((l: { name: string }) => l.name)).toEqual([
      'Artikel p-1',
      'Artikel p-2',
      'Artikel p-3',
    ])
    expect(component.combinations[0].map((l: { name: string }) => l.name)).toEqual([
      'Artikel p-1',
      'Artikel p-2',
      'Artikel p-3',
    ])
    expect(component.lineItems[2].bundleNumber).toBe(component.lineItems[0].bundleNumber)
    // Die Kombination bleibt markiert — der naechste Tap legt dort weiter ab.
    expect(component.selectedCombinationIndex).toEqual([0, null])
  })

  it('derselbe Artikel nochmal erhoeht die Menge IN der Kombination statt eine zweite Zeile anzulegen', () => {
    const { component } = setup()
    combinedPair(component)

    component.increaseLineItem(product('p-1'))

    expect(component.lineItems).toHaveLength(2)
    expect(component.lineItems[0].amount).toBe(2)
  })

  it('eine gleiche Zeile AUSSERHALB der Kombination zaehlt nicht als Duplikat', () => {
    // Die Pommes neben dem Menue sind nicht die Pommes im Menue.
    const { component } = setup()
    component.increaseLineItem(product('p-3'))
    combinedPair(component) // kombiniert ALLE drei — deshalb erst p-3 wieder herausloesen:
    component['_selectedCombinationIndex'] = [0, 0]
    component.deleteSelection()
    component.increaseLineItem(product('p-3')) // ohne Markierung: normale Zeile
    component.toggleCombinationSelection(0)

    component.increaseLineItem(product('p-3'))

    const rows = component.lineItems.map((l: { name: string; amount: number; bundleNumber: unknown }) => [
      l.name,
      l.amount,
      l.bundleNumber !== null,
    ])
    expect(rows).toEqual([
      ['Artikel p-1', 1, true],
      ['Artikel p-2', 1, true],
      ['Artikel p-3', 1, false],
      ['Artikel p-3', 1, true],
    ])
  })

  it('ein Bundle-Produkt in der Kombination startet den Flow auf der angelegten Zeile', () => {
    const { component } = setup()
    combinedPair(component)
    const menu = product('p-menu', {
      productType: 'BUNDLE',
      optionGroups: [{ id: 'og-1', name: 'Beilage', minSelections: 1, maxSelections: 1, options: [] }],
    } as never)

    component.increaseLineItem(menu)

    expect(component['_isBlocked']).toBe(true)
    expect(component.selectedCombinationIndex).toEqual([0, 2])
    expect(component['getCurrentSelectedLineItem']()?.name).toBe('Artikel p-menu')
    expect(component.lineItems[2].bundleNumber).toBe(component.lineItems[0].bundleNumber)

    // ABBRUCH-Pfad: die Zeile geht wieder, die Kombination bleibt.
    component.decreaseLineItem()

    expect(component.lineItems.map((l: { name: string }) => l.name)).toEqual(['Artikel p-1', 'Artikel p-2'])
    expect(component.combinations).toHaveLength(1)
  })

  it('eine Markierung auf eine Kombination, die es nicht mehr gibt, faellt auf den Normalmodus zurueck', () => {
    const { component } = setup()
    component.increaseLineItem(product('p-1'))
    component['_selectedCombinationIndex'] = [4, null]

    component.increaseLineItem(product('p-2'))

    expect(component.lineItems.map((l: { name: string; bundleNumber: unknown }) => [l.name, l.bundleNumber])).toEqual([
      ['Artikel p-1', null],
      ['Artikel p-2', null],
    ])
    expect(component.selectedCombinationIndex).toEqual([null, null])
  })
})

/**
 * Extras-Tap ohne stillen Rueckweg (#273). Kundenmeldung 2026-09-12: Tap auf „Mayo"
 * tat nichts und sagte nichts — `increaseExtra` kehrte bei einem Produkt ohne
 * `productType: MODIFIER` wortlos zurueck, obwohl die Optionsgruppe die Kachel
 * zeigt. Geprueft wird, dass jeder Tap ein sichtbares Ergebnis hat: Buchung oder
 * Begruendung (dieselbe Regel wie ADR 0034, vgl. #269/#271).
 */
describe('OrderDialog — Extras-Tap meldet statt still zurueckzukehren (#273)', () => {
  /** Produkt einer Optionsgruppe — `productType` steuert, ob es als Extra buchbar ist. */
  const extraProduct = (id: string, over: Partial<ProductSchema> = {}): ProductSchema =>
    product(id, { productType: 'MODIFIER', price: 0.5, ...over } as Partial<ProductSchema>)

  it('Tap auf ein Produkt, das kein Modifier ist, bucht nichts und nennt den Produkttyp', () => {
    const { component } = setup()
    component.increaseLineItem(product('pommes'))
    component.selectProduct(0)

    component.increaseExtra(extraProduct('mayo', { name: 'Mayo', productType: 'PRODUCT' }))

    expect(component.lineItems[0].modifiers).toEqual([])
    expect(component.infoBoxText).toBe('„Mayo" ist kein Extra (Produkttyp: PRODUCT) — im Admin auf Modifier stellen')
    expect(component.notice()?.tone).toBe('danger')
  })

  it('ein fehlendes `productType` steht als „fehlt" in der Meldung', () => {
    // Genau der Fall aus der Kundenmeldung: Der Cloud-CSV-Import ohne Typ-Spalte
    // laesst das Feld leer bzw. setzt PRODUCT — beides ist am Geraet unbedienbar.
    const { component } = setup()
    component.increaseLineItem(product('pommes'))
    component.selectProduct(0)

    component.increaseExtra(extraProduct('mayo', { name: 'Mayo', productType: undefined }))

    expect(component.infoBoxText).toBe('„Mayo" ist kein Extra (Produkttyp: fehlt) — im Admin auf Modifier stellen')
  })

  it('ohne markierte Zeile meldet der Tap die fehlende Markierung', () => {
    // Das Extras-Raster kann stehenbleiben, waehrend die Markierung schon weg ist.
    const { component } = setup()
    component.increaseLineItem(product('pommes'))

    component.increaseExtra(extraProduct('mayo', { name: 'Mayo' }))

    expect(component.lineItems[0].modifiers).toEqual([])
    expect(component.infoBoxText).toBe('Erst eine Position im Warenkorb antippen')
    expect(component.notice()?.tone).toBe('danger')
  })

  it('der Gutfall bucht unveraendert unter die markierte Zeile', () => {
    const { component } = setup()
    component.increaseLineItem(product('pommes'))
    component.selectProduct(0)

    component.increaseExtra(extraProduct('mayo', { name: 'Mayo' }))

    expect(component.lineItems[0].modifiers).toHaveLength(1)
    expect(component.lineItems[0].modifiers[0]).toMatchObject({ name: 'Mayo', amount: 1 })
  })

  it('Minus: derselbe Tap meldet dasselbe und legt keine „ohne"-Zeile an', () => {
    const { component } = setup()
    component.increaseLineItem(product('pommes'))
    component.selectProduct(0)

    component.decreaseExtra(extraProduct('mayo', { name: 'Mayo', productType: 'PRODUCT' }))

    expect(component.lineItems[0].modifiers).toEqual([])
    expect(component.infoBoxText).toBe('„Mayo" ist kein Extra (Produkttyp: PRODUCT) — im Admin auf Modifier stellen')
  })

  it('Minus akzeptiert Legacy-Extras genauso wie Plus', () => {
    // Vor #273 pruefte `decreaseExtra` ohne die Legacy-Flags: Ein Alt-Katalog-Extra
    // liess sich hinzufuegen, aber nicht abwaehlen — und haette faelschlich
    // „ist kein Extra" gemeldet ueber eine Kachel, die im PLUS-Modus funktioniert.
    // Seit #639 nimmt Minus nur Gebuchtes zurueck, einen OHNE-Marker legt es nicht mehr an.
    const { component } = setup()
    component.increaseLineItem(product('pommes'))
    component.selectProduct(0)
    const mayo = () =>
      extraProduct('mayo', { name: 'Mayo', productType: undefined, isExtra: true } as Partial<ProductSchema>)

    component.increaseExtra(mayo())
    component.decreaseExtra(mayo())

    expect(component.lineItems[0].modifiers).toEqual([])
    expect(component.infoBoxText).not.toContain('ist kein Extra')
  })

  it('das Extras-Raster kennzeichnet falsch typisierte Kacheln, bevor jemand tippt', () => {
    const mayo = product('mayo', { name: 'Mayo', productType: 'PRODUCT' } as Partial<ProductSchema>)
    const ketchup = product('ketchup', { name: 'Ketchup', productType: 'MODIFIER' } as Partial<ProductSchema>)
    const pommes = product('pommes', {
      optionGroups: [
        {
          id: 'group-1',
          name: 'Dips',
          minSelections: 0,
          maxSelections: 2,
          freeQuantity: 0,
          options: [{ productId: 'mayo' }, { productId: 'ketchup' }],
        },
      ],
    } as unknown as Partial<ProductSchema>)
    const { component } = setup({ catalog: [pommes, mayo, ketchup] })
    component.increaseLineItem(pommes)

    // Mit Optionsgruppen öffnet die Auswahl seit #639 das Panel; das Raster gibt es weiter
    // über „Alle Modifier" (`grid = true`). Beide Wege müssen die Fehlkonfiguration zeigen.
    component.selectProduct(0)
    expect(
      component
        .customizeModel()
        ?.groups[0].options.map((o: { name: string; isModifier: boolean }) => [o.name, o.isModifier]),
    ).toEqual([
      ['Mayo', false],
      ['Ketchup', true],
    ])

    component.setExtraSubButtons(undefined, undefined, false, true)
    const tiles: Array<{ name: string; iconName?: string }> = component.productButtons
    expect(tiles.find(t => t.name === 'Mayo')?.iconName).toBe('warning')
    expect(tiles.find(t => t.name === 'Ketchup')?.iconName).toBeUndefined()
  })
})

describe('OrderDialog — Zeilen-Identitaet (#230)', () => {
  it('jede Zeile bekommt eine eigene ID, nicht die des Produkts', () => {
    const { component } = setup()
    component.increaseLineItem(product('p-1'))

    const line = component.lineItems[0]
    expect(line._id).not.toBe('p-1')
    // Die Produkt-Identitaet steht weiterhin auf der Zeile — sie traegt jetzt nur
    // ein anderes Feld.
    expect(line.externalId).toBe('ext-p-1')
  })

  it('derselbe Nicht-Bundle-Artikel zweimal erhoeht die Menge statt eine zweite Zeile anzulegen', () => {
    // Bestandsverhalten, das die ID-Umstellung NICHT aendern darf: Der Duplikat-Check
    // laeuft seit #230 ueber `externalId` statt ueber `_id`.
    const { component } = setup()
    component.increaseLineItem(product('p-1'))
    component.increaseLineItem(product('p-1'))

    expect(component.lineItems).toHaveLength(1)
    expect(component.lineItems[0].amount).toBe(2)
  })

  it('zwei verschiedene Artikel bleiben zwei Zeilen', () => {
    const { component } = setup()
    component.increaseLineItem(product('p-1'))
    component.increaseLineItem(product('p-2'))

    expect(component.lineItems).toHaveLength(2)
  })

  it('Artikel ohne externalId fallen NICHT zu einer Zeile zusammen', () => {
    // Das Schema erlaubt `externalId: null`; `increaseLineItem` macht daraus `''`.
    // Ohne die Leer-Absicherung im Duplikat-Check haetten alle Alt-Produkte denselben
    // Schluessel und der Warenkorb fiele zu einer einzigen Zeile zusammen.
    const { component } = setup()
    component.increaseLineItem(product('p-1', { externalId: null } as never))
    component.increaseLineItem(product('p-2', { externalId: null } as never))

    expect(component.lineItems).toHaveLength(2)
    expect(component.lineItems[0]._id).not.toBe(component.lineItems[1]._id)
  })

  it('isMenuComplete() loest das Produkt weiterhin auf — ueber externalId', () => {
    // Die Menue-Vollstaendigkeit faerbt die Zeile im Warenkorb rot. Sie loeste das
    // Produkt ueber `lineItem._id` auf; nach #230 findet der Katalog darunter nichts
    // mehr. Hier zaehlt, DASS der Lookup die Zeile trifft — die Legacy-Flags dahinter
    // (`isMenuSideDish`/`isMenuDrink`) stehen nicht mehr im ProductSchema, siehe PR.
    const gefunden: string[] = []
    const { component } = setup()
    component['productService'].findProductByExternalId = (ext: string) => {
      gefunden.push(ext)
      return { isMenuSideDish: true } as never
    }
    component.increaseLineItem(product('p-menu', { isMenu: true } as never))

    expect(component.isMenuComplete(component.lineItems[0])).toBe(false)
    expect(gefunden).toEqual(['ext-p-menu'])
  })

  it('die Mehrdeutigkeits-Sperre aus #179 feuert im Normalbetrieb nicht mehr', () => {
    // Sie bleibt als Rueckfallsicherung stehen (Bestands-Orders, kuenftige Regressionen),
    // darf aber keinen regulaeren Vorgang mehr blockieren.
    const { component } = setup()
    addBundleLines(component, 3)

    for (let i = 0; i < 3; i++) {
      component.selectProduct(i)
      expect(component.canApplyLineDiscount()).toBe(true)
    }
    expect(new Set(component.lineItems.map((l: { _id: string }) => l._id)).size).toBe(3)
  })
})

describe('OrderDialog — Gate-Verdrahtung der Rabatt-Picker', () => {
  it('canApplyLineDiscount() ist bei Personalessen gesperrt', () => {
    const { component } = setup()
    component.increaseLineItem(product('p-1'))
    component.selectProduct(0)
    component.setAsStaffMealOrder()

    expect(component.canApplyLineDiscount()).toBe(false)
  })

  it('canApplyLineDiscount() ist ohne markierte Zeile gesperrt', () => {
    const { component } = setup()
    component.increaseLineItem(product('p-1'))

    expect(component.canApplyLineDiscount()).toBe(false)
  })

  it('zwei gleiche Menues sind zwei unterscheidbare Zeilen — der Positionsrabatt ist erlaubt', () => {
    // Kern von #230: Der Bundle-Pfad setzt den Duplikat-Check bewusst aus (zwei Menues
    // sind zwei Zeilen). Vorher trugen beide die Produkt-ID, und die Mehrdeutigkeits-
    // Sperre aus #179 verhinderte den Rabatt. Jetzt hat jede Zeile ihre eigene `uuidv7`.
    const { component } = setup()
    const ids = addBundleLines(component, 2)
    component.selectProduct(0)

    expect(component.lineItems).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
    expect(ids).not.toContain('p-menu')
    expect(component.canApplyLineDiscount()).toBe(true)
  })

  it('ein Rabatt auf das erste Menue laesst das zweite unberuehrt', () => {
    const { component } = setup()
    const ids = addBundleLines(component, 2)

    discountLine(component, 0)

    expect(component.lineDiscountOf(component.lineItems[0])).toBeDefined()
    expect(component.lineDiscountOf(component.lineItems[1])).toBeUndefined()
    expect(Object.keys(component.lineDiscounts())).toEqual([ids[0]])
  })

  it('canApplyLineDiscount() erlaubt den Normalfall', () => {
    const { component } = setup()
    component.increaseLineItem(product('p-1'))
    component.selectProduct(0)

    expect(component.canApplyLineDiscount()).toBe(true)
  })

  it('openLineDiscountPicker() oeffnet nichts und meldet, wenn das Gate sperrt', () => {
    const { component, openedDialogs } = setup()
    component.increaseLineItem(product('p-1')) // Zeile da, aber nicht markiert

    component.openLineDiscountPicker()

    expect(openedDialogs).toHaveLength(0)
    expect(component.infoBoxText).toBe('Erst eine Position im Warenkorb antippen')
  })

  it('openLineDiscountPicker() legt die Auswahl unter der Zeilen-ID ab', () => {
    const { component, openedDialogs, dialogResult } = setup()
    component.increaseLineItem(product('p-1'))
    component.selectProduct(0)
    dialogResult.value = managedDiscount()

    component.openLineDiscountPicker()

    expect(openedDialogs[0].data).toEqual({ scope: 'line', lineItemName: 'Artikel p-1' })
    expect(component.lineDiscounts()[component.lineItems[0]._id]).toBeDefined()
  })

  it('openDiscountPicker() oeffnet bei Personalessen nicht', () => {
    const { component, openedDialogs } = setup()
    component.setAsStaffMealOrder()

    component.openDiscountPicker()

    expect(openedDialogs).toHaveLength(0)
    expect(component.infoBoxText).toBe('Personalessen: kein zusätzlicher Rabatt möglich')
  })

  it('openPromoCodeDialog() oeffnet bei Personalessen nicht', () => {
    const { component, openedDialogs } = setup()
    component.setAsStaffMealOrder()

    component.openPromoCodeDialog()

    expect(openedDialogs).toHaveLength(0)
    expect(component.appliedCodeDiscount()).toBeNull()
  })

  it('openPromoCodeDialog() oeffnet im Tarif cloud-direct nicht und nennt den Grund (cloud#1429)', () => {
    const { component, openedDialogs } = setup({ tier: 'cloud-direct' })

    component.openPromoCodeDialog()

    expect(openedDialogs).toHaveLength(0)
    expect(component.infoBoxText).toBe('Rabattcodes sind an dieser Kasse (Cloud direkt) noch nicht verfügbar')
  })

  it('openPromoCodeDialog() oeffnet nicht, solange ein manueller Rabatt gewaehlt ist', () => {
    const { component, openedDialogs } = setup()
    component.selectedManualDiscount.set(managedDiscount())

    component.openPromoCodeDialog()

    expect(openedDialogs).toHaveLength(0)
    expect(component.infoBoxText).toBe('Es ist bereits ein Rabatt gewählt — erst entfernen')
  })
})

describe('OrderDialog — Snapshot-Bau in placeOrder', () => {
  const staffMealDiscount = managedDiscount({ _id: 'disc-staff', name: 'Personalessen', isStaffMeal: true })

  it('Personalessen traegt genau einen Rabatt — auch wenn Positionsrabatte gesetzt sind', async () => {
    const { component, createdOrders } = setup({
      staffMealDiscountId: 'disc-staff',
      activeDiscounts: [staffMealDiscount],
    })
    component.increaseLineItem(product('p-1'))
    discountLine(component, 0)
    component.setAsStaffMealOrder()

    await component.placeOrder()

    const applied = createdOrders[0]['appliedDiscounts'] as AppliedDiscount[]
    expect(applied).toHaveLength(1)
    expect(applied[0]).toMatchObject({ discountId: 'disc-staff', target: 'order', isStaffMeal: true })
    expect(createdOrders[0]['staffMealDetails']).toMatchObject({ userId: CURRENT_USER_ID, isPaid: false })
  })

  it('Personalessen raeumt einen zuvor gewaehlten Order-Rabatt sichtbar weg', () => {
    // Reihenfolge erst Rabatt, dann Personalessen. Fachlich entfaellt der Rabatt
    // ohnehin (assertStaffMealDiscountExclusivity) — er darf aber nicht bis zum
    // Abschluss im Dialog stehenbleiben und dann stumm verschwinden (#234).
    const { component } = setup({ staffMealDiscountId: 'disc-staff', activeDiscounts: [staffMealDiscount] })
    component.increaseLineItem(product('p-1'))
    component.selectedManualDiscount.set(managedDiscount({ _id: 'disc-manual', name: 'Kulanz' }))

    component.setAsStaffMealOrder()

    expect(component.selectedManualDiscount()).toBeNull()
    expect(component.infoBoxText).toBe('Personalessen: gewählter Rabatt wurde entfernt')
  })

  it('Personalessen ohne gewaehlten Rabatt meldet nichts', () => {
    // Sonst stuende die Meldung bei jedem Druck auf die Taste da und waere in genau
    // dem Fall, der sie braucht, nicht mehr zu unterscheiden.
    const { component } = setup({ staffMealDiscountId: 'disc-staff', activeDiscounts: [staffMealDiscount] })
    component.increaseLineItem(product('p-1'))

    component.setAsStaffMealOrder()

    expect(component.infoBoxText).not.toBe('Personalessen: gewählter Rabatt wurde entfernt')
  })

  it('Personalessen abwaehlen raeumt keinen Rabatt weg', () => {
    // Geraeumt wird nur beim EINschalten. Der hier hergestellte Zustand
    // („Personalessen aktiv UND Rabatt gesetzt") ist ueber die UI nicht erreichbar,
    // weil `openDiscountPicker()` dann sperrt — die Richtungspruefung im Code haelt
    // aber fest, dass das Abwaehlen nichts wegnimmt. Ohne diesen Test faellt sie beim
    // naechsten Aufraeumen weg, und dann loescht ein Abwaehlen fremde Auswahl.
    const { component } = setup({ staffMealDiscountId: 'disc-staff', activeDiscounts: [staffMealDiscount] })
    component.increaseLineItem(product('p-1'))
    component.setAsStaffMealOrder()
    component.selectedManualDiscount.set(managedDiscount({ _id: 'disc-manual', name: 'Kulanz' }))
    component.setInfoBoxText('Bitte wählen Sie eine Produktkategorie')

    component.setAsStaffMealOrder()

    expect(component.selectedManualDiscount()).not.toBeNull()
    expect(component.infoBoxText).toBe('Bitte wählen Sie eine Produktkategorie')
  })

  it('Personalessen traegt auch nach einer verworfenen Rabattwahl genau den Personalessen-Rabatt', async () => {
    const { component, createdOrders } = setup({
      staffMealDiscountId: 'disc-staff',
      activeDiscounts: [staffMealDiscount],
    })
    component.increaseLineItem(product('p-1'))
    component.selectedManualDiscount.set(managedDiscount({ _id: 'disc-manual', name: 'Kulanz' }))
    component.setAsStaffMealOrder()

    await component.placeOrder()

    const applied = createdOrders[0]['appliedDiscounts'] as AppliedDiscount[]
    expect(applied).toHaveLength(1)
    expect(applied[0].discountId).toBe('disc-staff')
  })

  it('ein manuell gewaehlter Personalessen-Rabatt hat Vorrang vor dem zugewiesenen', async () => {
    const { component, createdOrders } = setup({
      staffMealDiscountId: 'disc-staff',
      activeDiscounts: [staffMealDiscount],
    })
    component.increaseLineItem(product('p-1'))
    component.selectedManualDiscount.set(
      managedDiscount({ _id: 'disc-staff-manuell', name: 'Personalessen 50 %', isStaffMeal: true }),
    )

    await component.placeOrder()

    const applied = createdOrders[0]['appliedDiscounts'] as AppliedDiscount[]
    expect(applied).toHaveLength(1)
    expect(applied[0].discountId).toBe('disc-staff-manuell')
    // Der manuell gewaehlte Personalessen-Rabatt macht die Bestellung selbst zum
    // Personalessen — auch ohne Druck auf die Personalessen-Taste.
    expect(createdOrders[0]['staffMealDetails']).toMatchObject({ userId: CURRENT_USER_ID })
  })

  it('Personalessen ohne aufloesbaren Rabatt laeuft ohne Nachlass durch statt zu scheitern', async () => {
    const { component, createdOrders } = setup({ staffMealDiscountId: 'gibt-es-nicht', activeDiscounts: [] })
    component.increaseLineItem(product('p-1'))
    component.setAsStaffMealOrder()

    await component.placeOrder()

    expect(createdOrders[0]['appliedDiscounts']).toBeUndefined()
    expect(createdOrders[0]['staffMealDetails']).toBeDefined()
  })

  it('Normalfall kombiniert Positions-, Kunden-, manuellen und Code-Rabatt in dieser Reihenfolge', async () => {
    const { component, createdOrders, redeemCalls } = setup({
      redeemResult: {
        ok: true,
        code: 'SOMMER',
        discountCodeId: 'dc-1',
        discount: { name: 'Sommer', valueType: 'percent', valuePercent: 10 },
      },
    })
    component.increaseLineItem(product('p-1'))
    const lineId = discountLine(component, 0)
    // Der Kundenrabatt kommt aus den Stammdaten; der Setter zieht Firmenkunden-Logik
    // nach, die hier nichts beitraegt — deshalb direkt das Feld.
    component['_customer'] = {
      _id: 'cust-1',
      name1: 'Muster GmbH',
      discountDetails: { discountType: 'percent', discount: 5 },
    }
    component.selectedManualDiscount.set(managedDiscount({ _id: 'disc-manual', name: 'Kulanz' }))
    component.appliedCodeDiscount.set({ ok: true, code: 'SOMMER' })

    await component.placeOrder()

    const applied = createdOrders[0]['appliedDiscounts'] as AppliedDiscount[]
    expect(applied.map(a => [a.target, a.method, a.name])).toEqual([
      ['line', 'manual', '20 % Rabatt'],
      // Der Kundenrabatt kommt aus den Stammdaten, nicht aus der Rabatt-Verwaltung —
      // er traegt deshalb den Kundennamen und keine `discountId`.
      ['order', 'manual', 'Muster GmbH'],
      ['order', 'manual', 'Kulanz'],
      ['order', 'code', 'Sommer'],
    ])
    expect(applied[0].lineItemId).toBe(lineId)
    expect(applied[1].discountId).toBeNull()
    expect(redeemCalls[0]).toMatchObject({ code: 'SOMMER', customerId: 'cust-1' })
  })

  it('die Betraege bleiben 0 — gerechnet wird ausschliesslich in der Engine', async () => {
    const { component, createdOrders } = setup()
    component.increaseLineItem(product('p-1'))
    discountLine(component, 0)
    component.selectedManualDiscount.set(managedDiscount({ _id: 'disc-manual' }))

    await component.placeOrder()

    const applied = createdOrders[0]['appliedDiscounts'] as AppliedDiscount[]
    expect(applied.every(a => a.computedAmountCents === 0)).toBe(true)
  })

  it('der Rabatt einer inzwischen geloeschten Zeile landet nicht im Snapshot', async () => {
    const { component, createdOrders } = setup()
    component.increaseLineItem(product('p-1'))
    component.increaseLineItem(product('p-2'))
    // Beide Zeilen rabattiert, danach faellt p-2 weg — ohne Filterung druckte der
    // Bon eine Rabattzeile ueber 0,00 € (die Engine faende keine Atome mehr).
    const bleibt = discountLine(component, 0)
    discountLine(component, 1)
    component.lineItems.splice(1, 1)

    await component.placeOrder()

    const applied = createdOrders[0]['appliedDiscounts'] as AppliedDiscount[]
    expect(applied.map(a => a.lineItemId)).toEqual([bleibt])
  })

  it('eine eingeloeste Code-Bestellung traegt die ID der Einloesung', async () => {
    const { component, createdOrders, redeemCalls } = setup({
      redeemResult: {
        ok: true,
        code: 'SOMMER',
        discountCodeId: 'dc-1',
        discount: { valueType: 'amount', valueCents: 200 },
      },
    })
    component.increaseLineItem(product('p-1'))
    component.appliedCodeDiscount.set({ ok: true, code: 'SOMMER' })

    await component.placeOrder()

    expect(createdOrders[0]['_id']).toBe(redeemCalls[0]['orderId'])
    expect(createdOrders[0]['_id']).toBeTruthy()
  })

  it('eine gescheiterte Einloesung laesst die Bestellung ohne Code durchlaufen', async () => {
    const { component, createdOrders, closeCalls } = setup({ redeemResult: { ok: false, reason: 'exhausted' } })
    component.increaseLineItem(product('p-1'))
    component.appliedCodeDiscount.set({ ok: true, code: 'AUFGEBRAUCHT' })

    await component.placeOrder()

    expect(createdOrders[0]['appliedDiscounts']).toBeUndefined()
    // Ohne Einloesung vergibt der Server die ID wie gewohnt.
    expect(createdOrders[0]['_id']).toBeUndefined()
    expect(component.appliedCodeDiscount()).toBeNull()
    expect(closeCalls).toHaveLength(1)
  })

  it('eine gescheiterte Einloesung meldet den Grund ueber den Dialogschluss hinaus', async () => {
    // Der Kern von #234: Die Meldung muss den Dialogschluss ueberleben. Die Infobox
    // tut das nicht — `unselectProduct()` ueberschreibt sie noch in `placeOrder`,
    // und `close()` nimmt sie mit. Beides wird hier mitgeprueft, damit ein Rueckbau
    // auf `setInfoBoxText` auffaellt statt still zu passieren.
    const { component, closeCalls, notices } = setup({ redeemResult: { ok: false, reason: 'exhausted' } })
    component.increaseLineItem(product('p-1'))
    component.appliedCodeDiscount.set({ ok: true, code: 'AUFGEBRAUCHT' })

    await component.placeOrder()

    expect(notices).toHaveLength(1)
    expect(notices[0].message).toMatch(/^Rabattcode nicht eingelöst — /)
    // Quittierpflichtig: kein Ablauf, nur das × schliesst sie.
    expect(notices[0].sticky).toBe(true)

    // Gegenprobe: Die Infobox traegt die Meldung nicht (mehr) — sie waere unsichtbar.
    expect(component.infoBoxText).toBe('Bitte wählen Sie eine Produktkategorie')
    expect(closeCalls).toHaveLength(1)
  })

  it('das Undo-Aufraeumen beim Abschluss schliesst die Rabattcode-Meldung nicht (core#531)', async () => {
    // `placeOrder` meldet den gescheiterten Code und ruft danach `deleteOrder()`, das ein
    // offenes „Rueckgaengig" verfallen laesst. Bis core#531 tat es das per
    // `matSnackBar.dismiss()` — und das schloss die gerade offene Snackbar, also genau
    // die Rabattcode-Meldung. Sie war damit in JEDEM Fall sofort weg.
    const { component, notices, noticeRefs } = setup({
      redeemResult: { ok: false, reason: 'exhausted' },
    })
    component.increaseLineItem(product('p-1'))
    component.selectProduct(0)
    component.increaseSelectedQuantity() // bietet „Rueckgaengig" an
    component.appliedCodeDiscount.set({ ok: true, code: 'AUFGEBRAUCHT' })

    await component.placeOrder()

    expect(notices.map(c => [c.action, c.sticky])).toEqual([
      ['Rückgängig', false],
      [undefined, true],
    ])
    expect(noticeRefs[0].dismissed).toBe(true) // das Undo-Angebot verfaellt
    expect(noticeRefs[1].dismissed).toBe(false) // die Rabattcode-Meldung bleibt
  })

  it('eine geglueckte Einloesung meldet nichts', async () => {
    const { component, notices } = setup({
      redeemResult: {
        ok: true,
        code: 'SOMMER',
        discountCodeId: 'dc-1',
        discount: { valueType: 'amount', valueCents: 200 },
      },
    })
    component.increaseLineItem(product('p-1'))
    component.appliedCodeDiscount.set({ ok: true, code: 'SOMMER' })

    await component.placeOrder()

    expect(notices).toHaveLength(0)
  })

  it('nach dem Abschicken ist der Rabattzustand leer', async () => {
    const { component } = setup()
    component.increaseLineItem(product('p-1'))
    discountLine(component, 0)
    component.selectedManualDiscount.set(managedDiscount({ _id: 'disc-manual' }))

    await component.placeOrder()

    expect(component.lineItems).toHaveLength(0)
    expect(component.lineDiscounts()).toEqual({})
    expect(component.selectedManualDiscount()).toBeNull()
  })
})

/**
 * Fertigungszeit „Sofort" (#343).
 *
 * Geprueft wird die Verdrahtung des Abschluss-Pfades, nicht das Rendering: Fuehrt
 * `INNEN` am Minutenraster vorbei, traegt `AUSSEN` eine Sofort-Kachel, und landet in
 * beiden Faellen die richtige Zahl in `productionTime`? Die Bon-Seite (`SOFORT` unter
 * dem Badge) liegt in #342 und hat dort eigene Specs.
 *
 * `placeOrder()` wird aus `setProductionTimeSubbuttons` per `void` gestartet — die
 * Tests warten deshalb einen Makrotask ab, bevor sie `createdOrders` lesen.
 */
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('OrderDialog — Fertigungszeit „Sofort" (#343)', () => {
  /** Kachel aus dem Minutenraster bzw. dem Funktionsblock holen. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tile = (buttons: any[], name: string) => buttons.find(b => b.name === name)

  describe('INNEN fragt nicht nach einer Fertigungszeit', () => {
    it('schliesst direkt ab und bucht productionTime 0 — ohne Minutenklick', async () => {
      const { component, createdOrders } = setup()
      component.increaseLineItem(product('p-1'))

      component.selectDineLocation('INSIDE')
      await flush()

      expect(createdOrders).toHaveLength(1)
      expect(createdOrders[0]['productionTime']).toBe(0)
      expect(createdOrders[0]['dineLocation']).toBe('dine-in')
    })

    it('baut gar kein Minutenraster auf', async () => {
      const { component } = setup()
      component.increaseLineItem(product('p-1'))

      component.selectDineLocation('INSIDE')
      await flush()

      expect(component.productButtons).toHaveLength(0)
      expect(tile(component.functionButtons, 'Sofort')).toBeUndefined()
    })

    it('ueberspringt das Raster auch ohne gewaehlte Bestellart', async () => {
      // `placeOrder` bucht eine fehlende Auswahl als DINE_IN. Zeigte der Dialog hier
      // ein Minutenraster, waehlte der Kassierer eine Zeit fuer eine Bestellung, die
      // als INNEN in der Datenbank landet.
      const { component, createdOrders } = setup()
      component.increaseLineItem(product('p-1'))

      component.setProductionTimeSubbuttons()
      await flush()

      expect(component.productButtons).toHaveLength(0)
      expect(createdOrders[0]['productionTime']).toBe(0)
      expect(createdOrders[0]['dineLocation']).toBe('dine-in')
    })

    it('laesst Pager- und Tischabfrage unberuehrt', async () => {
      // Die Abzweigung sitzt am gemeinsamen Endpunkt, nicht in `selectDineLocation` —
      // sonst faehrt INNEN an Pager und Tisch vorbei.
      const { component, createdOrders } = setup()
      component.increaseLineItem(product('p-1'))
      component.locationService.showPagers = true
      component.locationService.showTables = false
      component.locationService.pagers = [7, 8]

      component.selectDineLocation('INSIDE')

      // Erst die Pagerwahl, noch keine Bestellung.
      expect(createdOrders).toHaveLength(0)
      expect(tile(component.productButtons, '7')).toBeDefined()

      tile(component.productButtons, '7').callback()
      await flush()

      expect(createdOrders).toHaveLength(1)
      expect(createdOrders[0]['pager']).toBe(7)
      expect(createdOrders[0]['productionTime']).toBe(0)
    })
  })

  describe('AUSSEN behaelt das Raster und bekommt „Sofort" dazu', () => {
    it('zeigt Sofort im Funktionsblock, nicht im Minutenraster', () => {
      // Der Ort ist die eigentliche Aussage: Eine vorangestellte Kachel IM Raster
      // wuerde jeden Minutenwert um eine Position verschieben, und der Griff nach
      // „15 min" landete auf „10 min". Wandert Sofort spaeter doch ins Raster, faellt
      // dieser Test — das ist Absicht.
      const { component } = setup()
      component.increaseLineItem(product('p-1'))

      component.selectDineLocation('OUTSIDE')

      expect(tile(component.functionButtons, 'Sofort')).toBeDefined()
      expect(tile(component.productButtons, 'Sofort')).toBeUndefined()
    })

    it('laesst die Minutenkacheln an ihren Positionen', () => {
      // `productionTimes` des Harness ist [0, 5, 10]; entscheidend ist, dass Reihenfolge
      // und Index unveraendert aus der Quelle kommen.
      const { component } = setup()
      component.increaseLineItem(product('p-1'))

      component.selectDineLocation('OUTSIDE')

      expect(component.productButtons.map((b: { name: string }) => b.name)).toEqual(['0 min', '5 min', '10 min'])
      expect(component.productButtons.map((b: { index: number }) => b.index)).toEqual([0, 1, 2])
    })

    it('bucht bei Sofort die Fertigungszeit 0', async () => {
      const { component, createdOrders } = setup()
      component.increaseLineItem(product('p-1'))
      component.selectDineLocation('OUTSIDE')

      tile(component.functionButtons, 'Sofort').callback()
      await flush()

      expect(createdOrders).toHaveLength(1)
      expect(createdOrders[0]['productionTime']).toBe(0)
      expect(createdOrders[0]['dineLocation']).toBe('take-out')
    })

    it('bucht bei einer Minutenkachel deren Wert', async () => {
      const { component, createdOrders } = setup()
      component.increaseLineItem(product('p-1'))
      component.selectDineLocation('OUTSIDE')

      tile(component.productButtons, '10 min').callback()
      await flush()

      expect(createdOrders).toHaveLength(1)
      expect(createdOrders[0]['productionTime']).toBe(10)
    })
  })

  describe('Zuruecksetzen', () => {
    it('stellt die Fertigungszeit beim Einstieg in den Abschluss auf 0', async () => {
      // Heute kann nichts stehenbleiben (jeder Dialogaufruf ist eine frische Instanz).
      // Der Test haelt die Eigenschaft fest, damit ein kuenftiger Weg zurueck in die
      // Bestellart-Auswahl keine verworfene Minutenwahl mitschleppt.
      const { component, createdOrders } = setup()
      component.increaseLineItem(product('p-1'))
      component.selectDineLocation('OUTSIDE')
      tile(component.productButtons, '10 min').callback()
      await flush()

      component.increaseLineItem(product('p-2'))
      component.setTaxRateSubbuttons()
      component.selectDineLocation('OUTSIDE')
      tile(component.functionButtons, 'Sofort').callback()
      await flush()

      expect(createdOrders).toHaveLength(2)
      expect(createdOrders[1]['productionTime']).toBe(0)
    })
  })
})

describe('OrderDialog — Mandantensperre (#489)', () => {
  it('placeOrder bucht bei gesperrtem Mandanten nichts und meldet es', async () => {
    const { component, createdOrders, notices, suspended, closeCalls } = setup()
    component.increaseLineItem(product('p-1'))
    suspended.set(true)

    await component.placeOrder()

    expect(createdOrders).toHaveLength(0)
    expect(notices.map(c => c.message)).toEqual(['Konto gesperrt — bitte den Inhaber kontaktieren'])
    // Der Warenkorb bleibt stehen: Nach dem Ende der Sperre geht derselbe Bon durch.
    expect(component.lineItems).toHaveLength(1)
    // Die Kasse bleibt mit dem Warenkorb offen (core#828).
    expect(closeCalls).toEqual([])
  })

  it('ohne Sperre bucht placeOrder wie bisher', async () => {
    const { component, createdOrders } = setup()
    component.increaseLineItem(product('p-1'))

    await component.placeOrder()

    expect(createdOrders).toHaveLength(1)
  })
})

describe('OrderDialog — Anpassen-Panel (#639)', () => {
  const KETCHUP = '018f0000-0000-7000-8000-00000000a001'
  const ketchup = () => ({
    externalId: KETCHUP,
    version: 1,
    ingredientName: 'Ketchup',
    initialQuantity: 1,
    quantity: 1,
    onlyOutsideConsumption: false,
    isRemovable: true,
    priceAdjustment: -0.3,
  })
  const ui = (showOptionsAuto: boolean) => ({ index: 1, showOptionsAuto, hideOnMainScreen: false })
  const burger = (showOptionsAuto: boolean) =>
    product('burger', { ui: ui(showOptionsAuto), ingredientReferences: [ketchup()] } as never)
  const cheese = () => product('cheese', { name: 'Käse', price: 0.5, productType: 'MODIFIER' } as never)
  const burgerWithExtras = (minSelections = 0) =>
    product('burger', {
      ui: ui(true),
      optionGroups: [
        {
          id: 'g-1',
          name: 'Extras',
          minSelections,
          maxSelections: 2,
          freeQuantity: 0,
          options: [{ productId: 'cheese' }],
        },
      ],
    } as never)

  it('öffnet das Panel beim Antippen eines Produkts mit ui.showOptionsAuto', () => {
    const p = burger(true)
    const { component } = setup({ catalog: [p] })

    component.increaseLineItem(p)

    expect(component.customizeModel()?.ingredients).toEqual([
      { externalId: KETCHUP, name: 'Ketchup', priceAdjustment: -0.3, removed: false },
    ])
    expect(component.selectedProductIndex).toBe(0)
  })

  it('legt beim Öffnen keinen Hinweis über das Sheet — der Kopf nennt das Produkt schon (core#909)', () => {
    const p = burger(false)
    const { component } = setup({ catalog: [p] })
    component.increaseLineItem(p)

    component.selectProduct(0)

    expect(component.customizeModel()?.name).toBe('Artikel burger')
    expect(component.notice()).toBeNull()
  })

  it('ohne das Flag wird nur gebucht — das Panel öffnet erst der Tipp auf die Position', () => {
    const p = burger(false)
    const { component } = setup({ catalog: [p] })

    component.increaseLineItem(p)
    expect(component.customizeModel()).toBeNull()

    component.selectProduct(0)
    expect(component.customizeModel()?.name).toBe('Artikel burger')
  })

  it('führt zwei unveränderte Tipps eines auto-anpassbaren Produkts zu einer Zeile zusammen (#699, D7)', () => {
    const p = burger(true)
    const { component } = setup({ catalog: [p] })

    component.increaseLineItem(p)
    component.increaseLineItem(p)

    // Bis #699 je Tipp eine eigene Zeile. Jetzt endet mit dem zweiten Tipp die erste Sitzung,
    // gleiche Konfigurationen werden eine Zeile — eine Anpassung spaltet danach ein Stück ab.
    expect(component.lineItems.map((l: { amount: number }) => l.amount)).toEqual([2])
    expect(component.customizeModel()?.amount).toBe(2)
    expect(component.customizeScope()).toBe('one')
  })

  it('Zutat abwählen und wieder anwählen hinterlässt genau einen bzw. keinen „Ohne"-Modifier', () => {
    const p = burger(true)
    const { component } = setup({ catalog: [p] })
    component.increaseLineItem(p)

    component.onCustomizeIngredientToggled(KETCHUP)
    expect(component.lineItems[0].modifiers.map((m: { name: string; price: number }) => [m.name, m.price])).toEqual([
      ['Ohne Ketchup', -0.3],
    ])
    expect(component.customizeModel()?.summary).toBe('ohne Ketchup')

    component.onCustomizeIngredientToggled(KETCHUP)
    expect(component.lineItems[0].modifiers).toEqual([])
  })

  it('„Abbrechen" stellt die Modifier vom Öffnen wieder her, „Fertig" behält sie', () => {
    const p = burger(true)
    const { component } = setup({ catalog: [p] })
    component.increaseLineItem(p)
    component.onCustomizeIngredientToggled(KETCHUP)
    component.onCustomizeCancelled()

    expect(component.lineItems[0].modifiers).toEqual([])
    expect(component.customizeModel()).toBeNull()

    component.selectProduct(0)
    component.onCustomizeIngredientToggled(KETCHUP)
    component.onCustomizeFinished()

    expect(component.lineItems[0].modifiers.map((m: { name: string }) => m.name)).toEqual(['Ohne Ketchup'])
    expect(component.customizeModel()).toBeNull()
  })

  it('Extras per Plus und Minus; Minus auf ein ungebuchtes Extra legt keinen OHNE-Marker an', () => {
    const p = burgerWithExtras()
    const { component } = setup({ catalog: [p, cheese()] })
    component.increaseLineItem(p)

    component.onCustomizeOptionDecreased({ groupName: 'Extras', productId: 'cheese' })
    expect(component.lineItems[0].modifiers).toEqual([])

    component.onCustomizeOptionIncreased({ groupName: 'Extras', productId: 'cheese' })
    component.onCustomizeOptionIncreased({ groupName: 'Extras', productId: 'cheese' })
    expect(component.customizeModel()?.groups[0].selected).toBe(2)

    // maxSelections 2 erreicht — ein drittes Plus bucht nichts
    component.onCustomizeOptionIncreased({ groupName: 'Extras', productId: 'cheese' })
    expect(component.lineItems[0].modifiers.map((m: { amount: number; topic: string }) => [m.amount, m.topic])).toEqual(
      [[2, 'Extras']],
    )

    component.onCustomizeOptionDecreased({ groupName: 'Extras', productId: 'cheese' })
    component.onCustomizeOptionDecreased({ groupName: 'Extras', productId: 'cheese' })
    expect(component.lineItems[0].modifiers).toEqual([])
  })

  it('„Fertig" schließt nicht, solange eine Pflichtgruppe fehlt', () => {
    const p = burgerWithExtras(1)
    const { component } = setup({ catalog: [p, cheese()] })
    component.increaseLineItem(p)

    component.onCustomizeFinished()
    expect(component.customizeModel()).not.toBeNull()

    component.onCustomizeOptionIncreased({ groupName: 'Extras', productId: 'cheese' })
    component.onCustomizeFinished()
    expect(component.customizeModel()).toBeNull()
  })

  it('ein Wechsel der Produktgruppe schließt das Panel', () => {
    const p = burger(true)
    const { component } = setup({ catalog: [p] })
    component.increaseLineItem(p)

    component.createProductButtons({ _id: 'cat-1', name: 'Speisen' })

    expect(component.customizeModel()).toBeNull()
  })

  it('Plus bucht auf die Zeile des Panels, auch wenn die Auswahl inzwischen gewechselt hat', () => {
    const p = burgerWithExtras()
    const { component } = setup({ catalog: [p, cheese(), product('cola')] })
    component.increaseLineItem(product('cola'))
    component.increaseLineItem(p) // Zeile 1, Panel offen
    component._selectedProductIndex = 0 // Auswahl wandert ohne Ansichtswechsel

    component.onCustomizeOptionIncreased({ groupName: 'Extras', productId: 'cheese' })

    expect(component.lineItems[0].modifiers).toEqual([])
    expect(component.lineItems[1].modifiers.map((m: { name: string }) => m.name)).toEqual(['Käse'])
  })

  it('wechselt die Auswahl per Pfeil, zieht das Panel mit oder schließt', () => {
    const a = burger(true)
    const b = product('cola')
    const { component } = setup({ catalog: [a, b] })
    component.increaseLineItem(b)
    component.increaseLineItem(a) // Zeile 1, Panel offen

    component.decreaseSelectedIndex() // auf Zeile 0 — nicht anpassbar
    expect(component.customizeModel()).toBeNull()
    expect(component.selectedProductIndex).toBe(0)

    component.selectProduct(1)
    expect(component.customizeModel()?.name).toBe('Artikel burger')
  })

  it('der Tipp auf eine Position IN einer Kombination markiert sie, „Anpassen" öffnet das Panel, der zweite Tipp schließt es (core#829)', () => {
    const p = burger(false)
    const cola = product('cola')
    const { component } = setup({ catalog: [p, cola] })
    component.increaseLineItem(p)
    component.increaseLineItem(cola)
    component.combineAllArticles()
    component.unselectProduct()

    component.selectCombinationByIndex(0, 0)

    expect(component.selectedCombinationIndex).toEqual([0, 0])
    expect(component.customizeModel()).toBeNull()

    component.customizeSelection()

    expect(component.customizeModel()?.name).toBe('Artikel burger')

    component.selectCombinationByIndex(0, 0)

    expect(component.selectedCombinationIndex).toEqual([0, null])
    expect(component.customizeModel()).toBeNull()
  })

  it('Löschen der angepassten Zeile schließt das Panel', () => {
    const p = burger(true)
    const { component } = setup({ catalog: [p] })
    component.increaseLineItem(p)

    component.deleteSelection()

    expect(component.lineItems).toHaveLength(0)
    expect(component.customizeModel()).toBeNull()
  })

  it('die Menge aus Spalte 2 kommt im Panel an', () => {
    const p = burger(true)
    const { component } = setup({ catalog: [p] })
    component.increaseLineItem(p)

    component.increaseSelectedQuantity()

    expect(component.customizeModel()?.amount).toBe(2)
  })

  it('ein Menü öffnet das Panel auch über den Warenkorb-Tipp nicht', () => {
    const menu = product('menu', {
      isMenu: true,
      ingredientReferences: [ketchup()],
    } as never)
    const { component } = setup({ catalog: [menu] })
    component.increaseLineItem(menu)
    component._isBlocked = false

    component.selectProduct(0)

    expect(component.customizeModel()).toBeNull()
  })

  it('das Extras-Raster hat keine OHNE-Funktionstaste mehr', () => {
    const { component } = setup({ catalog: [product('pommes')] })
    component.increaseLineItem(product('pommes'))

    component.selectProduct(0)

    expect(component.functionButtons.map((b: { name: string }) => b.name)).not.toContain('OHNE')
    expect(component.customizeModel()).toBeNull()
  })
})

describe('OrderDialog — Zeilen aufspalten und zusammenführen (#699)', () => {
  const KETCHUP = '018f0000-0000-7000-8000-00000000a001'
  const ketchup = () => ({
    externalId: KETCHUP,
    version: 1,
    ingredientName: 'Ketchup',
    initialQuantity: 1,
    quantity: 1,
    onlyOutsideConsumption: false,
    isRemovable: true,
    priceAdjustment: -0.3,
  })
  const ui = (showOptionsAuto: boolean) => ({ index: 1, showOptionsAuto, hideOnMainScreen: false })
  const burger = (showOptionsAuto = false) =>
    product('burger', { ui: ui(showOptionsAuto), ingredientReferences: [ketchup()] } as never)
  type Line = {
    amount: number
    modifiers: Array<{ name: string; amount: number }>
    modifierScope?: string
    _id: string
  }
  const shape = (component: { lineItems: Line[] }) =>
    component.lineItems.map(l => [l.amount, l.modifiers.map(m => m.name).join(',')])

  /** 2× Burger aus dem Warenkorb, Panel an der Zeile geöffnet. */
  function twoBurgersInPanel() {
    const p = burger()
    const ctx = setup({ catalog: [p] })
    ctx.component.increaseLineItem(p)
    ctx.component.increaseLineItem(p)
    ctx.component.selectProduct(0)
    return { ...ctx, p }
  }

  it('neue Zeilen tragen modifierScope unit', () => {
    const p = burger()
    const { component } = setup({ catalog: [p] })
    component.increaseLineItem(p)
    expect((component.lineItems[0] as Line).modifierScope).toBe('unit')
  })

  it('Fall 2/4: aus dem Warenkorb gilt eine Anpassung für ein Stück — es wird abgespalten und markiert', () => {
    const { component } = twoBurgersInPanel()
    expect(component.customizeScope()).toBe('one')

    component.onCustomizeIngredientToggled(KETCHUP)

    expect(shape(component)).toEqual([
      [1, ''],
      [1, 'Ohne Ketchup'],
    ])
    expect(component.selectedProductIndex).toBe(1)
    expect(component.customizeModel()?.amount).toBe(1)
    expect(component.customizeScopeLocked()).toBe(true)
  })

  it('Fall 7: mehrere Griffe in einer Sitzung spalten nur einmal ab', () => {
    const { component } = twoBurgersInPanel()
    component.onCustomizeIngredientToggled(KETCHUP)
    component.onCustomizeIngredientToggled(KETCHUP)
    component.onCustomizeIngredientToggled(KETCHUP)
    expect(shape(component)).toEqual([
      [1, ''],
      [1, 'Ohne Ketchup'],
    ])
  })

  it('Fall 3: bekommt die Restzeile dieselbe Anpassung, werden beide bei „Fertig" wieder eine Zeile', () => {
    const { component } = twoBurgersInPanel()
    component.onCustomizeIngredientToggled(KETCHUP)
    component.onCustomizeFinished()

    component.selectProduct(0)
    component.onCustomizeIngredientToggled(KETCHUP)
    component.onCustomizeFinished()

    expect(shape(component)).toEqual([[2, 'Ohne Ketchup']])
  })

  it('Fall 9: wird die Anpassung zurückgenommen, führt „Fertig" wieder zusammen', () => {
    const { component } = twoBurgersInPanel()
    component.onCustomizeIngredientToggled(KETCHUP)
    component.onCustomizeIngredientToggled(KETCHUP) // dasselbe Stück wieder mit Ketchup
    component.onCustomizeFinished()
    expect(shape(component)).toEqual([[2, '']])
  })

  it('Fall 37: „Abbrechen" nimmt auch das Abspalten zurück', () => {
    const { component } = twoBurgersInPanel()
    component.onCustomizeIngredientToggled(KETCHUP)
    component.onCustomizeCancelled()
    expect(shape(component)).toEqual([[2, '']])
  })

  it('„alle n" gilt für die ganze Zeile; nach der ersten Änderung ist der Umschalter fest', () => {
    const { component } = twoBurgersInPanel()
    component.onCustomizeScopeChanged('all')
    component.onCustomizeIngredientToggled(KETCHUP)
    component.onCustomizeScopeChanged('one') // fest — kein nachträglicher Split
    component.onCustomizeIngredientToggled(KETCHUP)
    component.onCustomizeIngredientToggled(KETCHUP)
    expect(shape(component)).toEqual([[2, 'Ohne Ketchup']])
    expect(component.customizeScope()).toBe('all')
  })

  it('Fall 15 (D2): im Hinzufügen-Ablauf gilt die Anpassung für alle Stück des Multiplikators', () => {
    const p = burger(true)
    const { component } = setup({ catalog: [p] })
    component.multiplier = 3
    component.increaseLineItem(p)

    expect(component.customizeScope()).toBe('all')
    component.onCustomizeIngredientToggled(KETCHUP)
    expect(shape(component)).toEqual([[3, 'Ohne Ketchup']])
  })

  it('Fall 10/11: ein neuer Tipp landet nicht auf einer angepassten Zeile, sondern auf einer gleichen', () => {
    const { component, p } = twoBurgersInPanel()
    component.onCustomizeIngredientToggled(KETCHUP)
    component.onCustomizeFinished() // [1×, 1× ohne Ketchup]

    component.increaseLineItem(p)
    expect(shape(component)).toEqual([
      [2, ''],
      [1, 'Ohne Ketchup'],
    ])
  })

  it('Fall 10: steht nur eine angepasste Zeile im Warenkorb, entsteht für den neuen Tipp eine eigene', () => {
    const { component, p } = twoBurgersInPanel()
    component.onCustomizeScopeChanged('all')
    component.onCustomizeIngredientToggled(KETCHUP)
    component.onCustomizeFinished() // [2× ohne Ketchup]

    component.increaseLineItem(p)
    expect(shape(component)).toEqual([
      [2, 'Ohne Ketchup'],
      [1, ''],
    ])
  })

  it('Fall 13: der Multiplikator auf eine vorhandene Zeile addiert die ganze Menge', () => {
    const p = burger()
    const { component } = setup({ catalog: [p] })
    component.increaseLineItem(p)
    component.multiplier = 3
    component.increaseLineItem(p)
    expect(shape(component)).toEqual([[4, '']])
  })

  it('D5: ein Prozent-Positionsrabatt geht beim Abspalten mit, ein Festbetrag bleibt an der Restzeile', () => {
    const percent = twoBurgersInPanel()
    const first = discountLine(percent.component, 0)
    percent.component.selectProduct(0)
    percent.component.onCustomizeIngredientToggled(KETCHUP)
    const discounts = percent.component.lineDiscounts()
    expect(Object.keys(discounts)).toEqual([first, percent.component.lineItems[1]._id])

    const fixed = twoBurgersInPanel()
    const id = discountLine(
      fixed.component,
      0,
      managedDiscount({ _id: 'fix', valueType: 'amount', valueCents: 150 } as never),
    )
    fixed.component.selectProduct(0)
    fixed.component.onCustomizeIngredientToggled(KETCHUP)
    expect(Object.keys(fixed.component.lineDiscounts())).toEqual([id])
  })

  it('D5: Zeilen mit unterschiedlichem Rabatt werden nicht zusammengeführt', () => {
    const { component } = twoBurgersInPanel()
    component.onCustomizeIngredientToggled(KETCHUP)
    component.onCustomizeFinished() // [1×, 1× ohne]
    discountLine(component, 0, managedDiscount({ _id: 'fix', valueType: 'amount', valueCents: 150 } as never))

    component.selectProduct(1)
    component.onCustomizeIngredientToggled(KETCHUP) // zurück auf „mit Ketchup" — gleiche Ware, anderer Rabatt
    component.onCustomizeFinished()
    expect(shape(component)).toEqual([
      [1, ''],
      [1, ''],
    ])
  })

  describe('Review-Nachträge', () => {
    const cheese = () => product('cheese', { name: 'Käse', price: 0.5, productType: 'MODIFIER' } as never)
    /** Tippt die Raster-Kachel des Extras an — derselbe Weg wie am Gerät. */
    function tapRasterExtra(component: any, id = 'cheese') {
      component.setExtraSubButtons([`ext-${id}`])
      const button = component.productButtons.find((b: { _id: string }) => b._id === id)
      button.callback()
    }

    it('Fall 40: ein Raster-Extra an einer Mehrstück-Zeile spaltet ab, ein zweites auf den Rest führt zusammen', () => {
      const pommes = product('pommes')
      const { component } = setup({ catalog: [pommes, cheese()] })
      component.increaseLineItem(pommes)
      component.increaseLineItem(pommes)
      component.selectProduct(0)

      tapRasterExtra(component)
      expect(shape(component)).toEqual([
        [1, ''],
        [1, 'Käse'],
      ])
      expect(component.selectedProductIndex).toBe(1)

      component.selectProduct(0)
      tapRasterExtra(component)
      expect(shape(component)).toEqual([[2, 'Käse']])
    })

    it('„Alle Modifier" nach „alle n" spaltet im Raster nicht ab', () => {
      const p = product('burger', { ui: ui(false), ingredientReferences: [ketchup()] } as never)
      const { component } = setup({ catalog: [p, cheese()] })
      component.increaseLineItem(p)
      component.increaseLineItem(p)
      component.selectProduct(0)
      component.onCustomizeScopeChanged('all')
      component.onCustomizeShowAllModifiers()

      tapRasterExtra(component)
      expect(shape(component)).toEqual([[2, 'Käse']])
    })

    it('im Hinzufügen-Ablauf gilt ein Raster-Extra über „Alle Modifier" für alle Stück', () => {
      const p = burger(true)
      const { component } = setup({ catalog: [p, cheese()] })
      component.multiplier = 3
      component.increaseLineItem(p)
      component.onCustomizeShowAllModifiers()

      tapRasterExtra(component)
      tapRasterExtra(component)
      expect(component.lineItems.map((l: Line) => [l.amount, l.modifiers.map(m => m.amount)])).toEqual([[3, [2]]])
    })

    it('„Abbrechen" behält eine währenddessen hinzugefügte Zeile', () => {
      const cola = product('cola')
      const { component } = twoBurgersInPanel()
      component.onCustomizeIngredientToggled(KETCHUP)
      component.increaseLineItem(cola)
      component.onCustomizeCancelled()

      expect(component.lineItems.map((l: Line & { name: string }) => [l.amount, l.name])).toEqual([
        [2, 'Artikel burger'],
        [1, 'Artikel cola'],
      ])
    })

    it('„Abbrechen" nimmt den kopierten Positionsrabatt des Stücks mit', () => {
      const { component } = twoBurgersInPanel()
      const id = discountLine(component, 0)
      component.selectProduct(0)
      component.onCustomizeIngredientToggled(KETCHUP)
      component.onCustomizeCancelled()
      expect(Object.keys(component.lineDiscounts())).toEqual([id])
    })

    it('ein offenes „Rückgängig" der Menge verfällt, sobald ein Stück abgespalten wird', () => {
      const p = burger()
      const { component, noticeRefs } = setup({ catalog: [p] })
      component.multiplier = 3
      component.increaseLineItem(p)
      component.selectProduct(0) // Panel offen, 3×, „1 Stück"
      component.decreaseSelectedQuantity() // 2×, Undo „zurück auf 3" angeboten
      component.onCustomizeIngredientToggled(KETCHUP) // spaltet ab: 1× + 1× ohne

      // Ohne Verfall setzte das Undo die Restzeile auf 3 — vier Burger statt zwei.
      noticeRefs[0].triggerAction()
      expect(shape(component)).toEqual([
        [1, ''],
        [1, 'Ohne Ketchup'],
      ])
    })

    it('Bestellen führt gleiche Zeilen zusammen, auch wenn das Panel per Ansichtswechsel verlassen wurde', async () => {
      const { component, createdOrders } = twoBurgersInPanel()
      component.onCustomizeIngredientToggled(KETCHUP)
      component.onCustomizeIngredientToggled(KETCHUP) // Stück wieder wie die Restzeile
      component.createProductButtons({ _id: 'cat-1', name: 'Speisen' }) // Ansichtswechsel statt „Fertig"
      expect(component.lineItems).toHaveLength(2)

      await component.placeOrder()
      const lines = createdOrders[0]['lineItems'] as Line[]
      expect(lines.map(l => l.amount)).toEqual([2])
    })

    it('D6: ein Menü mit mehreren Stück wird für ein Raster-Extra aufgespalten, aber nie zusammengeführt', () => {
      const menu = product('menu', { isMenu: true } as never)
      const { component } = setup({ catalog: [menu, cheese()] })
      component.increaseLineItem(menu)
      component.selectProduct(0)
      component.increaseSelectedQuantity() // 2× Menü

      tapRasterExtra(component)
      expect(shape(component)).toEqual([
        [1, ''],
        [1, 'Käse'],
      ])
    })
  })
})

describe('OrderDialog — Raster ohne hideOnMainScreen (#697)', () => {
  const ui = (hideOnMainScreen: boolean) => ({ index: 1, showOptionsAuto: false, hideOnMainScreen })
  const catalog = () => [
    product('burger', { ui: ui(false) } as never),
    product('sosse', { name: 'Extra Soße', productType: 'MODIFIER', ui: ui(true) } as never),
    product('cola'),
  ]
  const names = (component: { productButtons: Array<{ name: string }> }) => component.productButtons.map(b => b.name)

  it('blendet Menü-Modifier im Kategorie-Raster aus', () => {
    const { component } = setup()
    component['productService'].getProductsByGroupId = () => catalog()

    component.createProductButtons({ _id: 'cat-1', name: 'Hauptgerichte' } as never)

    expect(names(component)).toEqual(['Artikel burger', 'Artikel cola'])
  })

  it('blendet sie auch beim Zurück ins Raster der Gruppe aus (setProductButtonsByGroupId)', () => {
    const { component } = setup()
    component['productService'].getProductsByGroupId = () => catalog()
    component['productGroupService'].getProductGroupById = () => ({ _id: 'cat-1', name: 'Hauptgerichte' })

    component.setProductButtonsByGroupId('cat-1')

    expect(names(component)).toEqual(['Artikel burger', 'Artikel cola'])
  })

  it('blendet sie im Nachfolger-Raster aus (setSuccessorSubButtons)', () => {
    const { component } = setup()
    component['productService'].getProductsByGroupId = () => catalog()
    component['productGroupService'].getProductGroupByExternId = () => ({ _id: 'cat-2', name: 'Getränke dazu' })

    component.setSuccessorSubButtons(product('menu', { nextProductGroupExternalId: 'grp-2' } as never))

    expect(names(component)).toEqual(['Artikel burger', 'Artikel cola'])
  })
})

describe('OrderDialog — Numpad-Artikelsuche (#709)', () => {
  const withIndex = (id: string, index: number, hideOnMainScreen = false, name = `Artikel ${id}`) =>
    product(id, { name, ui: { index, showOptionsAuto: false, hideOnMainScreen } } as never)

  function searchFor(catalog: ProductSchema[], digits: number[]) {
    const { component } = setup()
    component['productService'].findProductsByIndex = (index: number) => catalog.filter(p => p.ui?.index === index)
    for (const digit of digits) component['concatProductSearch'](digit)
    return component
  }

  it('bucht das Produkt mit der eingetippten Nummer', () => {
    const component = searchFor([withIndex('burger', 12)], [1, 2])

    expect(component.numpadValue).toBe('Artikel burger')
    component.applyProductSearch()

    expect(component.lineItems.map((l: { name: string }) => l.name)).toEqual(['Artikel burger'])
  })

  it('findet einen Menü-Modifier mit hideOnMainScreen nicht und bucht nichts', () => {
    const component = searchFor([withIndex('sosse', 5, true, 'Extra Soße')], [5])

    expect(component.numpadValue).toBe('')
    component.applyProductSearch()

    expect(component.lineItems).toEqual([])
  })

  it('bucht das sichtbare Produkt, wenn ein versteckter Modifier dieselbe Nummer trägt', () => {
    const component = searchFor([withIndex('sosse', 5, true, 'Extra Soße'), withIndex('pommes', 5)], [5])

    expect(component.numpadValue).toBe('Artikel pommes')
    component.applyProductSearch()

    expect(component.lineItems.map((l: { name: string }) => l.name)).toEqual(['Artikel pommes'])
  })

  it('bucht bei doppelt vergebener Nummer nichts und nennt beide Produkte in der Infobox', () => {
    const component = searchFor([withIndex('cola', 3), withIndex('fanta', 3)], [3])

    expect(component.numpadValue).toBe('Nummer mehrfach vergeben')
    component.applyProductSearch()

    expect(component.lineItems).toEqual([])
    expect(component.infoBoxText).toBe(
      'Artikelnummer 3 ist mehrfach vergeben (Artikel cola, Artikel fanta) — bitte im Raster wählen.',
    )
  })

  it('bucht nach dem Doppel-Hinweis die Kachel einmal, nicht mit der Artikelnummer als Menge (#779)', () => {
    const cola = withIndex('cola', 22)
    const { component } = setup()
    component['productService'].findProductsByIndex = (index: number) =>
      [cola, withIndex('wasser', 22)].filter(p => p.ui?.index === index)
    component.numpadAction(2)
    component.numpadAction(2)

    component.applyProductSearch()
    component.increaseLineItem(cola)

    expect(component.lineItems.map((l: { name: string; amount: number }) => [l.name, l.amount])).toEqual([
      ['Artikel cola', 1],
    ])
    expect(component.numpadValue).toBe('')
  })
})

/**
 * Das X schloss die Bestellung bis #795 ohne Rückfrage — ein Fehltipp verwarf, was schon
 * eingegeben war. Ohne jede Eingabe schließt es weiter sofort.
 */
describe('OrderDialog — Schließen fragt nach, sobald etwas eingegeben wurde (#795)', () => {
  it('ohne jede Eingabe schließt das X sofort und ohne Rückfrage', async () => {
    const { component, openedDialogs, closeCalls } = setup()

    await component.leave()

    expect(openedDialogs).toEqual([])
    expect(closeCalls).toEqual(['cancelled'])
  })

  it('mit Positionen fragt es nach — nicht wegklickbar — und bleibt bei „Weiter bearbeiten" offen', async () => {
    const { component, openedDialogs, closeCalls, dialogResult } = setup()
    component.increaseLineItem(product('p-1'))
    dialogResult.value = false

    await component.leave()

    expect(openedDialogs).toHaveLength(1)
    expect(openedDialogs[0].disableClose).toBe(true)
    expect(closeCalls).toEqual([])
    expect(component.lineItems).toHaveLength(1)
  })

  it('auch wenn alles wieder gelöscht wurde, fragt es nach; „Verwerfen" schließt', async () => {
    const { component, openedDialogs, closeCalls, dialogResult } = setup()
    component.increaseLineItem(product('p-1'))
    component.selectProduct(0)
    component.deleteSelection()
    expect(component.lineItems).toHaveLength(0)
    dialogResult.value = true

    await component.leave()

    expect(openedDialogs).toHaveLength(1)
    expect(closeCalls).toEqual(['cancelled'])
  })
})

/**
 * Seit core#828 ist die Kasse eine Route: Browser-Zurück und jeder Routenwechsel fragen über
 * `confirmLeave()` nach wie das X — ohne selbst zu melden, denn die Navigation läuft schon.
 */
describe('Kasse — Verlassen per Navigation (core#828)', () => {
  it('ohne Eingabe darf sie ohne Rückfrage verlassen werden und protokolliert den Abbruch', async () => {
    const { component, openedDialogs, closeCalls, interactions } = setup()

    expect(await component.confirmLeave()).toBe(true)

    expect(openedDialogs).toEqual([])
    expect(interactions.map(i => i['type'])).toEqual(['order-cancel'])
    expect(closeCalls).toEqual([])
  })

  it('eine Folge-Bestellung ohne Eingabe ist kein Abbruch — sie hat niemand geöffnet', async () => {
    const { component, interactions } = setup()
    component.isFollowUp = () => true

    expect(await component.confirmLeave()).toBe(true)

    expect(interactions).toEqual([])
  })

  it('mit Eingabe fragt sie nach; „Weiter bearbeiten" hält die Navigation auf und lässt den Warenkorb stehen', async () => {
    const { component, openedDialogs, dialogResult, interactions } = setup()
    component.increaseLineItem(product('p-1'))
    dialogResult.value = false

    expect(await component.confirmLeave()).toBe(false)

    expect(openedDialogs).toHaveLength(1)
    expect(interactions).toEqual([])
    expect(component.lineItems).toHaveLength(1)
  })

  it('„Verwerfen" gibt die Navigation frei und protokolliert den Abbruch mit Positionen', async () => {
    const { component, dialogResult, interactions } = setup()
    component.increaseLineItem(product('p-1'))
    dialogResult.value = true

    expect(await component.confirmLeave()).toBe(true)

    expect(interactions).toHaveLength(1)
    expect(interactions[0]).toMatchObject({ type: 'order-cancel', hadLineItems: true })
  })

  it('ein weggeklickter Rückfrage-Dialog (kein Ergebnis) zählt als „Weiter bearbeiten"', async () => {
    const { component, dialogResult } = setup()
    component.increaseLineItem(product('p-1'))
    dialogResult.value = undefined

    expect(await component.confirmLeave()).toBe(false)
  })
})

describe('Kasse — Ende einer Bestellung (core#828)', () => {
  it('Bestellen meldet „order-placed" — die Kasse bleibt offen, die Route baut sie frisch auf', async () => {
    const { component, closeCalls, createdOrders } = setup()
    component.increaseLineItem(product('p-1'))

    await component.placeOrder()

    expect(createdOrders).toHaveLength(1)
    expect(closeCalls).toEqual(['order-placed'])
  })
})

/**
 * Der Inaktivitäts-Logout setzt aus, solange in der Kasse etwas eingegeben ist. Als Dialog hieß
 * das „Dialog offen"; die Route ist dauernd offen, also zählt die Eingabe (core#828).
 */
describe('Kasse — Entwurf für den Inaktivitäts-Logout (core#828)', () => {
  it('eine leere Kasse hält den Logout nicht auf, eine Eingabe schon', () => {
    const { component, kasseDraft } = setup()
    expect(kasseDraft.hasDraft()).toBe(false)

    component.increaseLineItem(product('p-1'))

    expect(kasseDraft.hasDraft()).toBe(true)
  })

  it('ohne angehängte Kasse gibt es keinen Entwurf', () => {
    expect(new KasseDraftRegistry().hasDraft()).toBe(false)
  })

  it('das Lösen einer alten Kasse hängt eine neuere nicht ab', () => {
    const registry = new KasseDraftRegistry()
    const detachOld = registry.attach(() => false)
    registry.attach(() => true)

    detachOld()

    expect(registry.hasDraft()).toBe(true)
  })
})

/**
 * „1x Ketchup +2,10 €" bei 3× Currywurst: der Betrag galt für drei Stück, die Menge nannte
 * eins (#795). Angezeigt wird jetzt die abgerechnete Menge — gleiche Entscheidung wie der Bon.
 */
describe('OrderDialog — Modifier-Menge im Warenkorb (#795)', () => {
  const extra = { amount: 1, price: 0.7, name: 'Ketchup' }

  it('je Stück gebucht: die Menge zählt alle Stücke der Zeile', () => {
    const { component } = setup()
    expect(component.modifierDisplayAmount({ amount: 3, modifierScope: 'unit', modifiers: [extra] }, extra)).toBe(3)
  })

  it('je Zeile gebucht oder ein Stück: die Menge bleibt, wie sie gespeichert ist', () => {
    const { component } = setup()
    expect(component.modifierDisplayAmount({ amount: 3, modifierScope: 'line', modifiers: [extra] }, extra)).toBe(1)
    expect(component.modifierDisplayAmount({ amount: 1, modifierScope: 'unit', modifiers: [extra] }, extra)).toBe(1)
  })
})

describe('OrderDialog — „Bestellung leeren" fragt nach (#795)', () => {
  it('„Abbrechen" in der Rückfrage lässt den Warenkorb stehen; die Rückfrage ist nicht wegklickbar', () => {
    const { component, openedDialogs, dialogResult } = setup()
    component.increaseLineItem(product('p-1'))
    dialogResult.value = false

    component.setDeleteSubbuttons()
    component.functionButtons.find((b: { _id?: string }) => b._id === 'deleteOrder').callback()

    expect(openedDialogs).toHaveLength(1)
    expect(openedDialogs[0].disableClose).toBe(true)
    expect(component.lineItems).toHaveLength(1)
  })

  it('das Menü bietet keinen zweiten Weg zum Löschen einer Kombination mehr', () => {
    const { component } = setup()
    component.increaseLineItem(product('p-1'))

    component.setDeleteSubbuttons()

    expect(component.functionButtons.map((b: { _id?: string }) => b._id)).toEqual(['deleteOrder'])
  })
})

/**
 * Lösen und Löschen einer markierten Kombination sitzen seit core#829 in der Steuerleiste unter der
 * Kombination (Konzept §5). Bis dahin waren es Funktionstasten über dem Raster (#795), die das Raster
 * verdrängten — ein Kacheltap in die markierte Kombination (#271) war dann gar nicht möglich.
 */
describe('OrderDialog — markierte Kombination in der Steuerleiste (core#829)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function combinedPair(component: any): void {
    component.increaseLineItem(product('p-1'))
    component.increaseLineItem(product('p-2'))
    component.combineAllArticles()
    component.unselectProduct()
  }

  it('der Header-Tap markiert nur — keine Funktionstasten über dem Raster', () => {
    const { component } = setup()
    combinedPair(component)

    component.toggleCombinationSelection(0)

    expect(component.isWholeCombinationSelected()).toBe(true)
    expect(component.functionButtons).toEqual([])
    expect(component.selectionQuantity()).toBeNull()
  })

  it('„Kombi lösen" macht freie Zeilen daraus und hebt die Markierung auf', () => {
    const { component } = setup()
    combinedPair(component)
    component.toggleCombinationSelection(0)

    component.resolveSelectedCombination()

    expect(component.combinations).toHaveLength(0)
    expect(component.lineItems).toHaveLength(2)
    expect(component.selectedCombinationIndex).toEqual([null, null])
  })

  it('„Kombi lösen" tut nichts, solange nur eine Position markiert ist', () => {
    const { component } = setup()
    combinedPair(component)
    component.selectCombinationByIndex(0, 1)

    component.resolveSelectedCombination()

    expect(component.combinations).toHaveLength(1)
  })

  it('Löschen entfernt die ganze Kombination, mit Rückgängig', () => {
    const { component, noticeRefs } = setup()
    combinedPair(component)
    component.toggleCombinationSelection(0)
    expect(component.canMutateSelection()).toBe(true)

    component.deleteSelection()

    expect(component.lineItems).toHaveLength(0)
    noticeRefs[noticeRefs.length - 1].triggerAction()
    expect(component.combinations).toHaveLength(1)
  })

  it('das Kombi-Menü bietet kein Auflösen mehr — das sitzt an der markierten Kombination', () => {
    const { component } = setup()
    combinedPair(component)

    component.setCombiSubButtons()

    expect(component.functionButtons.map((b: { _id?: string }) => b._id)).not.toContain('resolveCombination')
  })
})

/**
 * 3× Schnitzel + Rotwein: Bis #795 wanderten beim Kombinieren immer alle drei Schnitzel in die
 * Kombination, und aus einer Kombination ließ sich kein einzelnes Stück wieder lösen. Eine
 * Kombination ordnet Stücke einer Person zu — sie muss deshalb Stückzahlen kennen.
 */
describe('OrderDialog — Stückzahlen beim Kombinieren und Herauslösen (#795)', () => {
  type Line = { name: string; amount: number; bundleNumber?: number | null }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shape = (component: any) => ({
    combinations: component.combinations.map((c: Line[]) => c.map(l => `${l.amount}×${l.name}`)),
    free: component.lineItems
      .filter((l: Line) => l.bundleNumber === null || l.bundleNumber === undefined)
      .map((l: Line) => `${l.amount}×${l.name}`),
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function threeSchnitzelAndWine(component: any): void {
    for (let i = 0; i < 3; i++) component.increaseLineItem(product('schnitzel'))
    component.increaseLineItem(product('wein'))
    component.unselectProduct()
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tile = (component: any, index: number) =>
    component.productButtons.find((b: { _id?: string }) => b._id === `combiButton${index}`)

  it('jeder Tipp auf die Kachel zählt ein Stück hoch, nach dem letzten ist sie aus', () => {
    const { component } = setup()
    threeSchnitzelAndWine(component)
    component.setCombiSubButtons()

    tile(component, 0).callback()
    expect(tile(component, 0).pressed).toBe(true)
    expect(tile(component, 0).countLabel).toBe('1/3')
    tile(component, 0).callback()
    expect(tile(component, 0).countLabel).toBe('2/3')
    tile(component, 0).callback()
    tile(component, 0).callback()

    expect(tile(component, 0).pressed).toBe(false)
    expect(tile(component, 0).countLabel).toBeUndefined()
  })

  it('KOMBINIEREN nimmt nur die gezählten Stück, der Rest bleibt frei', () => {
    const { component } = setup()
    threeSchnitzelAndWine(component)
    component.setCombiSubButtons()

    tile(component, 0).callback() // 1/3
    tile(component, 1).callback() // Wein
    component.increaseCombination()

    expect(shape(component)).toEqual({
      combinations: [['1×Artikel schnitzel', '1×Artikel wein']],
      free: ['2×Artikel schnitzel'],
    })
  })

  it('„Alle Artikel kombinieren" nimmt weiterhin ganze Zeilen', () => {
    const { component } = setup()
    threeSchnitzelAndWine(component)

    component.combineAllArticles()

    expect(shape(component)).toEqual({ combinations: [['3×Artikel schnitzel', '1×Artikel wein']], free: [] })
  })

  it('Herauslösen nimmt so viele Stück, wie der Multiplikator zeigt, und nennt die Zahl', () => {
    const { component } = setup()
    threeSchnitzelAndWine(component)
    component.combineAllArticles()
    component.selectCombinationByIndex(0, 0)
    component.numpadAction(2)

    expect(component.releaseLabel()).toBe('2 herauslösen')
    component.releaseFromCombination()

    expect(shape(component)).toEqual({
      combinations: [['1×Artikel schnitzel', '1×Artikel wein']],
      free: ['2×Artikel schnitzel'],
    })
    expect(component.multiplier).toBe(1)
  })

  it('ohne Multiplikator löst es ein Stück und führt es mit einer gleichen freien Zeile zusammen', () => {
    const { component } = setup()
    threeSchnitzelAndWine(component)
    component.setCombiSubButtons()
    tile(component, 0).callback()
    tile(component, 0).callback() // 2/3
    tile(component, 1).callback()
    component.increaseCombination() // Kombination 2× Schnitzel + Wein, frei 1× Schnitzel
    component.selectCombinationByIndex(0, 0)

    expect(component.releaseLabel()).toBe('1 herauslösen')
    component.releaseFromCombination()

    expect(shape(component)).toEqual({
      combinations: [['1×Artikel schnitzel', '1×Artikel wein']],
      free: ['2×Artikel schnitzel'],
    })
  })

  it('bleibt nur eine Position übrig, löst sich die Kombination auf', () => {
    const { component } = setup()
    component.increaseLineItem(product('schnitzel'))
    component.increaseLineItem(product('wein'))
    component.combineAllArticles()
    component.selectCombinationByIndex(0, 1)

    component.releaseFromCombination()

    expect(shape(component)).toEqual({ combinations: [], free: ['1×Artikel schnitzel', '1×Artikel wein'] })
  })

  it('ein Multiplikator über der Stückzahl löst die ganze Position', () => {
    const { component } = setup()
    threeSchnitzelAndWine(component)
    component.combineAllArticles()
    component.selectCombinationByIndex(0, 0)
    component.numpadAction(9)

    expect(component.releaseLabel()).toBe('3 herauslösen')
  })

  it('an einer freien Zeile gibt es nichts herauszulösen', () => {
    const { component } = setup()
    threeSchnitzelAndWine(component)
    component.selectProduct(0)

    expect(component.releaseLabel()).toBeNull()
  })
})

/**
 * Kassenbildschirm B1 (core#829): Der Tipp auf eine Zeile wählt nur aus, die Steuerleiste darunter
 * trägt −, +, Anpassen und Löschen (Konzept §5 „Zeilenauswahl"). Bis dahin öffnete der Tipp sofort
 * das Panel und nahm das Raster weg, auch wenn nur die Menge zu ändern war.
 */
describe('Kasse — Zeilenauswahl und Steuerleiste (core#829)', () => {
  const ui = { index: 1, showOptionsAuto: false, hideOnMainScreen: false }
  const ketchup = {
    externalId: '018f0000-0000-7000-8000-00000000a001',
    version: 1,
    ingredientName: 'Ketchup',
    initialQuantity: 1,
    quantity: 1,
    onlyOutsideConsumption: false,
    isRemovable: true,
    priceAdjustment: 0,
  }
  // Anpassbar ist, was Zutaten trägt — beide Artikel öffnen damit das Panel.
  const customizable = (id: string) => product(id, { ui, ingredientReferences: [ketchup] } as never)
  const burger = () => customizable('burger')

  it('der Tipp wählt die Zeile aus, ohne das Panel zu öffnen; der zweite hebt die Auswahl auf', () => {
    const p = burger()
    const { component } = setup({ catalog: [p] })
    component.increaseLineItem(p)
    component.unselectProduct()

    component.toggleProductSelection(0)

    expect(component.selectedProductIndex).toBe(0)
    expect(component.customizeModel()).toBeNull()

    component.toggleProductSelection(0)

    expect(component.selectedProductIndex).toBeNull()
  })

  it('„Anpassen" öffnet das Panel für die markierte Zeile', () => {
    const p = burger()
    const { component } = setup({ catalog: [p] })
    component.increaseLineItem(p)
    component.unselectProduct()
    component.toggleProductSelection(0)

    component.customizeSelection()

    expect(component.customizeModel()?.name).toBe('Artikel burger')
  })

  it('ist das Panel offen, zieht es mit dem Tipp auf eine andere anpassbare Zeile mit', () => {
    const p = burger()
    const fries = customizable('fries')
    const { component } = setup({ catalog: [p, fries] })
    component.increaseLineItem(p)
    component.increaseLineItem(fries)
    component.unselectProduct()
    component.toggleProductSelection(0)
    component.customizeSelection()

    component.toggleProductSelection(1)

    expect(component.customizeModel()?.name).toBe('Artikel fries')
  })

  it('der Tipp auf die offene Zeile schließt das Panel', () => {
    const p = burger()
    const { component } = setup({ catalog: [p] })
    component.increaseLineItem(p)
    component.unselectProduct()
    component.toggleProductSelection(0)
    component.customizeSelection()

    component.toggleProductSelection(0)

    expect(component.customizeModel()).toBeNull()
  })

  it('die Steuerleiste zeigt die Menge der markierten Zeile; Minus ist bei 1 aus', () => {
    const { component } = setup()
    component.increaseLineItem(product('p-1'))
    component.unselectProduct()
    component.toggleProductSelection(0)

    expect(component.selectionQuantity()).toBe(1)
    expect(component.canDecreaseSelection()).toBe(false)

    component.increaseSelectedQuantity()

    expect(component.selectionQuantity()).toBe(2)
    expect(component.canDecreaseSelection()).toBe(true)
  })

  it('zählt für „Gesamt · n Artikel" Stücke, nicht Zeilen', () => {
    const { component } = setup()
    component.increaseLineItem(product('p-1'))
    component.increaseLineItem(product('p-1'))
    component.increaseLineItem(product('p-2'))

    expect(component.articleCount()).toBe(3)
  })
})

describe('Kasse — Seite des Warenkorbs je Mitarbeiter (core#829)', () => {
  it('ohne Wahl links, wie bisher', () => {
    const { component } = setup()

    expect(component.handedness()).toBe('left')
  })

  it('folgt posHandedness des angemeldeten Mitarbeiters', () => {
    const { component } = setup({ posHandedness: 'right' })

    expect(component.handedness()).toBe('right')
  })

  it('folgt einer Wahl im Avatar-Menü sofort, ohne neu geladenen Mitarbeiter (core#833)', () => {
    const { component, chosenHandedness } = setup({ posHandedness: 'left' })

    chosenHandedness.set('right')

    expect(component.handedness()).toBe('right')
  })
})

describe('Kasse — Blocker folgt dem Standort (core#868)', () => {
  it('verschwindet, sobald der Standort nach dem Neuladen auf /kasse eintrifft', async () => {
    const activeLocation = signal<unknown>(undefined)
    const { component } = setup({ activeLocation })
    await component.ngOnInit()
    component.ngOnDestroy()

    expect(component.blockingReason()).toBe('Standort konnte nicht geladen werden.')

    activeLocation.set({ _id: 'loc-1', settings: {}, operationMode: 'full' })

    expect(component.blockingReason()).toBeNull()
  })

  it('blockiert wieder, wenn der Standort wegfällt', () => {
    const activeLocation = signal<unknown>({ _id: 'loc-1', settings: {}, operationMode: 'full' })
    const { component } = setup({ activeLocation })

    expect(component.blockingReason()).toBeNull()

    activeLocation.set(undefined)

    expect(component.blockingReason()).toBe('Standort konnte nicht geladen werden.')
  })
})

describe('OrderDialog — Bezahlansicht „nur Bar" (core#831)', () => {
  const cashier = { operationMode: 'pos-cashier' }

  it('heißt im Kassenbetrieb „Bezahlen", im Bestellbetrieb bleibt es beim Bestellen', () => {
    expect(setup(cashier).component.paysAtCounter()).toBe(true)
    expect(setup({ operationMode: 'orders-only' }).component.paysAtCounter()).toBe(false)
  })

  it('bezahlt im Bestellbetrieb nie, auch wenn der Kanal auf Kasse umgeschaltet wird', () => {
    // Im Bestellbetrieb steht der Kanal vorbelegt auf Telefon; das Umschalten auf Kasse darf daran nichts ändern.
    const { component } = setup({ operationMode: 'orders-only' })
    component.toggleOrderChannel()

    expect(component.orderChannel()).toBe('pos')
    expect(component.paysAtCounter()).toBe(false)
  })

  it('kassiert die Summe nach Rabatt, wie sie die Primärtaste zeigt', async () => {
    const { component } = setup(cashier)
    component.increaseLineItem(product('p-1'))
    component.selectedManualDiscount.set(managedDiscount())

    await component.placeOrder()

    expect(component.payment()?.total).toBe(8)
  })

  it('bezahlt nur Barverkäufe an der Kasse: Telefon, Personalessen und Firmenkunde gehen den alten Weg', () => {
    const phone = setup(cashier)
    phone.component.toggleOrderChannel()
    expect(phone.component.paysAtCounter()).toBe(false)

    const customer = setup(cashier)
    customer.component._customer = { _id: 'c-1', name1: 'Firma' }
    expect(customer.component.paysAtCounter()).toBe(false)
  })

  it('legt die Bestellung mit vorab vergebener ID an, öffnet die Bezahlansicht und bleibt in der Kasse', async () => {
    const { component, createdOrders, closeCalls } = setup(cashier)
    component.increaseLineItem(product('p-1'))

    await component.placeOrder()

    expect(createdOrders).toHaveLength(1)
    const orderId = createdOrders[0]['_id'] as string
    expect(orderId).toMatch(/^[0-9a-f-]{36}$/)
    expect(component.payment()).toEqual({ orderId, total: 10 })
    expect(component.sheetOpen()).toBe(true)
    // Geschlossen wird erst nach Kassieren oder „Offen lassen" — vorher darf die Route nicht neu aufbauen.
    expect(closeCalls).toEqual([])
    // Der Warenkorb ist leer: Die Bestellung steht schon auf dem Server.
    expect(component.lineItems).toEqual([])
  })

  it('ohne Kassenbetrieb legt placeOrder wie bisher an und schließt sofort', async () => {
    const { component, createdOrders, closeCalls } = setup({ operationMode: 'orders-only' })
    component.increaseLineItem(product('p-1'))

    await component.placeOrder()

    expect(createdOrders[0]['_id']).toBeUndefined()
    expect(component.payment()).toBeNull()
    expect(closeCalls).toEqual(['order-placed'])
  })

  it('behält die Positionen, wenn das Anlegen scheitert, und öffnet keine Bezahlansicht', async () => {
    const { component, closeCalls } = setup({ ...cashier, createOrderResult: null })
    component.increaseLineItem(product('p-1'))

    await component.placeOrder()

    expect(component.payment()).toBeNull()
    expect(closeCalls).toEqual([])
    expect(component.lineItems).toHaveLength(1)
  })

  it('kassiert über OrderCheckoutService.payCash mit der Summe der Primärtaste und schließt danach', async () => {
    const { component, createdOrders, payCashCalls, closeCalls } = setup(cashier)
    component.increaseLineItem(product('p-1'))
    await component.placeOrder()

    await component.onCollect()

    expect(payCashCalls).toHaveLength(1)
    expect(payCashCalls[0]).toMatchObject({ orderId: createdOrders[0]['_id'], total: 10, cashierId: CURRENT_USER_ID })
    expect(component.payment()).toBeNull()
    expect(closeCalls).toEqual(['order-placed'])
  })

  it('bleibt in der Bezahlansicht, wenn das Kassieren scheitert, und kassiert nicht doppelt', async () => {
    const { component, payCashCalls, closeCalls } = setup({ ...cashier, payCashResult: 'failed' })
    component.increaseLineItem(product('p-1'))
    await component.placeOrder()

    await component.onCollect()

    expect(component.payment()).not.toBeNull()
    expect(closeCalls).toEqual([])
    expect(component.paying()).toBe(false)
    await component.onCollect()
    expect(payCashCalls).toHaveLength(2)
  })

  it('meldet eine verweigerte Kassen-Freigabe und lässt die Bestellung offen stehen', async () => {
    const { component, notices, closeCalls } = setup({ ...cashier, payCashResult: 'cash-session-declined' })
    component.increaseLineItem(product('p-1'))
    await component.placeOrder()

    await component.onCollect()

    expect(notices.map(c => c.message)).toEqual(['Kasse nicht freigegeben — die Bestellung bleibt offen'])
    expect(component.payment()).not.toBeNull()
    expect(closeCalls).toEqual([])
  })

  it('legt bei zwei schnellen Tipps nur eine Bestellung an, solange das Anlegen läuft', async () => {
    const { component, createdOrders, releaseCreate } = setup({ ...cashier, holdCreate: true })
    component.increaseLineItem(product('p-1'))

    const first = component.placeOrder()
    const second = component.placeOrder()
    expect(component.placing()).toBe(true)
    expect(component.sheetOpen()).toBe(true)
    // Erst wenn `createOrder` aufgerufen und offen ist, kann der „Server" antworten.
    await new Promise(resolve => setTimeout(resolve, 0))
    releaseCreate()
    await Promise.all([first, second])

    expect(createdOrders).toHaveLength(1)
    expect(component.placing()).toBe(false)
  })

  it('löst einen Rabattcode nach gescheitertem Anlegen nicht ein zweites Mal ein', async () => {
    const { component, createdOrders, redeemCalls } = setup({ ...cashier, createOrderFailures: 1 })
    component.increaseLineItem(product('p-1'))
    component.appliedCodeDiscount.set({ ok: true, code: 'SOMMER' })

    await component.placeOrder()
    expect(component.payment()).toBeNull()
    await component.placeOrder()

    expect(redeemCalls).toHaveLength(1)
    expect(createdOrders).toHaveLength(2)
    // Dieselbe ID und derselbe Rabatt-Snapshot beim zweiten Versuch.
    expect(createdOrders[1]['_id']).toBe(createdOrders[0]['_id'])
    expect(createdOrders[1]['appliedDiscounts']).toEqual(createdOrders[0]['appliedDiscounts'])
    expect(component.payment()?.orderId).toBe(createdOrders[0]['_id'])
  })

  it('nimmt die Einlösung eines Codes nach geglücktem Anlegen nicht in die nächste Bestellung mit', async () => {
    const { component, createdOrders, redeemCalls } = setup(cashier)
    component.increaseLineItem(product('p-1'))
    component.appliedCodeDiscount.set({ ok: true, code: 'SOMMER' })
    await component.placeOrder()
    component.onKeepOpen()

    component.increaseLineItem(product('p-2'))
    component.appliedCodeDiscount.set({ ok: true, code: 'WINTER' })
    await component.placeOrder()

    expect(redeemCalls.map(call => call['code'])).toEqual(['SOMMER', 'WINTER'])
    expect(createdOrders[1]['_id']).not.toBe(createdOrders[0]['_id'])
  })

  it('öffnet bei einem Personalessen-Rabatt keine Bezahlansicht', async () => {
    const { component, closeCalls } = setup(cashier)
    component.increaseLineItem(product('p-1'))
    component.selectedManualDiscount.set(managedDiscount({ isStaffMeal: true }))

    expect(component.paysAtCounter()).toBe(false)
    await component.placeOrder()

    expect(component.payment()).toBeNull()
    expect(closeCalls).toEqual(['order-placed'])
  })

  it('„Offen lassen" kassiert nichts und schließt wie heute', async () => {
    const { component, payCashCalls, closeCalls } = setup(cashier)
    component.increaseLineItem(product('p-1'))
    await component.placeOrder()

    component.onKeepOpen()

    expect(payCashCalls).toEqual([])
    expect(component.payment()).toBeNull()
    expect(closeCalls).toEqual(['order-placed'])
  })

  it('sperrt Kassieren, solange ein Abschluss läuft', async () => {
    const { component, payCashCalls } = setup(cashier)
    component.increaseLineItem(product('p-1'))
    await component.placeOrder()
    component.paying.set(true)

    await component.onCollect()
    component.onKeepOpen()

    expect(payCashCalls).toEqual([])
    expect(component.payment()).not.toBeNull()
  })
})

// core#878: Seit die Kasse eine Route ist (core#828), erzeugt ein Neuladen auf `/kasse` die Komponente, bevor
// `LocationService.activeLocation()` gesetzt ist. Kanal-Vorbelegung und Pauschalpreise wurden aber im Konstruktor
// einmal gelesen und blieben auf Telefon bzw. 0.
describe('OrderDialog — Standort kommt nach dem Aufbau (core#878)', () => {
  const location = (over: Record<string, unknown> = {}) => ({
    _id: 'loc-1',
    operationMode: 'pos-cashier',
    settings: { genericProductSettings: { generalSideDishPrice: 1.5, generalDrinkPrice: 2.5 } },
    ...over,
  })

  it('belegt den Kanal mit Kasse vor, sobald die Filiale im Kassenbetrieb geladen ist', () => {
    const activeLocation = signal<unknown>(undefined)
    const { component } = setup({ activeLocation: () => activeLocation() })
    expect(component.orderChannel()).toBe('telephone')

    activeLocation.set(location())

    expect(component.orderChannel()).toBe('pos')
  })

  it('belegt im Bestellbetrieb weiter Telefon vor', () => {
    const activeLocation = signal<unknown>(undefined)
    const { component } = setup({ activeLocation: () => activeLocation() })

    activeLocation.set(location({ operationMode: 'orders-only' }))

    expect(component.orderChannel()).toBe('telephone')
  })

  it('lässt die Wahl des Kassierers stehen, wenn der Standort neu geladen wird, ohne dass sich der Modus ändert', () => {
    const activeLocation = signal<unknown>(location())
    const { component } = setup({ activeLocation: () => activeLocation() })
    component.toggleOrderChannel()
    expect(component.orderChannel()).toBe('telephone')

    // Ein Refresh liefert ein neues Objekt mit demselben Modus.
    activeLocation.set(location({ _id: 'loc-1' }))

    expect(component.orderChannel()).toBe('telephone')
  })

  it('übernimmt die Pauschalpreise für Beilage und Getränk, auch wenn der Standort später kommt', () => {
    const activeLocation = signal<unknown>(undefined)
    const { component } = setup({ activeLocation: () => activeLocation() })
    expect([component.generalSideDishPrice, component.generalDrinkPrice]).toEqual([0, 0])

    activeLocation.set(location())

    expect([component.generalSideDishPrice, component.generalDrinkPrice]).toEqual([1.5, 2.5])
  })

  it('fällt ohne Einstellung auf 0 zurück', () => {
    const { component } = setup({ activeLocation: () => location({ settings: {} }) })

    expect([component.generalSideDishPrice, component.generalDrinkPrice]).toEqual([0, 0])
  })
})

// core#837: Die erste Ziffer ersetzt die Startmenge 1. Als erste Ziffer 0 stand der Multiplikator auf 0, und die
// nächste Kachel buchte eine Position mit Menge 0 (Summe 0 €, Zeile „0×").
describe('OrderDialog — Multiplikator beginnt nie mit 0 (core#837)', () => {
  const lineAmounts = (component: { lineItems: Array<{ amount: number }> }) => component.lineItems.map(l => l.amount)

  it('bucht nach einer Null als erster Ziffer mit Menge 1, nicht mit Menge 0', () => {
    const { component } = setup()

    component.numpadAction(0)
    component.increaseLineItem(product('p-1'))

    expect(lineAmounts(component)).toEqual([1])
  })

  it('zeigt den Multiplikator nach der Null weiter als × 1', () => {
    const { component } = setup()

    component.numpadAction(0)

    expect(component.multiplier).toBe(1)
  })

  it('lässt eine Null nach einer Ziffer gelten: 1, 0 → 10', () => {
    const { component } = setup()

    component.numpadAction(1)
    component.numpadAction(0)

    expect(component.multiplier).toBe(10)
  })

  it('nimmt nach der ignorierten Null die erste echte Ziffer als Menge: 0, 5 → 5', () => {
    const { component } = setup()

    component.numpadAction(0)
    component.numpadAction(5)
    component.increaseLineItem(product('p-1'))

    expect(lineAmounts(component)).toEqual([5])
  })

  it('mehrere führende Nullen bleiben ohne Wirkung: 0, 0, 3 → 3', () => {
    const { component } = setup()

    component.numpadAction(0)
    component.numpadAction(0)
    component.numpadAction(3)

    expect(component.multiplier).toBe(3)
  })

  it('setzt C wie bisher auf 1 zurück', () => {
    const { component } = setup()
    component.numpadAction(7)

    component.numpadReset()

    expect(component.multiplier).toBe(1)
  })
})

// core#908: Die Infozeile über der Gruppenleiste ist weg; Meldungen erscheinen als Hinweis über dem Raster und
// blenden sich aus. Stumm bleiben Leerlauf-Text und das Echo dessen, was Leiste und Funktionsblock schon zeigen.
describe('Kasse — Hinweis statt Infozeile (core#908)', () => {
  function withFakeTimers() {
    vi.useFakeTimers()
    onTestFinished(() => {
      vi.useRealTimers()
    })
  }

  it('zeigt einen Fehler rot und blendet ihn nach sechs Sekunden aus, nicht schon nach vier', () => {
    withFakeTimers()
    const { component } = setup()

    component.setInfoBoxText('Erst eine Position im Warenkorb antippen', 'red')

    expect(component.notice()).toEqual({ text: 'Erst eine Position im Warenkorb antippen', tone: 'danger' })
    vi.advanceTimersByTime(4000)
    expect(component.notice()).not.toBeNull()
    vi.advanceTimersByTime(2000)
    expect(component.notice()).toBeNull()
  })

  it('zeigt eine Meldung ohne Farbe neutral und blendet sie nach vier Sekunden aus', () => {
    withFakeTimers()
    const { component } = setup()

    component.setInfoBoxText('Rabattcode SOMMER übernommen')

    expect(component.notice()).toEqual({ text: 'Rabattcode SOMMER übernommen', tone: 'neutral' })
    vi.advanceTimersByTime(4000)
    expect(component.notice()).toBeNull()
  })

  it('lässt eine neue Meldung ihre volle Zeit stehen, auch wenn die alte gerade ablief', () => {
    withFakeTimers()
    const { component } = setup()

    component.setInfoBoxText('erste')
    vi.advanceTimersByTime(3000)
    component.setInfoBoxText('zweite')
    vi.advanceTimersByTime(3000)

    expect(component.notice()?.text).toBe('zweite')
  })

  it('bleibt beim Leerlauf-Text und bei der Wahl einer Gruppe stumm und räumt einen offenen Hinweis ab', () => {
    const { component } = setup()

    component.setInfoBoxText('Für die Kombination werden min. 2 Artikel benötigt.', 'red')
    component.unselectProduct()
    expect(component.notice()).toBeNull()

    component.setInfoBoxText('Für die Kombination werden min. 2 Artikel benötigt.', 'red')
    component.createProductButtons({ _id: 'g-1', name: 'Getränke', color: '#0ea5e9' } as never)
    expect(component.notice()).toBeNull()
  })

  it('wiederholt nicht, was der Funktionsblock schon als Überschrift trägt', () => {
    const { component } = setup()
    ;(component as unknown as { _functionBlockLabel: string })._functionBlockLabel = 'Beilage'

    component.setInfoBoxText('Beilage')

    expect(component.notice()).toBeNull()
    expect(component.infoBoxText).toBe('Beilage')
  })
})

// core#965: Der Hauptbildschirm zeigt keine Funktionstasten; „Kombination" sitzt in der Warenkorb-Leiste.
describe('Kasse — Hauptbereich ohne Funktionstasten (core#965)', () => {
  it('zeigt ohne laufenden Ablauf keine Funktionstasten', () => {
    const { component } = setup()

    expect(component.functionButtons).toEqual([])
    expect(component.boardFunctionButtons).toEqual([])
  })

  it('öffnet setCombiSubButtons die Kombinationsansicht, deren Tasten dann allein stehen', () => {
    const { component } = setup()
    component.increaseLineItem(product('p-1'))
    component.increaseLineItem(product('p-2'))

    component.setCombiSubButtons()

    expect(component.functionBlockLabel).toBe('Kombination')
    expect(component.boardFunctionButtons).toBe(component.functionButtons)
    expect(component.boardFunctionButtons.length).toBeGreaterThan(0)
  })

  it('meldet über setCombiSubButtons, wenn für eine Kombination Artikel fehlen', () => {
    const { component } = setup()

    component.setCombiSubButtons()

    expect(component.notice()).toEqual({ text: 'Für die Kombination werden min. 2 Artikel benötigt.', tone: 'danger' })
    expect(component.boardFunctionButtons).toEqual([])
  })
})

// core#1068: Die Gruppenleiste hebt die Gruppe hervor, deren Produkte das Raster zeigt.
describe('Kasse — aktive Produktgruppe (core#1068)', () => {
  it('merkt sich die gewählte Gruppe und wechselt mit der nächsten', () => {
    const { component } = setup()

    expect(component.activeProductGroupId()).toBeNull()
    component.createProductButtons({ _id: 'g-1', name: 'Getränke', color: '#0ea5e9' } as never)
    expect(component.activeProductGroupId()).toBe('g-1')
    component.createProductButtons({ _id: 'g-2', name: 'Speisen', color: '#e05d5d' } as never)
    expect(component.activeProductGroupId()).toBe('g-2')
  })

  it('verliert die Hervorhebung, sobald ein Ablauf das Raster ersetzt', () => {
    const { component } = setup()
    component.createProductButtons({ _id: 'g-1', name: 'Getränke', color: '#0ea5e9' } as never)

    component.setDeleteSubbuttons()

    expect(component.activeProductGroupId()).toBeNull()
  })
})
