import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog'
import { TranslateModule } from '@ngx-translate/core'

export interface ConfirmDialogData {
  title: string
  message: string
  detail?: string
  confirmText: string
  confirmVariant: 'primary' | 'danger'
  icon: string
}

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col w-full">
      <!-- Icon Header -->
      <div class="flex flex-col items-center gap-3 px-6 pt-7 pb-4">
        <div
          class="flex items-center justify-center w-16 h-16 rounded-2xl"
          [class]="iconBg">
          <span class="material-symbols-outlined text-[32px]" [class]="iconColor">{{ data.icon }}</span>
        </div>
        <h2 class="text-xl font-bold text-slate-800 dark:text-white text-center">{{ data.title }}</h2>
      </div>

      <!-- Body -->
      <div class="px-6 pb-2 text-center">
        <p class="text-slate-500 dark:text-gray-400 text-sm leading-relaxed">{{ data.message }}</p>
        @if (data.detail) {
          <p class="mt-2 text-slate-700 dark:text-gray-200 font-semibold text-base">{{ data.detail }}</p>
        }
      </div>

      <!-- Actions -->
      <div class="flex flex-col gap-2 px-6 pb-6 pt-4">
        <button
          (click)="confirm()"
          class="h-12 w-full rounded-xl font-bold text-sm transition-all active:scale-95"
          [class]="confirmClass">
          {{ data.confirmText }}
        </button>
        <button
          (click)="cancel()"
          class="h-12 w-full rounded-xl font-medium text-sm text-slate-500 dark:text-gray-300 bg-slate-100 dark:bg-gray-800 hover:bg-slate-200 dark:hover:bg-gray-700 transition-all active:scale-95">
          Abbrechen
        </button>
      </div>
    </div>
  `,
})
export class ConfirmDialogComponent {
  readonly data = inject<ConfirmDialogData>(MAT_DIALOG_DATA)
  readonly #ref = inject(MatDialogRef<ConfirmDialogComponent>)

  get iconBg(): string {
    return this.data.confirmVariant === 'danger'
      ? 'bg-red-50'
      : 'bg-indigo-50'
  }

  get iconColor(): string {
    return this.data.confirmVariant === 'danger'
      ? 'text-red-500'
      : 'text-indigo-600'
  }

  get confirmClass(): string {
    return this.data.confirmVariant === 'danger'
      ? 'bg-red-600 text-white hover:bg-red-700'
      : 'bg-indigo-600 text-white hover:bg-indigo-700'
  }

  confirm() {
    this.#ref.close(true)
  }

  cancel() {
    this.#ref.close(false)
  }
}
