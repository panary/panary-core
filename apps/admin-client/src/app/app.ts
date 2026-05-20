import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { RouterOutlet } from '@angular/router'
import { ConnectionService, LanguageService } from '@panary/shared/data-access'
import { CloudStatusBadgesComponent } from '@panary/shared/ui-cloud-status'

@Component({
  imports: [RouterOutlet, CloudStatusBadgesComponent],
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Cloud-Sync-Alter und Token-Restlaufzeit — schwebende Badge,
         gleiche Optik wie im POS-Client. Stack-Container haelt die Pillen
         oben am Viewport-Rand. Komponente rendert nichts, wenn beide
         Trigger auf level === 'ok' stehen. -->
    <div class="fixed top-3 left-1/2 -translate-x-1/2 z-[1000] flex flex-col items-center gap-2">
      <lib-cloud-status-badges [sync]="syncStaleness()" [token]="tokenExpiry()" />
    </div>
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
