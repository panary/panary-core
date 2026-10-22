import { ChangeDetectionStrategy, Component, inject, signal, viewChild } from '@angular/core'
import { Router } from '@angular/router'
import { KasseCloseReason, OrderDialogComponent } from './order-dialog.component'

/** Ziel von „Übersicht" und dem Verwerfen der Bestellung. */
export const KASSE_EXIT_URL = '/dashboard'

/**
 * Die Kasse als Route `/kasse` (core#828) — vorher ein MatDialog über dem Dashboard.
 *
 * Nach dem Abschicken bleibt man in der Kasse. Die Bestellkomponente wird dafür je Bestellung
 * neu aufgebaut (`@for` über eine laufende Nummer): Sie führt rund zwanzig Felder je Bestellung
 * (Kunde, Pager, Tisch, Kanal, Bestellbeginn …), die bisher erst das Schließen des Dialogs
 * zurücksetzte. Ein Neuaufbau setzt sie alle zurück, genau wie das Öffnen eines neuen Dialogs —
 * ein Reset von Hand vergäße beim nächsten neuen Feld eines.
 */
@Component({
  selector: 'pos-kasse-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [OrderDialogComponent],
  host: { class: 'block h-full w-full p-2' },
  template: `
    @for (run of [run()]; track run) {
      <app-order-dialog class="block h-full" (closed)="onClosed($event)" />
    }
  `,
})
export class KassePageComponent {
  readonly #router = inject(Router)
  readonly #order = viewChild(OrderDialogComponent)

  /** Laufende Nummer der Bestellung — jeder Wechsel baut die Kasse frisch auf. */
  protected readonly run = signal(0)

  /** Das Verlassen ist schon bestätigt (X/„Übersicht"); der Guard fragt dann nicht erneut. */
  #leaveConfirmed = false

  protected onClosed(reason: KasseCloseReason): void {
    if (reason === 'cancelled') {
      this.#leaveConfirmed = true
      void this.#router.navigateByUrl(KASSE_EXIT_URL)
      return
    }
    this.run.update(n => n + 1)
  }

  /** Für `kasseLeaveGuard`: Rückfrage, sofern die Bestellung nicht schon verworfen ist. */
  canLeave(): Promise<boolean> | boolean {
    if (this.#leaveConfirmed) return true
    return this.#order()?.confirmLeave() ?? true
  }
}
