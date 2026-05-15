import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog'
import { TranslateModule } from '@ngx-translate/core'

import {
  BusinessDay,
  BusinessDayOperationMode,
} from '@panary-core/businessdays/domain'
import { BusinessDayService } from '@panary-core/businessdays/data-access'

export interface OpeningDialogData {
  locationId: string | null
  operationMode: 'orders-only' | 'pos-cashier'
}

type DialogPhase = 'input' | 'submitting' | 'submitted' | 'failed'

/**
 * POS-Tageseroeffnungs-Dialog.
 *
 *   - orders-only-Modus: nur Bestaetigung; ruft openDay() ohne float
 *   - pos-cashier-Modus: Eingabe Opening-Float (Pflicht, Cents-Integer im Backend)
 *
 * Verhindert mehrfaches Oeffnen — Backend lehnt mit BadRequest ab.
 */
@Component({
  selector: 'app-opening-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, TranslateModule, FormsModule],
  template: `
    <h2 mat-dialog-title>{{ 'OPENING.TITLE' | translate }}</h2>
    <mat-dialog-content class="text-sm space-y-3">
      @if (phase() === 'input') {
        @if (isPosCashier()) {
          <p>Bitte hinterlegen Sie den Wechselgeld-Anfangsbestand der Kasse.</p>
          <label class="flex flex-col gap-1">
            <span class="text-xs text-gray-500 dark:text-gray-400">Anfangsbestand (€)</span>
            <input
              type="number"
              step="0.01"
              min="0"
              [(ngModel)]="openingFloatEuros"
              class="border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2 bg-white dark:bg-gray-900"
            />
          </label>
        } @else {
          <p>Bestellsystem-Modus — kein Wechselgeld-Anfangsbestand nötig.</p>
        }
      } @else if (phase() === 'submitting') {
        <p>Geschäftstag wird eröffnet…</p>
      } @else if (phase() === 'submitted') {
        <p>Geschäftstag erfolgreich eröffnet.</p>
      } @else {
        <div class="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-xl">
          {{ errorMessage() }}
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions class="flex justify-end gap-2">
      @if (phase() === 'submitted') {
        <button class="bg-white dark:bg-gray-800 border rounded-xl px-4 h-10" (click)="close()">
          {{ 'COMMON.CLOSE' | translate }}
        </button>
      } @else {
        <button
          class="bg-white dark:bg-gray-800 border rounded-xl px-4 h-10"
          (click)="close()"
          [disabled]="phase() === 'submitting'"
        >
          {{ 'COMMON.CANCEL' | translate }}
        </button>
        <button
          class="bg-blue-600 text-white rounded-xl px-4 h-10 disabled:opacity-50"
          [disabled]="!canSubmit() || phase() === 'submitting'"
          (click)="submit()"
        >
          {{ 'OPENING.SUBMIT' | translate }}
        </button>
      }
    </mat-dialog-actions>
  `,
})
export class OpeningDialogComponent {
  private dialogRef = inject(MatDialogRef<OpeningDialogComponent>)
  private businessDayService = inject(BusinessDayService)
  protected readonly data = inject<OpeningDialogData>(MAT_DIALOG_DATA)

  protected readonly phase = signal<DialogPhase>('input')
  protected readonly errorMessage = signal<string | null>(null)
  protected openingFloatEuros: number | null = null
  protected createdBusinessDay: BusinessDay | null = null

  protected readonly isPosCashier = computed(
    () => this.data.operationMode === BusinessDayOperationMode.POS_CASHIER,
  )

  protected readonly canSubmit = computed(() => {
    if (!this.isPosCashier()) return true
    return this.openingFloatEuros !== null && this.openingFloatEuros >= 0
  })

  async submit(): Promise<void> {
    this.phase.set('submitting')
    this.errorMessage.set(null)
    try {
      this.createdBusinessDay = await this.businessDayService.openDay({
        locationId: this.data.locationId,
        openingFloatCents: this.isPosCashier()
          ? Math.round((this.openingFloatEuros ?? 0) * 100)
          : undefined,
      })
      this.phase.set('submitted')
    } catch (err) {
      this.phase.set('failed')
      this.errorMessage.set((err as Error).message ?? 'Eröffnung fehlgeschlagen')
    }
  }

  close(): void {
    this.dialogRef.close(this.createdBusinessDay ?? null)
  }
}
