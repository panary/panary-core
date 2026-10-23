import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit, inject, signal } from '@angular/core'
import { formatEurCents } from '@panary/shared/util-helpers'
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog'
import { Discount } from '@panary/discounts/domain'
import { DiscountService } from '@panary/discounts/data-access'
import { TranslateModule } from '@ngx-translate/core'
import { IconComponent } from '@panary/shared/ui-common'

/** Beschriftungs-Variante: dieselbe Auswahl, anderes Ziel. */
export interface DiscountPickerData {
  scope: 'order' | 'line'
  /** Name der markierten Position — nur im `line`-Modus gesetzt. */
  lineItemName?: string
}

/**
 * Touch-Picker für manuelle POS-Rabatte. Lädt die aktiven, manuellen Rabatte
 * des POS-Kanals (Cloud-gepflegt, per Sync am Edge) und gibt den gewählten
 * `Discount` an den Order-Dialog zurück.
 *
 * Die Auswahl ist in beiden Modi **dieselbe** — bewusst nicht auf
 * `discount.target` gefiltert: Das Feld schreibt die Cloud-Admin-UI hart auf
 * `'order'` (kein Formularfeld), ein Filter auf `'line'` liesse den Picker also
 * immer leer. Fachlich ist „Kulanz 20 %" ohnehin derselbe Rabatt, ob er auf eine
 * Position oder die Bestellung wirkt; das Ziel entsteht durch die Verwendung
 * (`appliedDiscount.target`), nicht durch die Definition.
 */
@Component({
  selector: 'app-discount-picker-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, TranslateModule],
  template: `
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="discount-picker-title"
      class="flex flex-col w-full h-[35rem] bg-surface-input rounded-2xl shadow-xl overflow-hidden"
    >
      <!-- HEADER -->
      <div class="h-20 shrink-0 px-6 py-5 flex justify-between items-start">
        <div>
          <h2 id="discount-picker-title" class="text-lg font-bold text-ink">
            {{ isLineScope ? 'Positionsrabatt wählen' : 'Rabatt wählen' }}
          </h2>
          <p class="text-sm text-ink-muted mt-0.5">
            @if (isLineScope) {
              Nachlass auf <span class="font-semibold">{{ data.lineItemName || 'die markierte Position' }}</span>
            } @else {
              Manuelle Rabatte für diese Bestellung
            }
          </p>
        </div>
        <button
          (click)="close()"
          type="button"
          class="w-10 h-10 rounded-lg flex items-center justify-center text-ink-faint
                 hover:bg-line-soft active:scale-95 transition-all"
        >
          <lib-icon name="x" class="text-[1.25rem]" />
        </button>
      </div>

      <!-- CONTENT -->
      <div class="flex-1 overflow-y-auto px-6 pb-4 min-h-0">
        @if (loading()) {
          <div class="h-full flex items-center justify-center text-ink-faint">
            <span class="text-sm">Lade Rabatte…</span>
          </div>
        } @else if (discounts().length === 0) {
          <div class="h-full flex flex-col items-center justify-center gap-2 text-center">
            <lib-icon name="tag" class="text-[2.5rem] text-line-strong" />
            <span class="text-sm font-medium text-ink-muted dark:text-ink">Keine Rabatte verfügbar</span>
            <span class="text-xs text-ink-faint max-w-xs">
              Aktive manuelle Rabatte für den Kassen-Kanal werden in der Cloud verwaltet und synchronisiert.
            </span>
          </div>
        } @else {
          <div class="grid grid-cols-2 gap-2.5 content-start py-1">
            @for (d of discounts(); track d._id) {
              <button
                type="button"
                (click)="select(d)"
                class="pnry-touch h-[5.25rem] rounded-xl border border-line bg-surface-input
                       hover:bg-surface-elevated dark:hover:bg-surface-elevated/50 active:scale-[0.98] transition-all
                       p-3 flex flex-col items-start justify-between text-left"
              >
                <div class="flex items-center gap-1.5 w-full min-w-0">
                  <span class="text-sm font-semibold text-ink truncate flex-1">{{ d.name }}</span>
                  @if (d.isStaffMeal) {
                    <span
                      class="shrink-0 text-[0.5625rem] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded
                                 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                      >Personal</span
                    >
                  }
                </div>
                <span class="text-lg font-black text-ink">{{ valueLabel(d) }}</span>
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

  // Fallback für Aufrufer ohne `data` — MatDialog liefert dort `null`.
  protected readonly data: DiscountPickerData = inject(MAT_DIALOG_DATA, { optional: true }) ?? { scope: 'order' }
  protected get isLineScope(): boolean {
    return this.data.scope === 'line'
  }

  protected readonly discounts = signal<Discount[]>([])
  protected readonly loading = signal(true)

  async ngOnInit(): Promise<void> {
    try {
      const list = await this.#discountService.loadActivePosDiscounts()
      // Personalessen-Rabatte gehören nicht in die manuelle Auswahl: sie laufen
      // über die Personalessen-Taste, wo die Zuweisung am Mitarbeiter greift.
      // Hier angeboten wären sie doppelt bedienbar — und der Kassierer könnte
      // einen fremden Satz wählen, statt den ihm zugewiesenen zu bekommen.
      this.discounts.set(list.filter(d => !d.isStaffMeal))
    } catch {
      this.discounts.set([])
    } finally {
      this.loading.set(false)
      this.#cdr.markForCheck()
    }
  }

  protected valueLabel(d: Discount): string {
    return d.valueType === 'percent' ? `${d.valuePercent} %` : formatEurCents(d.valueCents)
  }

  protected select(d: Discount): void {
    this.#dialogRef.close(d)
  }

  protected close(): void {
    this.#dialogRef.close()
  }
}
