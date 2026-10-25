import { ChangeDetectionStrategy, Component, inject, signal, viewChild } from '@angular/core'
import { MatSnackBar } from '@angular/material/snack-bar'
import { Router } from '@angular/router'
import { TranslateService } from '@ngx-translate/core'
import { ReturnAfterOrderService } from '@panary/shared/data-access'
import { KasseCloseReason, OrderDialogComponent } from './order-dialog.component'

/** Ziel von „Übersicht" und dem Verwerfen der Bestellung. */
export const KASSE_EXIT_URL = '/dashboard'

const KASSE_URL = '/kasse'

/** Seiten, von denen aus die Kasse über die Rail oder einen Schnellzugriff geöffnet wird (core#974). */
const RETURN_PATHS = ['/dashboard', '/orders/active', '/pre-orders', '/orders/history']

/** Seite vor der Kasse, sofern es eine der Rail-Seiten war — sonst `null` (direkter Aufruf, Neuladen). */
export function kasseOrigin(url: string | null | undefined): string | null {
  const path = (url ?? '').split(/[?#]/, 1)[0]
  return RETURN_PATHS.find(p => path === p || path.startsWith(`${p}/`)) ?? null
}

/**
 * Die Kasse als Route `/kasse` (core#828) — vorher ein MatDialog über dem Dashboard.
 *
 * Nach dem Abschicken geht es zur Ausgangsseite zurück (core#974, abschaltbar); ohne bekannte Ausgangsseite bleibt man in der Kasse. Die Bestellkomponente wird dafür je Bestellung
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
    @for (n of [run()]; track n) {
      <app-order-dialog class="block h-full" [isFollowUp]="n > 0" (closed)="onClosed($event)" />
    }
  `,
})
export class KassePageComponent {
  readonly #router = inject(Router)
  readonly #snackBar = inject(MatSnackBar)
  readonly #translate = inject(TranslateService)
  readonly #returnAfterOrder = inject(ReturnAfterOrderService)

  /** Wo die Kasse geöffnet wurde; zum Zeitpunkt des Routings noch in `previousNavigation` (core#974). */
  readonly #origin = kasseOrigin(this.#router.currentNavigation?.()?.previousNavigation?.finalUrl?.toString())
  private readonly order = viewChild(OrderDialogComponent)

  /** Laufende Nummer der Bestellung — jeder Wechsel baut die Kasse frisch auf. */
  protected readonly run = signal(0)

  /** Das Verlassen ist schon bestätigt (X/„Übersicht"); der Guard fragt dann nicht erneut. */
  #leaveConfirmed = false

  /** Läuft schon eine Rückfrage (zweimal Zurück)? Dann teilt sich der Guard deren Antwort. */
  #pendingLeave: Promise<boolean> | null = null

  protected onClosed(reason: KasseCloseReason): void {
    if (reason === 'cancelled') {
      this.#leaveConfirmed = true
      // Scheitert die Navigation, bleibt die Kasse offen — und der Guard muss wieder fragen.
      void this.#router.navigateByUrl(KASSE_EXIT_URL).then(navigated => {
        if (!navigated) this.#leaveConfirmed = false
      })
      return
    }
    if (this.#origin && this.#returnAfterOrder.enabled()) {
      this.#returnToOrigin(this.#origin)
      return
    }
    this.run.update(n => n + 1)
  }

  /** Die Bestellung ist abgeschickt, es gibt nichts mehr zu verwerfen — der Guard fragt nicht. */
  #returnToOrigin(origin: string): void {
    this.#leaveConfirmed = true
    void this.#router.navigateByUrl(origin).then(navigated => {
      if (!navigated) {
        this.#leaveConfirmed = false
        this.run.update(n => n + 1)
        return
      }
      this.#snackBar
        .open(
          this.#translate.instant('SETTINGS.RETURN_AFTER_ORDER_HINT'),
          this.#translate.instant('ACTIVE_ORDERS.NEW_ORDER'),
          { duration: 5000 },
        )
        .onAction()
        .subscribe(() => void this.#router.navigateByUrl(KASSE_URL))
    })
  }

  /** Für `kasseLeaveGuard`: Rückfrage, sofern die Bestellung nicht schon verworfen ist. */
  canLeave(): Promise<boolean> | boolean {
    if (this.#leaveConfirmed) return true
    const order = this.order()
    if (!order) return true
    this.#pendingLeave ??= order.confirmLeave().finally(() => (this.#pendingLeave = null))
    return this.#pendingLeave
  }
}
