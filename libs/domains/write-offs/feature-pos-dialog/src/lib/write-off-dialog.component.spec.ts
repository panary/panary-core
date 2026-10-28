// JIT-Compiler zuerst laden: @angular/material ist partial-compiled (siehe cancel-order-dialog.component.spec).
import '@angular/compiler'
import { describe, expect, it } from 'vitest'
import {
  APP_ID,
  createEnvironmentInjector,
  type EnvironmentInjector,
  Injector,
  runInInjectionContext,
  signal,
  ɵChangeDetectionScheduler as ChangeDetectionScheduler,
  ɵEffectScheduler as EffectScheduler,
} from '@angular/core'
import { MatDialog, MatDialogRef } from '@angular/material/dialog'
import { TranslateService } from '@ngx-translate/core'
import { NotificationService } from '@panary/shared/ui-notifications'
import { WriteOffItemType } from '@panary/write-offs/domain'
import { WriteOffService } from '@panary/write-offs/data-access'
import { ProductService } from '@panary/products/data-access'
import { IngredientService } from '@panary/ingredients/data-access'
import { RecipeService } from '@panary/recipes/data-access'
import { UserService } from '@panary/users/data-access'
import { BusinessDayService } from '@panary/businessdays/data-access'
import { DeviceConfigService } from '@panary/shared/data-access-config'
import { LocationService } from '@panary/locations/data-access'
import { PosWriteOffDialogComponent } from './write-off-dialog.component'

// core#1017: Das Suchfeld läuft auf Signal Forms. Vorher setzte ein `valueChanges`-Abo die Auswahl
// beim Tippen zurück; jetzt erledigt das `linkedSignal` auf dem Suchbegriff. Bricht die Kopplung,
// bucht „Speichern“ den zuvor gewählten Artikel, obwohl im Feld schon ein anderer Name steht.

const PRODUCTS = [
  { _id: 'p1', name: 'Brezel', productType: 'PRODUCT' },
  { _id: 'p2', name: 'Brot', productType: 'PRODUCT' },
  { _id: 'b1', name: 'Brotzeit-Menü', productType: 'BUNDLE' },
]

function setup() {
  // `form()` braucht AppId und die beiden Scheduler, die sonst die Plattform stellt. Die Validierung
  // selbst sind computed-Signale und läuft ohne sie; die Stubs halten nur den Aufbau am Leben.
  const injector = createEnvironmentInjector(
    [
      { provide: ChangeDetectionScheduler, useValue: { notify: () => undefined, runningTick: false } },
      {
        provide: EffectScheduler,
        useValue: { add: () => undefined, schedule: () => undefined, remove: () => undefined, flush: () => undefined },
      },
      { provide: APP_ID, useValue: 'test' },
      { provide: MatDialogRef, useValue: { close: () => undefined } },
      { provide: MatDialog, useValue: {} },
      { provide: WriteOffService, useValue: {} },
      { provide: ProductService, useValue: { products: signal(PRODUCTS) } },
      { provide: IngredientService, useValue: { items: signal([]) } },
      { provide: RecipeService, useValue: { items: signal([]) } },
      { provide: UserService, useValue: {} },
      { provide: BusinessDayService, useValue: {} },
      { provide: LocationService, useValue: {} },
      { provide: DeviceConfigService, useValue: {} },
      { provide: NotificationService, useValue: new NotificationService() },
      { provide: TranslateService, useValue: { instant: (key: string) => key } },
    ],
    Injector.create({ providers: [] }) as EnvironmentInjector,
  )
  return runInInjectionContext(injector, () => new PosWriteOffDialogComponent())
}

describe('PosWriteOffDialogComponent – Suchfeld', () => {
  it('filtert Produkte nach dem Suchbegriff aus dem Formularfeld, ohne Menüs', () => {
    const dialog = setup()
    dialog.searchField().value.set('bro')
    expect(dialog.filteredOptions().map(i => i._id)).toEqual(['p2'])
  })

  it('hebt die Auswahl auf, sobald im Suchfeld getippt wird', () => {
    const dialog = setup()
    dialog.selectItem(PRODUCTS[0] as never)
    expect(dialog.selectedItem()?._id).toBe('p1')

    dialog.searchField().value.set('Br')
    expect(dialog.selectedItem()).toBeNull()
  })

  it('behält eine Auswahl, die nach dem Tippen getroffen wurde', () => {
    const dialog = setup()
    dialog.searchField().value.set('Brot')
    dialog.selectItem(PRODUCTS[1] as never)
    expect(dialog.selectedItem()?._id).toBe('p2')
  })

  it('leert Suchfeld und Auswahl beim Typwechsel', () => {
    const dialog = setup()
    dialog.searchField().value.set('Brot')
    dialog.selectItem(PRODUCTS[1] as never)

    dialog.setType(WriteOffItemType.INGREDIENT)

    expect(dialog.searchField().value()).toBe('')
    expect(dialog.selectedItem()).toBeNull()
  })
})
