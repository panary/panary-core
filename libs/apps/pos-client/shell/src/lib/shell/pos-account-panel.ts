import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { CdkMenuGroup, CdkMenuItemRadio } from '@angular/cdk/menu'
import { TranslateModule } from '@ngx-translate/core'
import { ThemeServiceService } from '@panary/shared/data-access-theme'
import { IconComponent, type IconName } from '@panary/shared/ui-common'
import type { ScreenSide } from '../navigation/pos-navigation'
import { PosStaffService } from '../navigation/pos-staff.service'

interface HandOption {
  readonly side: ScreenSide
  readonly label: string
}

interface ThemeOption {
  readonly value: 'light' | 'dark' | 'system'
  readonly label: string
  readonly icon: IconName
}

/** Linkshänder: Warenkorb links (und die Rail damit rechts, core#942). */
const HAND_OPTIONS: readonly HandOption[] = [
  { side: 'left', label: 'POS_NAV.LEFT_HANDED' },
  { side: 'right', label: 'POS_NAV.RIGHT_HANDED' },
]

const THEME_OPTIONS: readonly ThemeOption[] = [
  { value: 'light', label: 'SETTINGS.THEME_LIGHT', icon: 'sun' },
  { value: 'dark', label: 'SETTINGS.THEME_DARK', icon: 'moon' },
  { value: 'system', label: 'SETTINGS.THEME_SYSTEM', icon: 'circle-half' },
]

/**
 * Inhalt des Avatar-Menüs (core#942): wer angemeldet ist, die Bedienhand und die Darstellung.
 * Stempeln und Abmelden sitzen direkt in der Rail (core#907). Die Bedienhand spiegelt Kasse und Rail
 * sofort; das Theme gilt für das Gerät (`ThemeServiceService`, wie in den Einstellungen).
 */
@Component({
  selector: 'lib-pos-account-panel',
  imports: [CdkMenuGroup, CdkMenuItemRadio, IconComponent, TranslateModule],
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

    <div class="pos-menu__label">{{ 'POS_NAV.HANDEDNESS' | translate }}</div>
    <div cdkMenuGroup class="grid grid-cols-2 gap-1.5 px-1.5 pb-1">
      @for (option of hands; track option.side) {
        <button
          cdkMenuItemRadio
          type="button"
          class="pos-menu__segment"
          [class.is-active]="staff.cartSide() === option.side"
          [cdkMenuItemChecked]="staff.cartSide() === option.side"
          (cdkMenuItemTriggered)="staff.chooseCartSide(option.side)"
        >
          <lib-icon name="hand" class="text-[1.375rem]" [class.-scale-x-100]="option.side === 'left'" />
          {{ option.label | translate }}
        </button>
      }
    </div>

    <div class="pos-menu__label">{{ 'POS_NAV.THEME' | translate }}</div>
    <div cdkMenuGroup class="grid grid-cols-3 gap-1.5 px-1.5 pb-1.5">
      @for (option of themes; track option.value) {
        <button
          cdkMenuItemRadio
          type="button"
          class="pos-menu__segment"
          [class.is-active]="theme.theme === option.value"
          [cdkMenuItemChecked]="theme.theme === option.value"
          (cdkMenuItemTriggered)="theme.setTheme(option.value)"
        >
          <lib-icon [name]="option.icon" class="text-[1.375rem]" />
          {{ option.label | translate }}
        </button>
      }
    </div>
  `,
})
export class PosAccountPanel {
  protected readonly staff = inject(PosStaffService)
  protected readonly theme = inject(ThemeServiceService)
  protected readonly hands = HAND_OPTIONS
  protected readonly themes = THEME_OPTIONS
}
