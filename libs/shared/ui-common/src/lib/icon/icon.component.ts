import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core'
import { iconPath, type IconName } from '@panary/shared/util-helpers'

/**
 * Phosphor-Bold-Icon als Inline-SVG aus der lokalen Registry (`pnpm icons:build`).
 * Größe folgt `font-size` (1em), Farbe `currentColor` — Klassen wie `text-xl`/`text-amber-600` am Host genügen.
 */
@Component({
  selector: 'lib-icon',
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
export class IconComponent {
  readonly name = input.required<IconName>()

  protected readonly path = computed(() => iconPath(this.name()))
}
