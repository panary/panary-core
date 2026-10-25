import { ChangeDetectionStrategy, Component, input } from '@angular/core'

/**
 * Einheitlicher Seitenkopf des POS (core#972, Designstudie POS-Screens v2, E6): 68 px hoch, Titel mit
 * grauem Zusatz, ohne Zurück-Pfeil, Kopf-Icon und Kasten — die Rail ist immer da. Der Standard-Slot
 * nimmt Zähler und Suche neben dem Titel, `[pageHeaderActions]` die Aktionen. Der Titel bleibt immer
 * links (Text linksbündig, core#1005), die Aktionen stehen ihm gegenüber am rechten Rand — bei Rail links
 * wie rechts (core#1022). Gleich hinter dem Titel hingen sie bei Rail links am Titel.
 */
@Component({
  selector: 'lib-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block shrink-0' },
  template: `
    <header class="flex h-[4.25rem] items-center gap-4 px-6">
      <div class="flex min-w-0 items-baseline gap-3">
        <h1 class="truncate text-[1.375rem] font-bold tracking-tight text-ink">{{ title() }}</h1>
        @if (subtitle(); as sub) {
          <span class="truncate text-sm text-ink-muted">{{ sub }}</span>
        }
      </div>
      <ng-content />
      <span class="page-header-spacer flex-1"></span>
      <div class="page-header-actions flex items-center gap-3"><ng-content select="[pageHeaderActions]" /></div>
    </header>
  `,
})
export class PageHeaderComponent {
  readonly title = input.required<string>()
  /** Grauer Zusatz hinter dem Titel (Datum, Name, „älteste wartet 7 min"). */
  readonly subtitle = input<string>('')
}
