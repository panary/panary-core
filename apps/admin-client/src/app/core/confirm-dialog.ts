import { ChangeDetectionStrategy, Component, input, output } from '@angular/core'

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 backdrop-blur-sm"
      tabindex="0"
      role="button"
      (click)="onCancel()"
      (keydown.enter)="onCancel()"
    >
      <div
        class="bg-surface-input border border-line rounded-2xl p-6
                  max-w-sm w-full mx-4 shadow-2xl animate-[scale-in_0.15s_ease-out]"
        tabindex="0"
        role="button"
        (click)="$event.stopPropagation()"
        (keydown.enter)="$event.stopPropagation()"
      >
        <p class="text-ink text-sm font-medium mb-1">{{ title() }}</p>
        <p class="text-ink-muted text-sm" [class.mb-6]="!warning()">{{ message() }}</p>
        @if (warning()) {
          <p class="text-amber-600 dark:text-amber-400 text-sm mt-3 mb-6 flex items-start gap-1.5">
            <span class="shrink-0 mt-0.5" aria-hidden="true">&#9888;</span>
            <span>{{ warning() }}</span>
          </p>
        }

        <div class="flex gap-2">
          <button
            (click)="confirmed.emit()"
            class="flex-1 bg-ink text-surface-panel font-bold py-2.5 rounded-xl text-sm
                   hover:bg-ink/90 transition"
          >
            {{ confirmLabel() }}
          </button>
          <button
            (click)="dismissed.emit()"
            class="flex-1 bg-line-soft text-ink-muted dark:text-ink font-medium py-2.5
                   rounded-xl text-sm hover:bg-line transition"
          >
            {{ dismissLabel() }}
          </button>
          @if (cancelLabel()) {
            <button
              (click)="onCancel()"
              class="bg-line-soft/50 text-ink-faint font-medium py-2.5 px-4
                     rounded-xl text-sm hover:bg-line transition"
            >
              {{ cancelLabel() }}
            </button>
          }
        </div>
      </div>
    </div>
  `,
  styles: `
    @keyframes scale-in {
      from {
        transform: scale(0.95);
        opacity: 0;
      }
      to {
        transform: scale(1);
        opacity: 1;
      }
    }
  `,
})
export class ConfirmDialogComponent {
  title = input('Ungespeicherte Änderungen')
  message = input('Möchten Sie die Änderungen speichern?')
  confirmLabel = input('Speichern')
  dismissLabel = input('Verwerfen')
  cancelLabel = input('')
  /**
   * Optionaler, optisch abgesetzter Warnhinweis unter der Message — fuer Folgen,
   * die ueber die eigentliche Aktion hinausgehen (z.B. "Geraet X verliert dadurch
   * den Zugang"). Leer = kein zusaetzlicher Absatz, alle bestehenden Aufrufer
   * bleiben unveraendert.
   */
  warning = input('')

  confirmed = output<void>()
  dismissed = output<void>()
  cancelled = output<void>()

  onCancel() {
    this.cancelled.emit()
  }
}
