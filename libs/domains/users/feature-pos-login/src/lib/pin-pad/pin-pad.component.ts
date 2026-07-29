import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core'
import { TranslateModule } from '@ngx-translate/core'

/**
 * Touch-Ziffernblock fuer PIN-Eingaben am POS (Login-PIN und PIN-Wechsel).
 *
 * Die Punktreihe leitet sich aus `length` ab — vorher war sie im Login-Template
 * als `[0, 1, 2, 3]` hartcodiert. Bei einer Wiederverwendung per Copy-Paste
 * haette sich dieser Fehler dupliziert.
 */
@Component({
  selector: 'lib-pin-pad',
  standalone: true,
  imports: [TranslateModule],
  templateUrl: './pin-pad.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PinPadComponent {
  /** Erwartete PIN-Laenge — bestimmt die Anzahl der Punkte. */
  readonly length = input<number>(4)
  /** Aktuelle Eingabe (nur zur Anzeige — die Komponente haelt keinen State). */
  readonly value = input<string>('')
  readonly disabled = input<boolean>(false)
  readonly error = input<boolean>(false)

  readonly digit = output<string>()
  readonly backspace = output<void>()

  protected readonly dots = computed(() => Array.from({ length: this.length() }, (_, index) => index))
  protected readonly digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const
}
