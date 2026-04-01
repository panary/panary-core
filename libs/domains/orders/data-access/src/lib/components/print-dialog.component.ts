import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog'
import { MatSnackBar } from '@angular/material/snack-bar'
import { LocationService } from '@panary-core/locations/data-access'
import { OrderPrintService } from '../services/order-print.service'
import { Order } from '../models/order.model'

interface Printer {
  pid: string
  active: boolean
  type: 'ip' | 'mqtt'
  name: string
}

@Component({
  selector: 'lib-print-dialog',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-6 min-w-[360px]">
      <h2 class="text-xl font-bold text-slate-900 mb-5">Drucken</h2>

      <!-- An alle Drucker -->
      <button (click)="printAll()"
        class="flex items-center gap-4 w-full p-4 rounded-2xl
               active:scale-[0.98] transition-all group">
        <span class="flex items-center justify-center w-12 h-12 rounded-full bg-slate-800">
          <span class="material-symbols-outlined text-[22px] text-white
                       group-hover:scale-110 transition-transform duration-150">print</span>
        </span>
        <span class="font-semibold text-slate-800">An alle Drucker senden</span>
      </button>

      @if (printers.length > 0) {
        <div class="border-t border-slate-200 my-4"></div>
      }

      <!-- Einzelne Drucker -->
      <div class="space-y-1">
        @for (printer of printers; track printer.pid) {
          <button (click)="printTo(printer)"
            class="flex items-center gap-4 w-full p-4 rounded-2xl
                   active:scale-[0.98] transition-all group">
            <span class="flex items-center justify-center w-12 h-12 rounded-full bg-amber-400">
              <span class="material-symbols-outlined text-[22px] text-black
                           group-hover:scale-110 transition-transform duration-150">
                {{ printer.type === 'ip' ? 'print' : 'hub' }}
              </span>
            </span>
            <span class="font-semibold text-slate-800 text-lg">{{ printer.name }}</span>
          </button>
        }
      </div>

      @if (printers.length === 0) {
        <p class="text-sm text-slate-400 text-center py-6">Keine Drucker konfiguriert</p>
      }

      <!-- Schließen -->
      <div class="flex justify-end pt-4">
        <button (click)="close()"
          class="text-sm font-medium text-slate-400 hover:text-slate-700 px-4 py-2 rounded-lg
                 hover:bg-slate-50 transition">
          Schließen
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
  private order: Order = inject(MAT_DIALOG_DATA)

  printers: Printer[] = (this.locationService.printers || []).filter(
    (p: Printer) => p.active,
  )

  async printAll() {
    try {
      await this.orderPrintService.printOrder(this.order)
      this.snackBar.open('Druckauftrag an alle Drucker gesendet', undefined, { duration: 2000 })
      this.dialogRef.close(true)
    } catch {
      this.snackBar.open('Druckfehler — ist der Print-Server aktiv?', 'OK', { duration: 4000 })
    }
  }

  async printTo(printer: Printer) {
    try {
      await this.orderPrintService.printOrder(this.order, [printer.pid])
      this.snackBar.open(`Gesendet an ${printer.name}`, undefined, { duration: 2000 })
    } catch {
      this.snackBar.open('Druckfehler — ist der Print-Server aktiv?', 'OK', { duration: 4000 })
    }
  }

  close() {
    this.dialogRef.close()
  }
}
