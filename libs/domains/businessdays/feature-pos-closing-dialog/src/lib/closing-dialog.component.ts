import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog'
import { TranslateModule } from '@ngx-translate/core'

import { BusinessDay, BusinessDayOperationMode } from '@panary/businessdays/domain'
import { BusinessDayService } from '@panary/businessdays/data-access'

export interface ClosingDialogData {
  businessDay: BusinessDay
}

type DialogPhase = 'input' | 'submitting' | 'submitted' | 'failed'

/**
 * POS-Tagesabschluss-Dialog.
 *
 * - Mode 'orders-only': einfache Bestaetigung; ruft closeDay() ohne Cash-Count
 * - Mode 'pos-cashier': Eingabe gezaehlter Endbestand (Pflicht)
 *
 * Der Aggregations-Fortschritt selbst laeuft in der Cloud — der POS bekommt
 * nach Trigger ein 'closing-requested'-Status zurueck und der Manager kann
 * den Live-Progress im Admin-Dashboard verfolgen. Diese vereinfachte
 * UX-Trennung halten wir bewusst, weil der Edge-fetch-only-Stack keine
 * praktische SSE-/WebSocket-Bruecke fuer Cloud-Events liefert.
 */
@Component({
  selector: 'app-closing-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, TranslateModule, FormsModule],
  template: `
    <h2 mat-dialog-title>{{ 'CLOSING.TITLE' | translate }}</h2>
    <mat-dialog-content class="text-sm space-y-3">
      @if (phase() === 'input') {
        @if (isPosCashier()) {
          <p>Bitte zählen Sie den Kassen-Endbestand und geben Sie den Wert in Euro ein.</p>
          <label class="flex flex-col gap-1">
            <span class="text-xs text-gray-500 dark:text-gray-400">Gezählter Endbestand (€)</span>
            <input
              type="number"
              step="0.01"
              min="0"
              [(ngModel)]="countedFloatEuros"
              class="border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2 bg-white dark:bg-gray-900"
            />
          </label>
        } @else {
          <p>
            Bestellsystem-Modus — kein Kassen-Count nötig. Bestätigen Sie den Tagesabschluss
            und der Cloud-Report wird im Hintergrund erstellt.
          </p>
        }
      } @else if (phase() === 'submitting') {
        <p>Tagesabschluss wird ausgelöst…</p>
      } @else if (phase() === 'submitted') {
        <p>
          Tagesabschluss wurde an die Cloud übermittelt. Der finale Report kann im
          Admin-Dashboard unter „Tagesabschluss" eingesehen werden.
        </p>
      } @else if (phase() === 'failed') {
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
          {{ 'CLOSING.SUBMIT' | translate }}
        </button>
      }
    </mat-dialog-actions>
  `,
})
export class ClosingDialogComponent {
  private dialogRef = inject(MatDialogRef<ClosingDialogComponent>)
  private businessDayService = inject(BusinessDayService)
  protected readonly data = inject<ClosingDialogData>(MAT_DIALOG_DATA)

  protected readonly phase = signal<DialogPhase>('input')
  protected readonly errorMessage = signal<string | null>(null)
  protected countedFloatEuros: number | null = null

  protected readonly isPosCashier = computed(
    () => this.data.businessDay.operationMode === BusinessDayOperationMode.POS_CASHIER,
  )

  protected readonly canSubmit = computed(() => {
    if (!this.isPosCashier()) return true
    return this.countedFloatEuros !== null && this.countedFloatEuros >= 0
  })

  async submit(): Promise<void> {
    this.phase.set('submitting')
    this.errorMessage.set(null)
    try {
      await this.businessDayService.closeDay({
        businessDayId: this.data.businessDay._id,
        countedClosingFloatCents: this.isPosCashier()
          ? Math.round((this.countedFloatEuros ?? 0) * 100)
          : undefined,
      })
      this.phase.set('submitted')
    } catch (err) {
      this.phase.set('failed')
      this.errorMessage.set((err as Error).message ?? 'Tagesabschluss fehlgeschlagen')
    }
  }

  close(): void {
    this.dialogRef.close(this.phase() === 'submitted' ? this.data.businessDay : null)
  }
}
