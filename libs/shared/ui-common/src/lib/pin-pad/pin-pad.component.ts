import { ChangeDetectionStrategy, Component, computed, effect, input, output } from '@angular/core'
import { NgClass } from '@angular/common'
import { TranslateModule } from '@ngx-translate/core'
import { fromEvent, type Observable } from 'rxjs'
import { pinKeyAction } from './pin-key'

/** Quelle der Tastaturereignisse: `'window'`, ein Strom (z. B. `dialogRef.keydownEvents()`) oder `null` (nur Touch). */
export type PinPadKeyboardSource = 'window' | Observable<KeyboardEvent> | null

/**
 * Ziffernblock mit Punktreihe fuer jede PIN-Eingabe am POS.
 *
 * Touch/Maus ueber die Tasten, physische Tastatur direkt (ohne vorheriges Anklicken): Ziffern 0-9
 * und Backspace/Delete. Esc und alles andere bleiben beim Host. Die Komponente haelt keinen State —
 * der Host fuehrt den Wert und reagiert auf `digit`/`backspace`.
 *
 * Tastaturquelle:
 * - `'window'` (Vorgabe) haengt sich in der Capture-Phase an `window`. Ein `stopPropagation()` im
 *   Panel eines Overlays (Kiosk-PIN, Entkoppeln) verschluckt die Taste so nicht mehr.
 * - Overlays auf dem CDK (MatDialog) uebergeben `dialogRef.keydownEvents()`: Der CDK routet Tasten nur
 *   ans oberste Overlay, gestapelte Dialoge reagieren so nicht gleichzeitig auf eine Ziffer.
 */
@Component({
  selector: 'lib-pin-pad',
  standalone: true,
  imports: [NgClass, TranslateModule],
  templateUrl: './pin-pad.component.html',
  styles: `
    .pin-shake {
      animation: pin-shake 0.3s ease-out;
    }

    @keyframes pin-shake {
      0%,
      100% {
        transform: translateX(0);
      }
      20% {
        transform: translateX(-0.5rem);
      }
      40% {
        transform: translateX(0.5rem);
      }
      60% {
        transform: translateX(-0.25rem);
      }
      80% {
        transform: translateX(0.25rem);
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PinPadComponent {
  /** Erwartete PIN-Laenge — bestimmt die Anzahl der Punkte. Bewusst ohne Vorgabe: Aufrufer uebergeben `POS_PIN_LENGTH`. */
  readonly length = input.required<number>()
  /** Aktuelle Eingabe (nur zur Anzeige). */
  readonly value = input<string>('')
  readonly disabled = input<boolean>(false)
  readonly error = input<boolean>(false)
  /** Tailwind-Klasse der gefuellten Punkte (Akzentfarbe je Dialog). Voller Klassenname, sonst findet Tailwind ihn nicht. */
  readonly accentClass = input<string>('bg-[#00B8D4]')
  readonly keyboard = input<PinPadKeyboardSource>('window')

  readonly digit = output<string>()
  readonly backspace = output<void>()

  protected readonly dots = computed(() => Array.from({ length: this.length() }, (_, index) => index))
  protected readonly digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

  constructor() {
    effect(onCleanup => {
      const source = this.keyboard()
      if (!source) return
      const events$ =
        source === 'window' ? fromEvent<KeyboardEvent>(window, 'keydown', { capture: true }) : source
      const subscription = events$.subscribe(event => this.#handleKey(event))
      onCleanup(() => subscription.unsubscribe())
    })
  }

  #handleKey(event: KeyboardEvent): void {
    if (this.disabled()) return
    const action = pinKeyAction(event)
    if (!action) return
    event.preventDefault()
    if (action.type === 'digit') this.digit.emit(action.digit)
    else this.backspace.emit()
  }
}
