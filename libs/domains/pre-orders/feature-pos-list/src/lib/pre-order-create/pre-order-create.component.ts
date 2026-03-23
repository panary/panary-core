import { Component, inject, OnInit, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms'
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatDatepickerModule } from '@angular/material/datepicker'
import { MatNativeDateModule } from '@angular/material/core'
import { MatIconModule } from '@angular/material/icon'
import { MatAutocompleteModule } from '@angular/material/autocomplete'
import { PreOrdersStore } from '../pre-orders.store'
import { PreOrderService, PreOrder } from '@panary-core/pre-orders/data-access'
import { ProductService, ProductSchema } from '@panary-core/products/data-access'
import { OrderLineItemSchema } from '@panary-core/orders/data-access'
import { debounceTime, tap } from 'rxjs/operators'

@Component({
  selector: 'app-pre-order-create',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatIconModule,
    MatAutocompleteModule,
  ],
  template: `
    <h2 mat-dialog-title>Neue Vorbestellung</h2>
    <mat-dialog-content [formGroup]="form" class="flex flex-col gap-4 min-w-[500px]">
      <!-- Contact Info -->
      <div class="grid grid-cols-2 gap-4">
        <mat-form-field appearance="outline">
          <mat-label>Kundenname</mat-label>
          <input matInput formControlName="name" placeholder="Max Mustermann" cdkFocusInitial />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Telefon</mat-label>
          <input matInput formControlName="phone" placeholder="0123 456789" />
        </mat-form-field>
      </div>

      <!-- Date/Time -->
      <mat-form-field appearance="outline">
        <mat-label>Datum & Uhrzeit</mat-label>
        <input matInput type="datetime-local" formControlName="scheduledFor" />
        <mat-hint>Wann soll die Bestellung abgeholt werden?</mat-hint>
      </mat-form-field>

      <!-- Item Selection -->
      <div class="flex flex-col gap-2 border-t pt-4">
        <h3 class="font-bold text-gray-700">Artikel hinzufügen</h3>

        <mat-form-field appearance="outline" class="w-full">
          <mat-label>Artikel suchen...</mat-label>
          <input matInput [formControl]="searchControl" [matAutocomplete]="auto" />
          <mat-autocomplete
            #auto="matAutocomplete"
            [displayWith]="displayFn"
            (optionSelected)="addItem($event.option.value)"
          >
            @for (item of foundItems(); track item._id) {
              <mat-option [value]="item">
                <div class="flex justify-between w-full gap-4">
                  <span>{{ item.name }}</span>
                  <span class="text-gray-500">{{ item.price | currency: 'EUR' }}</span>
                </div>
              </mat-option>
            }
          </mat-autocomplete>
          <mat-icon matSuffix class="text-gray-400">search</mat-icon>
        </mat-form-field>

        <!-- Selected Items List -->
        <div class="bg-gray-50 rounded-lg p-2 max-h-40 overflow-y-auto mb-2 border border-gray-200">
          @if (selectedItems().length === 0) {
            <p class="text-center text-gray-400 text-sm py-2">Noch keine Artikel ausgewählt</p>
          }
          @for (item of selectedItems(); track item._id + '-' + $index) {
            <div class="flex justify-between items-center p-2 bg-white rounded shadow-sm mb-1 border border-gray-100">
              <div class="flex flex-col">
                <span class="font-medium text-sm">{{ item.name }}</span>
                <span class="text-xs text-gray-500">{{ item.price | currency: 'EUR' }}</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-sm font-bold w-6 text-center">1x</span>
                <button mat-icon-button color="warn" class="!w-8 !h-8" (click)="removeItem($index)">
                  <mat-icon class="text-base text-red-400">delete</mat-icon>
                </button>
              </div>
            </div>
          }
        </div>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end" class="!px-6 !pb-6">
      <button mat-button mat-dialog-close>Abbrechen</button>
      <button mat-raised-button color="primary" [disabled]="form.invalid" (click)="save()">
        Reservierung Speichern
      </button>
    </mat-dialog-actions>
  `,
})
export class PreOrderCreateComponent implements OnInit {
  #fb = inject(FormBuilder)
  #dialogRef = inject(MatDialogRef<PreOrderCreateComponent>)
  #preOrderService = inject(PreOrderService)
  #ProductService = inject(ProductService)
  #store = inject(PreOrdersStore)
  data = inject(MAT_DIALOG_DATA, { optional: true }) as PreOrder | null

