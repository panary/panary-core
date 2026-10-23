import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu'
import type { ConnectedPosition } from '@angular/cdk/overlay'
import { TranslateModule } from '@ngx-translate/core'
import { IconComponent } from '@panary/shared/ui-common'
import { PosNavigationService } from '../navigation/pos-navigation.service'
import { PosStaffService } from '../navigation/pos-staff.service'
import { PosAccountPanel } from './pos-account-panel'
import { PosTimeClock } from './pos-time-clock'

/**
 * Linke Navigationsleiste des POS (core#832, Konzept §3 und Mockup 2.7): fünf direkte Einträge,
 * „Mehr" mit Gruppen und Einstellungen-Untermenü, Verbindungsanzeige, Stempeln, Avatar-Menü und
 * Abmelden. Stempeln und Abmelden liegen seit core#907 direkt in der Rail statt im Avatar-Menü.
 * Was sichtbar und was gesperrt ist, entscheidet `PosNavigationService`.
 */
@Component({
  selector: 'lib-pos-rail',
  imports: [CdkMenu, CdkMenuItem, CdkMenuTrigger, IconComponent, PosAccountPanel, PosTimeClock, TranslateModule],
  templateUrl: './pos-rail.html',
  styleUrls: ['./pos-rail.css', './pos-menu.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full' },
})
export class PosRail {
  protected readonly nav = inject(PosNavigationService)
  protected readonly staff = inject(PosStaffService)

  /** Menüs öffnen rechts neben dem Eintrag, oben bündig; reicht der Platz nicht, unten bündig. */
  protected readonly menuPositions = besides(8)
  /** Der Avatar ist schmaler als ein Eintrag; sein Menü beginnt trotzdem erst hinter der Rail. */
  protected readonly accountMenuPositions = besides(24)

  /**
   * Mit der Maus öffnet das Überfahren das Untermenü schon, und der Klick danach schaltete es
   * wieder zu (CDK `toggle()`). Ein Klick soll immer öffnen; nach dem Umschalten der CDK wird
   * deshalb nachgezogen — am Touchgerät öffnet der Klick selbst, das Nachziehen ist dann leer.
   */
  protected keepOpen(trigger: CdkMenuTrigger): void {
    queueMicrotask(() => trigger.open())
  }
}

function besides(offsetX: number): ConnectedPosition[] {
  return [
    { originX: 'end', originY: 'top', overlayX: 'start', overlayY: 'top', offsetX },
    { originX: 'end', originY: 'bottom', overlayX: 'start', overlayY: 'bottom', offsetX },
  ]
}
