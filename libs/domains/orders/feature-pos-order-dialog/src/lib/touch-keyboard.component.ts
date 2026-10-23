import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core'
import { IconComponent } from '@panary/shared/ui-common'

export type TouchKeyboardLayout = 'qwertz' | 'alphanumeric' | 'numpad'

const QWERTZ_ROWS: readonly (readonly string[])[] = [
  ['Q', 'W', 'E', 'R', 'T', 'Z', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Y', 'X', 'C', 'V', 'B', 'N', 'M'],
]

/**
 * Tastenreihen der Buchstaben-Layouts. `alphanumeric` setzt die Ziffernreihe darueber —
 * fuer Eingaben wie Rabattcodes (`SOMMER25`, panary/panary-core#749). `qwertz` bleibt
 * ohne Ziffern (Namensfelder).
 */
export const touchKeyboardRows = (layout: TouchKeyboardLayout): readonly (readonly string[])[] =>
  layout === 'alphanumeric' ? [['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'], ...QWERTZ_ROWS] : QWERTZ_ROWS

@Component({
  imports: [IconComponent],
  selector: 'app-touch-keyboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (layout() !== 'numpad') {
      <div class="flex flex-col items-center gap-1.5 max-w-xl mx-auto py-2">
        @for (row of rows(); track $index) {
          <div class="flex justify-center gap-1.5">
            @for (key of row; track key) {
              <button
                type="button"
                (click)="keyPress.emit(key)"
                [attr.aria-label]="key"
                class="h-11 w-11 rounded-lg bg-surface-elevated border border-line
                       text-base font-semibold text-ink shadow-sm
                       active:scale-95 active:bg-line-soft transition-all
                       flex items-center justify-center"
              >
                {{ key }}
              </button>
            }
          </div>
        }
        <!-- Bottom row: Space, Backspace, Weiter -->
        <div class="flex justify-center gap-1.5">
          <button
            type="button"
            (click)="keyPress.emit(' ')"
            aria-label="Leerzeichen"
            class="h-11 px-6 rounded-lg bg-surface-elevated border border-line
                   text-sm font-semibold text-ink-muted dark:text-ink shadow-sm
                   active:scale-95 active:bg-surface-bg transition-all flex items-center justify-center"
          >
            SPACE
          </button>
          <button
            type="button"
            (click)="backspace.emit()"
            aria-label="Löschen"
            class="h-11 w-11 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800
                   text-red-500 shadow-sm active:scale-95 active:bg-red-100 transition-all
                   flex items-center justify-center"
          >
            <lib-icon name="backspace" class="text-[1.125rem]" />
          </button>
          <button
            type="button"
            (click)="confirm.emit()"
            aria-label="Weiter"
            class="h-11 px-5 rounded-lg bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800
                   text-green-600 dark:text-green-400 font-semibold shadow-sm
                   active:scale-95 active:bg-green-100 transition-all flex items-center justify-center"
          >
            Weiter
          </button>
        </div>
      </div>
    } @else {
      <!-- Numpad -->
      <div class="grid grid-cols-3 gap-1.5 w-fit mx-auto py-2">
        @for (key of numpadKeys; track key) {
          <button
            type="button"
            (click)="keyPress.emit(key)"
            [attr.aria-label]="key"
            class="pnry-touch h-12 w-14 rounded-lg bg-surface-elevated border border-line
                   text-xl font-bold text-ink shadow-sm
                   active:scale-95 active:bg-line-soft transition-all
                   flex items-center justify-center"
          >
            {{ key }}
          </button>
        }
        <!-- Bottom row: Backspace, 0, OK -->
        <button
          type="button"
          (click)="backspace.emit()"
          aria-label="Löschen"
          class="pnry-touch h-12 w-14 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800
                 text-red-500 shadow-sm active:scale-95 active:bg-red-100 transition-all
                 flex items-center justify-center"
        >
          <lib-icon name="backspace" class="text-[1.125rem]" />
        </button>
        <button
          type="button"
          (click)="keyPress.emit('0')"
          aria-label="0"
          class="pnry-touch h-12 w-14 rounded-lg bg-surface-elevated border border-line
                 text-xl font-bold text-ink shadow-sm
                 active:scale-95 active:bg-surface-bg transition-all flex items-center justify-center"
        >
          0
        </button>
        <button
          type="button"
          (click)="confirm.emit()"
          aria-label="OK"
          class="pnry-touch h-12 w-14 rounded-lg bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800
                 text-green-600 dark:text-green-400 font-bold text-base shadow-sm
                 active:scale-95 active:bg-green-100 transition-all flex items-center justify-center"
        >
          OK
        </button>
      </div>
    }
  `,
})
export class TouchKeyboardComponent {
  layout = input<TouchKeyboardLayout>('qwertz')
  keyPress = output<string>()
  backspace = output<void>()
  confirm = output<void>()

  readonly rows = computed(() => touchKeyboardRows(this.layout()))

  readonly numpadKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
}
