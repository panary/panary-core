import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core'
import { RouterOutlet } from '@angular/router'
import { TranslateModule } from '@ngx-translate/core'
import { type CloudBannerActionKind, CloudStatusBannerService, LanguageService } from '@panary/shared/data-access'
import { CloudStatusBannerComponent } from '@panary/shared/ui-cloud-status'

import { ConfirmDialogComponent } from './core/confirm-dialog'
import { EmergencyOverrideService } from './core/emergency-override.service'
import { OfflineOverrideService } from './core/offline-override.service'

@Component({
  imports: [RouterOutlet, CloudStatusBannerComponent, ConfirmDialogComponent, TranslateModule],
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Genau EIN priorisierter Cloud-Status-Banner (positioniert sich selbst).
         Offline-Modus- und Notfall-Modus-Aktion sind im Admin freigeschaltet
         (RBAC: cloud-connection); der POS bekommt beide bewusst nicht. -->
    <lib-cloud-status-banner
      [banner]="banner()"
      [enableOfflineModeAction]="true"
      [enableEmergencyOverrideAction]="true"
      (action)="onBannerAction($event)" />

    @if (confirmEndEmergency()) {
      <app-confirm-dialog
        [title]="'CLOUD_MANAGED.EMERGENCY_END' | translate"
        [message]="'CLOUD_MANAGED.EMERGENCY_END_CONFIRM' | translate"
        [confirmLabel]="'COMMON.CONFIRM' | translate"
        [dismissLabel]="'COMMON.CANCEL' | translate"
        (confirmed)="onEndEmergencyConfirmed()"
        (dismissed)="confirmEndEmergency.set(false)"
        (cancelled)="confirmEndEmergency.set(false)" />
    }

    <router-outlet />
  `,
})
export class App {
  // Eager-Init: translate.use() muss vor Login laufen
  protected lang = inject(LanguageService)
  #bannerService = inject(CloudStatusBannerService)
  #offlineOverride = inject(OfflineOverrideService)
  #emergencyOverride = inject(EmergencyOverrideService)

  protected readonly banner = this.#bannerService.activeBanner
  protected readonly confirmEndEmergency = signal(false)

  protected onBannerAction(kind: CloudBannerActionKind): void {
    if (kind === 'reload') {
      window.location.reload()
      return
    }
    if (kind === 'end-emergency-override') {
      // Bestaetigen, weil danach keine lokalen Drucker-Aenderungen mehr
      // angenommen werden — bei laufendem Cloud-Ausfall eine folgenreiche
      // Entscheidung.
      this.confirmEndEmergency.set(true)
      return
    }
    // activate-offline-mode
    void this.#offlineOverride.activate()
  }

  protected async onEndEmergencyConfirmed(): Promise<void> {
    this.confirmEndEmergency.set(false)
    try {
      await this.#emergencyOverride.setActive(false)
    } catch {
      // Fehler bleibt sichtbar: der Banner verschwindet schlicht nicht, weil
      // /health weiterhin emergencyOverride=true meldet.
    }
  }
}
