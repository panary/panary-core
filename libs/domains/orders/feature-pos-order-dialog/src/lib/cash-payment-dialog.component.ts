import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core'
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog'
import { MatSnackBar } from '@angular/material/snack-bar'
import { TranslateService } from '@ngx-translate/core'
import { OrderCheckoutService } from '@panary/orders/data-access'
import { LocationService } from '@panary/locations/data-access'
import { UserService } from '@panary/users/data-access'
import {
  promptCashSessionAuthorization,
  type CashSessionPromptLocation,
} from '@panary/businessdays/feature-pos-closing-dialog'
import { CashPaymentComponent } from './cash-payment.component'

/**
 * Material begrenzt Dialoge auf `max-width: 560px`; die Bezahlansicht (Zahlarten, Ziffernblock, Schnellbeträge)
 * braucht mehr, sonst wird sie rechts abgeschnitten (core#834, Sichttest). Breite und Obergrenze setzt der
 * Aufrufer deshalb über diese Konfiguration, nicht der Inhalt.
 */
export const CASH_PAYMENT_DIALOG_CONFIG = {
  width: 'min(46rem, 94vw)',
  maxWidth: '94vw',
  panelClass: 'rounded-dialog',
  autoFocus: false,
  // Backdrop/ESC dürfen den Abschluss nicht abschneiden; „Offen lassen“ ist der Ausweg.
  disableClose: true,
} as const

export interface CashPaymentDialogData {
  orderId: string
  /** Summe in Euro. */
  total: number
  cashierId: string
}

/**
 * Bezahlansicht als Dialog für bestehende Bestellungen (core#834, „Abschließen" in Offene Bestellungen im
 * Kassenbetrieb). Dieselbe Ansicht (`CashPaymentComponent`) und derselbe Kern (`OrderCheckoutService.payCash`)
 * wie im Bestelldialog — keine zweite Kassierlogik. Schließt mit `true`, wenn bezahlt wurde, sonst `false`.
 */
@Component({
  selector: 'lib-cash-payment-dialog',
  standalone: true,
  imports: [CashPaymentComponent],
  host: { class: 'block' },
  template: `
    <div class="h-[min(36rem,88dvh)] w-full pt-4">
      <lib-cash-payment [total]="data.total" [busy]="paying()" (collect)="onCollect()" (keepOpen)="onKeepOpen()" />
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CashPaymentDialogComponent {
  protected readonly data = inject<CashPaymentDialogData>(MAT_DIALOG_DATA)
  readonly #ref = inject<MatDialogRef<CashPaymentDialogComponent, boolean>>(MatDialogRef)
  readonly #checkout = inject(OrderCheckoutService)
  readonly #matDialog = inject(MatDialog)
  readonly #locationService = inject(LocationService)
  readonly #userService = inject(UserService)
  readonly #snackBar = inject(MatSnackBar)
  readonly #translate = inject(TranslateService)

  protected readonly paying = signal(false)

  protected async onCollect(): Promise<void> {
    if (this.paying()) return
    this.paying.set(true)
    try {
      const result = await this.#checkout.payCash({
        orderId: this.data.orderId,
        total: this.data.total,
        cashierId: this.data.cashierId,
        requestCashSession: id =>
          promptCashSessionAuthorization(
            this.#matDialog,
            this.#locationService.activeLocation() as CashSessionPromptLocation | undefined,
            this.#userService.users(),
            id,
          ),
      })
      if (result === 'paid') {
        this.#ref.close(true)
        return
      }
      if (result === 'cash-session-declined') {
        this.#snackBar.open(this.#translate.instant('ORDER_DIALOG.PAYMENT_CASH_SESSION_DECLINED'), 'OK', {
          duration: 5000,
        })
      }
      // `failed`: `handleError` hat schon gemeldet, die Ansicht bleibt für einen neuen Versuch stehen.
    } finally {
      this.paying.set(false)
    }
  }

  protected onKeepOpen(): void {
    if (this.paying()) return
    this.#ref.close(false)
  }
}
