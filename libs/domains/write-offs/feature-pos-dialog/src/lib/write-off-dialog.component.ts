import { Component, computed, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule, ReactiveFormsModule, FormControl } from '@angular/forms'
import { MatDialogRef, MatDialogModule, MatDialog } from '@angular/material/dialog'
import { MatAutocompleteModule } from '@angular/material/autocomplete'
import { MatSnackBar } from '@angular/material/snack-bar'
import {
  WriteOff,
  WriteOffItemType,
  WriteOffReason,
  WriteOffService,
  WasteType,
} from '@panary-core/write-offs/data-access'
import { ProductService, ProductSchema } from '@panary-core/products/data-access'
import { Ingredient, IngredientService } from '@panary-core/ingredients/data-access'
import { Recipe, RecipeService } from '@panary-core/recipes/data-access'
import { UserService } from '@panary-core/users/data-access'
import { BusinessDayService } from '@panary-core/businessdays/data-access'
import { DeviceConfigService } from '@panary-core/shared/data-access-config'
import { LocationService } from '@panary-core/locations/data-access'
import { NumpadDialogComponent } from '@panary-core/shared/ui-common'

@Component({
  selector: 'panary-pos-write-off-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatAutocompleteModule,
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
  protected readonly matSnackBar = inject(MatSnackBar)

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

    // Debug Logging
    console.group('Unit Debug')
    console.log('Item:', item)
    console.log('baseUnit:', (item as any).baseUnit)
    console.groupEnd()

    const unit =
      (item as any).basicUnit ||
      (item as any).baseUnit ||
      (item as any).unit ||
      (item as any).uom ||
      (item as any).base_unit

    return unit || 'Stk'
  }

  async save() {
    if (!this.selectedItem()) {
      this.matSnackBar.open('Bitte wähle einen Artikel aus.', 'OK', { duration: 3000 })
      return
    }

    // New Logic: Rely on LocationService
    const activeLocation = this.locationService.activeLocation()
    const locationId = activeLocation?._id || this.deviceConfigService.getLocationId()

    // Error only if NO Location ID is present at all
    if (!locationId) {
      this.matSnackBar.open('Kein Standort gefunden! Bitte Setup prüfen.', 'OK', { duration: 3000 })
      return
    }

    // Try to get BusinessDay ID from LocationService (lightweight) OR BusinessDayService (heavy)
    let businessDayId = activeLocation?.currentBusinessDay?.businessDayId

    // If LocationService has no business day logic, try fallback to BusinessDayService
    if (!businessDayId) {
      businessDayId = this.businessDayService.currentBusinessDay()?._id
    }

    // If still undefined, we proceed anyway as requested, but warn
    if (!businessDayId) {
      console.warn('Proceeding with write-off without explicit businessDayId, relying on location context.')
    }

    // Attempt to find current user.
    let userId = this.userService.currentUser()?._id
    if (!userId) {
      const stored = localStorage.getItem('pos_current_user')
      if (stored) {
        try {
          userId = JSON.parse(stored)._id
        } catch (e) {}
      }
    }

    if (!userId) {
      this.matSnackBar.open('Benutzer nicht identifiziert!', 'OK', { duration: 3000 })
      return
    }

    const item = this.selectedItem()!
    const writeOff: Partial<WriteOff> = {
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

    try {
      await this.writeOffService.create(writeOff as WriteOff)
      this.matSnackBar.open('Abschreibung gespeichert', 'OK', { duration: 2000 })
      this.matDialogRef.close(true)
    } catch (error) {
      console.error('Error saving write-off', error)
      this.matSnackBar.open('Fehler beim Speichern', 'OK', { duration: 3000 })
    }
  }

  close() {
    this.matDialogRef.close()
  }
}
