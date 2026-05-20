import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog'
import { MatSnackBar } from '@angular/material/snack-bar'
import { TranslateModule, TranslateService } from '@ngx-translate/core'
import { LocationService } from '@panary/locations/data-access'
import { OrderPrintService } from '../services/order-print.service'
import { Order } from '@panary/orders/domain'

interface Printer {
  pid: string
  active: boolean
  type: 'ip' | 'mqtt'
  name: string
}

@Component({
  selector: 'lib-print-dialog',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-6 min-w-[360px] max-w-[420px]">
      <div class="flex items-center gap-3 mb-5">
        <div class="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center">
          <span class="material-symbols-outlined text-[20px] text-blue-600 dark:text-blue-400">print</span>
        </div>
        <div>
          <h2 class="text-lg font-bold text-gray-900 dark:text-white">{{ 'PRINT.TITLE' | translate }}</h2>
          <p class="text-xs text-gray-500 dark:text-gray-400">#{{ order.dailySequenceNumber }}</p>
        </div>
      </div>

      <!-- An alle Drucker -->
      <button (click)="printAll()"
        class="w-full flex items-center gap-3 px-4 py-3 rounded-xl
               bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800
               text-blue-700 dark:text-blue-300 font-medium text-sm
               hover:bg-blue-100 dark:hover:bg-blue-950/60
               active:scale-[0.98] transition-all">
        <span class="material-symbols-outlined text-[20px]">print</span>
        {{ 'PRINT.SEND_ALL' | translate }}
      </button>

      @if (printers.length > 0) {
        <div class="my-4 border-t border-gray-200 dark:border-gray-700"></div>
        <p class="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">{{ 'PRINT.SELECT_PRINTER' | translate }}</p>

        <div class="flex flex-col gap-2">
          @for (printer of printers; track printer.pid) {
            <button (click)="printTo(printer)"
              class="w-full flex items-center gap-3 px-4 py-3 rounded-xl
                     bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700
                     text-gray-700 dark:text-gray-200 font-medium text-sm
                     hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-gray-300 dark:hover:border-gray-600
                     active:scale-[0.98] transition-all">
              <div class="w-8 h-8 rounded-lg flex items-center justify-center"
                [class]="printer.type === 'ip'
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400'
                  : 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400'">
                <span class="material-symbols-outlined text-[18px]">
                  {{ printer.type === 'ip' ? 'print' : 'hub' }}
                </span>
              </div>
              <span>{{ printer.name }}</span>
            </button>
          }
        </div>
      }

      @if (printers.length === 0) {
        <div class="mt-4 flex flex-col items-center gap-2 py-6 text-gray-400 dark:text-gray-500">
          <span class="material-symbols-outlined text-[32px] opacity-30">print_disabled</span>
          <span class="text-sm">{{ 'PRINT.NO_PRINTERS' | translate }}</span>
        </div>
      }

      <div class="flex justify-end pt-4">
        <button (click)="close()"
          class="text-sm font-medium text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-4 py-2 rounded-lg
                 hover:bg-gray-50 dark:hover:bg-gray-800 transition">
          {{ 'COMMON.CLOSE' | translate }}
        </button>
      </div>
    </div>
  `,
})
export class PrintDialogComponent {
  private dialogRef = inject(MatDialogRef<PrintDialogComponent>)
  private locationService = inject(LocationService)
  private orderPrintService = inject(OrderPrintService)
  private snackBar = inject(MatSnackBar)
  private translate = inject(TranslateService)
  order: Order = inject(MAT_DIALOG_DATA)

  printers: Printer[] = (this.locationService.printers || []).filter(
    (p: Printer) => p.active,
  )

  async printAll() {
    try {
      await this.orderPrintService.printOrder(this.order)
      this.snackBar.open(this.translate.instant('PRINT.SENT_ALL'), undefined, { duration: 2000 })
      this.dialogRef.close(true)
    } catch {
      this.snackBar.open(this.translate.instant('PRINT.ERROR'), 'OK', { duration: 4000 })
    }
  }

  async printTo(printer: Printer) {
    try {
      await this.orderPrintService.printOrder(this.order, [printer.pid])
      this.snackBar.open(this.translate.instant('PRINT.SENT_TO', { name: printer.name }), undefined, { duration: 2000 })
    } catch {
      this.snackBar.open(this.translate.instant('PRINT.ERROR'), 'OK', { duration: 4000 })
    }
  }

  close() {
    this.dialogRef.close()
  }
}
