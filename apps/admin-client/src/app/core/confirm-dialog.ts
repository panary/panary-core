import { ChangeDetectionStrategy, Component, input, output } from '@angular/core'

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
         (click)="onCancel()">
      <div class="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl
                  animate-[scale-in_0.15s_ease-out]"
           (click)="$event.stopPropagation()">
        <p class="text-white text-sm font-medium mb-1">{{ title() }}</p>
        <p class="text-gray-400 text-sm mb-6">{{ message() }}</p>

        <div class="flex gap-2">
          <button (click)="confirmed.emit()"
            class="flex-1 bg-white text-black font-bold py-2.5 rounded-xl text-sm hover:bg-gray-200 transition">
            {{ confirmLabel() }}
          </button>
          <button (click)="dismissed.emit()"
            class="flex-1 bg-gray-800 text-gray-300 font-medium py-2.5 rounded-xl text-sm hover:bg-gray-700 transition">
            {{ dismissLabel() }}
          </button>
          <button (click)="onCancel()"
            class="bg-gray-800/50 text-gray-500 font-medium py-2.5 px-4 rounded-xl text-sm hover:bg-gray-700 transition">
            {{ cancelLabel() }}
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
export class ConfirmDialogComponent {
  title = input('Ungespeicherte Änderungen')
  message = input('Möchten Sie die Änderungen speichern?')
  confirmLabel = input('Speichern')
  dismissLabel = input('Verwerfen')
  cancelLabel = input('Abbrechen')

  confirmed = output<void>()
  dismissed = output<void>()
  cancelled = output<void>()

  onCancel() {
    this.cancelled.emit()
  }
}
