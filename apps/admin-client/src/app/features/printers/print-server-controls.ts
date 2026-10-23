import { ChangeDetectionStrategy, Component, input, output, signal, inject } from '@angular/core'
import { PrinterService, type PrintServerStatus } from './printer.service'

@Component({
  selector: 'app-print-server-controls',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bg-surface-input border border-line-soft rounded-xl p-6">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-4">
          <h2 class="text-lg font-semibold text-ink">Print-Server</h2>

          <!-- Status-Badge -->
          @switch (status()?.status) {
            @case ('running') {
              <span
                class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium
                           bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
              >
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                Aktiv
              </span>
            }
            @case ('stopped') {
              <span
                class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium
                           bg-line-soft text-ink-muted"
              >
                <span class="w-1.5 h-1.5 rounded-full bg-line-strong"></span>
                Gestoppt
              </span>
            }
            @case ('error') {
              <span
                class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium
                           bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400"
              >
                <span class="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                Fehler
              </span>
            }
          }

          @if (status(); as s) {
            @if (s.printerCount !== undefined) {
              <span class="text-xs text-ink-faint"> {{ s.printerCount }} Drucker </span>
            }
          }
        </div>

        <!-- Steuerungs-Buttons -->
        <div class="flex items-center gap-2">
          @if (status()?.status !== 'running') {
            <button
              (click)="onStart()"
              [disabled]="actionInProgress()"
              class="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 text-white
                     hover:bg-emerald-700 transition disabled:opacity-50"
            >
              Starten
            </button>
          } @else {
            <button
              (click)="onStop()"
              [disabled]="actionInProgress()"
              class="px-4 py-2 rounded-lg text-sm font-medium bg-line-soft
                     text-ink hover:bg-line-strong
                     transition disabled:opacity-50"
            >
              Stoppen
            </button>
            <button
              (click)="onRestart()"
              [disabled]="actionInProgress()"
              class="px-4 py-2 rounded-lg text-sm font-medium bg-ink
                     text-surface-panel hover:bg-ink/90
                     transition disabled:opacity-50"
            >
              Neustarten
            </button>
          }
        </div>
      </div>

      @if (status()?.error) {
        <p class="mt-3 text-sm text-red-500 dark:text-red-400">{{ status()!.error }}</p>
      }

      @if (status()?.startedAt) {
        <p class="mt-2 text-xs text-ink-faint dark:text-line-strong">Gestartet: {{ status()!.startedAt }}</p>
      }
    </div>
  `,
})
export class PrintServerControlsComponent {
  status = input<PrintServerStatus | null>(null)
  statusChanged = output<void>()

  private printerService = inject(PrinterService)
  actionInProgress = signal(false)

  async onStart() {
    this.actionInProgress.set(true)
    try {
      await this.printerService.start()
      this.statusChanged.emit()
    } finally {
      this.actionInProgress.set(false)
    }
  }

  async onStop() {
    this.actionInProgress.set(true)
    try {
      await this.printerService.stop()
      this.statusChanged.emit()
    } finally {
      this.actionInProgress.set(false)
    }
  }

  async onRestart() {
    this.actionInProgress.set(true)
    try {
      await this.printerService.restart()
      this.statusChanged.emit()
    } finally {
      this.actionInProgress.set(false)
    }
  }
}
