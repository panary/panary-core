import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core'
import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu'
import type { ConnectedPosition } from '@angular/cdk/overlay'
import { TranslateModule } from '@ngx-translate/core'
import { IconComponent, PanaryLogoComponent } from '@panary/shared/ui-common'
import type { ScreenSide } from '../navigation/pos-navigation'
import { PosNavigationService } from '../navigation/pos-navigation.service'
import { monogramStyle } from '@panary/users/domain'
import { PosStaffService } from '../navigation/pos-staff.service'
import { PosAccountPanel } from './pos-account-panel'
import { PosTimeClock } from './pos-time-clock'

/**
 * Navigationsleiste des POS (core#832, Konzept §3 und Mockup 2.7): fünf direkte Einträge, „Mehr" mit
 * Gruppen und direktem Einstellungen-Eintrag, unten die ruhige Fußzone aus core#942 — Stempeltaste,
 * Abmelden und ganz unten der Avatar mit Online-Punkt. Die Rail sitzt dem Warenkorb gegenüber
 * (`PosStaffService.railSide`), ihre Menüs öffnen deshalb immer zur Bildschirmmitte hin.
 * Was sichtbar und was gesperrt ist, entscheidet `PosNavigationService`.
 */
@Component({
  selector: 'lib-pos-rail',
  imports: [
    CdkMenu,
    CdkMenuItem,
    CdkMenuTrigger,
    IconComponent,
    PanaryLogoComponent,
    PosAccountPanel,
    PosTimeClock,
    TranslateModule,
  ],
  templateUrl: './pos-rail.html',
  styleUrls: ['./pos-rail.css', './pos-menu.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full' },
})
export class PosRail {
  protected readonly nav = inject(PosNavigationService)
  protected readonly staff = inject(PosStaffService)
  protected readonly monogram = monogramStyle

  /** Menüs öffnen neben dem Eintrag zur Mitte hin, oben bündig; reicht der Platz nicht, unten bündig. */
  protected readonly menuPositions = computed(() => besides(8, this.staff.railSide()))
  /** Der Avatar ist schmaler als ein Eintrag; sein Menü beginnt trotzdem erst hinter der Rail. */
  protected readonly accountMenuPositions = computed(() => besides(24, this.staff.railSide()))
}

function besides(offset: number, railSide: ScreenSide): ConnectedPosition[] {
  const toRight = railSide === 'left'
  const originX = toRight ? 'end' : 'start'
  const overlayX = toRight ? 'start' : 'end'
  const offsetX = toRight ? offset : -offset
  return [
    { originX, originY: 'top', overlayX, overlayY: 'top', offsetX },
    { originX, originY: 'bottom', overlayX, overlayY: 'bottom', offsetX },
  ]
}
