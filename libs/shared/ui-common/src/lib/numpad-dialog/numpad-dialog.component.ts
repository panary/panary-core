import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog'

@Component({
  selector: 'panary-numpad-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatDialogModule],
  template: `
    <div class="p-6 bg-white rounded-2xl w-[320px] flex flex-col gap-4">
      <div class="flex justify-between items-center pb-2 border-b border-slate-100">
        <h2 class="text-xl font-bold text-slate-800 m-0">Menge eingeben</h2>
        <button
          type="button"
          (click)="close()"
          class="w-10 h-10 rounded-xl bg-slate-50 border border-slate-200 text-slate-400 hover:bg-slate-100 active:bg-slate-200 transition-all flex items-center justify-center"
        >
          <span class="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>

      <div class="h-16 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-center p-4">
        <span class="text-3xl font-bold text-slate-800">{{ displayValue }}</span>
      </div>

      <div class="grid grid-cols-3 gap-3">
        @for (num of [1, 2, 3, 4, 5, 6, 7, 8, 9]; track num) {
          <button
            (click)="append(num)"
            class="h-14 rounded-xl bg-white border border-slate-200 text-xl font-bold text-slate-700 hover:bg-slate-50 active:bg-slate-100 shadow-sm transition-all active:scale-95"
          >
            {{ num }}
          </button>
        }
        <button
          (click)="append('.')"
          class="h-14 rounded-xl bg-white border border-slate-200 text-xl font-bold text-slate-700 hover:bg-slate-50 active:bg-slate-100 shadow-sm transition-all active:scale-95"
        >
          ,
        </button>
        <button
          (click)="append(0)"
          class="h-14 rounded-xl bg-white border border-slate-200 text-xl font-bold text-slate-700 hover:bg-slate-50 active:bg-slate-100 shadow-sm transition-all active:scale-95"
        >
          0
        </button>
        <button
          (click)="backspace()"
          class="h-14 rounded-xl bg-red-50 border border-red-100 text-red-500 hover:bg-red-100 active:bg-red-200 shadow-sm transition-all active:scale-95 flex items-center justify-center"
        >
          <span class="material-symbols-outlined text-[20px]">backspace</span>
        </button>
      </div>

      <button
        (click)="confirm()"
        class="h-14 rounded-xl bg-yellow-500 text-slate-800 font-bold text-lg hover:bg-yellow-400 active:scale-98 transition-all shadow-lg shadow-yellow-200 flex items-center justify-center gap-2"
      >
        <span class="material-symbols-outlined text-[20px]">check</span>
        Bestätigen
      </button>
    </div>
  `,
  styles: [],
})
export class NumpadDialogComponent {
  private dialogRef = inject(MatDialogRef<NumpadDialogComponent>)

  displayValue = '0'

  append(val: number | string) {
    if (this.displayValue === '0' && val !== '.') {
      this.displayValue = val.toString()
    } else {
      // Prevent multiple dots
      if (val === '.' && this.displayValue.includes('.')) return
      this.displayValue += val.toString()
    }
  }

  backspace() {
    if (this.displayValue.length > 1) {
      this.displayValue = this.displayValue.slice(0, -1)
    } else {
      this.displayValue = '0'
    }
  }

  close() {
    this.dialogRef.close()
  }

  confirm() {
    const num = parseFloat(this.displayValue)
    if (!isNaN(num)) {
      this.dialogRef.close(num)
    } else {
      this.dialogRef.close()
    }
  }
}
