import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { formatEurCents } from '@panary/shared/util-helpers'
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
  /** Die offene Kasse, die gezählt und geschlossen wird. */
  session: CashSession
}

type DialogPhase = 'input' | 'submitting' | 'submitted' | 'failed'

/** Cents → Anzeige-Label („50000" → „500 €", „1" → „1 ct"). */
function denomLabel(cents: number): string {
  return cents >= 100 ? `${cents / 100} €` : `${cents} ct`
}

/**
 * POS-Kassen-Dialog (edge-nativ, offline): Kasse zählen und schließen.
 * Stückelungs-Zähler (Kleingeldzähler); Live-Summe = gezählter Ist-Bestand.
 * Soll/Varianz berechnet die Cloud beim Tagesabschluss.
 *
 * Eröffnet wird eine Kasse nur über die Manager-Freigabe
 * (`ManagerAuthorizeCashSessionDialogComponent`, seit #888); der frühere
 * Eröffnungsmodus dieses Dialogs war unerreichbar und ist entfernt (#1322).
 */
@Component({
  selector: 'app-cash-session-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, TranslateModule],
  template: `
    <h2 mat-dialog-title>Kasse schließen</h2>
    <mat-dialog-content class="text-sm space-y-3">
      @if (phase() === 'input') {
        <p>Bitte zählen Sie Ihre Kasse und erfassen Sie die Stückelung.</p>
        <div class="grid grid-cols-2 gap-2">
          @for (cents of denominations; track cents) {
            <label class="flex items-center justify-between gap-2 border border-line rounded-lg px-2 py-1">
              <span class="text-xs text-ink-muted dark:text-ink w-14">{{ label(cents) }}</span>
              <input
                #countInput
                type="number"
                min="0"
                step="1"
                inputmode="numeric"
                [value]="countFor(cents)"
                (input)="setCount(cents, countInput.valueAsNumber)"
                class="border border-line-strong rounded-md px-2 py-1 w-20 text-right bg-surface-input"
              />
            </label>
          }
        </div>
        <div class="flex justify-between font-semibold pt-2 border-t border-line">
          <span>Gezählt gesamt</span>
          <span>{{ countedEuros() }}</span>
        </div>
      } @else if (phase() === 'submitting') {
        <p>Kasse wird geschlossen…</p>
      } @else if (phase() === 'submitted') {
        <p>Kasse geschlossen.</p>
      } @else {
        <div class="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-xl">
          {{ errorMessage() }}
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions class="flex justify-end gap-2">
      @if (phase() === 'submitted') {
        <button class="bg-surface-elevated border rounded-xl px-4 h-10" (click)="close()">
          {{ 'COMMON.CLOSE' | translate }}
        </button>
      } @else {
        <button
          class="bg-surface-elevated border rounded-xl px-4 h-10"
          (click)="cancel()"
          [disabled]="phase() === 'submitting'"
        >
          {{ 'COMMON.CANCEL' | translate }}
        </button>
        <button
          class="bg-blue-600 text-white rounded-xl px-4 h-10 disabled:opacity-50"
          [disabled]="phase() === 'submitting'"
          (click)="submit()"
        >
          Schließen
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

  protected readonly counts = signal<DenominationCounts>({})

  protected readonly countedEuros = computed(() => formatEurCents(sumDenominationCounts(this.counts())))

  protected label(cents: number): string {
    return denomLabel(cents)
  }

  protected countFor(cents: number): number | null {
    return this.counts()[`d_${cents}` as keyof DenominationCounts] ?? null
  }

  protected setCount(cents: number, value: number | null): void {
    // Ein leeres Zahlenfeld liefert per `valueAsNumber` NaN; das zaehlt wie 0.
    const next: DenominationCounts = { ...this.counts() }
    const key = `d_${cents}` as keyof DenominationCounts
    if (value && value > 0) next[key] = Math.floor(value)
    else delete next[key]
    this.counts.set(next)
  }

  async submit(): Promise<void> {
    if (this.phase() === 'submitting') return
    this.phase.set('submitting')
    this.errorMessage.set(null)
    try {
      this.resultSession = await this.cashSessionService.closeSession(this.data.session._id, {
        denominationCounts: this.counts(),
      })
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