  // Controls
  searchControl = new FormControl('')

  // Signals
  foundItems = signal<ProductSchema[]>([])
  selectedItems = signal<ProductSchema[]>([])

  form = this.#fb.group({
    name: ['', Validators.required],
    phone: [''],
    scheduledFor: ['', Validators.required],
  })

  ngOnInit() {
    // Search Logic
    this.searchControl.valueChanges
      .pipe(
        debounceTime(300),
        tap(val => {
          if (typeof val === 'string' && val.length > 1) {
            this.searchItems(val)
          }
        }),
      )
      .subscribe()

    // Fill form if editing
    if (this.data) {
      this.form.patchValue({
        name: this.data.customerContact.name,
        phone: this.data.customerContact.phone,
        scheduledFor: this.data.scheduledFor.slice(0, 16), // Cut seconds for datetime-local
      })
      // Note: Reconstructing full Product objects from OrderItems is tricky without fetching.
      // For now, edit mode might just be contact info without item editing if items are complex.
      // Or we just don't preload items for simplicity in this MVP iteration.
      // Or better: We assume items are OrderItems, we can display them but not map back to full ProductSchema easily.
    }
  }

  async searchItems(query: string) {
    try {
      const res = await this.#ProductService.find({
        query: {
          name: { $regex: query, $options: 'i' },
          $limit: 10,
        },
      })
      const items = Array.isArray(res) ? res : res.data
      this.foundItems.set(items)
    } catch (e) {
      console.error(e)
    }
  }

  displayFn(item: ProductSchema): string {
    return item && item.name ? item.name : ''
  }

  addItem(item: ProductSchema) {
    if (!item) return
    this.selectedItems.update(current => [...current, item])
    this.searchControl.setValue('') // Reset search
  }

  removeItem(index: number) {
    this.selectedItems.update(current => current.filter((_, i) => i !== index))
  }

  async save() {
    if (this.form.valid) {
      const val = this.form.value

      // Map selected ProductSchema to OrderLineItemSchema
      const orderItems: OrderLineItemSchema[] = this.selectedItems().map(item => {
        return {
          _id: item._id, // We use the item ID as the base ID for now, or generate new ones if needed by backend logic
          externalId: item.externalId || null,
          name: item.name,
          amount: 1,
          price: item.price || 0,

          taxInside: item.taxInside || 19,
          taxOutside: item.taxOutside || 7,
          topic: '',

          recipeReferences: item.recipeReferences || [],
          ingredientReferences: (item as any).ingredientReferences || [],

          modifiers: [],

          isMenu: !!(item as any).isMenu,
          productGroupExternalId: (item as any).productGroupExternalId,
          bundleNumber: null,
          menuDrink: null,
          menuSideDish: null,
        } as unknown as OrderLineItemSchema
      })

      const payload = {
        customerContact: {
          name: val.name!,
          phone: val.phone || '',
        },
        scheduledFor: new Date(val.scheduledFor!).toISOString(),
        lineItems: orderItems,
        status: 'pending' as const,
      }

      try {
        if (this.data?._id) {
          await this.#preOrderService.patch(this.data._id, payload)
        } else {
          await this.#preOrderService.create(payload)
        }

        // Refresh store
        this.#store.loadUpcoming()
        this.#dialogRef.close(true)
      } catch (e) {
        console.error(e)
      }
    }
  }
}
