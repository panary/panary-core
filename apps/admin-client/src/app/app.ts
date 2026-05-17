import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { RouterOutlet } from '@angular/router'
import { ConnectionService, LanguageService } from '@panary-core/shared/data-access'
import { CloudStatusBadgesComponent } from '@panary-core/shared/ui-cloud-status'

@Component({
  imports: [RouterOutlet, CloudStatusBadgesComponent],
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Cloud-Sync-Alter und Token-Restlaufzeit — schwebende Badge,
         gleiche Optik wie im POS-Client. Rendert nichts, wenn beide
         Trigger auf level === 'ok' stehen. -->
    <lib-cloud-status-badges [sync]="syncStaleness()" [token]="tokenExpiry()" />
    <router-outlet />
  `,
})
export class App {
  // Eager-Init: translate.use() muss vor Login laufen
  protected lang = inject(LanguageService)
  #connectionService = inject(ConnectionService)

  protected readonly syncStaleness = this.#connectionService.syncStaleness
  protected readonly tokenExpiry = this.#connectionService.tokenExpiry
}
