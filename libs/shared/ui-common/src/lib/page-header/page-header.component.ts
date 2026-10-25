import { ChangeDetectionStrategy, Component, input } from '@angular/core'

/**
 * Einheitlicher Seitenkopf des POS (core#972, Designstudie POS-Screens v2, E6): 68 px hoch, Titel mit
 * grauem Zusatz, ohne Zurück-Pfeil, Kopf-Icon und Kasten — die Rail ist immer da. Der Standard-Slot
 * nimmt Zähler und Suche neben dem Titel, `[pageHeaderActions]` die Aktionen. Die Aktionen liegen auf
 * der Seite der Rail (unter der Hand): sitzt die Rail rechts (`data-rail-side` am App-Rahmen der Shell), spiegelt der Kopf die Reihenfolge; der
 * Text bleibt linksbündig.
 */
@Component({
  selector: 'lib-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block shrink-0' },
  // Die Shell setzt `data-rail-side` am App-Rahmen; so spiegelt jede Seite ohne eigene Eingabe.
  styles: `
    :host-context([data-rail-side='right']) header {
      flex-direction: row-reverse;
    }
  `,
  template: `
    <header class="flex h-[4.25rem] items-center gap-4 px-6">
      <div class="flex min-w-0 items-baseline gap-3">
        <h1 class="truncate text-[1.375rem] font-bold tracking-tight text-ink">{{ title() }}</h1>
        @if (subtitle(); as sub) {
          <span class="truncate text-sm text-ink-muted">{{ sub }}</span>
        }
      </div>
      <ng-content />
      <span class="flex-1"></span>
      <div class="flex items-center gap-3"><ng-content select="[pageHeaderActions]" /></div>
    </header>
  `,
})
export class PageHeaderComponent {
  readonly title = input.required<string>()
  /** Grauer Zusatz hinter dem Titel (Datum, Name, „älteste wartet 7 min"). */
  readonly subtitle = input<string>('')
}
