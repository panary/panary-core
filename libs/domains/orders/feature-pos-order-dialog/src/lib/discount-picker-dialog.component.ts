import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit, inject, signal } from '@angular/core'
import { MatDialogRef } from '@angular/material/dialog'
import { Discount } from '@panary/discounts/domain'
import { DiscountService } from '@panary/discounts/data-access'
import { TranslateModule } from '@ngx-translate/core'

/**
 * Touch-Picker für manuelle POS-Rabatte. Lädt die aktiven, manuellen Rabatte
 * des POS-Kanals (Cloud-gepflegt, per Sync am Edge) und gibt den gewählten
 * `Discount` an den Order-Dialog zurück. Order-Level (target=order) — Positions-
 * rabatte sind Phase 2.
 */
@Component({
  selector: 'app-discount-picker-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule],
  template: `
    <div role="dialog" aria-modal="true" aria-labelledby="discount-picker-title"
         class="flex flex-col w-full h-[560px] bg-white dark:bg-gray-950 rounded-2xl shadow-xl overflow-hidden">

      <!-- HEADER -->
      <div class="h-20 shrink-0 px-6 py-5 flex justify-between items-start">
        <div>
          <h2 id="discount-picker-title" class="text-lg font-bold text-gray-900 dark:text-white">Rabatt wählen</h2>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Manuelle Rabatte für diese Bestellung</p>
        </div>
        <button (click)="close()" type="button"
          class="w-10 h-10 rounded-lg flex items-center justify-center text-gray-400 dark:text-gray-500
                 hover:bg-gray-100 dark:hover:bg-gray-800 active:scale-95 transition-all">
          <span class="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>

      <!-- CONTENT -->
      <div class="flex-1 overflow-y-auto px-6 pb-4 min-h-0">
        @if (loading()) {
          <div class="h-full flex items-center justify-center text-gray-400 dark:text-gray-500">
            <span class="text-sm">Lade Rabatte…</span>
          </div>
        } @else if (discounts().length === 0) {
          <div class="h-full flex flex-col items-center justify-center gap-2 text-center">
            <span class="material-symbols-outlined text-[40px] text-gray-300 dark:text-gray-600">sell</span>
            <span class="text-sm font-medium text-gray-600 dark:text-gray-300">Keine Rabatte verfügbar</span>
            <span class="text-xs text-gray-400 dark:text-gray-500 max-w-xs">
              Aktive manuelle Rabatte für den Kassen-Kanal werden in der Cloud verwaltet und synchronisiert.
            </span>
          </div>
        } @else {
          <div class="grid grid-cols-2 gap-2.5 content-start py-1">
            @for (d of discounts(); track d._id) {
              <button type="button" (click)="select(d)"
                class="h-[84px] rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900
                       hover:bg-gray-50 dark:hover:bg-gray-800/50 active:scale-[0.98] transition-all
                       p-3 flex flex-col items-start justify-between text-left">
                <div class="flex items-center gap-1.5 w-full min-w-0">
                  <span class="text-sm font-semibold text-gray-900 dark:text-white truncate flex-1">{{ d.name }}</span>
                  @if (d.isStaffMeal) {
                    <span class="shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded
                                 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">Personal</span>
                  }
                </div>
                <span class="text-lg font-black text-gray-800 dark:text-gray-100">{{ valueLabel(d) }}</span>
              </button>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class DiscountPickerDialogComponent implements OnInit {
  #dialogRef = inject(MatDialogRef<DiscountPickerDialogComponent, Discount>)
  #discountService = inject(DiscountService)
  #cdr = inject(ChangeDetectorRef)

  protected readonly discounts = signal<Discount[]>([])
  protected readonly loading = signal(true)

  async ngOnInit(): Promise<void> {
    try {
      const list = await this.#discountService.loadActivePosDiscounts()
      this.discounts.set(list)
    } catch {
      this.discounts.set([])
    } finally {
      this.loading.set(false)
      this.#cdr.markForCheck()
    }
  }

  protected valueLabel(d: Discount): string {
    return d.valueType === 'percent' ? `${d.valuePercent} %` : `${(d.valueCents / 100).toFixed(2)} €`
  }

  protected select(d: Discount): void {
    this.#dialogRef.close(d)
  }

  protected close(): void {
    this.#dialogRef.close()
  }
}
