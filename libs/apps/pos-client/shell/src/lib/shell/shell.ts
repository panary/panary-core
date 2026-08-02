import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core'
import { RouterOutlet } from '@angular/router'
import { PosIdleLogoutService } from '../services/pos-idle-logout.service'
import { IdleWarningOverlayComponent } from './idle-warning-overlay.component'

/**
 * Rahmen der authentifizierten POS-Routen.
 *
 * Die Komponente umschliesst in `app.routes.ts` genau die geschuetzten Routen —
 * `/setup` und `/login` liegen ausserhalb. Ihr Lebenszyklus ist deshalb der
 * richtige Schalter fuer den Inaktivitaets-Logout: er laeuft, solange ein
 * Mitarbeiter angemeldet ist, und nicht davor oder danach.
 */
@Component({
  selector: 'lib-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div id="app-frame" class="h-full w-full bg-gray-50 dark:bg-black">
      <main class="h-full w-full">
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
  imports: [RouterOutlet, IdleWarningOverlayComponent],
})
export class AppPosShellComponent {
  protected readonly idle = inject(PosIdleLogoutService)

  constructor() {
    this.idle.start()
    inject(DestroyRef).onDestroy(() => this.idle.stop())
  }
}
