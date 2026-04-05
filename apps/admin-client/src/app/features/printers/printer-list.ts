import { ChangeDetectionStrategy, Component, input, output, inject, signal } from '@angular/core'
import { MatDialog, MatDialogModule } from '@angular/material/dialog'
import { PrinterFormDialogComponent, type PrinterFormData } from './printer-form-dialog'
import { PrinterService } from './printer.service'

@Component({
  selector: 'app-printer-list',
  standalone: true,
  imports: [MatDialogModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bg-white dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-xl">
      <!-- Header -->
      <div class="flex items-center justify-between p-6 border-b border-slate-200 dark:border-gray-800">
        <h2 class="text-lg font-semibold text-slate-900 dark:text-white">Drucker</h2>
        <div class="flex items-center gap-3">
          @if (saving()) {
            <span class="text-xs text-slate-400 dark:text-gray-500">Speichern...</span>
          }
          <button (click)="onAddPrinter()" [disabled]="saving()"
            class="px-4 py-2 rounded-lg text-sm font-medium bg-slate-900 dark:bg-white
                   text-white dark:text-black hover:bg-slate-800 dark:hover:bg-gray-200
                   transition disabled:opacity-50">
            + Drucker hinzufügen
          </button>
        </div>
      </div>

      <!-- Tabelle -->
      @if (printers().length === 0) {
        <div class="p-12 text-center">
          <p class="text-slate-400 dark:text-gray-500">Keine Drucker konfiguriert</p>
          <p class="text-slate-400 dark:text-gray-600 text-sm mt-1">Füge einen Drucker hinzu, um loszulegen.</p>
        </div>
      } @else {
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="border-b border-slate-200 dark:border-gray-800">
                <th class="text-left p-4 text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">Name</th>
                <th class="text-left p-4 text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">Typ</th>
                <th class="text-left p-4 text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">Adresse</th>
                <th class="text-left p-4 text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">Papier</th>
                <th class="text-center p-4 text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">Aktiv</th>
                <th class="text-right p-4 text-xs font-medium text-slate-500 dark:text-gray-400 uppercase tracking-wider">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              @for (printer of printers(); track printer.pid) {
                <tr class="border-b border-slate-100 dark:border-gray-800/50 hover:bg-slate-50 dark:hover:bg-gray-900/50 transition">
                  <td class="p-4 text-sm text-slate-900 dark:text-white font-medium">{{ printer.name }}</td>
                  <td class="p-4">
                    @if (printer.type === 'ip') {
                      <span class="inline-flex px-2 py-0.5 rounded text-xs font-medium
                                   bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
                        WLAN/IP
                      </span>
                    } @else {
                      <span class="inline-flex px-2 py-0.5 rounded text-xs font-medium
                                   bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400">
                        MQTT
                      </span>
                    }
                  </td>
                  <td class="p-4 text-sm text-slate-600 dark:text-gray-400">
                    @if (printer.type === 'ip') {
                      {{ printer.ip }}:{{ printer.port ?? 9100 }}
                    } @else {
                      {{ printer.mqttTopic }}
                    }
                  </td>
                  <td class="p-4 text-sm text-slate-600 dark:text-gray-400">{{ printer.paperWidth ?? '80mm' }}</td>
                  <td class="p-4 text-center">
                    @if (printer.active) {
                      <span class="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
                    } @else {
                      <span class="w-2 h-2 rounded-full bg-slate-300 dark:bg-gray-600 inline-block"></span>
                    }
                  </td>
                  <td class="p-4 text-right">
                    <div class="flex items-center justify-end gap-1">
                      @if (printer.type === 'ip') {
                        <button (click)="onTestPrint(printer.pid)" [disabled]="testingPrinter() === printer.pid"
                          class="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-gray-400
                                 hover:bg-slate-100 dark:hover:bg-gray-800 transition disabled:opacity-50"
                          title="Testdruck">
                          {{ testingPrinter() === printer.pid ? '...' : 'Test' }}
                        </button>
                      }
                      <button (click)="onEditPrinter(printer)"
                        class="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-gray-400
                               hover:bg-slate-100 dark:hover:bg-gray-800 transition">
                        Bearbeiten
                      </button>
                      <button (click)="onDeletePrinter(printer.pid)"
                        class="px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400
                               hover:bg-red-50 dark:hover:bg-red-900/20 transition">
                        Löschen
                      </button>
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      @if (testResult()) {
        <div class="p-4 border-t border-slate-200 dark:border-gray-800">
          <p class="text-sm" [class]="testResult()!.success
            ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-red-600 dark:text-red-400'">
            {{ testResult()!.success ? 'Testdruck erfolgreich!' : 'Testdruck fehlgeschlagen: ' + testResult()!.results[0]?.error }}
          </p>
        </div>
      }
    </div>
  `,
})
export class PrinterListComponent {
  printers = input<PrinterFormData[]>([])
  saving = input(false)
  printersChanged = output<PrinterFormData[]>()

  private dialog = inject(MatDialog)
  private printerService = inject(PrinterService)

  testingPrinter = signal<string | null>(null)
  testResult = signal<{ success: boolean; results: Array<{ error?: string }> } | null>(null)

  onAddPrinter() {
    const dialogRef = this.dialog.open(PrinterFormDialogComponent, {
      data: null,
    })

    dialogRef.afterClosed().subscribe((result: PrinterFormData | null) => {
      if (result) {
        const updated = [...this.printers(), result]
        this.printersChanged.emit(updated)
      }
    })
  }

  onEditPrinter(printer: PrinterFormData) {
    const dialogRef = this.dialog.open(PrinterFormDialogComponent, {
      data: { ...printer },
    })

    dialogRef.afterClosed().subscribe((result: PrinterFormData | null) => {
      if (result) {
        const updated = this.printers().map(p => (p.pid === result.pid ? result : p))
        this.printersChanged.emit(updated)
      }
    })
  }

  onDeletePrinter(pid: string) {
    const updated = this.printers().filter(p => p.pid !== pid)
    this.printersChanged.emit(updated)
  }

  async onTestPrint(printerId: string) {
    this.testingPrinter.set(printerId)
    this.testResult.set(null)
    try {
      const result = await this.printerService.testPrint(printerId)
      this.testResult.set(result)
    } catch {
      this.testResult.set({ success: false, results: [{ error: 'Verbindung zum Print-Server fehlgeschlagen' }] })
    } finally {
      this.testingPrinter.set(null)
    }
  }
}
