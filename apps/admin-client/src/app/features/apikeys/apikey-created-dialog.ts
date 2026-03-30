import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core'

@Component({
  selector: 'app-apikey-created-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 backdrop-blur-sm">
      <div class="bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-2xl p-6
                  max-w-md w-full mx-4 shadow-2xl animate-[scale-in_0.15s_ease-out]"
           (click)="$event.stopPropagation()">

        <div class="flex items-center gap-3 mb-4">
          <div class="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
            <span class="text-green-600 dark:text-green-400 text-lg">⚿</span>
          </div>
          <div>
            <p class="text-slate-900 dark:text-white text-sm font-bold">API-Schlüssel erstellt</p>
            <p class="text-slate-500 dark:text-gray-400 text-xs">Kopieren Sie den Schlüssel jetzt.</p>
          </div>
        </div>

        <div class="bg-slate-50 dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-lg p-3 mb-3">
          <code class="text-slate-900 dark:text-white text-sm font-mono break-all select-all">{{ apikey() }}</code>
        </div>

        <p class="text-amber-600 dark:text-amber-400 text-xs mb-4 flex items-start gap-1.5">
          <span class="shrink-0 mt-0.5">⚠</span>
          <span>Dieser Schlüssel wird nicht erneut angezeigt. Speichern Sie ihn an einem sicheren Ort.</span>
        </p>

        <div class="flex gap-2">
          <button (click)="copyToClipboard()"
            [class]="copied()
              ? 'flex-1 bg-green-600 text-white font-bold py-2.5 rounded-xl text-sm transition'
              : 'flex-1 bg-slate-900 dark:bg-white text-white dark:text-black font-bold py-2.5 rounded-xl text-sm hover:bg-slate-800 dark:hover:bg-gray-200 transition'">
            @if (copied()) {
              ✓ Kopiert
            } @else {
              Kopieren
            }
          </button>
          <button (click)="closed.emit()"
            class="bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-300 font-medium py-2.5 px-5
                   rounded-xl text-sm hover:bg-slate-200 dark:hover:bg-gray-700 transition">
            Schließen
          </button>
        </div>
      </div>
    </div>
  `,
  styles: `
    @keyframes scale-in {
      from { transform: scale(0.95); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }
  `,
})
export class ApikeyCreatedDialogComponent {
  apikey = input.required<string>()
  closed = output<void>()
  copied = signal(false)

  async copyToClipboard() {
    try {
      await navigator.clipboard.writeText(this.apikey())
      this.copied.set(true)
      setTimeout(() => this.copied.set(false), 3000)
    } catch {
      // Fallback: Selektiere den Text manuell
    }
  }
}
