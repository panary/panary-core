import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal, Signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { Router } from '@angular/router'
import { NGX_ECHARTS_CONFIG, NgxEchartsModule } from 'ngx-echarts'
import type { EChartsOption } from 'echarts'
import { isOrderOpen, Order, OrderService } from '@panary/orders/data-access'
import { TranslateModule } from '@ngx-translate/core'
import { PreOrder, PreOrderService } from '@panary/pre-orders/data-access'
import { IconComponent, PageHeaderComponent } from '@panary/shared/ui-common'
import { LocationService } from '@panary/locations/data-access'
import { locationCalendarDate, type LocationScopedHourException } from '@panary/locations/domain'
import { ConnectionService } from '@panary/shared/data-access'
import { formatDecimal } from '@panary/shared/util-helpers'
import {
  averageWaitingMinutes,
  chartWindow,
  hourlyOrderCounts,
  ordersPerHour,
  preOrderSummary,
  todaysOpening,
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
  imports: [IconComponent, PageHeaderComponent, CommonModule, NgxEchartsModule, TranslateModule],
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

  #hourExceptions = signal<LocationScopedHourException[]>([])

  /** Minutentakt der Wartezeit — sie wächst auch ohne neue Bestellung. */
  readonly #now = signal(new Date())

  /**
   * Heute offen, geschlossen oder nicht gepflegt (core#1132). Reaktiv auf die aktive Location: Ein
   * Settings-Patch aus der Cloud (`patched`-Event im LocationService) erreicht die Startseite ohne Neustart.
   */
  readonly #todaysOpening = computed(() =>
    todaysOpening(this.#locationService.activeLocation(), this.#hourExceptions(), this.#now()),
  )
  readonly #locationId = computed(() => this.#locationService.activeLocation()?._id ?? null)
  /** Kalendertag der Filiale — wechselt um Mitternacht, nicht im Minutentakt. */
  readonly #calendarDate = computed(() => locationCalendarDate(this.#locationService.activeLocation(), this.#now()))
  /** Hochgezählt je Ladeauftrag; eine spät eintreffende Antwort für einen alten Tag wird verworfen. */
  #exceptionsRequest = 0
  /** Filiale und Tag, für die die Ausnahmen zuletzt angefordert wurden. */
  #exceptionsKey: string | null = null

  todayPreOrders = signal<PreOrder[]>([])
  orders: Signal<Order[]> = this.#orderService.orders

  readonly chartOptions = computed(() => this.#buildOccupancyChart())
  readonly activeOrdersCount = computed(() => this.orders().filter(o => isOrderOpen(o.status)).length)
  readonly todayOrdersCount = computed(() => this.orders().length)
  readonly productivity = computed(() => {
    const start = this.#chartWindow().startHour
    return formatDecimal(ordersPerHour(this.todayOrdersCount(), this.#now(), start))
  })
  /** Die nächsten offenen Vorbestellungen des Tages, nach Abholzeit. */
  readonly nextPreOrders = computed(() => this.todayPreOrders().slice(0, 4))
  /** „Sonntag, 25. Oktober · Dahlerstraße" — Datum läuft mit der Minute, Filiale aus der aktiven Location. */
  readonly headerSubtitle = computed(() => {
    const date = this.#now().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })
    const location = (this.#locationService.activeLocation() as { name?: string } | null)?.name
    return location ? `${date} · ${location}` : date
  })
  readonly #hourlyCounts = computed(() => hourlyOrderCounts(this.orders(), this.#now()))
  readonly #chartWindow = computed(() => chartWindow(this.#todaysOpening(), this.#hourlyCounts()))
  /** Unterzeile des Diagramms: Übersetzungsschlüssel und Parameter, Uhrzeit nur bei gepflegter Öffnungszeit. */
  readonly chartSubtitle = computed(() => {
    const { kind, openingLabel, extended, hasOrders } = this.#chartWindow()
    if (kind === 'closed') {
      return { key: hasOrders ? 'DASHBOARD.OPENING_WINDOW_CLOSED_SALES' : 'DASHBOARD.OPENING_WINDOW_CLOSED' }
    }
    if (kind === 'unset') return { key: 'DASHBOARD.OPENING_WINDOW_UNSET' }
    return {
      key: extended ? 'DASHBOARD.OPENING_WINDOW_EXTENDED' : 'DASHBOARD.OPENING_WINDOW',
      params: { window: openingLabel },
    }
  })
  // Nur die Zahl: Die Einheit steht im Label, "119 min" brach ab lg in der schmalen Kachel um (core#577)
  readonly avgWaitingMinutes = computed(() => averageWaitingMinutes(this.orders(), this.#now()))

  ngOnInit(): void {
    // Der Minutentakt holt auch die Ausnahmen nach, wenn Filiale (kam erst nach dem Init) oder
    // Kalendertag (Mitternacht) wechseln. Bewusst kein `effect()`: Laden setzt Signale (Memory effect+async).
    const tick = setInterval(() => {
      this.#now.set(new Date())
      this.refreshHourExceptions()
    }, 60_000)
    this.#destroyRef.onDestroy(() => clearInterval(tick))

    this.fetchTodayPreOrders()
    this.#listenPreOrderEvents()
    this.#listenHourExceptionEvents()
    this.refreshHourExceptions()
  }

  /** Lädt die Ausnahmen, wenn sich Filiale oder Kalendertag seit dem letzten Laden geändert haben (`force`: immer). */
  refreshHourExceptions(force = false): void {
    const locationId = this.#locationId()
    const date = this.#calendarDate()
    const key = `${locationId}|${date}`
    if (!force && key === this.#exceptionsKey) return
    this.#exceptionsKey = key
    void this.#loadHourExceptions(locationId, date)
  }

  /**
   * Filialgenaue Ausnahmen des heutigen Tages. Bei Fehler bleibt die Liste leer, dann entscheidet der reguläre
   * Wochentag — wie vorher, nur ohne den alten Stand eines anderen Tages stehen zu lassen.
   */
  async #loadHourExceptions(locationId: string | null, date: string): Promise<void> {
    const request = ++this.#exceptionsRequest
    if (!locationId) {
      this.#hourExceptions.set([])
      return
    }
    let exceptions: LocationScopedHourException[] = []
    try {
      const result = await this.#connectionService.openingHourExceptionsService.find({
        query: { date, locationId, $limit: 5 },
      })
      exceptions = Array.isArray(result) ? result : ((result as any).data ?? [])
    } catch {
      exceptions = []
    }
    if (request === this.#exceptionsRequest) this.#hourExceptions.set(exceptions)
  }

  /** Eine per Sync angelegte, geänderte oder gelöschte Ausnahme lädt die heutigen neu (core#1132). */
  #listenHourExceptionEvents(): void {
    const svc = this.#connectionService.openingHourExceptionsService as any
    if (!svc || typeof svc.on !== 'function') return

    const reload = () => this.refreshHourExceptions(true)
    svc.on('created', reload)
    svc.on('patched', reload)
    svc.on('updated', reload)
    svc.on('removed', reload)
    this.#destroyRef.onDestroy(() => {
      if (typeof svc.off !== 'function') return
      svc.off('created', reload)
      svc.off('patched', reload)
      svc.off('updated', reload)
      svc.off('removed', reload)
    })
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

  /** Öffnet Vorbestellungen mit dieser Vorbestellung ausgewählt (core#1025). */
  openPreOrder(preOrder: PreOrder) {
    this.#router.navigate(['/pre-orders'], { queryParams: { select: preOrder._id } })
  }

  #buildOccupancyChart(): EChartsOption {
    const hourlyCounts = this.#hourlyCounts()
    const { startHour, endHour } = this.#chartWindow()
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
