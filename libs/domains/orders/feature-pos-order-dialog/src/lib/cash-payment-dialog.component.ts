import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core'
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog'
import { NotificationService } from '@panary/shared/ui-notifications'
import { TranslateModule, TranslateService } from '@ngx-translate/core'
import { OrderCheckoutService, type PayCashResult } from '@panary/orders/data-access'
import { sumCents, toCents } from '@panary/orders/domain'
import { formatEurCents } from '@panary/shared/util-helpers'
import { LocationService } from '@panary/locations/data-access'
import { UserService } from '@panary/users/data-access'
import {
  promptCashSessionAuthorization,
  promptClosedDayApprovalFromError,
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

/** Eine Bestellung kassieren (Einzelkarte, core#834). */
export interface CashPaymentOrderData {
  orderId: string
  /** Summe in Euro. */
  total: number
  cashierId: string
}

/**
 * „Tisch kassieren“ (core#1142): alle offenen Bestellungen eines Kreises in einem Bezahlvorgang. `total` ist die
 * Summe für den Gast in Euro, gebildet aus genau den Beträgen in `orders` (`tableCheckoutPlan`).
 */
export interface CashPaymentCircleData {
  circle: { table: string; orders: ReadonlyArray<{ orderId: string; total: number }> }
  total: number
  cashierId: string
}

export type CashPaymentDialogData = CashPaymentOrderData | CashPaymentCircleData

/**
 * Bezahlansicht als Dialog für bestehende Bestellungen (core#834, „Abschließen" in Offene Bestellungen im
 * Kassenbetrieb). Dieselbe Ansicht (`CashPaymentComponent`) und derselbe Kern (`OrderCheckoutService.payCash`)
 * wie im Bestelldialog — keine zweite Kassierlogik. Schließt mit `true`, wenn bezahlt wurde, sonst `false`.
 */
@Component({
  selector: 'lib-cash-payment-dialog',
  standalone: true,
  imports: [CashPaymentComponent, TranslateModule],
  host: { class: 'block' },
  template: `
    @if (circle; as c) {
      <p class="px-6 pt-4 text-lg font-extrabold text-ink" data-testid="cash-payment-circle">
        {{ 'ACTIVE_ORDERS.CIRCLE_TITLE' | translate: { table: c.table, count: c.orders.length } }}
      </p>
    }
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
  readonly #notifications = inject(NotificationService)
  readonly #translate = inject(TranslateService)

  protected readonly paying = signal(false)
  protected readonly circle = 'circle' in this.data ? this.data.circle : null

  protected async onCollect(): Promise<void> {
    if (this.paying()) return
    this.paying.set(true)
    try {
      const prompts = {
        cashierId: this.data.cashierId,
        requestCashSession: (id: string) =>
          promptCashSessionAuthorization(
            this.#matDialog,
            this.#locationService.activeLocation() as CashSessionPromptLocation | undefined,
            this.#userService.users(),
            id,
          ),
        requestClosedDayApproval: (err: unknown) =>
          promptClosedDayApprovalFromError(
            this.#matDialog,
            err,
            (this.#locationService.activeLocation() as { operationMode?: string } | undefined)?.operationMode,
          ),
      }
      const result =
        'circle' in this.data
          ? await this.#payCircle(this.data, prompts)
          : await this.#checkout.payCash({ ...prompts, orderId: this.data.orderId, total: this.data.total })
      if (result === null) return
      if (result === 'paid') {
        this.#ref.close(true)
        return
      }
      if (result === 'cash-session-declined') {
        this.#notifications.warning(this.#translate.instant('ORDER_DIALOG.PAYMENT_CASH_SESSION_DECLINED'))
      }
      if (result === 'closed-day-declined') {
        this.#notifications.warning(this.#translate.instant('CLOSED_DAY.DECLINED'))
      }
      if (result === 'timeout') {
        this.#notifications.warning(this.#translate.instant('ORDER_DIALOG.PAYMENT_TIMEOUT'), { sticky: true })
      }
      // `failed`: `handleError` hat schon gemeldet, die Ansicht bleibt für einen neuen Versuch stehen.
    } finally {
      this.paying.set(false)
    }
  }

  /**
   * Kassiert den Kreis. Ist schon ein Teil gebucht, als der Ablauf anhält, schließt die Ansicht: Der Gast hat für
   * alles gezahlt, und der Kassierer muss sehen, was nicht gebucht ist. Die Meldung bleibt bis zum Quittieren
   * stehen, der Rest liegt weiter in „Offen“ und lässt sich erneut kassieren. `null` heißt: erledigt, nichts mehr
   * zu melden.
   */
  async #payCircle(
    data: CashPaymentCircleData,
    prompts: Omit<Parameters<OrderCheckoutService['payCashCircle']>[0], 'orders'>,
  ): Promise<PayCashResult | null> {
    const outcome = await this.#checkout.payCashCircle({ ...prompts, orders: data.circle.orders })
    if (outcome.result === 'paid' || outcome.paid.length + outcome.skipped.length === 0) return outcome.result

    const open = data.circle.orders.filter(order => outcome.remaining.includes(order.orderId))
    const openCents = sumCents(open.map(order => toCents(order.total)))
    this.#notifications.warning(
      this.#translate.instant('ORDER_DIALOG.PAYMENT_TABLE_PARTIAL', {
        table: data.circle.table,
        paid: outcome.paid.length + outcome.skipped.length,
        count: data.circle.orders.length,
        rest: formatEurCents(openCents),
      }),
      { sticky: true },
    )
    this.#ref.close(false)
    return null
  }

  protected onKeepOpen(): void {
    if (this.paying()) return
    this.#ref.close(false)
  }
}
