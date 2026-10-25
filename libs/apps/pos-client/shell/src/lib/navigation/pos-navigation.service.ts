import { computed, inject, Injectable } from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import { MatSnackBar } from '@angular/material/snack-bar'
import { NavigationEnd, Router } from '@angular/router'
import { TranslateService } from '@ngx-translate/core'
import { filter, map } from 'rxjs'
import { PosSessionService } from '@panary/auth/data-access'
import { LocationService } from '@panary/locations/data-access'
import { OrderService } from '@panary/orders/data-access'
import { KasseDraftRegistry } from '@panary/orders/feature-pos-order-dialog'
import { ConnectionService, TenantSuspensionService } from '@panary/shared/data-access'
import {
  isNavPathActive,
  MORE_GROUPS,
  type PosNavContext,
  type PosNavItem,
  RAIL_ENTRIES,
  resolveNavGroups,
  resolveNavItems,
  SETTINGS_ENTRY,
} from './pos-navigation'
import { PosDayActionsService } from './pos-day-actions.service'

/** Liest den Gerätezustand für die Regeln aus `pos-navigation.ts` und führt Einträge aus. */
@Injectable({ providedIn: 'root' })
export class PosNavigationService {
  readonly #router = inject(Router)
  readonly #connection = inject(ConnectionService)
  readonly #locations = inject(LocationService)
  readonly #suspension = inject(TenantSuspensionService)
  readonly #session = inject(PosSessionService)
  readonly #orders = inject(OrderService)
  readonly #kasse = inject(KasseDraftRegistry)
  readonly #dayActions = inject(PosDayActionsService)
  readonly #snackBar = inject(MatSnackBar)
  readonly #translate = inject(TranslateService)

  readonly context = computed<PosNavContext>(() => {
    const location = this.#locations.activeLocation() as { currentBusinessDay?: { businessDayId?: string } } | undefined
    return {
      standalone: this.#connection.systemMode() === 'standalone',
      cloudPaired: this.#connection.cloudPairingStatus() === 'connected',
      businessDayOpen: !!location?.currentBusinessDay?.businessDayId,
      offline: this.#session.isOffline(),
      bookingSuspended: this.#suspension.suspended(),
    }
  })

  readonly rail = computed(() => resolveNavItems(RAIL_ENTRIES, this.context()))
  readonly moreGroups = computed(() => resolveNavGroups(MORE_GROUPS, this.context()))
  readonly settings = computed(() => resolveNavItems([SETTINGS_ENTRY], this.context())[0])

  /** Dieselbe Menge, die „Offene Bestellungen" listet (`ordersActive`). */
  readonly openOrdersCount = computed(() => this.#orders.ordersActive().length)

  /**
   * Solange in der Kasse ein Sheet liegt (Extras, Bezahlen, Abschicken), ist die Rail gesperrt
   * (Konzept §5). Ein Wechsel mitten im Abschicken verlöre sonst die Rückmeldung.
   */
  readonly locked = this.#kasse.sheetOpen

  readonly url = toSignal(
    this.#router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(event => event.urlAfterRedirects),
    ),
    { initialValue: this.#router.url },
  )

  /** Pfad trifft; trägt der Eintrag Query-Parameter (Einstellungen-Abschnitt), müssen auch die passen. */
  isActive(item: PosNavItem): boolean {
    const { target } = item.entry
    if (target.kind !== 'route' || !isNavPathActive(target.path, this.url())) return false
    const current = this.#router.parseUrl(this.url()).queryParams
    return Object.entries(target.queryParams ?? {}).every(([key, value]) => current[key] === value)
  }

  /**
   * „Mehr" leuchtet, solange eine seiner Routen offen ist (Arbeitszeiten, Einstellungen) — nach dem Pfad
   * allein: `/settings` ohne `?section=` zeigt „Allgemein" und gehört genauso dazu.
   */
  readonly moreActive = computed(() =>
    [...this.moreGroups().flatMap(group => group.items), this.settings()].some(
      ({ entry: { target } }) => target.kind === 'route' && isNavPathActive(target.path, this.url()),
    ),
  )

  open(item: PosNavItem): void {
    if (this.locked()) return
    if (item.block) {
      this.#snackBar.open(this.#translate.instant(item.block), undefined, { duration: 4000 })
      return
    }
    const { target } = item.entry
    if (target.kind === 'route') {
      void this.#router.navigate([target.path], { queryParams: target.queryParams })
      return
    }
    this.#dayActions.run(target.action)
  }
}
