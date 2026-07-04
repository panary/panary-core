import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { Router, RouterModule } from '@angular/router'
import { type CloudBannerActionKind, CloudStatusBannerService, LanguageService } from '@panary/shared/data-access'
import { ThemeServiceService } from '@panary/shared/data-access-theme'
import { LogService, UpdateService } from '@panary/shared/data-access-updater'
import { CloudStatusBannerComponent } from '@panary/shared/ui-cloud-status'
import { NotificationOutletComponent } from '@panary/shared/ui-notifications'

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterModule, CloudStatusBannerComponent, NotificationOutletComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Genau EIN priorisierter Cloud-Status-Banner (positioniert sich selbst,
         höchste Gewichtung gewinnt). Im Setup-Wizard ausgeblendet. Der
         „Offline-Modus aktivieren"-Button ist auf dem Device nicht verfügbar
         (kein RBAC-Write auf cloud-connection) → enableOfflineModeAction bleibt false. -->
    @if (!isSetupRoute()) {
      <lib-cloud-status-banner [banner]="banner()" (action)="onBannerAction($event)" />
    }
    <!-- Globaler Toast-Outlet: zeigt NotificationService-Meldungen (u.a. aus
         handleError). Außerhalb des Setup-Guards, damit auch dort Fehler sichtbar sind. -->
    <lib-notification-outlet />
    <router-outlet></router-outlet>
  `,
})
export class AppComponent {
  #bannerService = inject(CloudStatusBannerService)
  #router = inject(Router)

  protected readonly banner = this.#bannerService.activeBanner

  constructor() {
    // Theme- und Sprach-Service initialisieren — Konstruktoren wenden gespeicherte Einstellungen sofort an
    inject(ThemeServiceService)
    inject(LanguageService)

    // Natives Logging: globale Fehler + console.error/warn in die Logdatei
    // spiegeln (Feld-Diagnose ohne DevTools). Zuerst, damit auch der
    // Update-Check und frühe Fehler erfasst werden. No-Op außerhalb Tauri.
    inject(LogService).installGlobalCapture()

    // Update-Check beim App-Start — auch im Setup-Wizard (isTauri()-Guard im Service)
    inject(UpdateService).startPeriodicCheck()
  }

  isSetupRoute(): boolean {
    return this.#router.url.startsWith('/setup')
  }

  protected onBannerAction(kind: CloudBannerActionKind): void {
    if (kind === 'reload') {
      window.location.reload()
    }
    // activate-offline-mode wird auf dem POS nicht angeboten (Button ausgeblendet).
  }
}
