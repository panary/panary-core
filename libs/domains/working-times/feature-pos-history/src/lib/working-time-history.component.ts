import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { DatePipe } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { WorkingTime } from '@panary/working-times/domain'
import { WorkingTimeService } from '@panary/working-times/data-access'
import { UserService } from '@panary/users/data-access'
import { Router } from '@angular/router'
import { TranslateModule, TranslateService } from '@ngx-translate/core'

export interface DailySummary {
  date: Date
  dayName: string
  workingTime: WorkingTime | undefined
  checkIn: string
  checkOut: string
  breakDuration: number
  netDuration: number
  status: 'worked' | 'off' | 'active'
}

@Component({
  selector: 'lib-working-time-history',
  standalone: true,
  imports: [DatePipe, FormsModule, TranslateModule],
  templateUrl: './working-time-history.component.html',
  styleUrl: './working-time-history.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkingTimeHistoryComponent {
  #router = inject(Router)
  #workingTimeService = inject(WorkingTimeService)
  #userService = inject(UserService)
  #translate = inject(TranslateService)

  // Signals
  selectedMonth = signal(new Date().getMonth())
  selectedYear = signal(new Date().getFullYear())
  expandedBreakRow = signal<DailySummary | null>(null)
  hideOffDays = signal(true)

  // Computed: aktueller Monatsname
  currentMonthLabel = computed(() => {
    const m = this.months()
    return m[this.selectedMonth()]?.label ?? ''
  })

  currentUser = computed(() => {
    const authUser = this.#userService.currentUser()
    if (authUser) return authUser

    const storedUser = localStorage.getItem('pos_current_user')
    if (storedUser) {
      try {
        const parsed = JSON.parse(storedUser)
        return this.#userService.users().find((u: any) => u._id === parsed._id)
      } catch {
        return undefined
      }
    }
    return undefined
  })

  months = computed(() => [
    { value: 0, label: this.#translate.instant('MONTHS.JANUARY') },
    { value: 1, label: this.#translate.instant('MONTHS.FEBRUARY') },
    { value: 2, label: this.#translate.instant('MONTHS.MARCH') },
    { value: 3, label: this.#translate.instant('MONTHS.APRIL') },
    { value: 4, label: this.#translate.instant('MONTHS.MAY') },
    { value: 5, label: this.#translate.instant('MONTHS.JUNE') },
    { value: 6, label: this.#translate.instant('MONTHS.JULY') },
    { value: 7, label: this.#translate.instant('MONTHS.AUGUST') },
    { value: 8, label: this.#translate.instant('MONTHS.SEPTEMBER') },
    { value: 9, label: this.#translate.instant('MONTHS.OCTOBER') },
    { value: 10, label: this.#translate.instant('MONTHS.NOVEMBER') },
    { value: 11, label: this.#translate.instant('MONTHS.DECEMBER') },
  ])

  years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i)

  monthlyData = signal<DailySummary[]>([])

  /** Gefilterte Daten: blendet freie Tage aus wenn Checkbox aktiv */
  filteredData = computed(() => {
    const data = this.monthlyData()
    return this.hideOffDays() ? data.filter(d => d.status !== 'off') : data
  })

  totalNetDuration = computed(() => this.monthlyData().reduce((sum, day) => sum + day.netDuration, 0))
  totalBreakDuration = computed(() => this.monthlyData().reduce((sum, day) => sum + day.breakDuration, 0))

  constructor() {
    this.initialLoad()
  }

  //#region Monats-Navigation
  prevMonth(): void {
    const month = this.selectedMonth()
    if (month === 0) {
      // Dezember des Vorjahres
      this.selectedMonth.set(11)
      this.selectedYear.update(y => y - 1)
    } else {
      this.selectedMonth.set(month - 1)
    }
    this.onFilterChange()
  }

  nextMonth(): void {
    const month = this.selectedMonth()
    if (month === 11) {
      // Januar des nächsten Jahres
      this.selectedMonth.set(0)
      this.selectedYear.update(y => y + 1)
    } else {
      this.selectedMonth.set(month + 1)
    }
    this.onFilterChange()
  }
  //#endregion

  //#region Pausen-Details Toggle
  toggleBreakDetails(row: DailySummary): void {
    this.expandedBreakRow.update(current => current === row ? null : row)
  }
  //#endregion

  async initialLoad() {
    await this.fetchData()
  }

  async fetchData() {
    const user = this.currentUser()
    if (!user) return

    const year = this.selectedYear()
    const month = this.selectedMonth()

    const start = new Date(year, month, 1)
    const end = new Date(year, month + 1, 0, 23, 59, 59)

    if (this.#userService.users().length === 0) {
      await this.#userService.find({})
    }

    const response = await this.#workingTimeService.find({
      query: {
        userId: user._id,
        checkinDate: {
          $gte: start.toISOString(),
          $lte: end.toISOString(),
        },
      },
    })

    const times: WorkingTime[] = Array.isArray(response) ? response : response.data
    this.processData(times, year, month)
  }

  processData(times: WorkingTime[], year: number, month: number) {
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const summary: DailySummary[] = []

    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d)
      const dayTimes = times.filter(t => {
        const tDate = new Date(t.checkinDate)
        return tDate.getDate() === d && tDate.getMonth() === month && tDate.getFullYear() === year
      })

      if (dayTimes.length === 0) {
        summary.push({
          date,
          dayName: this.getDayName(date),
          workingTime: undefined,
          checkIn: '-',
          checkOut: '-',
          breakDuration: 0,
          netDuration: 0,
          status: 'off',
        })
      } else {
        dayTimes.forEach(wt => {
          summary.push(this.createSummary(wt, date))
        })
      }
    }

    this.monthlyData.set(summary)
  }

  createSummary(wt: WorkingTime, date: Date): DailySummary {
    const checkIn = new Date(wt.checkinDate)
    const checkOut = wt.checkoutDate ? new Date(wt.checkoutDate) : null

    let breakMs = 0
    if (wt.breaks && wt.breaks.length > 0) {
      wt.breaks.forEach((b) => {
        if (b.from && b.to) {
          breakMs += new Date(b.to).getTime() - new Date(b.from).getTime()
        } else if (b.from && !b.to) {
          breakMs += new Date().getTime() - new Date(b.from).getTime()
        }
      })
    }

    let netMs = 0
    let status: 'worked' | 'active' = 'worked'

    if (checkOut) {
      const totalMs = checkOut.getTime() - checkIn.getTime()
      netMs = totalMs - breakMs
    } else {
      const totalMs = new Date().getTime() - checkIn.getTime()
      netMs = totalMs - breakMs
      status = 'active'
    }

    return {
      date,
      dayName: this.getDayName(date),
      workingTime: wt,
      checkIn: this.formatTime(checkIn),
      checkOut: checkOut ? this.formatTime(checkOut) : '...',
      breakDuration: breakMs,
      netDuration: netMs,
      status,
    }
  }

  getDayName(date: Date): string {
    return date.toLocaleDateString('de-DE', { weekday: 'short' })
  }

  formatTime(date: Date): string {
    return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  }

  formatDuration(ms: number): string {
    if (ms < 0) ms = 0
    const h = Math.floor(ms / (1000 * 60 * 60))
    const m = Math.floor((ms / (1000 * 60)) % 60)
    return `${h}h ${m}m`
  }

  getBreakDetails(wt: WorkingTime | undefined): string {
    if (!wt || !wt.breaks || wt.breaks.length === 0) return this.#translate.instant('WORKING_TIMES.NO_BREAKS')

    return wt.breaks
      .map((b) => {
        const from = new Date(b.from).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
        const to = b.to
          ? new Date(b.to).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
          : '...'
        return `${from} - ${to}`
      })
      .join('\n')
  }

  goBack() {
    this.#router.navigate(['/dashboard'])
  }

  onFilterChange() {
    this.expandedBreakRow.set(null)
    this.fetchData()
  }
}
