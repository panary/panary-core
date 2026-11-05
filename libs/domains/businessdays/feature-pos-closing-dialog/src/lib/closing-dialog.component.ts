import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog'
import { TranslateModule } from '@ngx-translate/core'

import { BusinessDay, BusinessDayOperationMode } from '@panary/businessdays/domain'
import { BusinessDayService, CashSessionService } from '@panary/businessdays/data-access'

export interface ClosingDialogData {
  businessDay: BusinessDay
}

type DialogPhase = 'input' | 'submitting' | 'submitted' | 'failed'

/**
 * POS-Tagesabschluss-Dialog.
 *
 * - Mode 'orders-only': einfache Bestaetigung; ruft closeDay() ohne Cash-Count
 * - Mode 'pos-cashier': Kassen werden je Kassierer geschlossen. Gab es am Tag keine Kasse, fragt der Dialog den
 *   gezaehlten Endbestand ab (Vorgabe 0 €), denn ohne Session verlangt die Cloud ihn (core#1323)
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
  imports: [MatDialogModule, TranslateModule],
  template: `
    <h2 mat-dialog-title>{{ 'CLOSING.TITLE' | translate }}</h2>
    <mat-dialog-content class="text-sm space-y-3">
      @if (phase() === 'input') {
        @if (needsCountedFloat()) {
          <p>
            Heute wurde keine Kasse geführt. Bitte zählen Sie den Bestand der Kassenlade und tragen Sie ihn ein, bevor
            Sie den Tag abschließen.
          </p>
          <label class="block space-y-1">
            <span class="text-xs font-medium">Gezählter Endbestand (€)</span>
            <input
              #floatInput
              data-testid="closing-counted-float"
              type="text"
              inputmode="decimal"
              class="w-full border rounded-xl px-3 h-12 text-base"
              [value]="countedFloatInput()"
              (input)="setCountedFloat(floatInput.value)"
            />
          </label>
          @if (countedFloatInvalid()) {
            <p class="text-red-600 text-xs">Bitte einen Betrag ab 0 eingeben, z. B. 0 oder 12,50.</p>
          }
        } @else if (isPosCashier()) {
          <p>
            Die Kassen werden separat pro Kassierer gezählt und geschlossen. Der Tagesabschluss aggregiert alle Kassen
            in der Cloud. Bitte stellen Sie sicher, dass alle Kassen geschlossen sind, und bestätigen Sie den Abschluss.
          </p>
        } @else {
          <p>
            Bestellsystem-Modus: kein Kassen-Count nötig. Bestätigen Sie den Tagesabschluss und der Cloud-Report wird im
            Hintergrund erstellt.
          </p>
        }
      } @else if (phase() === 'submitting') {
        <p>Tagesabschluss wird ausgelöst…</p>
      } @else if (phase() === 'submitted') {
        <p>
          Tagesabschluss wurde an die Cloud übermittelt. Der finale Report kann im Admin-Dashboard unter
          „Tagesabschluss" eingesehen werden.
        </p>
      } @else if (phase() === 'failed') {
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
          (click)="close()"
          [disabled]="phase() === 'submitting'"
        >
          {{ 'COMMON.CANCEL' | translate }}
        </button>
        <button
          class="bg-blue-600 text-white rounded-xl px-4 h-10 disabled:opacity-50"
          [disabled]="phase() === 'submitting' || sessionsLoading() || countedFloatInvalid()"
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
  private cashSessionService = inject(CashSessionService)
  protected readonly data = inject<ClosingDialogData>(MAT_DIALOG_DATA)

  protected readonly phase = signal<DialogPhase>('input')
  protected readonly errorMessage = signal<string | null>(null)

  protected readonly isPosCashier = computed(
    () => this.data.businessDay.operationMode === BusinessDayOperationMode.POS_CASHIER,
  )

  /** null = unbekannt (lädt noch oder Laden scheiterte); dann bleibt der Abschluss wie bisher ohne Bestand. */
  private readonly sessionCount = signal<number | null>(null)
  protected readonly sessionsLoading = signal(false)
  protected readonly needsCountedFloat = computed(() => this.isPosCashier() && this.sessionCount() === 0)
  protected readonly countedFloatInput = signal('0')
  private readonly countedFloatCents = computed(() => parseEuroToCents(this.countedFloatInput()))
  protected readonly countedFloatInvalid = computed(() => this.needsCountedFloat() && this.countedFloatCents() === null)

  /** Für Aufrufer und Specs: erfüllt, sobald feststeht, ob der Tag Kassen hatte. */
  readonly sessionsLoaded: Promise<void> = this.isPosCashier() ? this.loadSessionCount() : Promise.resolve()

  private async loadSessionCount(): Promise<void> {
    this.sessionsLoading.set(true)
    try {
      const sessions = await this.cashSessionService.loadForBusinessDay(this.data.businessDay._id)
      this.sessionCount.set(sessions.length)
    } catch (err) {
      console.error('closing-dialog: Kassen des Tages nicht ladbar', err)
    } finally {
      this.sessionsLoading.set(false)
    }
  }

  setCountedFloat(raw: string): void {
    this.countedFloatInput.set(raw)
  }

  async submit(): Promise<void> {
    if (this.phase() === 'submitting') return
    const cents = this.countedFloatCents()
    if (this.needsCountedFloat() && cents === null) return
    this.phase.set('submitting')
    this.errorMessage.set(null)
    try {
      // Mit Kassen kein day-level Bestand: Kassen werden pro Session gezählt, die Cloud aggregiert sie.
      await this.businessDayService.closeDay({
        businessDayId: this.data.businessDay._id,
        ...(this.needsCountedFloat() ? { countedClosingFloatCents: cents as number } : {}),
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

/** „12,50“ oder „12.50“ → 1250; leer zählt als 0. Negativ, mehr als zwei Nachkommastellen oder kein Betrag → null. */
function parseEuroToCents(raw: string): number | null {
  const text = raw.trim().replace(',', '.')
  if (text === '') return 0
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null
  return Math.round(Number(text) * 100)
}
