// JIT-Compiler zuerst laden: @angular/material ist partial-compiled; ohne Linker
// (kein analogjs-Plugin in dieser node-Vitest-Config) faellt Angular auf JIT zurueck.
import '@angular/compiler'
import { describe, expect, it } from 'vitest'
import {
  ChangeDetectorRef,
  DestroyRef,
  Injector,
  runInInjectionContext,
  signal,
  ɵChangeDetectionScheduler,
  ɵEffectScheduler,
} from '@angular/core'
import { MatDialog, MatDialogRef } from '@angular/material/dialog'
import { MatSnackBar } from '@angular/material/snack-bar'
import { TranslateService } from '@ngx-translate/core'
import { Subject, of } from 'rxjs'

import { OrderInteractionService, OrderService } from '@panary/orders/data-access'
import type { AppliedDiscount } from '@panary/orders/domain'
import { ProductGroupService } from '@panary/product-groups/data-access'
import { ProductService } from '@panary/products/data-access'
import type { ProductSchema } from '@panary/products/domain'
import { DiscountCodeService, DiscountService } from '@panary/discounts/data-access'
import type { Discount as ManagedDiscount } from '@panary/discounts/domain'
import { AuthService } from '@panary/auth/data-access'
import { UserService } from '@panary/users/data-access'
import { LocationService } from '@panary/locations/data-access'
import { PreOrderService } from '@panary/pre-orders/data-access'
import { ConnectionService, TenantSuspensionService } from '@panary/shared/data-access'
import { DeviceConfigService } from '@panary/shared/data-access-config'

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
  const redeemCalls: Array<Record<string, unknown>> = []
  const openedDialogs: Array<{ data?: unknown }> = []
  const closeCalls: unknown[] = []
  /** Was ueber `MatSnackBar` gemeldet wurde — der einzige Meldeweg, der den Dialogschluss ueberlebt. */
  const snackBarCalls: Array<{ message: string; action?: string }> = []
  /** Die geoeffneten Snackbars — `triggerAction()` spielt den Klick auf „Rueckgaengig" nach. */
  const snackBarRefs: Array<{ triggerAction: () => void; dismissed: boolean }> = []
  /** Aufrufe von `matSnackBar.dismiss()` — schliesst „die gerade offene", wer immer das ist (core#531). */
  const snackBarDismissAll = { count: 0 }
  /** Was `matDialog.open()` als Auswahl zurueckgibt — pro Test gesetzt. */
  const dialogResult = { value: undefined as unknown }

  /** Mandantensperre der Cloud (core#489) — pro Test per `suspended.set(true)` gesetzt. */
  const suspended = signal(false)

  const currentUser = {
    _id: CURRENT_USER_ID,
    firstName: 'Anna',
    lastName: 'Alt',
    staffMealDiscountId: options.staffMealDiscountId,
  }

  const injector = Injector.create({
    providers: [
      {
        provide: OrderService,
        useValue: {
          productionTimes: [0, 5, 10],
          createOrder: (payload: Record<string, unknown>) => {
            createdOrders.push(payload)
            return 0
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
          // Ohne aktive Filiale blockiert `checkBusinessDayValidity()` den Dialog —
          // hier reicht die Minimalform, der Geschaeftstag spielt fuer Rabatte keine Rolle.
          activeLocation: () => ({ _id: 'loc-1', settings: {}, operationMode: 'full' }),
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
        },
      },
      {
        provide: MatDialog,
        useValue: {
          open: (_component: unknown, config?: { data?: unknown }) => {
            openedDialogs.push({ data: config?.data })
            return { afterClosed: () => of(dialogResult.value) }
          },
        },
      },
      { provide: MatDialogRef, useValue: { close: (result?: unknown) => closeCalls.push(result) } },
      {
        provide: MatSnackBar,
        useValue: {
          open: (message: string, action?: string) => {
            snackBarCalls.push({ message, action })
            const actions = new Subject<void>()
            const ref = {
              afterDismissed: () => of(undefined),
              onAction: () => actions.asObservable(),
              dismissed: false,
              dismiss: () => {
                ref.dismissed = true
              },
              triggerAction: () => actions.next(),
            }
            snackBarRefs.push(ref)
            return ref
          },
          dismiss: () => {
            snackBarDismissAll.count++
          },
        },
      },
      { provide: OrderInteractionService, useValue: {} },
      { provide: PreOrderService, useValue: {} },
      { provide: DeviceConfigService, useValue: {} },
      { provide: ConnectionService, useValue: { systemMode: () => 'connected' } },
      { provide: TenantSuspensionService, useValue: { suspended } },
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
      { provide: DestroyRef, useValue: { onDestroy: () => () => undefined } },
    ],
  })

  // Direkt instanziieren statt `createComponent` (Muster: device-assignment.spec):
  // geprueft wird die Verdrahtung, nicht das Rendering. `private`/`protected` sind
  // nur TS-Sichtbarkeiten; zur Laufzeit sind die Member da.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component = runInInjectionContext(injector, () => new OrderDialogComponent()) as any

  return {
    component,
    createdOrders,
    redeemCalls,
    openedDialogs,
    closeCalls,
    snackBarCalls,
    snackBarRefs,
    snackBarDismissAll,
    dialogResult,
    suspended,
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

  it('der Funktionsknopf „Bestellung löschen?" setzt Rabatt, Code und Positionsrabatte zurueck (core#734)', () => {
    const { component } = setup()
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
    const { component, snackBarCalls } = setup()
    component.increaseLineItem(product('p-1'))

    expect(component.canMutateSelection()).toBe(false)
    expect(component.canDecreaseSelection()).toBe(false)

    component.increaseSelectedQuantity()
    component.decreaseSelectedQuantity()
    component.deleteSelection()

    expect(component.lineItems).toHaveLength(1)
    expect(component.lineItems[0].amount).toBe(1)
    expect(snackBarCalls).toHaveLength(0)
  })

  it('+ auf die markierte Zeile erhoeht die Menge und bietet „Rueckgaengig" an', () => {
    const { component, snackBarCalls, snackBarRefs } = setup()
    component.increaseLineItem(product('p-1'))
    component.selectProduct(0)

    component.increaseSelectedQuantity()

    expect(component.lineItems[0].amount).toBe(2)
    expect(snackBarCalls).toEqual([{ message: 'Menge: 2× Artikel p-1', action: 'Rückgängig' }])

    snackBarRefs[0].triggerAction()

    expect(component.lineItems[0].amount).toBe(1)
  })

  it('ein verfallenes „Rueckgaengig" tut nichts mehr', () => {
    // Zwei Faelle: ein neueres Angebot loest das aeltere ab, und nach dem Leeren
    // des Warenkorbs (placeOrder ruft deleteOrder) darf nichts zurueckkommen.
    const { component, snackBarRefs } = setup()
    component.increaseLineItem(product('p-1'))
    component.selectProduct(0)
    component.increaseSelectedQuantity() // -> 2
    component.increaseSelectedQuantity() // -> 3

    snackBarRefs[0].triggerAction() // das aeltere Angebot

    expect(component.lineItems[0].amount).toBe(3)

    component.deleteOrder()
    snackBarRefs[1].triggerAction()

    expect(component.lineItems).toHaveLength(0)
  })

  it('Minus bei Menge 1 ist deaktiviert und loescht NICHT', () => {
    const { component, snackBarCalls } = setup()
    component.increaseLineItem(product('p-1'))
    component.selectProduct(0)

    expect(component.canMutateSelection()).toBe(true)
    expect(component.canDecreaseSelection()).toBe(false)

    component.decreaseSelectedQuantity()

    expect(component.lineItems).toHaveLength(1)
    expect(component.lineItems[0].amount).toBe(1)
    expect(snackBarCalls).toHaveLength(0)
  })

  it('„Rueckgaengig" nach dem Loeschen bringt die Zeile MIT Rabatt zurueck und nimmt das item-delete mit', async () => {
    const { component, createdOrders, snackBarRefs } = setup()
    component.increaseLineItem(product('p-1'))
    component.increaseLineItem(product('p-2'))
    const id = discountLine(component, 0)
    component.selectProduct(0)

    component.deleteSelection()

    expect(component.lineItems.map((l: { name: string }) => l.name)).toEqual(['Artikel p-2'])
    expect(component.lineDiscounts()).toEqual({})

    snackBarRefs[0].triggerAction()

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
    const { component, snackBarRefs } = setup()
    component.increaseLineItem(product('p-1'))
    component.increaseLineItem(product('p-2'))
    component.combineAllArticles()
    component.toggleCombinationSelection(0)

    component.increaseSelectedQuantity()

    expect(component.lineItems.map((l: { amount: number }) => l.amount)).toEqual([2, 2])

    component.deleteSelection()

    expect(component.lineItems).toHaveLength(0)

    snackBarRefs[1].triggerAction()

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
    const { component, snackBarRefs } = setup()
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

    snackBarRefs[1].triggerAction()

    // … und nach „Rueckgaengig" wieder da, mit beiden Positionen.
    expect(component.combinations).toHaveLength(1)
    expect(component.combinations[0].map((l: { name: string }) => l.name)).toEqual(['Artikel p-1', 'Artikel p-2'])
  })

  it('der Header-Tap markiert die ganze Kombination und hebt sie beim zweiten Tap auf', () => {
    const { component } = setup()
    component.increaseLineItem(product('p-1'))
    component.increaseLineItem(product('p-2'))
    component.combineAllArticles()
    component['_selectedCombinationIndex'] = [0, 1]

    component.toggleCombinationSelection(0)

    // War eine Position markiert, gilt der Tap als Abwaehlen — nicht als Umschalten
    // auf die ganze Kombination.
    expect(component.selectedCombinationIndex).toEqual([null, null])

    component.toggleCombinationSelection(0)

    expect(component.selectedCombinationIndex).toEqual([0, null])
    expect(component.canMutateSelection()).toBe(true)
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
    expect(component.infoBoxBackgroundColor).toBe('red')
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
    expect(component.infoBoxBackgroundColor).toBe('red')
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
    const tiles: Array<{ name: string; icon?: string }> = component.productButtons
    expect(tiles.find(t => t.name === 'Mayo')?.icon).toBe('warning')
    expect(tiles.find(t => t.name === 'Ketchup')?.icon).toBeUndefined()
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
    const { component, closeCalls, snackBarCalls } = setup({ redeemResult: { ok: false, reason: 'exhausted' } })
    component.increaseLineItem(product('p-1'))
    component.appliedCodeDiscount.set({ ok: true, code: 'AUFGEBRAUCHT' })

    await component.placeOrder()

    expect(snackBarCalls).toHaveLength(1)
    expect(snackBarCalls[0].message).toMatch(/^Rabattcode nicht eingelöst — /)
    // Ohne `duration` bleibt die Snackbar bis zur Quittierung stehen; die Aktion ist
    // der einzige Weg, sie zu schliessen.
    expect(snackBarCalls[0].action).toBe('OK')

    // Gegenprobe: Die Infobox traegt die Meldung nicht (mehr) — sie waere unsichtbar.
    expect(component.infoBoxText).toBe('Bitte wählen Sie eine Produktkategorie')
    expect(closeCalls).toHaveLength(1)
  })

  it('das Undo-Aufraeumen beim Abschluss schliesst die Rabattcode-Meldung nicht (core#531)', async () => {
    // `placeOrder` meldet den gescheiterten Code und ruft danach `deleteOrder()`, das ein
    // offenes „Rueckgaengig" verfallen laesst. Bis core#531 tat es das per
    // `matSnackBar.dismiss()` — und das schliesst die gerade offene Snackbar, also genau
    // die Rabattcode-Meldung. Sie war damit in JEDEM Fall sofort weg.
    const { component, snackBarCalls, snackBarRefs, snackBarDismissAll } = setup({
      redeemResult: { ok: false, reason: 'exhausted' },
    })
    component.increaseLineItem(product('p-1'))
    component.selectProduct(0)
    component.increaseSelectedQuantity() // bietet „Rueckgaengig" an
    component.appliedCodeDiscount.set({ ok: true, code: 'AUFGEBRAUCHT' })

    await component.placeOrder()

    expect(snackBarCalls.map(c => c.action)).toEqual(['Rückgängig', 'OK'])
    expect(snackBarDismissAll.count).toBe(0)
    expect(snackBarRefs[0].dismissed).toBe(true) // das Undo-Angebot verfaellt
    expect(snackBarRefs[1].dismissed).toBe(false) // die Rabattcode-Meldung bleibt
  })

  it('eine geglueckte Einloesung meldet nichts', async () => {
    const { component, snackBarCalls } = setup({
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

    expect(snackBarCalls).toHaveLength(0)
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
    const { component, createdOrders, snackBarCalls, suspended } = setup()
    component.increaseLineItem(product('p-1'))
    suspended.set(true)

    await component.placeOrder()

    expect(createdOrders).toHaveLength(0)
    expect(snackBarCalls.map(c => c.message)).toEqual(['Konto gesperrt — bitte den Inhaber kontaktieren'])
    // Der Warenkorb bleibt stehen: Nach dem Ende der Sperre geht derselbe Bon durch.
    expect(component.lineItems).toHaveLength(1)
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
      const { component, snackBarRefs } = setup({ catalog: [p] })
      component.multiplier = 3
      component.increaseLineItem(p)
      component.selectProduct(0) // Panel offen, 3×, „1 Stück"
      component.decreaseSelectedQuantity() // 2×, Undo „zurück auf 3" angeboten
      component.onCustomizeIngredientToggled(KETCHUP) // spaltet ab: 1× + 1× ohne

      // Ohne Verfall setzte das Undo die Restzeile auf 3 — vier Burger statt zwei.
      snackBarRefs[0].triggerAction()
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
})
