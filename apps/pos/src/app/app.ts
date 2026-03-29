import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { RouterModule } from '@angular/router'
import { ConnectionService } from '@panary-core/shared/data-access'

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Globaler Connection-Status-Indikator -->
    @if (connectionState().status === 'disconnected' || connectionState().status === 'error') {
      <div class="fixed top-3 left-1/2 -translate-x-1/2 z-[1000] flex flex-col items-center gap-2">
        <div class="px-3 py-1 bg-red-100/90 backdrop-blur text-red-700 rounded-full text-xs font-bold border border-red-200 shadow-sm flex items-center gap-1.5 animate-bounce">
          <span class="material-symbols-outlined text-[14px]">wifi_off</span>
          Offline
        </div>
        <button (click)="reloadPage()"
          class="w-10 h-10 bg-white/90 backdrop-blur shadow-md rounded-full flex items-center justify-center hover:bg-white transition-colors">
          <span class="material-symbols-outlined text-slate-700 text-[20px]">refresh</span>
        </button>
      </div>
    }
    <router-outlet></router-outlet>
  `,
})
export class AppComponent {
  #connectionService = inject(ConnectionService)
  connectionState = this.#connectionService.connectionState

  reloadPage() {
    window.location.reload()
  }
}
