import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core'
import { TranslateModule } from '@ngx-translate/core'
import { EurPipe, IconComponent } from '@panary/shared/ui-common'
import { fromCents, toCents } from '@panary/orders/domain'
import { appendCashDigit, canCollect, changeCents, quickAmounts, removeCashDigit } from './cash-payment'

/**
 * Bezahlansicht „nur Bar" der Kasse (core#831, Konzept §2.4). Reine Anzeige und Eingabe: Die Bestellung ist
 * schon angelegt, der Dialog kassiert über `OrderCheckoutService.payCash`. Die Komponente meldet nur, dass
 * kassiert (`collect`) oder offen gelassen (`keepOpen`) werden soll. Das Rückgeld ist reine Anzeige (F2) — es
 * wird nirgends gebucht.
 */
@Component({
  selector: 'lib-cash-payment',
  standalone: true,
  imports: [TranslateModule, EurPipe, IconComponent],
  templateUrl: './cash-payment.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CashPaymentComponent {
  /** Summe in Euro, gleich dem Betrag auf der Primärtaste. */
  readonly total = input.required<number>()
  /** Der Abschluss läuft (Server-Aufruf, Kassen-Freigabe): alle Tasten gesperrt. */
  readonly busy = input<boolean>(false)

  /** Gegebener Betrag in Cent. */
  readonly collect = output<number>()
  readonly keepOpen = output<void>()

  protected readonly given = signal(0)
  protected readonly digits = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const

  protected readonly totalCents = computed(() => toCents(this.total()))
  protected readonly change = computed(() => changeCents(this.given(), this.totalCents()))
  protected readonly canCollect = computed(() => canCollect(this.given(), this.totalCents()))
  protected readonly quick = computed(() => quickAmounts(this.totalCents()))

  protected press(digit: number): void {
    this.given.update(cents => appendCashDigit(cents, digit))
  }

  protected backspace(): void {
    this.given.update(removeCashDigit)
  }

  protected clear(): void {
    this.given.set(0)
  }

  protected setGiven(cents: number): void {
    this.given.set(cents)
  }

  protected submit(): void {
    if (this.busy() || !this.canCollect()) return
    this.collect.emit(this.given())
  }

  /** Cent als Euro für die `eur`-Pipe. */
  protected euro(cents: number): number {
    return fromCents(cents)
  }
}
