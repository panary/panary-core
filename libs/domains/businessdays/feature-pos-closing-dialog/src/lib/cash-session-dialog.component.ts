import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog'
import { TranslateModule } from '@ngx-translate/core'

import {
  CASH_DENOMINATIONS_CENTS,
  CashSession,
  type DenominationCounts,
  sumDenominationCounts,
} from '@panary/businessdays/domain'
import { CashSessionService } from '@panary/businessdays/data-access'

export interface CashSessionDialogData {
  businessDayId: string
  /** Wenn gesetzt → Schließen-Modus (Zählen); sonst Eröffnen-Modus. */
  session?: CashSession | null
  /** Vorbelegung des Eröffner-Labels (z. B. Mitarbeitername). */
  defaultLabel?: string
}

type DialogPhase = 'input' | 'submitting' | 'submitted' | 'failed'

/** Cents → Anzeige-Label („50000" → „500 €", „1" → „1 ct"). */
function denomLabel(cents: number): string {
  return cents >= 100 ? `${cents / 100} €` : `${cents} ct`
}

/**
 * POS-Kassen-Dialog (edge-nativ, offline):
 *   - Eröffnen: Name der Kasse + Wechselgeld-Anfangsbestand (€).
 *   - Schließen: Stückelungs-Zähler (Kleingeldzähler); Live-Summe = gezählter
 *     Ist-Bestand. Soll/Varianz berechnet die Cloud beim Tagesabschluss.
 */
@Component({
  selector: 'app-cash-session-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, TranslateModule, FormsModule],
  template: `
    <h2 mat-dialog-title>{{ isCloseMode() ? 'Kasse schließen' : 'Kasse eröffnen' }}</h2>
    <mat-dialog-content class="text-sm space-y-3">
      @if (phase() === 'input') {
        @if (isCloseMode()) {
          <p>Bitte zählen Sie Ihre Kasse und erfassen Sie die Stückelung.</p>
          <div class="grid grid-cols-2 gap-2">
            @for (cents of denominations; track cents) {
              <label class="flex items-center justify-between gap-2 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1">
                <span class="text-xs text-gray-600 dark:text-gray-300 w-14">{{ label(cents) }}</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  inputmode="numeric"
                  [ngModel]="countFor(cents)"
                  (ngModelChange)="setCount(cents, $event)"
                  class="border border-gray-300 dark:border-gray-700 rounded-md px-2 py-1 w-20 text-right bg-white dark:bg-gray-900"
                />
              </label>
            }
          </div>
          <div class="flex justify-between font-semibold pt-2 border-t border-gray-200 dark:border-gray-700">
            <span>Gezählt gesamt</span>
            <span>{{ countedEuros() }}</span>
          </div>
        } @else {
          <label class="flex flex-col gap-1">
            <span class="text-xs text-gray-500 dark:text-gray-400">Bezeichnung der Kasse</span>
            <input
              type="text"
              maxlength="80"
              [(ngModel)]="label_"
              placeholder="z. B. Kasse 1"
              class="border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2 bg-white dark:bg-gray-900"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-xs text-gray-500 dark:text-gray-400">Wechselgeld-Anfangsbestand (€)</span>
            <input
              type="number"
              step="0.01"
              min="0"
              [(ngModel)]="openingFloatEuros"
              class="border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2 bg-white dark:bg-gray-900"
            />
          </label>
        }
      } @else if (phase() === 'submitting') {
        <p>{{ isCloseMode() ? 'Kasse wird geschlossen…' : 'Kasse wird eröffnet…' }}</p>
      } @else if (phase() === 'submitted') {
        <p>{{ isCloseMode() ? 'Kasse geschlossen.' : 'Kasse eröffnet.' }}</p>
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
          (click)="cancel()"
          [disabled]="phase() === 'submitting'"
        >
          {{ 'COMMON.CANCEL' | translate }}
        </button>
        <button
          class="bg-blue-600 text-white rounded-xl px-4 h-10 disabled:opacity-50"
          [disabled]="!canSubmit() || phase() === 'submitting'"
          (click)="submit()"
        >
          {{ isCloseMode() ? 'Schließen' : 'Eröffnen' }}
        </button>
      }
    </mat-dialog-actions>
  `,
})
export class CashSessionDialogComponent {
  private dialogRef = inject(MatDialogRef<CashSessionDialogComponent>)
  private cashSessionService = inject(CashSessionService)
  protected readonly data = inject<CashSessionDialogData>(MAT_DIALOG_DATA)

  protected readonly denominations = CASH_DENOMINATIONS_CENTS
  protected readonly phase = signal<DialogPhase>('input')
  protected readonly errorMessage = signal<string | null>(null)
  protected resultSession: CashSession | null = null

  // Eröffnen-Modus
  protected label_ = this.data.defaultLabel ?? ''
  protected openingFloatEuros: number | null = null

  // Schließen-Modus
  protected readonly counts = signal<DenominationCounts>({})

  protected readonly isCloseMode = computed(() => !!this.data.session)
  protected readonly countedEuros = computed(() =>
    (sumDenominationCounts(this.counts()) / 100).toLocaleString('de-DE', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
    }),
  )

  protected readonly canSubmit = computed(() => {
    if (this.isCloseMode()) return true
    return this.label_.trim().length > 0 && this.openingFloatEuros !== null && this.openingFloatEuros >= 0
  })

  protected label(cents: number): string {
    return denomLabel(cents)
  }

  protected countFor(cents: number): number | null {
    return this.counts()[`d_${cents}` as keyof DenominationCounts] ?? null
  }

  protected setCount(cents: number, value: number | null): void {
    const next: DenominationCounts = { ...this.counts() }
    const key = `d_${cents}` as keyof DenominationCounts
    if (value && value > 0) next[key] = Math.floor(value)
    else delete next[key]
    this.counts.set(next)
  }

  async submit(): Promise<void> {
    this.phase.set('submitting')
    this.errorMessage.set(null)
    try {
      const session = this.data.session
      if (session) {
        this.resultSession = await this.cashSessionService.closeSession(session._id, {
          denominationCounts: this.counts(),
        })
      } else {
        this.resultSession = await this.cashSessionService.openSession({
          businessDayId: this.data.businessDayId,
          label: this.label_.trim(),
          openingFloatCents: Math.round((this.openingFloatEuros ?? 0) * 100),
        })
      }
      this.phase.set('submitted')
    } catch (err) {
      this.phase.set('failed')
      this.errorMessage.set((err as Error).message ?? 'Aktion fehlgeschlagen')
    }
  }

  cancel(): void {
    this.dialogRef.close(null)
  }

  close(): void {
    this.dialogRef.close(this.resultSession)
  }
}
