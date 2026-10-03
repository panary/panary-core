import { Injectable, Provider, inject } from '@angular/core'
import {
  MAT_SNACK_BAR_DEFAULT_OPTIONS,
  MatSnackBar,
  MatSnackBarConfig,
  MatSnackBarRef,
  TextOnlySnackBar,
} from '@angular/material/snack-bar'

/** Eine Meldung, die stehen bleibt, bis jemand ihre Aktion tippt. */
interface StickyNotice {
  message: string
  action: string
  config: MatSnackBarConfig | undefined
}

/**
 * `MatSnackBar` mit Rangfolge für quittierpflichtige Meldungen (core#531).
 *
 * `MatSnackBar` zeigt immer nur eine Meldung; jede neue verdrängt die laufende, und
 * `dismiss()` schließt, was gerade offen ist. Für eine Meldung ohne `duration`, die der
 * Kassierer quittieren soll — „Rabattcode nicht eingelöst" (#234) —, hieß das: Sie war
 * nach Bruchteilen einer Sekunde weg. `placeOrder` schloss sie selbst über das
 * Undo-Aufräumen, und „Bestellungen aktualisiert" nach dem Anlegen hätte sie ohnehin
 * verdrängt.
 *
 * Rangfolge: Eine Meldung **ohne** Ablaufzeit **mit** Aktion gilt als quittierpflichtig.
 * Verdrängt eine andere Meldung sie oder schließt `dismiss()` sie, erscheint sie wieder,
 * sobald nichts anderes mehr offen ist. Sie endet erst mit dem Tipp auf ihre Aktion.
 * Kurzmeldungen bleiben dabei unverändert sichtbar, ein „Rückgängig" funktioniert weiter.
 *
 * Grenzen, bewusst:
 * - Es gibt **eine** quittierpflichtige Meldung; eine neue ersetzt eine ältere offene.
 * - Die Rückkehr ist eine neue Snackbar mit eigenem `MatSnackBarRef`. Wer am Ref der
 *   ersten Anzeige `onAction()` abonniert, sieht den Tipp auf eine zurückgekehrte nicht.
 *   Heute abonniert kein Aufrufer einer quittierpflichtigen Meldung ihr Ref.
 * - Nur `open()` wird gezählt; `openFromComponent`/`openFromTemplate` nutzt der POS nicht.
 */
@Injectable()
export class PosSnackBar extends MatSnackBar {
  readonly #defaults = inject(MAT_SNACK_BAR_DEFAULT_OPTIONS)
  #sticky: StickyNotice | null = null
  /** Die zuletzt geöffnete Snackbar — solange sie steht, gibt es nichts zurückzuholen. */
  #current: MatSnackBarRef<TextOnlySnackBar> | null = null

  override open(message: string, action = '', config?: MatSnackBarConfig): MatSnackBarRef<TextOnlySnackBar> {
    const duration = config?.duration ?? this.#defaults.duration ?? 0
    const notice = action !== '' && !(duration > 0) ? { message, action, config } : null
    if (notice) this.#sticky = notice
    return this.#show(message, action, config, notice)
  }

  /** Beim Abbau nichts mehr zurückholen — der Injector, an dem das Overlay hängt, ist weg. */
  override ngOnDestroy(): void {
    this.#sticky = null
    super.ngOnDestroy()
  }

  #show(
    message: string,
    action: string,
    config: MatSnackBarConfig | undefined,
    notice: StickyNotice | null,
  ): MatSnackBarRef<TextOnlySnackBar> {
    const ref = super.open(message, action, config)
    this.#current = ref
    ref.afterDismissed().subscribe(({ dismissedByAction }) => {
      if (notice && dismissedByAction && this.#sticky === notice) this.#sticky = null
      if (this.#current !== ref) return // eine neuere Meldung hat übernommen
      this.#current = null
      // Erst nach dem laufenden Öffnen entscheiden: Verdrängt eine neue Meldung diese,
      // kann deren `afterDismissed` noch innerhalb von `super.open()` feuern — bevor
      // `#current` auf die neue zeigt.
      queueMicrotask(() => this.#restore())
    })
    return ref
  }

  #restore(): void {
    const notice = this.#sticky
    if (!notice || this.#current) return
    this.#show(notice.message, notice.action, notice.config, notice)
  }
}

/** Ersetzt `MatSnackBar` app-weit durch {@link PosSnackBar} — alle Aufrufer bleiben unverändert. */
export function providePosSnackBar(): Provider {
  return { provide: MatSnackBar, useClass: PosSnackBar }
}
