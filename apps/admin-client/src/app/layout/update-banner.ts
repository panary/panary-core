import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { TranslateModule } from '@ngx-translate/core'
import { UpdateMonitorService } from '../core/update-monitor.service'

/**
 * Hinweis „Neue Version verfügbar" (core#1439): Der Edge meldet eine andere Version als die geladene Oberfläche.
 * Nicht blockierend, mit Neuladen und „Später". Sitzt unten mittig, der Cloud-Status-Banner oben. Den
 * Offline-Hinweis „Edge nicht erreichbar" trägt er bewusst nicht mit: anderer Zustand, anderer Text.
 */
@Component({
  selector: 'app-update-banner',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (monitor.visible()) {
      <div class="fixed bottom-4 left-1/2 -translate-x-1/2 z-[1000] w-auto max-w-[min(92vw,40rem)]">
        <div
          class="flex items-center gap-3 rounded-xl border border-line bg-surface-panel/95 px-4 py-2.5 text-ink shadow-md backdrop-blur dark:bg-surface-bg/90"
          role="status"
          aria-live="polite"
          data-testid="update-banner"
        >
          <p class="flex-1 min-w-0 text-sm font-semibold leading-snug">
            {{ 'UPDATE_BANNER.MESSAGE' | translate: { version: monitor.latestVersion() } }}
          </p>
          <button
            type="button"
            (click)="monitor.reload()"
            class="shrink-0 rounded-lg bg-action px-3 py-1.5 text-xs font-medium text-on-action transition-colors"
          >
            {{ 'UPDATE_BANNER.RELOAD' | translate }}
          </button>
          <button
            type="button"
            (click)="monitor.dismiss()"
            class="shrink-0 text-xs font-medium underline text-ink-muted"
          >
            {{ 'UPDATE_BANNER.LATER' | translate }}
          </button>
        </div>
      </div>
    }
  `,
})
export class UpdateBannerComponent {
  protected readonly monitor = inject(UpdateMonitorService)

  constructor() {
    this.monitor.start()
  }
}
