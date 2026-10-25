import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core'
import { DatePipe } from '@angular/common'
import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu'
import type { ConnectedPosition } from '@angular/cdk/overlay'
import { MatTooltip } from '@angular/material/tooltip'
import { TranslateModule } from '@ngx-translate/core'
import { IconComponent, type IconName } from '@panary/shared/ui-common'
import type { WorkingTime } from '@panary/working-times/domain'
import { WorkingTimeService } from '@panary/working-times/data-access'
import { type ScreenSide, type TimeClockState, timeClockTapAction } from '../navigation/pos-navigation'
import { PosStaffService } from '../navigation/pos-staff.service'

const STATE_ICONS: Record<TimeClockState, IconName> = { out: 'clock', in: 'clock', break: 'coffee' }
const STATE_LABELS: Record<TimeClockState, string> = {
  out: 'POS_NAV.CLOCK_STATE_OUT',
  in: 'POS_NAV.CLOCK_STATE_IN',
  break: 'POS_NAV.CLOCK_STATE_BREAK',
}

/**
 * Eine Stempeltaste in der Rail (core#942, vorher drei Tasten aus core#907): grau = ausgestempelt,
 * ein Tipp stempelt ein; mint = eingestempelt, ein Tipp öffnet Pause und Gehen; amber = Pause, ein Tipp
 * beendet sie. Gesperrt (offline, Mandantensperre) bleibt die Taste antippbar und nennt den Grund.
 * Wer gestempelt wird, entscheidet `PosStaffService.currentUser()` aus der Bediener-Sitzung (core#902).
 */
@Component({
  selector: 'lib-pos-time-clock',
  imports: [CdkMenu, CdkMenuItem, CdkMenuTrigger, DatePipe, IconComponent, MatTooltip, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./pos-rail.css', './pos-menu.css'],
  host: { class: 'contents' },
  template: `
    <button
      type="button"
      class="rail-item rail-item--compact rail-clock"
      [attr.data-state]="staff.timeClockState()"
      [class.is-blocked]="!!blockedKey()"
      [disabled]="locked() || staff.timeClockBusy()"
      [attr.aria-disabled]="blockedKey() ? true : null"
      [attr.aria-label]="labelKey() | translate"
      [matTooltip]="blockedKey() ?? labelKey() | translate"
      [matTooltipPosition]="railSide() === 'left' ? 'right' : 'left'"
      [cdkMenuTriggerFor]="opensMenu() ? clockMenu : null"
      [cdkMenuPosition]="menuPositions()"
      (click)="tap()"
    >
      <lib-icon [name]="icon()" class="text-[1.5rem]" />
    </button>

    <ng-template #clockMenu>
      <div cdkMenu class="pos-menu w-[18.75rem]">
        <div class="px-3 py-2.5">
          <b class="block text-[1.0625rem]">{{ 'DASHBOARD.CLOCKED_IN' | translate }}</b>
          @if (checkinDate(); as since) {
            <span class="text-sm text-ink-muted"
              >{{ 'POS_NAV.SINCE' | translate: { time: (since | date: 'HH:mm') } }} · {{ duration() }}</span
            >
          }
        </div>
        <button
          cdkMenuItem
          type="button"
          class="pos-menu__item"
          (cdkMenuItemTriggered)="staff.timeClock('start-break')"
        >
          <lib-icon name="coffee" class="text-[1.375rem] text-warn-ink" />
          {{ 'DASHBOARD.START_BREAK' | translate }}
        </button>
        <button cdkMenuItem type="button" class="pos-menu__item" (cdkMenuItemTriggered)="staff.timeClock('clock-out')">
          <lib-icon name="sign-out" class="text-[1.375rem] text-danger-ink" />
          <span class="flex flex-col">
            {{ 'DASHBOARD.CLOCK_OUT' | translate }}
            <em class="text-xs font-medium not-italic text-ink-muted">{{
              'POS_NAV.CLOCK_OUT_LOGS_OUT' | translate
            }}</em>
          </span>
        </button>
      </div>
    </ng-template>
  `,
})
export class PosTimeClock {
  protected readonly staff = inject(PosStaffService)
  readonly #workingTimes = inject(WorkingTimeService)

  /** Rail gesperrt (offenes Sheet in der Kasse). */
  readonly locked = input(false)
  /** Seite der Rail; Hinweis und Menü öffnen zur Bildschirmmitte hin (core#968). */
  readonly railSide = input<ScreenSide>('left')
  /** Das Menü öffnet zur Bildschirmmitte hin — die Rail kann links oder rechts sitzen. */
  readonly menuPositions = input<ConnectedPosition[]>([])

  protected readonly blockedKey = this.staff.timeTrackingBlockedKey
  protected readonly icon = computed(() => STATE_ICONS[this.staff.timeClockState()])
  protected readonly labelKey = computed(() => STATE_LABELS[this.staff.timeClockState()])
  /** Gesperrt öffnet die Taste kein Menü, sondern nennt den Grund (wie die übrigen Rail-Einträge). */
  protected readonly opensMenu = computed(() => this.staff.timeClockState() === 'in' && !this.blockedKey())

  readonly #workingTime = signal<WorkingTime | undefined>(undefined)
  /** Minutentakt der Dauer im Menü und im Tooltip. */
  readonly #now = signal(Date.now())

  protected readonly checkinDate = computed(() => this.#workingTime()?.checkinDate)

  protected readonly duration = computed(() => {
    const since = this.checkinDate()
    if (!since) return ''
    const minutes = Math.max(0, Math.floor((this.#now() - new Date(since).getTime()) / 60_000))
    return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
  })

  constructor() {
    const timer = setInterval(() => this.#now.set(Date.now()), 60_000)
    inject(DestroyRef).onDestroy(() => clearInterval(timer))

    // Die Stempel-ID bewusst getrackt: Kommen/Gehen lädt die Zeit neu (angular.md §2.1).
    effect(() => {
      const stampingId = this.staff.currentUser()?.stampingId
      untracked(() => void this.#loadWorkingTime(stampingId))
    })
  }

  /** Eingestempelt öffnet der Trigger das Menü; gesperrt nennt die Taste nur den Grund. */
  protected tap(): void {
    const action = timeClockTapAction(this.staff.timeClockState())
    if (action) void this.staff.timeClock(action)
    else this.staff.notifyTimeTrackingBlocked()
  }

  async #loadWorkingTime(stampingId: string | null | undefined): Promise<void> {
    if (!stampingId) {
      this.#workingTime.set(undefined)
      return
    }
    let workingTime: WorkingTime | undefined
    try {
      workingTime = await this.#workingTimes.get(stampingId)
    } catch {
      // Offline: Status ohne Uhrzeit.
    }
    // Gehen und gleich wieder Kommen: Die späte Antwort der alten Stempelung überschreibt die neue nicht.
    if (this.staff.currentUser()?.stampingId === stampingId) this.#workingTime.set(workingTime)
  }
}
