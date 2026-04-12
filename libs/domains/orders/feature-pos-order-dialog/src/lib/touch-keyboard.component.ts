import { ChangeDetectionStrategy, Component, input, output } from '@angular/core'

@Component({
  selector: 'app-touch-keyboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (layout() === 'qwertz') {
      <div class="flex flex-col items-center gap-1.5 max-w-xl mx-auto py-2">
        @for (row of qwertzRows; track $index) {
          <div class="flex justify-center gap-1.5">
            @for (key of row; track key) {
              <button type="button" (click)="keyPress.emit(key)" [attr.aria-label]="key"
                class="h-11 w-11 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700
                       text-base font-semibold text-gray-800 dark:text-gray-200 shadow-sm
                       active:scale-95 active:bg-gray-100 dark:active:bg-gray-700 transition-all
                       flex items-center justify-center">
                {{ key }}
              </button>
            }
          </div>
        }
        <!-- Bottom row: Space, Backspace, Weiter -->
        <div class="flex justify-center gap-1.5">
          <button type="button" (click)="keyPress.emit(' ')" aria-label="Leerzeichen"
            class="h-11 px-6 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700
                   text-sm font-semibold text-gray-600 dark:text-gray-300 shadow-sm
                   active:scale-95 active:bg-gray-100 transition-all flex items-center justify-center">
            SPACE
          </button>
          <button type="button" (click)="backspace.emit()" aria-label="Löschen"
            class="h-11 w-11 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800
                   text-red-500 shadow-sm active:scale-95 active:bg-red-100 transition-all
                   flex items-center justify-center">
            <span class="material-symbols-outlined text-[18px]">backspace</span>
          </button>
          <button type="button" (click)="confirm.emit()" aria-label="Weiter"
            class="h-11 px-5 rounded-lg bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800
                   text-green-600 dark:text-green-400 font-semibold shadow-sm
                   active:scale-95 active:bg-green-100 transition-all flex items-center justify-center">
            Weiter
          </button>
        </div>
      </div>
    } @else {
      <!-- Numpad -->
      <div class="grid grid-cols-3 gap-1.5 w-fit mx-auto py-2">
        @for (key of numpadKeys; track key) {
          <button type="button" (click)="keyPress.emit(key)" [attr.aria-label]="key"
            class="h-12 w-14 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700
                   text-xl font-bold text-gray-800 dark:text-gray-200 shadow-sm
                   active:scale-95 active:bg-gray-100 dark:active:bg-gray-700 transition-all
                   flex items-center justify-center">
            {{ key }}
          </button>
        }
        <!-- Bottom row: Backspace, 0, OK -->
        <button type="button" (click)="backspace.emit()" aria-label="Löschen"
          class="h-12 w-14 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800
                 text-red-500 shadow-sm active:scale-95 active:bg-red-100 transition-all
                 flex items-center justify-center">
          <span class="material-symbols-outlined text-[18px]">backspace</span>
        </button>
        <button type="button" (click)="keyPress.emit('0')" aria-label="0"
          class="h-12 w-14 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700
                 text-xl font-bold text-gray-800 dark:text-gray-200 shadow-sm
                 active:scale-95 active:bg-gray-100 transition-all flex items-center justify-center">
          0
        </button>
        <button type="button" (click)="confirm.emit()" aria-label="OK"
          class="h-12 w-14 rounded-lg bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800
                 text-green-600 dark:text-green-400 font-bold text-base shadow-sm
                 active:scale-95 active:bg-green-100 transition-all flex items-center justify-center">
          OK
        </button>
      </div>
    }
  `,
})
export class TouchKeyboardComponent {
  layout = input<'qwertz' | 'numpad'>('qwertz')
  keyPress = output<string>()
  backspace = output<void>()
  confirm = output<void>()

  readonly qwertzRows = [
    ['Q', 'W', 'E', 'R', 'T', 'Z', 'U', 'I', 'O', 'P'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
    ['Y', 'X', 'C', 'V', 'B', 'N', 'M'],
  ]

  readonly numpadKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
}
