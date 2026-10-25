import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal, Signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { Router } from '@angular/router'
import { NGX_ECHARTS_CONFIG, NgxEchartsModule } from 'ngx-echarts'
import type { EChartsOption } from 'echarts'
import { isOrderOpen, Order, OrderService } from '@panary/orders/data-access'
import { TranslateModule } from '@ngx-translate/core'
import { PreOrder, PreOrderService } from '@panary/pre-orders/data-access'
import { IconComponent } from '@panary/shared/ui-common'
import { LocationService } from '@panary/locations/data-access'
import { getOpeningHoursForDate, type HourException, type RegularHour, formatDateISO } from '@panary/locations/domain'
import { ConnectionService } from '@panary/shared/data-access'
import { formatDecimal } from '@panary/shared/util-helpers'
import {
  averageWaitingMinutes,
  chartWindow,
  hourlyOrderCounts,
  ordersPerHour,
  preOrderSummary,
} from './dashboard-kpis'

/**
 * „Übersicht" der Rail: Kennzahlen, Stundenlast, Vorbestellungen heute.
 *
 * Bis core#832 war das die Startseite mit Begrüßung, Stempelmenü und Schnellzugriff-Kacheln. Die
 * Kacheln ersetzt die Rail (`PosNavigationService`, Regeln unverändert), Stempeln und Abmelden
 * sitzen im Avatar-Menü; nach dem Login landet man in der Kasse.
 */
@Component({
  selector: 'lib-dashboard',
  standalone: true,
  imports: [IconComponent, CommonModule, NgxEchartsModule, TranslateModule],
  providers: [{ provide: NGX_ECHARTS_CONFIG, useValue: { echarts: () => import('echarts') } }],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent implements OnInit {
  #router = inject(Router)
  #orderService = inject(OrderService)
  #preOrderService = inject(PreOrderService)
  #destroyRef = inject(DestroyRef)
  #locationService = inject(LocationService)
  #connectionService = inject(ConnectionService)

  readonly formatDecimal = formatDecimal
  readonly preOrderSummary = preOrderSummary

  #regularHours = signal<RegularHour[]>([])
  #hourExceptions = signal<HourException[]>([])
  #openingHoursEnabled = signal(false)

  /** Öffnungszeit des heutigen Tages; `null` ohne gepflegte Zeiten, geschlossen oder Ausnahme ohne Zeiten. */
  readonly #todaysOpening = computed(() => {
    if (!this.#openingHoursEnabled()) return null
    const result = getOpeningHoursForDate(this.#now(), this.#regularHours(), this.#hourExceptions())
    return result.closed ? null : result
  })

  todayPreOrders = signal<PreOrder[]>([])
  orders: Signal<Order[]> = this.#orderService.orders

  /** Minutentakt der Wartezeit — sie wächst auch ohne neue Bestellung. */
  readonly #now = signal(new Date())

  readonly chartOptions = computed(() => this.#buildOccupancyChart())
  readonly activeOrdersCount = computed(() => this.orders().filter(o => isOrderOpen(o.status)).length)
  readonly todayOrdersCount = computed(() => this.orders().length)
  readonly productivity = computed(() => {
    const start = chartWindow(this.#todaysOpening(), hourlyOrderCounts(this.orders())).startHour
    return formatDecimal(ordersPerHour(this.todayOrdersCount(), this.#now(), start))
  })
  /** Die nächsten offenen Vorbestellungen des Tages, nach Abholzeit. */
  readonly nextPreOrders = computed(() => this.todayPreOrders().slice(0, 4))
  readonly chartSubtitle = computed(() => {
    const { startHour, endHour } = chartWindow(this.#todaysOpening(), hourlyOrderCounts(this.orders()))
    return `${String(startHour).padStart(2, '0')}–${String(endHour).padStart(2, '0')}`
  })
  // Nur die Zahl: Die Einheit steht im Label, "119 min" brach ab lg in der schmalen Kachel um (core#577)
  readonly avgWaitingMinutes = computed(() => averageWaitingMinutes(this.orders(), this.#now()))

  ngOnInit(): void {
    const tick = setInterval(() => this.#now.set(new Date()), 60_000)
    this.#destroyRef.onDestroy(() => clearInterval(tick))

    this.fetchTodayPreOrders()
    this.#listenPreOrderEvents()
    void this.#loadOpeningHours()
  }

  /** Öffnungszeiten der aktiven Filiale; ohne Pflege oder bei Fehler greift der Rückfall im Diagramm. */
  async #loadOpeningHours(): Promise<void> {
    try {
      const location = this.#locationService.activeLocation() as any
      const ohs = location?.settings?.openingHoursSettings
      if (!ohs?.enabled) return
      this.#regularHours.set(ohs.regular ?? [])
      const result = await this.#connectionService.openingHourExceptionsService.find({
        query: { date: formatDateISO(new Date()), locationId: location._id, $limit: 5 },
      })
      this.#hourExceptions.set(Array.isArray(result) ? result : ((result as any).data ?? []))
      this.#openingHoursEnabled.set(true)
    } catch {
      this.#openingHoursEnabled.set(this.#regularHours().length > 0)
    }
  }

  /** Lauscht auf Realtime-Events des Pre-Order-Service und aktualisiert die KPI */
  #listenPreOrderEvents(): void {
    const svc = (this.#preOrderService as any).service
    if (!svc || typeof svc.on !== 'function') return

    // Gleiche Handler-Referenz für on/off — der Feathers-Service ist ein Singleton,
    // ohne Deregistrierung akkumulieren die Listener über jeden Dashboard-Besuch.
    const reload = () => this.fetchTodayPreOrders()
    svc.on('created', reload)
    svc.on('patched', reload)
    svc.on('removed', reload)
    this.#destroyRef.onDestroy(() => {
      if (typeof svc.off !== 'function') return
      svc.off('created', reload)
      svc.off('patched', reload)
      svc.off('removed', reload)
    })
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

  navigateTo(path: string) {
    this.#router.navigate([path])
  }

  #buildOccupancyChart(): EChartsOption {
    const hourlyCounts = hourlyOrderCounts(this.orders())
    const { startHour, endHour } = chartWindow(this.#todaysOpening(), hourlyCounts)
    const currentHour = this.#now().getHours()
    const css = getComputedStyle(document.documentElement)
    const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
    const accent = token('--accent', '#0f9d6c')
    const past = token('--border-strong', '#c9c4b9')
    const muted = token('--text-muted', '#6b665d')
    const grid = token('--border-soft', '#e9e6df')

    const hours = Array.from({ length: Math.max(1, endHour - startHour) }, (_, i) => startHour + i)

    return {
      grid: { top: 16, right: 12, bottom: 8, left: 8, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'none' },
        className: 'echarts-tooltip',
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params
          return `${p.name}:00 · ${p.value ?? 0}`
        },
      },
      xAxis: {
        type: 'category',
        data: hours.map(h => String(h).padStart(2, '0')),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: muted, fontSize: 12 },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        splitLine: { lineStyle: { type: 'dashed', color: grid } },
        axisLabel: { color: muted, fontSize: 12 },
      },
      series: [
        {
          type: 'bar',
          barCategoryGap: '30%',
          // Künftige Stunden bleiben leer — ein Balken der Höhe 0 wäre eine Aussage.
          data: hours.map(h => ({
            value: h > currentHour ? null : hourlyCounts[h],
            itemStyle: { color: h === currentHour ? accent : past, borderRadius: [4, 4, 0, 0] },
          })),
        },
      ],
    }
  }
}
