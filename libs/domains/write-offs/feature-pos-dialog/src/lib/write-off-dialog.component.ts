import { Component, computed, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule, ReactiveFormsModule, FormControl } from '@angular/forms'
import { MatDialogRef, MatDialogModule, MatDialog } from '@angular/material/dialog'
import { MatAutocompleteModule } from '@angular/material/autocomplete'
import { NotificationService } from '@panary/shared/ui-notifications'
import { WriteOff, WriteOffItemType, WriteOffReason, WasteType } from '@panary/write-offs/domain'
import { WriteOffService } from '@panary/write-offs/data-access'
import { ProductSchema } from '@panary/products/domain'
import { ProductService } from '@panary/products/data-access'
import { Ingredient, IngredientService } from '@panary/ingredients/data-access'
import { Recipe, RecipeService } from '@panary/recipes/data-access'
import { UserService } from '@panary/users/data-access'
import { BusinessDayService } from '@panary/businessdays/data-access'
import { DeviceConfigService } from '@panary/shared/data-access-config'
import { LocationService } from '@panary/locations/data-access'
import { NumpadDialogComponent, IconComponent } from '@panary/shared/ui-common'
import { TranslateModule, TranslateService } from '@ngx-translate/core'
import { uuidv7 } from 'uuidv7'
import { withTimeout, writeOffErrorMessage } from './write-off-error'

@Component({
  selector: 'lib-write-off-dialog',
  standalone: true,
  imports: [
    IconComponent,
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatAutocompleteModule,
    TranslateModule,
  ],
  templateUrl: './write-off-dialog.component.html',
  styleUrls: ['./write-off-dialog.component.scss'],
})
export class PosWriteOffDialogComponent {
  // Services
  protected readonly matDialogRef = inject(MatDialogRef)
  protected readonly matDialog = inject(MatDialog)
  protected readonly writeOffService = inject(WriteOffService)
  protected readonly productService = inject(ProductService)
  protected readonly ingredientService = inject(IngredientService)
  protected readonly recipeService = inject(RecipeService)
  protected readonly userService = inject(UserService)
  protected readonly businessDayService = inject(BusinessDayService)
  protected readonly locationService = inject(LocationService)
  protected readonly deviceConfigService = inject(DeviceConfigService)
  readonly #notifications = inject(NotificationService)
  protected readonly translate = inject(TranslateService)

  // Enums for Template
  WriteOffItemType = WriteOffItemType
  WriteOffReason = WriteOffReason

  // State
  selectedType = signal<WriteOffItemType>(WriteOffItemType.PRODUCT)
  quantity = signal<number>(1)
  selectedReason = signal<WriteOffReason>(WriteOffReason.WASTE)
  comment = signal<string>('')

  // Search
  searchControl = new FormControl('')
  searchTerm = signal('')
  // Doppeltipp-Schutz: Ein zweiter Tipp während des Speicherns legte eine zweite Abschreibung an,
  // und die Cloud buchte den Bestand doppelt.
  readonly saving = signal(false)
  // Eine ID je Dialog: Ein erneuter Versuch nach einem Fehler trifft denselben Datensatz, statt
  // eine zweite Abschreibung zu erzeugen.
  readonly #writeOffId = uuidv7()
  selectedItem = signal<ProductSchema | Ingredient | Recipe | null>(null)

  // Data Signals
  products = computed(() => this.productService.products())
  ingredients = computed(() => this.ingredientService.items())
  recipes = computed(() => this.recipeService.items())

  // Filtered Options
  filteredOptions = computed((): (ProductSchema | Ingredient | Recipe)[] => {
    const term = this.searchTerm().toLowerCase()
    const type = this.selectedType()

    if (type === WriteOffItemType.PRODUCT) {
      // Filter out Menus (isMenu)
      return this.products()
        .filter(i => i.productType !== 'BUNDLE') // Exclude bundles (ehem. isMenu)
        .filter(i => i.name.toLowerCase().includes(term))
    } else if (type === WriteOffItemType.INGREDIENT) {
      return this.ingredients().filter(i => i.name.toLowerCase().includes(term))
    } else if (type === WriteOffItemType.RECIPE) {
      return this.recipes().filter(i => i.name.toLowerCase().includes(term))
    }
    return []
  })

  constructor() {
    this.searchControl.valueChanges.subscribe(val => {
      // If the value is not an object (meaning user is typing), reset selected item
      if (typeof val === 'string') {
        this.selectedItem.set(null)
        this.searchTerm.set(val)
      } else {
        this.searchTerm.set('') // Or handle object selection if needed for filtering
      }
    })
  }

