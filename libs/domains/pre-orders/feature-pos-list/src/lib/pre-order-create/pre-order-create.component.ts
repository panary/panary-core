import { Component, inject, OnInit, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms'
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog'
import { MatDatepickerModule } from '@angular/material/datepicker'
import { MatNativeDateModule } from '@angular/material/core'
import { MatAutocompleteModule } from '@angular/material/autocomplete'
import { PreOrdersStore } from '../pre-orders.store'
import { PreOrderService, PreOrder } from '@panary-core/pre-orders/data-access'
import { ProductService, ProductSchema } from '@panary-core/products/data-access'
import { OrderLineItemSchema } from '@panary-core/orders/data-access'
import { debounceTime, tap } from 'rxjs/operators'
import { TranslateModule } from '@ngx-translate/core'

@Component({
  selector: 'lib-pre-order-create',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatAutocompleteModule,
    TranslateModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ 'PRE_ORDERS.NEW_PRE_ORDER' | translate }}</h2>
    <mat-dialog-content [formGroup]="form" class="flex flex-col gap-4 min-w-[500px]">
      <!-- Contact Info -->
      <div class="grid grid-cols-2 gap-4">
        <div class="space-y-1">
          <label for="pre-order-name" class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1 block">{{ 'PRE_ORDERS.CUSTOMER_NAME' | translate }}</label>
          <input id="pre-order-name" formControlName="name" placeholder="Max Mustermann" cdkFocusInitial
            class="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-gray-800 dark:text-gray-200 focus:border-gray-400 focus:ring-1 focus:ring-gray-400 outline-none placeholder-gray-400" />
        </div>

        <div class="space-y-1">
          <label for="pre-order-phone" class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1 block">{{ 'PRE_ORDERS.PHONE' | translate }}</label>
          <input id="pre-order-phone" formControlName="phone" placeholder="0123 456789"
            class="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-gray-800 dark:text-gray-200 focus:border-gray-400 focus:ring-1 focus:ring-gray-400 outline-none placeholder-gray-400" />
        </div>
      </div>

      <!-- Date/Time -->
      <div class="space-y-1">
        <label for="pre-order-scheduled" class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1 block">{{ 'PRE_ORDERS.DATE_TIME' | translate }}</label>
        <input id="pre-order-scheduled" type="datetime-local" formControlName="scheduledFor"
          class="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-gray-800 dark:text-gray-200 focus:border-gray-400 focus:ring-1 focus:ring-gray-400 outline-none placeholder-gray-400" />
        <p class="text-xs text-gray-400 mt-1">{{ 'PRE_ORDERS.PICKUP_TIME_HINT' | translate }}</p>
      </div>

      <!-- Dine Location -->
      <div class="space-y-1">
        <label class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1 block">{{ 'PRE_ORDERS.DINE_LOCATION' | translate }}</label>
        <div class="grid grid-cols-2 gap-2">
          <button type="button" (click)="form.patchValue({ dineLocation: 'take-out' })"
            [class]="form.get('dineLocation')?.value === 'take-out'
              ? 'flex items-center justify-center gap-2 py-3.5 rounded-xl font-medium text-sm border-2 border-gray-900 dark:border-white bg-gray-900 dark:bg-white text-white dark:text-black transition'
              : 'flex items-center justify-center gap-2 py-3.5 rounded-xl font-medium text-sm border-2 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-500 transition'">
            <span class="text-lg">🥡</span>
            {{ 'PRE_ORDERS.TAKE_OUT' | translate }}
          </button>
          <button type="button" (click)="form.patchValue({ dineLocation: 'dine-in' })"
            [class]="form.get('dineLocation')?.value === 'dine-in'
              ? 'flex items-center justify-center gap-2 py-3.5 rounded-xl font-medium text-sm border-2 border-gray-900 dark:border-white bg-gray-900 dark:bg-white text-white dark:text-black transition'
              : 'flex items-center justify-center gap-2 py-3.5 rounded-xl font-medium text-sm border-2 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-500 transition'">
            <span class="text-lg">🍽</span>
            {{ 'PRE_ORDERS.DINE_IN' | translate }}
          </button>
        </div>
      </div>

      <!-- Item Selection -->
      <div class="flex flex-col gap-2 border-t pt-4">
        <h3 class="font-bold text-gray-700">{{ 'PRE_ORDERS.ADD_ITEMS' | translate }}</h3>

        <div class="space-y-1 relative">
          <label for="pre-order-search" class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1 block">{{ 'PRE_ORDERS.SEARCH_ITEMS' | translate }}</label>
          <div class="relative">
            <input id="pre-order-search" [formControl]="searchControl" [matAutocomplete]="auto" [placeholder]="'PRE_ORDERS.ENTER_NAME' | translate"
              class="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 pr-10 text-gray-800 focus:border-gray-400 focus:ring-1 focus:ring-gray-400 outline-none placeholder-gray-400" />
            <span class="material-symbols-outlined text-[20px] absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">search</span>
          </div>
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
        </div>

        <!-- Selected Items List -->
        <div class="bg-gray-50 dark:bg-gray-800 rounded-lg p-2 max-h-40 overflow-y-auto mb-2 border border-gray-200 dark:border-gray-700">
          @if (selectedItems().length === 0) {
            <p class="text-center text-gray-400 text-sm py-2">{{ 'PRE_ORDERS.NO_ITEMS_SELECTED' | translate }}</p>
          }
          @for (item of selectedItems(); track item._id + '-' + $index) {
            <div class="flex justify-between items-center p-2 bg-white dark:bg-gray-950 rounded shadow-sm mb-1 border border-gray-100 dark:border-gray-700">
              <div class="flex flex-col">
                <span class="font-medium text-sm">{{ item.name }}</span>
                <span class="text-xs text-gray-500">{{ item.price | currency: 'EUR' }}</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-sm font-bold w-6 text-center">1x</span>
                <button type="button" (click)="removeItem($index)"
                  class="flex items-center justify-center w-8 h-8 rounded-lg text-red-400 hover:bg-red-50 transition-colors">
                  <span class="material-symbols-outlined text-[20px]">delete</span>
                </button>
              </div>
            </div>
          }
        </div>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end" class="!px-6 !pb-6">
      <button type="button" mat-dialog-close
        class="px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl transition-colors">
        Abbrechen
      </button>
      <button type="button" [disabled]="form.invalid" (click)="save()"
        class="px-4 py-2 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
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
    dineLocation: ['take-out', Validators.required],
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
        dineLocation: (this.data as any).dineLocation || 'take-out',
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
        dineLocation: val.dineLocation || 'take-out',
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
