import { inject } from '@angular/core'
import { CanActivateFn, CanDeactivateFn, Router } from '@angular/router'
import { TenantSuspensionService } from '@panary/shared/data-access'
import { KASSE_EXIT_URL, KassePageComponent } from './kasse-page.component'

/**
 * Mandant in der Cloud gesperrt: keine Kasse (Kachel „Neue Bestellung" ist dann ohnehin
 * gesperrt, `requiresBooking`). Ein direkter Aufruf von `/kasse` landet auf der Übersicht;
 * der Abbruch in `placeOrder` bleibt für eine Sperre, die erst in der offenen Kasse eintrifft.
 */
export const kasseBookingGuard: CanActivateFn = () =>
  inject(TenantSuspensionService).suspended() ? inject(Router).parseUrl(KASSE_EXIT_URL) : true

/**
 * Ziele, die die Sitzung beenden (Logout, Inaktivität, Neueinrichtung). Dort entscheidet nicht
 * der Kassierer — eine Rückfrage hielte den Logout auf. Verworfen wird wie früher beim Dialog,
 * der beim Routenwechsel ungefragt zuging.
 */
const SESSION_EXIT_PATHS = ['/login', '/setup']

/** Browser-Zurück und jeder Routenwechsel aus der Kasse fragen nach wie das X (core#828). */
export const kasseLeaveGuard: CanDeactivateFn<KassePageComponent> = (page, _route, _state, next) => {
  const target = next?.url ?? ''
  if (
    SESSION_EXIT_PATHS.some(path => target === path || target.startsWith(`${path}/`) || target.startsWith(`${path}?`))
  )
    return true
  return page.canLeave()
}
