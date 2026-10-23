import { computed, inject, Injectable, signal } from '@angular/core'
import { MatSnackBar } from '@angular/material/snack-bar'
import { TranslateService } from '@ngx-translate/core'
import { AuthService, PosSessionService } from '@panary/auth/data-access'
import {
  isPosOperatorRejection,
  posOperatorSession,
  TenantSuspensionService,
  withPosOperatorToken,
} from '@panary/shared/data-access'
import { PosHandednessService, UserService } from '@panary/users/data-access'
import { PosHandedness } from '@panary/users/domain'
import { type TimeClockAction, timeTrackingBlockedHintKey } from './pos-navigation'

/**
 * Der per PIN angemeldete Mitarbeiter: Name, Stempelstatus, Stempeln und Abmelden.
 *
 * Bis core#832 lag das im Kopf des Dashboards, bis core#907 im Avatar-Menü; seitdem sitzt es direkt in
 * der Rail und muss von jeder Seite aus erreichbar sein. Die Sperren (offline, Mandantensperre) sind Bedienhilfe — die
 * Custom-Methods `checkin`/`checkout`/`startBreak`/`endBreak` prüft der Server selbst.
 */
@Injectable({ providedIn: 'root' })
export class PosStaffService {
  readonly #users = inject(UserService)
  readonly #auth = inject(AuthService)
  readonly #session = inject(PosSessionService)
  readonly #suspension = inject(TenantSuspensionService)
  readonly #handedness = inject(PosHandednessService)
  readonly #snackBar = inject(MatSnackBar)
  readonly #translate = inject(TranslateService)

  readonly isOffline = this.#session.isOffline
  readonly bookingSuspended = this.#suspension.suspended

  /**
   * Auf dem POS ist der Auth-User das Gerät (API-Key); der Kassierer kommt aus der PIN-Anmeldung.
   * Ohne geladenen Auth-User hilft der beim Login abgelegte Eintrag.
   */
  readonly currentUser = computed(() => {
    posOperatorSession()
    const authUser = this.#users.currentUser()
    if (authUser) return authUser
    const id = storedPosUser()?._id
    return id ? this.#users.users().find(u => u._id === id) : undefined
  })

  readonly displayName = computed<string>(() => {
    posOperatorSession()
    const authName = this.#auth.fullName()
    if (authName && authName !== 'Unknown User') return authName
    const stored = storedPosUser()
    if (stored?.firstName || stored?.lastName) return [stored.firstName, stored.lastName].filter(Boolean).join(' ')
    return this.#translate.instant('DASHBOARD.EMPLOYEE')
  })

