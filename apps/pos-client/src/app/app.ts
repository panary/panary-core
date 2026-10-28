import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { Router, RouterModule } from '@angular/router'
import { type CloudBannerActionKind, CloudStatusBannerService, LanguageService } from '@panary/shared/data-access'
import { ThemeServiceService } from '@panary/shared/data-access-theme'
import { KioskService, LogService, UpdateService } from '@panary/shared/data-access-updater'
import { DeviceConfigService } from '@panary/shared/data-access-config'
import { CloudStatusBannerComponent } from '@panary/shared/ui-cloud-status'
import { NotificationOutletComponent } from '@panary/shared/ui-notifications'

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterModule, CloudStatusBannerComponent, NotificationOutletComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Genau EIN priorisierter Cloud-Status-Banner (positioniert sich selbst,
         höchste Gewichtung gewinnt) als Streifen oben, der den Inhalt schiebt (core#972). Im Setup-Wizard ausgeblendet. Der
         „Offline-Modus aktivieren"-Button ist auf dem Device nicht verfügbar
         (kein RBAC-Write auf cloud-connection) → enableOfflineModeAction bleibt false. -->
    @if (!isSetupRoute()) {
      <lib-cloud-status-banner layout="strip" [banner]="banner()" (action)="onBannerAction($event)" />
    }
    <!-- Meldungsebene (core#1026): alle NotificationService-Meldungen, oben mittig direkt unter
         dem Streifen. Außerhalb des Setup-Guards, damit auch dort Fehler sichtbar sind. -->
    <lib-notification-outlet />
    <router-outlet></router-outlet>
  `,
  // Spalte: Streifen oben, die geroutete Seite füllt den Rest (ohne Streifen unverändert Vollhöhe).
  styles: `
    :host {
      display: flex;
      flex-direction: column;
    }
    :host > router-outlet + * {
      flex: 1 1 0;
      min-height: 0;
    }
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

    // Kiosk (core#1188): Die Kopplung liegt im localStorage, den die Shell nicht lesen
    // kann. Pairing und Entkoppeln laden die App neu, also meldet dieser Aufruf jede Änderung.
    inject(KioskService)
      .reportPaired(inject(DeviceConfigService).hasConfig())
      .catch((err: unknown) => console.warn('[kiosk] Kopplung nicht gemeldet:', err))

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
