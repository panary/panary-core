import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { MatSelectModule } from '@angular/material/select'
import { MatTableModule } from '@angular/material/table'
import { MatTooltipModule } from '@angular/material/tooltip'
import { WorkingTime, WorkingTimeService } from '@panary-core/working-times/data-access'
import { UserService } from '@panary-core/users/data-access'
import { Router } from '@angular/router'
import { MatMenuModule } from '@angular/material/menu'

export interface DailySummary {
    date: Date
    dayName: string
    workingTime: WorkingTime|undefined
    checkIn: string
    checkOut: string
    breakDuration: number
    netDuration: number
    status: 'worked'|'off'|'active'
}

@Component({
    selector: 'app-working-time-history',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        MatSelectModule,
        MatTableModule,
        MatTooltipModule,
        MatMenuModule,
    ],
    templateUrl: './working-time-history.component.html',
    styleUrl: './working-time-history.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkingTimeHistoryComponent {
    #router=inject(Router)
    #workingTimeService=inject(WorkingTimeService)
    #userService=inject(UserService)

    // Signals
    selectedMonth=signal(new Date().getMonth())
    selectedYear=signal(new Date().getFullYear())

    // Computed state
    currentUser=computed(() => {
        const authUser=this.#userService.currentUser()
        if (authUser) return authUser

        const storedUser=localStorage.getItem('pos_current_user')
        if (storedUser) {
            try {
                const parsed=JSON.parse(storedUser)
                return this.#userService.users().find((u: any) => u._id===parsed._id)
            } catch {
                return undefined
            }
        }
        return undefined
    })

    // Date constants
    months=[
        { value: 0, label: 'Januar' },
        { value: 1, label: 'Februar' },
        { value: 2, label: 'März' },
        { value: 3, label: 'April' },
        { value: 4, label: 'Mai' },
        { value: 5, label: 'Juni' },
        { value: 6, label: 'Juli' },
        { value: 7, label: 'August' },
        { value: 8, label: 'September' },
        { value: 9, label: 'Oktober' },
        { value: 10, label: 'November' },
        { value: 11, label: 'Dezember' },
    ]

    years=Array.from({ length: 5 }, (_, i) => new Date().getFullYear()-i)

    displayedColumns=['day', 'date', 'checkin', 'checkout', 'breaks', 'netTime', 'status']

    // This will be simpler: Fetch all for user, filter purely in frontend for now (assuming reasonable dataset size)
    // or use query params. Let's use computed for filtering after loading.
    workingTimes=computed(() => {
        const user=this.currentUser()
        if (!user) return []
        // Filter logic would ideally be backed by a query, but simplistic approach for now:
        // We bind to the workingTimeService signals if available, or just fetch once.
        // The workingTimeService usually holds "all" or "current" data.
        // Let's assume we need to trigger a fetch.
        return [] // TODO: Implement fetching
    })

    // We need a writable signal for the fetched data if the service doesn't provide a filtered view
    monthlyData=signal<DailySummary[]>([])

    // Computed total net duration for the month
    totalNetDuration=computed(() => {
        return this.monthlyData().reduce((sum, day) => sum+day.netDuration, 0)
    })

    totalBreakDuration=computed(() => {
        return this.monthlyData().reduce((sum, day) => sum+day.breakDuration, 0)
    })

    constructor() {
        this.initialLoad()
    }

    async initialLoad() {
        await this.fetchData()
    }

    async fetchData() {
        const user=this.currentUser()
        if (!user) return

        const year=this.selectedYear()
        const month=this.selectedMonth()

        // Calculate start and end of month
        const start=new Date(year, month, 1)
        const end=new Date(year, month+1, 0, 23, 59, 59)

        // Ensure we have users loaded
        if (this.#userService.users().length===0) {
            await this.#userService.find({})
        }

        // Fetch working times for this period
        // Since Feathers query might vary, we can fetch larger set or specific range
        const response=await this.#workingTimeService.find({
            query: {
                userId: user._id,
                checkinDate: {
                    $gte: start.toISOString(),
                    $lte: end.toISOString()
                }
            }
        })

        const times: WorkingTime[]=Array.isArray(response)? response:response.data

        this.processData(times, year, month)
    }

    processData(times: WorkingTime[], year: number, month: number) {
        const daysInMonth=new Date(year, month+1, 0).getDate()
        const summary: DailySummary[]=[]

        for (let d=1; d<=daysInMonth; d++) {
            const date=new Date(year, month, d)
            // Find matching working time(s) - handling single shift per day primarily
            // If multiple, ideally sum them up. For simplicity, take the first or major one.
            // Or filter list.
            const dayTimes=times.filter(t => {
                const tDate=new Date(t.checkinDate)
                return tDate.getDate()===d&&tDate.getMonth()===month&&tDate.getFullYear()===year
            })

            // If multiple shifts, we might show multiple rows or aggregation.
            // Requirement: "Tabular month view".
            // Let's assume one row per day. If multiple shifts, maybe comma separate or just handle primary.
            // Let's aggregate for simplicity or just take the first.
            // Actually, standard is normally one shift.

            if (dayTimes.length===0) {
                summary.push({
                    date,
                    dayName: this.getDayName(date),
                    workingTime: undefined,
                    checkIn: '-',
                    checkOut: '-',
                    breakDuration: 0,
                    netDuration: 0,
                    status: 'off'
                })
            } else {
                // Handle potentially multiple entries?
                // Let's produce one row per entry if multiple?
                // Or one row per day.
                // Let's do one row per entry to be safe.
                dayTimes.forEach(wt => {
                    summary.push(this.createSummary(wt, date))
                })
            }
        }

        this.monthlyData.set(summary)
    }

    createSummary(wt: WorkingTime, date: Date): DailySummary {
        const checkIn=new Date(wt.checkinDate)
        const checkOut=wt.checkoutDate? new Date(wt.checkoutDate):null

        // Breaks
        let breakMs=0
        if (wt.breaks&&wt.breaks.length>0) {
            wt.breaks.forEach((b: { from: Date; to?: Date }) => {
                if (b.from&&b.to) {
                    breakMs+=new Date(b.to).getTime()-new Date(b.from).getTime()
                } else if (b.from&&!b.to) {
                    // Active break?
                    breakMs+=new Date().getTime()-new Date(b.from).getTime()
                }
            })
        }

        let netMs=0
        let status: 'worked'|'active'='worked'

        if (checkOut) {
            const totalMs=checkOut.getTime()-checkIn.getTime()
            netMs=totalMs-breakMs
        } else {
            // Active
            const totalMs=new Date().getTime()-checkIn.getTime()
            netMs=totalMs-breakMs
            status='active'
        }

        return {
            date,
            dayName: this.getDayName(date),
            workingTime: wt,
            checkIn: this.formatTime(checkIn),
            checkOut: checkOut? this.formatTime(checkOut):'...',
            breakDuration: breakMs,
            netDuration: netMs,
            status
        }
    }

    getDayName(date: Date): string {
        return date.toLocaleDateString('de-DE', { weekday: 'short' })
    }

    formatTime(date: Date): string {
        return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    }

    formatDuration(ms: number): string {
        if (ms<0) ms=0
        const h=Math.floor(ms/(1000*60*60))
        const m=Math.floor((ms/(1000*60))%60)
        return `${h}h ${m}m`
    }

    // Formatting breaks for tooltip/dropdown
    getBreakDetails(wt: WorkingTime|undefined): string {
        if (!wt||!wt.breaks||wt.breaks.length===0) return 'Keine Pausen'

        return wt.breaks.map((b: { from: Date; to?: Date }) => {
            const from=new Date(b.from).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
            const to=b.to? new Date(b.to).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }):'...'
            return `${from} - ${to}`
        }).join('\n')
    }

    goBack() {
        this.#router.navigate(['/dashboard'])
    }

    onFilterChange() {
        this.fetchData()
    }
}
