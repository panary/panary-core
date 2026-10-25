import { ChangeDetectionStrategy, Component, input } from '@angular/core'

/**
 * Split-Layout der POS-Seiten (core#975): Liste links, Detail rechts. Das Detail ist
 * clamp(400px, 32%, 600px) breit, die Liste nimmt den Rest und wird per `listMaxWidth` gedeckelt.
 * Inhalte kommen als `[posSplitList]` und `[posSplitDetail]`; `reverse` vertauscht die Seiten
 * (Bedienhand, core#976).
 */
@Component({
  selector: 'lib-pos-split',
  standalone: true,
  template: `
    <div class="pos-split__list" [style.max-width]="listMaxWidth()">
      <ng-content select="[posSplitList]" />
    </div>
    <div class="pos-split__detail">
      <ng-content select="[posSplitDetail]" />
    </div>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex: 1;
        min-height: 0;
        gap: 1rem;
      }
      :host(.pos-split--reverse) {
        flex-direction: row-reverse;
      }
      .pos-split__list {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .pos-split__detail {
        flex: 0 0 clamp(400px, 32%, 600px);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      @media (max-width: 1023px) {
        .pos-split__detail {
          display: none;
        }
        :host(.pos-split--detail-open) .pos-split__list {
          display: none;
        }
        :host(.pos-split--detail-open) .pos-split__detail {
          display: flex;
          flex: 1;
        }
      }
    `,
  ],
  host: {
    '[class.pos-split--reverse]': 'reverse()',
    '[class.pos-split--detail-open]': 'detailOpen()',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PosSplitComponent {
  listMaxWidth = input<string | null>(null)
  reverse = input(false)
  /** Schmale Schirme zeigen entweder die Liste oder das Detail. */
  detailOpen = input(false)
}
