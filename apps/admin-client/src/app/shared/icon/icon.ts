import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core'
import { ADMIN_ICON_PATHS, type AdminIconName } from './icons.generated'

/**
 * Phosphor-Regular-Icon des Core-Admins als Inline-SVG aus der App-Registry (`pnpm icons:build`).
 * Größe folgt `font-size` (1em), Farbe `currentColor` — `text-[20px]`/`text-amber-600` am Host genügen.
 * Eigene Registry statt `<lib-icon>` (Bold, POS): docs/references/admin-icon-mapping.md.
 */
@Component({
  selector: 'app-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  styles: `
    :host {
      display: inline-block;
      flex: none;
      width: 1em;
      height: 1em;
      line-height: 1;
      vertical-align: -0.125em;
    }
    svg {
      display: block;
      width: 100%;
      height: 100%;
      fill: currentColor;
    }
  `,
  template: `
    <svg viewBox="0 0 256 256" focusable="false">
      <path [attr.d]="path()" />
    </svg>
  `,
})
export class AdminIconComponent {
  readonly name = input.required<AdminIconName>()

  protected readonly path = computed(() => ADMIN_ICON_PATHS[this.name()])
}
