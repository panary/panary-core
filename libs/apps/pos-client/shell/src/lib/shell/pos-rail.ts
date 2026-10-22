import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu'
import type { ConnectedPosition } from '@angular/cdk/overlay'
import { TranslateModule } from '@ngx-translate/core'
import { IconComponent } from '@panary/shared/ui-common'
import { PosNavigationService } from '../navigation/pos-navigation.service'
import { PosStaffService } from '../navigation/pos-staff.service'
import { PosAccountPanel } from './pos-account-panel'

/**
 * Linke Navigationsleiste des POS (core#832, Konzept §3 und Mockup 2.7): fünf direkte Einträge,
 * „Mehr" mit Gruppen und Einstellungen-Untermenü, Verbindungsanzeige und Avatar-Menü.
 * Was sichtbar und was gesperrt ist, entscheidet `PosNavigationService`.
 */
@Component({
  selector: 'lib-pos-rail',
  imports: [CdkMenu, CdkMenuItem, CdkMenuTrigger, IconComponent, PosAccountPanel, TranslateModule],
  templateUrl: './pos-rail.html',
  styleUrls: ['./pos-rail.css', './pos-menu.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full' },
})
export class PosRail {
  protected readonly nav = inject(PosNavigationService)
  protected readonly staff = inject(PosStaffService)

  /** Menüs öffnen rechts neben der Rail, oben bündig; reicht der Platz nicht, unten bündig. */
  protected readonly menuPositions: ConnectedPosition[] = [
    { originX: 'end', originY: 'top', overlayX: 'start', overlayY: 'top', offsetX: 8 },
    { originX: 'end', originY: 'bottom', overlayX: 'start', overlayY: 'bottom', offsetX: 8 },
  ]
}
