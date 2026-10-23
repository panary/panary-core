import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { CdkMenuItem } from '@angular/cdk/menu'
import { TranslateModule } from '@ngx-translate/core'
import { IconComponent } from '@panary/shared/ui-common'
import { PosStaffService } from '../navigation/pos-staff.service'

/**
 * Inhalt des Avatar-Menüs: wer angemeldet ist und die Warenkorb-Seite (core#833).
 * Kommen/Pause/Gehen und Abmelden lagen hier bis core#907 und sitzen jetzt direkt in der Rail.
 */
@Component({
  selector: 'lib-pos-account-panel',
  imports: [CdkMenuItem, IconComponent, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './pos-menu.css',
  template: `
    <div class="flex items-center gap-3 px-3 py-2.5">
      <span
        class="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink text-[0.9375rem] font-bold text-surface-panel"
        >{{ staff.initials() }}</span
      >
      <div class="min-w-0">
        <b class="block truncate text-[1.0625rem]">{{ staff.displayName() }}</b>
        <span class="text-sm text-ink-muted">
          @if (staff.isOnBreak()) {
            {{ 'DASHBOARD.BREAK' | translate }}
          } @else if (staff.isStampedIn()) {
            {{ 'DASHBOARD.CLOCKED_IN' | translate }}
          } @else {
            {{ 'DASHBOARD.CLOCKED_OUT' | translate }}
          }
        </span>
      </div>
    </div>

    <div class="pos-menu__label">{{ 'POS_NAV.KASSE' | translate }}</div>
    <button cdkMenuItem type="button" class="pos-menu__item" (cdkMenuItemTriggered)="staff.toggleCartSide()">
      <lib-icon [name]="staff.cartSide() === 'right' ? 'arrow-right' : 'arrow-left'" class="text-[1.375rem]" />
      <span class="flex flex-col">
        {{ 'POS_NAV.CART_SIDE' | translate }}
        <em class="text-xs font-medium not-italic text-ink-muted">{{
          (staff.cartSide() === 'right' ? 'POS_NAV.CART_SIDE_RIGHT' : 'POS_NAV.CART_SIDE_LEFT') | translate
        }}</em>
      </span>
    </button>
  `,
})
export class PosAccountPanel {
  protected readonly staff = inject(PosStaffService)
}
