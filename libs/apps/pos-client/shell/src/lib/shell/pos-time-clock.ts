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
import { TranslateModule } from '@ngx-translate/core'
import { IconComponent, type IconName } from '@panary/shared/ui-common'
import type { WorkingTime } from '@panary/working-times/domain'
import { WorkingTimeService } from '@panary/working-times/data-access'
import { type TimeClockAction, timeClockActions } from '../navigation/pos-navigation'
import { PosStaffService } from '../navigation/pos-staff.service'

interface TimeClockButton {
  readonly action: TimeClockAction
  readonly icon: IconName
  /** Kurzer Rail-Text. */
  readonly label: string
  /** Voller Text für Tooltip und Screenreader. */
  readonly title: string
  readonly tone: 'accent' | 'warn' | 'danger'
}

const BUTTONS: Record<TimeClockAction, TimeClockButton> = {
  'clock-in': {
    action: 'clock-in',
    icon: 'sign-in',
    label: 'POS_NAV.CLOCK_IN',
    title: 'DASHBOARD.CLOCK_IN',
    tone: 'accent',
  },
  'start-break': {
    action: 'start-break',
    icon: 'coffee',
    label: 'POS_NAV.BREAK_START',
    title: 'DASHBOARD.START_BREAK',
    tone: 'warn',
  },
  'end-break': {
    action: 'end-break',
    icon: 'play',
    label: 'POS_NAV.BREAK_END',
    title: 'DASHBOARD.END_BREAK',
    tone: 'accent',
  },
  'clock-out': {
    action: 'clock-out',
    icon: 'sign-out',
    label: 'POS_NAV.CLOCK_OUT',
    title: 'POS_NAV.CLOCK_OUT_TITLE',
    tone: 'danger',
  },
}

/**
 * Stempeln direkt in der Rail (core#907): Status mit Uhrzeit und Kommen/Pause/Gehen mit einem Tipp.
 * Bis dahin lag das im Avatar-Menü (core#832). Gesperrt (offline, Mandantensperre) bleiben die Tasten
 * antippbar und melden den Grund — wie die übrigen Rail-Einträge. Wer gestempelt wird, entscheidet
 * `PosStaffService.currentUser()` aus der Bediener-Sitzung (core#902).
 */
@Component({
  selector: 'lib-pos-time-clock',
  imports: [DatePipe, IconComponent, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './pos-rail.css',
  host: { class: 'flex flex-col items-center gap-1.5' },
  template: `
    <span
      class="max-w-[4.25rem] truncate text-center text-xs font-semibold tabular-nums"
      [class.text-accent-ink]="staff.isStampedIn() && !staff.isOnBreak()"
      [class.text-warn-ink]="staff.isOnBreak()"
      [class.text-ink-muted]="!staff.isStampedIn()"
      [title]="checkinDate() ? (checkinDate() | date: 'HH:mm') + ' · ' + duration() : ''"
      role="status"
    >
      @if (staff.isOnBreak()) {
        {{ 'DASHBOARD.BREAK' | translate }}
      } @else if (staff.isStampedIn()) {
        @if (checkinDate(); as since) {
          {{ since | date: 'HH:mm' }}
        } @else {
          {{ 'POS_NAV.CLOCKED_IN_SHORT' | translate }}
        }
      } @else {
        {{ 'POS_NAV.CLOCKED_OUT_SHORT' | translate }}
      }
    </span>

    @for (button of buttons(); track button.action) {
      <button
        type="button"
        class="rail-item rail-item--compact"
        [attr.data-tone]="button.tone"
        [class.is-blocked]="!!staff.timeTrackingBlockedKey()"
        [disabled]="locked() || staff.timeClockBusy()"
        [attr.aria-disabled]="staff.timeTrackingBlockedKey() ? true : null"
        [attr.aria-label]="button.title | translate"
        [title]="staff.timeTrackingBlockedKey() ?? button.title | translate"
        (click)="staff.timeClock(button.action)"
      >
        <lib-icon [name]="button.icon" class="text-[1.375rem]" />
        <span>{{ button.label | translate }}</span>
      </button>
    }
  `,
})
export class PosTimeClock {
  protected readonly staff = inject(PosStaffService)
  readonly #workingTimes = inject(WorkingTimeService)

  /** Rail gesperrt (offenes Sheet in der Kasse). */
  readonly locked = input(false)

  protected readonly buttons = computed(() =>
    timeClockActions(this.staff.isStampedIn(), this.staff.isOnBreak()).map(action => BUTTONS[action]),
  )

  readonly #workingTime = signal<WorkingTime | undefined>(undefined)
  /** Minutentakt der Dauer im Tooltip. */
  readonly #now = signal(Date.now())

  protected readonly checkinDate = computed(() => this.#workingTime()?.checkinDate)

  /** Dauer seit Kommen für den Tooltip — die Rail selbst zeigt nur die Uhrzeit. */
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