  // Methods
  setType(type: WriteOffItemType) {
    this.selectedType.set(type)
    this.searchControl.setValue('')
    this.searchTerm.set('')
    this.selectedItem.set(null)
  }

  displayFn(item: any): string {
    return item && item.name ? item.name : ''
  }

  onOptionSelected(event: any) {
    this.selectedItem.set(event.option.value)
  }

  selectItem(item: ProductSchema | Ingredient | Recipe) {
    this.selectedItem.set(item)
  }

  changeQuantity(delta: number) {
    this.quantity.update(q => Math.max(0.1, +(q + delta).toFixed(2)))
  }

  setQuantity(value: number) {
    this.quantity.set(value)
  }

  openNumpad() {
    const dialogRef = this.matDialog.open(NumpadDialogComponent, {
      width: 'auto',
      height: 'auto',
      panelClass: 'numpad-dialog',
    })

    dialogRef.afterClosed().subscribe(result => {
      if (typeof result === 'number') {
        this.setQuantity(result)
      }
    })
  }

  setReason(reason: WriteOffReason) {
    this.selectedReason.set(reason)
  }

  getUnit(item: ProductSchema | Ingredient | Recipe | null): string {
    if (!item) return ''

    // Logic as requested:
    // If Product (Product) -> use 'Stk'
    if (this.selectedType() === WriteOffItemType.PRODUCT) {
      return 'Stk'
    }

    // For Ingredients / Recipes -> Checks multiple possible property names

    const unit =
      (item as any).basicUnit ||
      (item as any).baseUnit ||
      (item as any).unit ||
      (item as any).uom ||
      (item as any).base_unit

    return unit || 'Stk'
  }

  async save() {
    if (this.saving()) return
    if (!this.selectedItem()) {
      this.#notifications.warning(this.translate.instant('WRITE_OFF.SELECT_ITEM_FIRST'))
      return
    }

    // New Logic: Rely on LocationService
    const activeLocation = this.locationService.activeLocation()
    const locationId = activeLocation?._id || this.deviceConfigService.getLocationId()

    // Error only if NO Location ID is present at all
    if (!locationId) {
      this.#notifications.warning(this.translate.instant('WRITE_OFF.NO_LOCATION'))
      return
    }

    // Try to get BusinessDay ID from LocationService (lightweight) OR BusinessDayService (heavy)
    let businessDayId = activeLocation?.currentBusinessDay?.businessDayId

    // If LocationService has no business day logic, try fallback to BusinessDayService
    if (!businessDayId) {
      businessDayId = this.businessDayService.currentBusinessDay()?._id
    }

    // Ohne Geschäftstag lehnt der Edge die Abschreibung ab (Pflichtfeld) — gleich sagen, warum.
    if (!businessDayId) {
      this.#notifications.warning(this.translate.instant('WRITE_OFF.NO_BUSINESS_DAY'))
      return
    }

    // Attempt to find current user.
    let userId = this.userService.currentUser()?._id
    if (!userId) {
      const stored = localStorage.getItem('pos_current_user')
      if (stored) {
        try {
          userId = JSON.parse(stored)._id
        } catch (e) {
          /* noop */
        }
      }
    }

    if (!userId) {
      this.#notifications.warning(this.translate.instant('WRITE_OFF.USER_NOT_IDENTIFIED'))
      return
    }

    const item = this.selectedItem()!
    const writeOff: Partial<WriteOff> = {
      _id: this.#writeOffId,
      businessDayId: businessDayId?.toString(), // Ensure string
      userId: userId.toString(),
      itemType: this.selectedType(),
      itemId: item._id,
      itemName: item.name,
      itemVersion: (item as any).currentVersion || 1,
      quantity: this.quantity(),
      unit: this.getUnit(item),
      reason: this.selectedReason(),
      wasteType: WasteType.FINISHED,
      comment: this.comment(),
      costPerUnit: 0,
      totalCost: 0,
    }

    // If unit costs available
    if ('cost' in item) {
      const cost = (item as any).cost || 0
      writeOff.costPerUnit = cost
      writeOff.totalCost = cost * this.quantity()
    }

    this.saving.set(true)
    try {
      await withTimeout(this.writeOffService.create(writeOff as WriteOff))
      this.#notifications.success(this.translate.instant('WRITE_OFF.SAVED'))
      this.matDialogRef.close(true)
    } catch (error) {
      // Dialog bleibt offen: Die Abschreibung ist NICHT gespeichert, der Bediener kann es erneut versuchen.
      console.error('Error saving write-off', error)
      const message = writeOffErrorMessage(error, key => this.translate.instant(key))
      if (message) this.#notifications.error(message)
    } finally {
      this.saving.set(false)
    }
  }

  close() {
    this.matDialogRef.close()
  }
}
