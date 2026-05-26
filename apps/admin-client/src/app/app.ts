import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { RouterOutlet } from '@angular/router'
import { type CloudBannerActionKind, CloudStatusBannerService, LanguageService } from '@panary/shared/data-access'
import { CloudStatusBannerComponent } from '@panary/shared/ui-cloud-status'

import { OfflineOverrideService } from './core/offline-override.service'

@Component({
  imports: [RouterOutlet, CloudStatusBannerComponent],
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Genau EIN priorisierter Cloud-Status-Banner (positioniert sich selbst).
         Offline-Modus-Aktion ist im Admin freigeschaltet (RBAC: cloud-connection). -->
    <lib-cloud-status-banner [banner]="banner()" [enableOfflineModeAction]="true" (action)="onBannerAction($event)" />
    <router-outlet />
  `,
})
export class App {
  // Eager-Init: translate.use() muss vor Login laufen
  protected lang = inject(LanguageService)
  #bannerService = inject(CloudStatusBannerService)
  #offlineOverride = inject(OfflineOverrideService)

  protected readonly banner = this.#bannerService.activeBanner

  protected onBannerAction(kind: CloudBannerActionKind): void {
    if (kind === 'reload') {
      window.location.reload()
      return
    }
    // activate-offline-mode
    void this.#offlineOverride.activate()
  }
}
