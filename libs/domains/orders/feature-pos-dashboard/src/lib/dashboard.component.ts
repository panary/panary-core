import { ChangeDetectorRef, Component, computed, effect, inject, OnInit, signal, Signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { Router } from '@angular/router'
import { NGX_ECHARTS_CONFIG, NgxEchartsModule } from 'ngx-echarts'
import type { EChartsOption } from 'echarts'
import { ConnectionService } from '@panary/shared/data-access'
import { Order, OrderService, OrderStatus } from '@panary/orders/data-access'
import { UserService } from '@panary/users/data-access'
import { UserSystemRole } from '@panary/users/domain'
import { AuthService } from '@panary/auth/data-access'
import { WorkingTime } from '@panary/working-times/domain'
import { WorkingTimeService } from '@panary/working-times/data-access'
import { LocationService } from '@panary/locations/data-access'
import { BusinessDayService } from '@panary/businessdays/data-access'
import { MatDialog, MatDialogModule } from '@angular/material/dialog'
import { OrderDialogComponent } from '@panary/orders/feature-pos-order-dialog'
import {
  ClosingDialogComponent,
  OpeningDialogComponent,
} from '@panary/businessdays/feature-pos-closing-dialog'
import { BusinessDayOperationMode } from '@panary/businessdays/domain'
import { PosWriteOffDialogComponent } from '@panary/write-offs/feature-pos-dialog'
import { TranslateModule, TranslateService } from '@ngx-translate/core'
import { PreOrder, PreOrderService } from '@panary/pre-orders/data-access'

interface QuickAction {
  label: string
  icon: string
  action: () => void
  bgClass: string
  textClass: string
  allowedRoles?: UserSystemRole[]
  hideInStandalone?: boolean
  /**
   * Versteckt den Button, sobald die Edge mit der Cloud gepairt ist
   * (cloudPairingStatus === 'connected'). Wird fuer BusinessDay-Lifecycle-
   * Buttons benoetigt: im Hybrid-Modell ist die Cloud Master, Eroeffnung +
   * Tagesabschluss laufen im Cloud-Admin-Dashboard, NICHT am POS.
   */
  hideWhenCloudPaired?: boolean
  /**
   * Optionaler Sichtbarkeits-Filter, der zur Render-Zeit ausgewertet wird.
   * Im Gegensatz zu `allowedRoles` (statisch beim Login) kann `condition`
   * auf reaktive Signals zugreifen (z.B. ob ein Geschäftstag offen ist).
   * Default: immer sichtbar.
   */
  condition?: () => boolean
}

@Component({
  selector: 'lib-dashboard',
  standalone: true,
  imports: [CommonModule, MatDialogModule, NgxEchartsModule, TranslateModule],
  providers: [
    { provide: NGX_ECHARTS_CONFIG, useValue: { echarts: () => import('echarts') } },
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
  // Services
  #router = inject(Router)
  #orderService = inject(OrderService)
  #userService = inject(UserService)
  #authService = inject(AuthService)
  #workingTimeService = inject(WorkingTimeService)
  #locationService = inject(LocationService)
  #connectionService = inject(ConnectionService)
  #businessDayService = inject(BusinessDayService)
  #cdr = inject(ChangeDetectorRef)
  #dialog = inject(MatDialog)
  #translate = inject(TranslateService)
  #preOrderService = inject(PreOrderService)

  // Vorbestellungen für heute
  todayPreOrders = signal<PreOrder[]>([])

  isStandaloneMode = computed(() => this.#connectionService.systemMode() === 'standalone')
  /**
   * True wenn die Edge aktiv mit der Cloud gepairt ist. Verwendet von
   * `visibleQuickActions`, um BusinessDay-Lifecycle-Buttons im Hybrid-Modell
   * auszublenden — der Lifecycle wird ausschliesslich im Cloud-Admin geregelt.
   */
  isCloudPaired = computed(() => this.#connectionService.cloudPairingStatus() === 'connected')

  /**
   * Indikator, ob die aktive Location einen offenen Geschaeftstag hat.
   * Quelle: `location.currentBusinessDay.businessDayId` — wird beim
   * Edge-Sync mit der Cloud konsistent gehalten. Kein zusaetzlicher
   * Service-Call noetig.
   */
  hasOpenBusinessDay = computed(() => {
    const loc = this.#locationService.activeLocation() as
      | { currentBusinessDay?: { businessDayId?: string } }
      | undefined
    return !!loc?.currentBusinessDay?.businessDayId
  })

  // Signals
  currentUser = computed(() => {
    const authUser = this.#userService.currentUser()
    if (authUser) return authUser

    const storedUser = localStorage.getItem('pos_current_user')
    if (storedUser) {
      try {
        const parsed = JSON.parse(storedUser)
        return this.#userService.users().find(u => u._id === parsed._id)
      } catch {
        return undefined
      }
    }
    return undefined
  })
  orders: Signal<Order[]> = this.#orderService.orders

  // State
  chartOptions: EChartsOption = {}
  currentWorkingTime: WorkingTime | undefined
  formattedWorkingTime = '-'
  statusMenuOpen = false

  // KPIs
  productivity = '0' // Orders/Hour
  avgWaitingTime = '0 min'

  // Configuration
  quickActions: QuickAction[] = [
    {
      label: 'DASHBOARD.NEW_ORDER',
      icon: 'add_shopping_cart',
      action: () => {
        this.#dialog.open(OrderDialogComponent, {
          width: '98vw',
          height: '95vh',
          maxWidth: '100vw',
          maxHeight: '100vh',
          panelClass: 'order-dialog-panel',
          disableClose: true,
        })
      },
      bgClass: 'bg-emerald-100 dark:bg-emerald-900/30',
      textClass: 'text-emerald-700 dark:text-emerald-400',
    },
    {
      label: 'DASHBOARD.OPEN_ORDERS',
      icon: 'receipt',
      action: () => this.navigateTo('/orders/active'),
      bgClass: 'bg-blue-100 dark:bg-blue-900/30',
      textClass: 'text-blue-700 dark:text-blue-400',
    },
    {
      label: 'DASHBOARD.PRE_ORDERS',
      icon: 'event_note',
      action: () => this.navigateTo('/pre-orders'),
      bgClass: 'bg-amber-100 dark:bg-amber-900/30',
      textClass: 'text-amber-700 dark:text-amber-400',
    },
    {
      label: 'DASHBOARD.HISTORY',
      icon: 'history',
      action: () => this.navigateTo('/orders/history'),
      bgClass: 'bg-purple-100 dark:bg-purple-900/30',
      textClass: 'text-purple-700 dark:text-purple-400',
    },
    {
      label: 'DASHBOARD.WORKING_TIMES',
      icon: 'schedule',
      action: () => this.navigateTo('/working-times'),
      bgClass: 'bg-orange-100 dark:bg-orange-900/30',
      textClass: 'text-orange-700 dark:text-orange-400',
    },
    {
      label: 'DASHBOARD.WRITE_OFF',
      icon: 'delete_outline',
      action: () => {
        this.#dialog.open(PosWriteOffDialogComponent, {
          width: '98vw',
          maxWidth: '98vw',
          height: '95vh',
          maxHeight: '95vh',
          panelClass: 'fullscreen-dialog',
        })
      },
      bgClass: 'bg-red-50 dark:bg-red-900/30',
      textClass: 'text-red-500 dark:text-red-400',
      hideInStandalone: true,
    },
    // Tageseroeffnung — nur sichtbar wenn kein Geschaeftstag offen ist.
    // `hideWhenCloudPaired`: im Hybrid-Modell ist die Cloud Master fuer
    // BusinessDay-Lifecycle — Eroeffnung laeuft im Cloud-Admin-Dashboard.
    {
      label: 'DASHBOARD.OPEN_BUSINESS_DAY',
      icon: 'play_circle',
      action: () => this.startOpening(),
      bgClass: 'bg-teal-100 dark:bg-teal-900/30',
      textClass: 'text-teal-700 dark:text-teal-400',
      condition: () => !this.hasOpenBusinessDay(),
      hideInStandalone: true,
      hideWhenCloudPaired: true,
    },
    // Tagesabschluss — nur sichtbar wenn Geschaeftstag offen ist.
    // `hideWhenCloudPaired`: gleich wie Open — Cloud-Admin uebernimmt im
    // Hybrid-Modell den Closing-Workflow.
    {
      label: 'DASHBOARD.CLOSE_BUSINESS_DAY',
      icon: 'verified',
      action: () => this.startClosing(),
      bgClass: 'bg-indigo-100 dark:bg-indigo-900/30',
      textClass: 'text-indigo-700 dark:text-indigo-400',
      condition: () => this.hasOpenBusinessDay(),
      hideInStandalone: true,
      hideWhenCloudPaired: true,
    },
    {
      label: 'DASHBOARD.SETTINGS',
      icon: 'settings',
      action: () => this.navigateTo('/settings'),
      bgClass: 'bg-gray-100 dark:bg-gray-800',
      textClass: 'text-gray-700 dark:text-gray-300',
    },
  ]

  visibleQuickActions = computed(() => {
    const user = this.currentUser()
    const userRole = user?.role || UserSystemRole.TENANT_STAFF

    return this.quickActions.filter(action => {
      if (action.hideInStandalone && this.isStandaloneMode()) return false
      if (action.hideWhenCloudPaired && this.isCloudPaired()) return false
      if (action.condition && !action.condition()) return false
      if (!action.allowedRoles) return true
      return action.allowedRoles.includes(userRole)
    })
  })

  constructor() {
    // React to Order Changes
    effect(() => {
      this.buildOccupancyChartData()
      this.updateKPIs()
    })

    // React to User Changes
    effect(() => {
      this.handleUserWorkingTime()
    })
  }

  ngOnInit(): void {
    // Update working time display every minute
    setInterval(() => {
      this.calculateDuration()
    }, 60000)

    this.fetchTodayPreOrders()
    this.#listenPreOrderEvents()
  }

  /** Lauscht auf Realtime-Events des Pre-Order-Service und aktualisiert die KPI */
  #listenPreOrderEvents(): void {
    const svc = (this.#preOrderService as any).service
    if (!svc || typeof svc.on !== 'function') return

    const reload = () => this.fetchTodayPreOrders()
    svc.on('created', reload)
    svc.on('patched', reload)
    svc.on('removed', reload)
  }

  async fetchTodayPreOrders(): Promise<void> {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date()
    end.setHours(23, 59, 59, 999)

    try {
      const result = await this.#preOrderService.find({
        query: {
          scheduledFor: { $gte: start.toISOString(), $lte: end.toISOString() },
          status: 'pending',
          $sort: { scheduledFor: 1 },
          $limit: 50,
        },
      })
      const orders: PreOrder[] = Array.isArray(result) ? result : (result as any).data
      this.todayPreOrders.set(orders)
    } catch {
      this.todayPreOrders.set([])
    }
  }

  // --- Getters ---

  get userName(): string {
    const authName = this.#authService.fullName()
    if (authName && authName !== 'Unknown User') {
      return authName
    }

    // Fallback for POS: Check localStorage
    const storedUser = localStorage.getItem('pos_current_user')
    if (storedUser) {
      try {
        const user = JSON.parse(storedUser)
        return `${user.firstName} ${user.lastName}`
      } catch {
        return this.#translate.instant('DASHBOARD.EMPLOYEE')
      }
    }

    return this.#translate.instant('DASHBOARD.EMPLOYEE')
  }

  get isStampedIn(): boolean {
    return !!this.currentUser()?.stampingId
  }

  get activeOrdersCount(): number {
    return this.orders().filter(
      o => o.status !== OrderStatus.COMPLETED && o.status !== OrderStatus.ABORTED && o.status !== OrderStatus.UNCLAIMED,
    ).length
  }

  get todayOrdersCount(): number {
    return this.orders().length
  }

  // --- Actions ---

  navigateTo(path: string) {
    this.#router.navigate([path])
  }

  logout() {
    localStorage.removeItem('pos_current_user')
    this.#authService.logout()
  }

  // --- Time Tracking Actions ---

  get isOnBreak(): boolean {
    return !!this.currentUser()?.startBreakAt
  }

  async clockIn() {
    const user = this.currentUser()
    if (!user) return

    try {
      await this.#userService.checkin(user._id)
      // Reload is likely handled by signal update or we might need to manually refresh if not optimistic
      // But userService handles the call. We might need to refresh the local user state?
      // The currentUser is computed from userService.users().
      // If userService.checkin updates the user in the store, it's fine.
      // Assuming userService updates the BehaviorSubject/Signal internally.
    } catch (error) {
      console.error('Clock in failed:', error)
    }
  }

  async clockOut() {
    const user = this.currentUser()
    if (!user?.stampingId) return

    try {
      await this.#userService.checkout(user._id)
      this.logout()
    } catch (error) {
      console.error('Clock out failed:', error)
    }
  }

  async startBreak() {
    const user = this.currentUser()
    if (!user?.stampingId) return

    try {
      await this.#userService.startBreak(user._id)
      // No logout to allow easy resume
    } catch (error) {
      console.error('Start break failed:', error)
    }
  }

  async endBreak() {
    const user = this.currentUser()
    if (!user?.stampingId) return

    try {
      await this.#userService.endBreak(user._id)
      // Reload working time handled by effect ideally, or we force refresh if needed
      this.handleUserWorkingTime()
    } catch (error) {
      console.error('End break failed:', error)
    }
  }

  /**
   * Tageseroeffnung — oeffnet den OpeningDialog. Mode aus
   * `Location.operationMode` (Default: pos-cashier). Nach Erfolg
   * aktualisiert sich `hasOpenBusinessDay()` reaktiv, weil der Edge-Service
   * `Location.currentBusinessDay` patcht.
   */
  startOpening() {
    const activeLocation = this.#locationService.activeLocation() as
      | { _id?: string; operationMode?: string }
      | undefined
    const locationId = activeLocation?._id ?? null
    const operationMode =
      activeLocation?.operationMode === 'orders-only'
        ? BusinessDayOperationMode.ORDERS_ONLY
        : BusinessDayOperationMode.POS_CASHIER

    this.#dialog.open(OpeningDialogComponent, {
      width: '480px',
      maxWidth: '92vw',
      maxHeight: '90vh',
      disableClose: false,
      data: { locationId, operationMode },
    })
  }

  /**
   * Tagesabschluss — oeffnet den ClosingDialog. Erwartet einen offenen
   * BusinessDay (Wahrscheinlichkeit ueber `hasOpenBusinessDay()`-Condition
   * im Quick-Action-Filter). Der Dialog ruft seinerseits closeDay() auf,
   * was Sync-Outbox-Vorabpruefung + Cloud-Trigger erledigt.
   */
  startClosing() {
    const activeLocation = this.#locationService.activeLocation() as
      | { _id?: string; currentBusinessDay?: { businessDayId?: string } }
      | undefined
    const businessDayId = activeLocation?.currentBusinessDay?.businessDayId
    if (!businessDayId) {
      console.warn('startClosing: kein offener Geschäftstag — Aktion ignoriert')
      return
    }

    // Volle BusinessDay-Daten aus dem Service holen (operationMode etc.)
    void (async () => {
      try {
        const businessDay = await this.#businessDayService.get(businessDayId)
        this.#dialog.open(ClosingDialogComponent, {
          width: '500px',
          maxWidth: '90vw',
          height: 'auto',
          maxHeight: '90vh',
          disableClose: true,
          panelClass: 'closing-dialog-panel',
          data: { businessDay },
        })
      } catch (err) {
        console.error('startClosing: BusinessDay konnte nicht geladen werden', err)
      }
    })()
  }

  // --- Logic ---

  private updateKPIs() {
    const orders = this.orders()
    if (!orders.length) {
      this.productivity = '0'
      this.avgWaitingTime = '0 min'
      return
    }

    // Productivity: Orders per hour (simple approximation based on span of first to last order, or just current opening hours)
    // Let's use orders / (current hour - opening hour + 1) or similar.
    // For now, simpler: Counts / business day hours elapsed.
    // Let's just do a simple average active orders count or similar if productivity definition is vague.
    // The prompt asked for "Produktivität". Let's assume Orders/Hour.
    const now = new Date()
    const startOfDay = new Date(now.setHours(8, 0, 0, 0)) // Assume 8 AM start if no config
    const hoursOpen = Math.max(1, (new Date().getTime() - startOfDay.getTime()) / (1000 * 60 * 60))
    this.productivity = (this.todayOrdersCount / hoursOpen).toFixed(1)

    // Avg Waiting Time (for Active Orders)
    const activeOrders = orders.filter(o => o.status !== OrderStatus.COMPLETED && o.status !== OrderStatus.ABORTED)
    if (activeOrders.length === 0) {
      this.avgWaitingTime = '0 min'
    } else {
      let totalWait = 0
      activeOrders.forEach(o => {
        const created = new Date(o.recordingDate ?? o.createdAt ?? (o as any).created_at).getTime()
        totalWait += new Date().getTime() - created
      })
      const avgMs = totalWait / activeOrders.length
      this.avgWaitingTime = Math.round(avgMs / 60000) + ' min'
    }
  }

  private handleUserWorkingTime() {
    const user = this.currentUser()
    if (user?.stampingId) {
      this.#workingTimeService.get(user.stampingId).then(wt => {
        this.currentWorkingTime = wt
        this.calculateDuration()
      })
    } else {
      this.currentWorkingTime = undefined
      this.formattedWorkingTime = '-'
    }
  }

  private calculateDuration() {
    if (!this.currentWorkingTime) {
      this.formattedWorkingTime = '-'
      return
    }
    // Simple duration from checkin
    const start = new Date(this.currentWorkingTime.checkinDate)
    const now = new Date()
    const diff = now.getTime() - start.getTime()

    // Subtract breaks if needed, but for now simple diff
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const minutes = Math.floor((diff / (1000 * 60)) % 60)
    this.formattedWorkingTime = `${hours}h ${minutes}min`
    this.#cdr.markForCheck()
  }

  private buildOccupancyChartData(): void {
    // 1) Group orders by hour
    const hourlyCounts: number[] = new Array(24).fill(0)

    this.orders().forEach((order: Order): void => {
      const ts: Date | string | number | undefined =
        order.recordingDate ?? order.createdAt ?? (order as any).created_at ?? order.updatedAt

      if (!ts) return

      const hour = new Date(ts).getHours()
      hourlyCounts[hour]++
    })

    // const openingHour = 8  // TODO: use for chart range filtering
    // const closingHour = 22

    const xAxisData = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0') + ':00')

    // Styling for Fintech look (smooth, gradient, clean)
    this.chartOptions = {
      grid: { top: 20, right: 20, bottom: 20, left: 20, containLabel: true },
      tooltip: {
        trigger: 'axis',
        className: 'echarts-tooltip',
        formatter: '{b0}: {c0} Orders',
      },
      xAxis: {
        type: 'category',
        data: xAxisData,
        boundaryGap: false,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: '#64748b', fontSize: 10, interval: 3 }, // Show every 3rd label
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        splitLine: { lineStyle: { type: 'dashed', color: '#f1f5f9' } },
        axisLabel: { color: '#64748b', fontSize: 10 },
      },
      series: [
        {
          name: 'Auslastung',
          type: 'line',
          smooth: 0.4, // Curved lines
          symbol: 'none',
          data: hourlyCounts,
          itemStyle: { color: '#3b82f6' }, // Blue-500
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(59, 130, 246, 0.3)' }, // Blue-500 with opacity
                { offset: 1, color: 'rgba(59, 130, 246, 0.0)' },
              ],
            },
          },
          lineStyle: { width: 3 },
        },
      ],
    }
  }
}
