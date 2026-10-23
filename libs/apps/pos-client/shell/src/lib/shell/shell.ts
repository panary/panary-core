import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, untracked } from '@angular/core'
import { PosHandednessService } from '@panary/users/data-access'
import { RouterOutlet } from '@angular/router'
import { PosStaffService } from '../navigation/pos-staff.service'
import { PosIdleLogoutService } from '../services/pos-idle-logout.service'
import { IdleWarningOverlayComponent } from './idle-warning-overlay.component'
import { PosRail } from './pos-rail'

/**
 * Rahmen der authentifizierten POS-Routen.
 *
 * Die Komponente umschliesst in `app.routes.ts` genau die geschuetzten Routen —
 * `/setup` und `/login` liegen ausserhalb. Ihr Lebenszyklus ist deshalb der
 * richtige Schalter fuer den Inaktivitaets-Logout: er laeuft, solange ein
 * Mitarbeiter angemeldet ist, und nicht davor oder danach. Aus demselben Grund trägt sie die
 * Rail (core#832): Login und Einrichtung bleiben ohne Navigation. Die Rail sitzt dem Warenkorb
 * gegenüber und wechselt mit der Bedienhand die Seite (core#942).
 */
@Component({
  selector: 'lib-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      id="app-frame"
      class="flex h-full w-full bg-surface-bg"
      [class.flex-row-reverse]="staff.railSide() === 'right'"
    >
      <lib-pos-rail class="shrink-0" />
      <main class="h-full min-w-0 flex-1">
        <router-outlet></router-outlet>
      </main>
    </div>

    @if (idle.phase() === 'warning') {
      <lib-idle-warning-overlay
        [remainingSeconds]="idle.remainingSeconds()"
        [warningSeconds]="idle.warningSeconds()"
        (stayLoggedIn)="idle.reset()"
      />
    }
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
    `,
  ],
  imports: [RouterOutlet, IdleWarningOverlayComponent, PosRail],
})
export class AppPosShellComponent {
  protected readonly idle = inject(PosIdleLogoutService)
  protected readonly staff = inject(PosStaffService)

  constructor() {
    this.idle.start()
    inject(DestroyRef).onDestroy(() => this.idle.stop())

    // Offline gewählte Bedienhand nachsenden, sobald der Edge wieder erreichbar ist (core#833).
    // Bewusst getrackt: jede Rückkehr der Verbindung löst aus (angular.md §2.1).
    const handedness = inject(PosHandednessService)
    effect(() => {
      if (handedness.online()) untracked(() => void handedness.flush())
    })
  }
}
