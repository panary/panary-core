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
import { of } from 'rxjs'

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
import { ConnectionService } from '@panary/shared/data-access'
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
  /** Was `matDialog.open()` als Auswahl zurueckgibt — pro Test gesetzt. */
  const dialogResult = { value: undefined as unknown }

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
          findProductById: () => undefined,
          findProductByExternalId: () => undefined,
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
            return { afterDismissed: () => of(undefined) }
          },
        },
      },
      { provide: OrderInteractionService, useValue: {} },
      { provide: PreOrderService, useValue: {} },
      { provide: DeviceConfigService, useValue: {} },
      { provide: ConnectionService, useValue: { systemMode: () => 'connected' } },
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

  return { component, createdOrders, redeemCalls, openedDialogs, closeCalls, snackBarCalls, dialogResult }
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

  it('decreaseQuantity() nimmt bei Menge 1 die Zeile UND ihren Rabatt mit', () => {
    const { component } = setup()
    component.increaseLineItem(product('p-1'))
    discountLine(component, 0)

    component.decreaseQuantity(component.lineItems[0], null)

    expect(component.lineItems).toHaveLength(0)
    expect(component.lineDiscounts()).toEqual({})
  })

  it('decreaseQuantity() laesst den Rabatt stehen, solange die Zeile bleibt', () => {
    const { component } = setup()
    component.increaseLineItem(product('p-1'))
    component.increaseLineItem(product('p-1')) // Duplikat-Check erhoeht die Menge
    const id = discountLine(component, 0)

    component.decreaseQuantity(component.lineItems[0], null)

    expect(component.lineItems).toHaveLength(1)
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
    component.decreaseQuantity(component.lineItems[0], null)

    component.increaseLineItem(product('p-1'))

    expect(component.lineDiscounts()).toEqual({})
    expect(component.lineDiscountOf(component.lineItems[0])).toBeUndefined()
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
