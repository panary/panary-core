import { ChangeDetectionStrategy, Component, input, output } from '@angular/core'

@Component({
  selector: 'app-virtual-keyboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bg-slate-50 p-2 rounded-xl shadow-xl border border-slate-200">
      @if (layout() === 'numeric') {
        <div class="grid grid-cols-3 gap-2">
          @for (key of numericKeys; track key) {
            <button class="key w-20 h-16 text-2xl rounded-lg bg-white shadow-sm border-b-2 border-slate-200 font-bold active:border-b-0 active:translate-y-[2px] active:bg-slate-50 transition-all" (click)="onKey(key)">{{ key }}</button>
          }
          <button class="key w-20 h-16 flex items-center justify-center rounded-lg shadow-sm border-b-2 font-bold active:border-b-0 active:translate-y-[2px] transition-all bg-red-50 text-red-500 border-red-100"
            (click)="backspace.emit()">
            <span class="material-symbols-outlined">backspace</span>
          </button>
          <button class="key w-20 h-16 text-2xl rounded-lg bg-white shadow-sm border-b-2 border-slate-200 font-bold active:border-b-0 active:translate-y-[2px] active:bg-slate-50 transition-all" (click)="onKey('0')">0</button>
          <button class="key w-20 h-16 text-xl rounded-lg shadow-sm border-b-2 font-bold active:border-b-0 active:translate-y-[2px] transition-all bg-green-50 text-green-600 border-green-100"
            (click)="enter.emit()">OK</button>
        </div>
      } @else {
        <div class="flex flex-col gap-2">
          @for (row of defaultLayout; track $index) {
            <div class="flex justify-center gap-1">
              @for (key of row; track key) {
                <button class="key w-12 h-14 text-xl rounded-lg bg-white shadow-sm border-b-2 border-slate-200 font-bold active:border-b-0 active:translate-y-[2px] active:bg-slate-50 transition-all" (click)="onKey(key)">{{ key }}</button>
              }
            </div>
          }
          <div class="flex justify-center gap-2 mt-1">
            <button class="key w-32 h-12 text-xl rounded-lg shadow-sm border-b-2 border-slate-200 font-bold active:border-b-0 active:translate-y-[2px] transition-all bg-slate-100" (click)="onKey(' ')">SPACE</button>
            <button class="key w-20 h-12 flex items-center justify-center rounded-lg shadow-sm border-b-2 font-bold active:border-b-0 active:translate-y-[2px] transition-all bg-red-50 text-red-500 border-red-100"
              (click)="backspace.emit()">
              <span class="material-symbols-outlined">backspace</span>
            </button>
            <button class="key w-24 h-12 text-lg rounded-lg shadow-sm border-b-2 font-bold active:border-b-0 active:translate-y-[2px] transition-all bg-green-50 text-green-600 border-green-100"
              (click)="enter.emit()">Weiter</button>
          </div>
        </div>
      }
    </div>
  `,
})
export class VirtualKeyboardComponent {
  layout = input<'default' | 'numeric'>('default')
  keyPress = output<string>()
  backspace = output<void>()
  enter = output<void>()

  numericKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

  defaultLayout = [
    ['Q', 'W', 'E', 'R', 'T', 'Z', 'U', 'I', 'O', 'P'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
    ['Y', 'X', 'C', 'V', 'B', 'N', 'M'],
  ]

  onKey(key: string) {
    this.keyPress.emit(key)
  }
}
