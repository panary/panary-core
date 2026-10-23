import { ChangeDetectionStrategy, Component, input } from '@angular/core'

/**
 * Panary-Logo wie im Auth-Shell der Cloud: dunkles Quadrat mit zwei Mint-Stäben (Token `--brand-navy` / `--primary`,
 * in beiden Themes gleich, daher auf hellem und dunklem Grund lesbar) und die Wortmarke in `currentColor`.
 * Die Höhe setzt `size` in rem; die Wortmarke folgt der Textfarbe des Elternelements.
 */
@Component({
  selector: 'lib-panary-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex items-center gap-2', role: 'img', '[attr.aria-label]': '"Panary"' },
  template: `
    <svg
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      class="shrink-0"
      [style.width.rem]="size()"
      [style.height.rem]="size()"
    >
      <rect width="64" height="64" rx="13" fill="var(--brand-navy)" />
      <rect x="16" y="14" width="13" height="35" rx="2" fill="var(--primary)" />
      <rect x="32" y="14" width="16" height="19" rx="2" fill="var(--primary)" />
    </svg>
    @if (wordmark()) {
      <span class="font-semibold leading-none" aria-hidden="true" [style.font-size.rem]="size() * 0.6">Panary</span>
    }
  `,
})
export class PanaryLogoComponent {
  /** Kantenlänge des Zeichens in rem. */
  readonly size = input<number>(2)
  readonly wordmark = input<boolean>(true)
}