  readonly initials = computed(() =>
    this.displayName()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part.charAt(0).toUpperCase())
      .join(''),
  )

  readonly isStampedIn = computed(() => !!this.currentUser()?.stampingId)
  readonly isOnBreak = computed(() => !!this.currentUser()?.startBreakAt)

  /** Übersetzungsschlüssel, warum Stempeln gerade nicht geht; `null` = es geht. */
  readonly timeTrackingBlockedKey = computed(() =>
    timeTrackingBlockedHintKey(this.bookingSuspended(), this.isOffline()),
  )

  /** Läuft gerade ein Stempel-Aufruf aus der Rail? */
  readonly timeClockBusy = signal(false)

  /**
   * Stempel-Taste der Rail (core#907). Ein Tipp, ein Aufruf: Ein Doppeltipp während der Antwort
   * stempelt nicht zweimal — Kommen liefe sonst gegen eine schon offene Stempelung.
   */
  async timeClock(action: TimeClockAction): Promise<void> {
    if (this.timeClockBusy()) return
    this.timeClockBusy.set(true)
    try {
      await TIME_CLOCK_CALLS[action](this)
    } finally {
      this.timeClockBusy.set(false)
    }
  }

  async clockIn(): Promise<void> {
    const user = this.#timeTrackingUser()
    if (!user) return
    await this.#run('Clock in', () => this.#users.checkin(user._id, withPosOperatorToken()))
  }

  /** Ausstempeln meldet ab — wie bisher am Dashboard. */
  async clockOut(): Promise<void> {
    const user = this.#timeTrackingUser()
    if (!user?.stampingId) return
    if (await this.#run('Clock out', () => this.#users.checkout(user._id, withPosOperatorToken()))) this.logout()
  }

  async startBreak(): Promise<void> {
    const user = this.#timeTrackingUser()
    if (!user?.stampingId) return
    await this.#run('Start break', () => this.#users.startBreak(user._id, withPosOperatorToken()))
  }

  async endBreak(): Promise<void> {
    const user = this.#timeTrackingUser()
    if (!user?.stampingId) return
    await this.#run('End break', () => this.#users.endBreak(user._id, withPosOperatorToken()))
  }

  /** Seite des Warenkorbs an der Kasse — eigene Wahl dieser Sitzung, sonst Datensatz, sonst links. */
  readonly cartSide = computed(() => this.#handedness.effective(this.currentUser()))

  /**
   * Warenkorb auf die andere Seite (core#833). Wirkt sofort; der Edge speichert über das
   * Bediener-Token, offline merkt der POS die Wahl und sendet sie nach.
   */
  async toggleCartSide(): Promise<void> {
    const user = this.currentUser()
    if (!user) return
    const next = this.cartSide() === PosHandedness.LEFT ? PosHandedness.RIGHT : PosHandedness.LEFT
    try {
      if ((await this.#handedness.choose(user._id, next)) === 'pending') this.#notify('POS_NAV.CART_SIDE_PENDING')
    } catch (error) {
      console.error('Set cart side failed:', error)
      this.#notify('POS_NAV.CART_SIDE_FAILED')
    }
  }

  /** Offline gesperrt: Die Wiederanmeldung braucht den Server (Begründung in `PosSessionService`). */
  logout(): void {
    if (this.isOffline()) {
      this.#notify('DASHBOARD.LOGOUT_OFFLINE_BLOCKED')
      return
    }
    void this.#session.endSession('button')
  }

  /**
   * Stempeln läuft ohne Outbox: offline oder gesperrt hinge der Aufruf still. Die Aufrufe tragen das
   * Bediener-Token, damit der Edge die Stempelung an den angemeldeten Menschen binden kann (core#903).
   * Ein Edge vor #903 entfernt den Schlüssel in `resolvePosOperator`, ohne ihn auszuwerten.
   */
  #timeTrackingUser() {
    const blocked = this.timeTrackingBlockedKey()
    if (blocked) {
      this.#notify(blocked)
      return undefined
    }
    return this.currentUser()
  }

  async #run(label: string, call: () => Promise<unknown>): Promise<boolean> {
    try {
      await call()
      return true
    } catch (error) {
      console.error(`${label} failed:`, error)
      // Bediener-Token abgelehnt (abgelaufen, fremdes Gerät): Das Gerät bleibt angemeldet, nur der
      // Bediener muss neu per PIN. Danach ist die Stempelung wiederholbar (panary/panary-core#923).
      if (isPosOperatorRejection(error)) {
        // Erst abmelden, dann der Hinweis: `AuthService.logout()` öffnet eine eigene Snackbar
        // („Benutzer erfolgreich abgemeldet“), die ihn sonst sofort ersetzt (panary/panary-core#937).
        await this.#session.endSession('button')
        this.#notify('POS_NAV.OPERATOR_PIN_REQUIRED', 8000)
      }
      return false
    }
  }

  #notify(key: string, duration = 4000): void {
    this.#snackBar.open(this.#translate.instant(key), undefined, { duration })
  }
}

const TIME_CLOCK_CALLS: Record<TimeClockAction, (staff: PosStaffService) => Promise<void>> = {
  'clock-in': staff => staff.clockIn(),
  'start-break': staff => staff.startBreak(),
  'end-break': staff => staff.endBreak(),
  'clock-out': staff => staff.clockOut(),
}

interface StoredPosUser {
  _id?: string
  firstName?: string
  lastName?: string
}

function storedPosUser(): StoredPosUser | null {
  const raw = localStorage.getItem('pos_current_user')
  if (!raw) return null
  try {
    return JSON.parse(raw) as StoredPosUser
  } catch {
    return null
  }
}
