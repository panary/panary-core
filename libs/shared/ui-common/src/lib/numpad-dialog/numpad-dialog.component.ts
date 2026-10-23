import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog'
import { IconComponent } from '../icon/icon.component'

@Component({
  selector: 'panary-numpad-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, CommonModule, MatDialogModule],
  template: `
    <div class="p-6 bg-surface-panel rounded-2xl w-[320px] flex flex-col gap-4">
      <div class="flex justify-between items-center pb-2 border-b border-line-soft">
        <h2 class="text-xl font-bold text-ink m-0">Menge eingeben</h2>
        <button
          type="button"
          (click)="close()"
          class="w-10 h-10 rounded-xl bg-surface-elevated border border-line text-ink-faint hover:bg-surface-bg active:bg-line transition-all flex items-center justify-center"
        >
          <lib-icon name="x" class="text-[20px]" />
        </button>
      </div>

      <div class="h-16 bg-surface-elevated rounded-xl border border-line flex items-center justify-center p-4">
        <span class="text-3xl font-bold text-ink">{{ displayValue }}</span>
      </div>

      <div class="grid grid-cols-3 gap-3">
        @for (num of [1, 2, 3, 4, 5, 6, 7, 8, 9]; track num) {
          <button
            (click)="append(num)"
            class="h-14 rounded-xl bg-surface-panel border border-line text-xl font-bold text-ink hover:bg-surface-elevated active:bg-surface-bg shadow-sm transition-all active:scale-95"
          >
            {{ num }}
          </button>
        }
        <button
          (click)="append('.')"
          class="h-14 rounded-xl bg-surface-panel border border-line text-xl font-bold text-ink hover:bg-surface-elevated active:bg-surface-bg shadow-sm transition-all active:scale-95"
        >
          ,
        </button>
        <button
          (click)="append(0)"
          class="h-14 rounded-xl bg-surface-panel border border-line text-xl font-bold text-ink hover:bg-surface-elevated active:bg-surface-bg shadow-sm transition-all active:scale-95"
        >
          0
        </button>
        <button
          (click)="backspace()"
          class="h-14 rounded-xl bg-danger-soft border border-danger-line text-danger-ink hover:bg-danger-line active:bg-danger-line shadow-sm transition-all active:scale-95 flex items-center justify-center"
        >
          <lib-icon name="backspace" class="text-[20px]" />
        </button>
      </div>

      <button
        (click)="confirm()"
        class="h-14 rounded-xl bg-action text-on-action font-bold text-lg hover:brightness-95 active:scale-98 transition-all shadow-lg flex items-center justify-center gap-2"
      >
        <lib-icon name="check" class="text-[20px]" />
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
