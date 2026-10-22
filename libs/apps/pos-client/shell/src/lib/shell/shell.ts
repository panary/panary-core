import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core'
import { RouterOutlet } from '@angular/router'
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
 * Rail (core#832): Login und Einrichtung bleiben ohne Navigation.
 */
@Component({
  selector: 'lib-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div id="app-frame" class="flex h-full w-full bg-surface-bg">
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

  constructor() {
    this.idle.start()
    inject(DestroyRef).onDestroy(() => this.idle.stop())
  }
}
