import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core'
import { DatePipe } from '@angular/common'
import { CdkMenuItem } from '@angular/cdk/menu'
import { TranslateModule } from '@ngx-translate/core'
import { IconComponent } from '@panary/shared/ui-common'
import type { WorkingTime } from '@panary/working-times/domain'
import { WorkingTimeService } from '@panary/working-times/data-access'
import { PosStaffService } from '../navigation/pos-staff.service'

/**
 * Inhalt des Avatar-Menüs: Stempelstatus, Kommen/Pause/Gehen und Abmelden (vorher Dashboard-Kopf).
 * Entsteht erst beim Öffnen des Menüs — die laufende Arbeitszeit wird deshalb nur dann geladen.
 */
@Component({
  selector: 'lib-pos-account-panel',
  imports: [CdkMenuItem, DatePipe, IconComponent, TranslateModule],
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
            @if (checkinDate(); as since) {
              {{ 'POS_NAV.SINCE' | translate: { time: (since | date: 'HH:mm') } }} · {{ duration() }}
            }
          } @else {
            {{ 'DASHBOARD.CLOCKED_OUT' | translate }}
          }
        </span>
      </div>
    </div>

    <div class="pos-menu__label">{{ 'POS_NAV.GROUP_WORKING_TIME' | translate }}</div>
    @if (!staff.isStampedIn()) {
      <button
        cdkMenuItem
        type="button"
        class="pos-menu__item"
        [cdkMenuItemDisabled]="!!staff.timeTrackingBlockedKey()"
        (cdkMenuItemTriggered)="staff.clockIn()"
      >
        <lib-icon name="sign-in" class="text-[1.375rem] text-accent-ink" />
        {{ 'DASHBOARD.CLOCK_IN' | translate }}
      </button>
    } @else {
      @if (staff.isOnBreak()) {
        <button
          cdkMenuItem
          type="button"
          class="pos-menu__item"
          [cdkMenuItemDisabled]="!!staff.timeTrackingBlockedKey()"
          (cdkMenuItemTriggered)="staff.endBreak()"
        >
          <lib-icon name="play" class="text-[1.375rem] text-accent-ink" />
          {{ 'DASHBOARD.END_BREAK' | translate }}
        </button>
      } @else {
        <button
          cdkMenuItem
          type="button"
          class="pos-menu__item"
          [cdkMenuItemDisabled]="!!staff.timeTrackingBlockedKey()"
          (cdkMenuItemTriggered)="staff.startBreak()"
        >
          <lib-icon name="coffee" class="text-[1.375rem] text-warn-ink" />
          {{ 'DASHBOARD.START_BREAK' | translate }}
        </button>
      }
      <button
        cdkMenuItem
        type="button"
        class="pos-menu__item"
        [cdkMenuItemDisabled]="!!staff.timeTrackingBlockedKey()"
        (cdkMenuItemTriggered)="staff.clockOut()"
      >
        <lib-icon name="sign-out" class="text-[1.375rem] text-danger-ink" />
        <span class="flex flex-col">
          {{ 'DASHBOARD.CLOCK_OUT' | translate }}
          <em class="text-xs font-medium not-italic text-ink-muted">{{ 'POS_NAV.CLOCK_OUT_LOGS_OUT' | translate }}</em>
        </span>
      </button>
    }
    @if (staff.timeTrackingBlockedKey(); as hint) {
      <p class="px-3 pb-1 text-xs text-ink-muted">{{ hint | translate }}</p>
    }

    <div class="my-1 h-px bg-line"></div>
    <button
      cdkMenuItem
      type="button"
      class="pos-menu__item text-danger-ink"
      [cdkMenuItemDisabled]="staff.isOffline()"
      (cdkMenuItemTriggered)="staff.logout()"
    >
      <lib-icon name="sign-out" class="text-[1.375rem]" />
      <span class="flex flex-col">
        {{ 'DASHBOARD.LOGOUT' | translate }}
        @if (staff.isOffline()) {
          <em class="text-xs font-medium not-italic text-ink-muted">{{
            'DASHBOARD.LOGOUT_OFFLINE_BLOCKED' | translate
          }}</em>
        }
      </span>
    </button>
  `,
})
export class PosAccountPanel {
  protected readonly staff = inject(PosStaffService)
  readonly #workingTimes = inject(WorkingTimeService)

  readonly #workingTime = signal<WorkingTime | undefined>(undefined)
  /** Minutentakt der Dauer-Anzeige; läuft nur, solange das Menü offen ist. */
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

    // Die Stempel-ID bewusst getrackt: Kommen/Gehen im offenen Menü lädt die Zeit neu (angular.md §2.1).
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
    try {
      this.#workingTime.set(await this.#workingTimes.get(stampingId))
    } catch {
      // Offline: Status ohne Uhrzeit.
      this.#workingTime.set(undefined)
    }
  }
}
