import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core'
import { DatePipe } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { WorkingTime } from '@panary/working-times/domain'
import { WorkingTimeService } from '@panary/working-times/data-access'
import { UserService } from '@panary/users/data-access'
import { TranslateModule, TranslateService } from '@ngx-translate/core'
import { IconComponent, PageHeaderComponent } from '@panary/shared/ui-common'
import { formatHoursMinutes, formatTotal, monthTotals, newestFirst } from './working-time-summary'

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
  imports: [IconComponent, PageHeaderComponent, DatePipe, FormsModule, TranslateModule],
  templateUrl: './working-time-history.component.html',
  styleUrl: './working-time-history.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkingTimeHistoryComponent {
  #workingTimeService = inject(WorkingTimeService)
  #userService = inject(UserService)
  #translate = inject(TranslateService)

  // Signals
  selectedMonth = signal(new Date().getMonth())
  selectedYear = signal(new Date().getFullYear())
  expandedBreakRow = signal<DailySummary | null>(null)
  showOffDays = signal(false)

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

  userName = computed(() => {
    const user = this.currentUser()
    return user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() : ''
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

  monthlyData = signal<DailySummary[]>([])

  /** Neueste Tage zuerst; freie Tage nur auf Wunsch. */
  filteredData = computed(() => {
    const data = this.monthlyData()
    return newestFirst(this.showOffDays() ? data : data.filter(d => d.status !== 'off'))
  })

  /** Der Monat ohne einen einzigen Eintrag (freie Tage gibt es immer, zählen aber nicht). */
  monthIsEmpty = computed(() => this.monthlyData().length > 0 && this.monthlyData().every(d => d.status === 'off'))

  totals = computed(() => monthTotals(this.monthlyData(), new Date()))
  totalNetLabel = computed(() => formatTotal(this.totals().netMs))
  totalBreakLabel = computed(() => formatTotal(this.totals().breakMs))

  /** Weiter als der laufende Monat gibt es nichts zu sehen. */
  isCurrentMonth = computed(() => {
    const now = new Date()
    return this.selectedYear() === now.getFullYear() && this.selectedMonth() === now.getMonth()
  })

  constructor() {
    // Erst laden, wenn der Benutzer da ist: Nach einem Reload steht `currentUser()` im Konstruktor noch
    // leer, und ein einmaliger Aufruf dort holte nie nach (core#1000). Nur die Benutzer-ID löst aus;
    // der Abruf selbst läuft untracked, sonst hängt er an den Monats-Signalen.
    const userId = computed(() => this.currentUser()?._id)
    effect(() => {
      if (userId()) untracked(() => void this.fetchData())
    })
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
    this.expandedBreakRow.update(current => (current === row ? null : row))
  }
  //#endregion

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
        // Aufsteigend, weil `newestFirst` mehrere Einträge eines Tages danach ordnet (später zuerst).
        $sort: { checkinDate: 1 },
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
      wt.breaks.forEach(b => {
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
    return formatHoursMinutes(ms)
  }

  getBreakDetails(wt: WorkingTime | undefined): string {
    if (!wt || !wt.breaks || wt.breaks.length === 0) return this.#translate.instant('WORKING_TIMES.NO_BREAKS')

    return wt.breaks
      .map(b => {
        const from = new Date(b.from).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
        const to = b.to ? new Date(b.to).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '...'
        return `${from} - ${to}`
      })
      .join('\n')
  }

  onFilterChange() {
    this.expandedBreakRow.set(null)
    this.fetchData()
  }
}
