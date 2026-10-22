import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal, Signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { Router } from '@angular/router'
import { NGX_ECHARTS_CONFIG, NgxEchartsModule } from 'ngx-echarts'
import type { EChartsOption } from 'echarts'
import { isOrderOpen, Order, OrderService } from '@panary/orders/data-access'
import { TranslateModule } from '@ngx-translate/core'
import { PreOrder, PreOrderService } from '@panary/pre-orders/data-access'
import { IconComponent } from '@panary/shared/ui-common'
import { averageWaitingMinutes, hourlyOrderCounts, ordersPerHour } from './dashboard-kpis'

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

  todayPreOrders = signal<PreOrder[]>([])
  orders: Signal<Order[]> = this.#orderService.orders

  /** Minutentakt der Wartezeit — sie wächst auch ohne neue Bestellung. */
  readonly #now = signal(new Date())

  readonly chartOptions = computed(() => this.#buildOccupancyChart())
  readonly activeOrdersCount = computed(() => this.orders().filter(o => isOrderOpen(o.status)).length)
  readonly todayOrdersCount = computed(() => this.orders().length)
  readonly productivity = computed(() => ordersPerHour(this.todayOrdersCount(), this.#now()))
  // Nur die Zahl: Die Einheit steht im Label, "119 min" brach ab lg in der schmalen Kachel um (core#577)
  readonly avgWaitingMinutes = computed(() => averageWaitingMinutes(this.orders(), this.#now()))

  ngOnInit(): void {
    const tick = setInterval(() => this.#now.set(new Date()), 60_000)
    this.#destroyRef.onDestroy(() => clearInterval(tick))

    this.fetchTodayPreOrders()
    this.#listenPreOrderEvents()
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

    // const openingHour = 8  // TODO: use for chart range filtering
    // const closingHour = 22

    const xAxisData = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0') + ':00')

    // Styling for Fintech look (smooth, gradient, clean)
    return {
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
