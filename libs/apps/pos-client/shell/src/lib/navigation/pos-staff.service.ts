import { computed, inject, Injectable, signal } from '@angular/core'
import { NotificationService, type NotificationType } from '@panary/shared/ui-notifications'
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
import { KasseDraftRegistry } from '@panary/orders/feature-pos-order-dialog'
import {
  railSide,
  type ScreenSide,
  type TimeClockAction,
  timeClockState,
  timeTrackingBlockedHintKey,
} from './pos-navigation'

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
  readonly #notifications = inject(NotificationService)
  readonly #translate = inject(TranslateService)
  readonly #kasse = inject(KasseDraftRegistry)

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

  /** ID der angemeldeten Person — Grundlage der Monogramm-Farbe (core#963). */
  readonly userId = computed(() => {
    posOperatorSession()
    return this.currentUser()?._id ?? storedPosUser()?._id
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
  readonly timeClockState = computed(() => timeClockState(this.isStampedIn(), this.isOnBreak()))

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
    await this.#run('Clock in', () => this.#users.checkin(user._id, withPosOperatorToken()), 'POS_NAV.CLOCKED_IN')
  }

  /**
   * Ausstempeln meldet ab — wie bisher am Dashboard. Eine angefangene Bestellung fragt vorher nach (core#1064);
   * wer „Weiter bearbeiten" wählt, bleibt eingestempelt.
   */
  async clockOut(): Promise<void> {
    const user = this.#timeTrackingUser()
    if (!user?.stampingId) return
    if (!(await this.#kasse.confirmLeave())) return
    if (
      await this.#run('Clock out', () => this.#users.checkout(user._id, withPosOperatorToken()), 'POS_NAV.CLOCKED_OUT')
    )
      this.#endSession()
  }

  async startBreak(): Promise<void> {
    const user = this.#timeTrackingUser()
    if (!user?.stampingId) return
    await this.#run(
      'Start break',
      () => this.#users.startBreak(user._id, withPosOperatorToken()),
      'POS_NAV.BREAK_STARTED',
    )
  }

  async endBreak(): Promise<void> {
    const user = this.#timeTrackingUser()
    if (!user?.stampingId) return
    await this.#run('End break', () => this.#users.endBreak(user._id, withPosOperatorToken()), 'POS_NAV.BREAK_ENDED')
  }

  /** Nennt den Grund, warum Stempeln gerade gesperrt ist; `false`, wenn es nicht gesperrt ist. */
  notifyTimeTrackingBlocked(): boolean {
    const blocked = this.timeTrackingBlockedKey()
    if (blocked) this.#notify(blocked)
    return !!blocked
  }

  /** Seite des Warenkorbs an der Kasse — eigene Wahl dieser Sitzung, sonst Datensatz, sonst links. */
  readonly cartSide = computed(() => this.#handedness.effective(this.currentUser()))

  /** Die Rail sitzt dem Warenkorb gegenüber, auf jeder Seite mit Rail (core#942). */
  readonly railSide = computed(() => railSide(this.cartSide()))

  /** Bedienhand aus dem Avatar-Menü wählen (core#942); dieselbe Wahl ist ein Tipp ohne Wirkung. */
  async chooseCartSide(side: ScreenSide): Promise<void> {
    if (side !== this.cartSide()) await this.toggleCartSide()
  }

  /**
   * Warenkorb auf die andere Seite (core#833). Wirkt sofort; der Edge speichert über das
   * Bediener-Token, offline merkt der POS die Wahl und sendet sie nach. Kann der Edge sie nicht annehmen
   * (kein Token, Edge ohne Methode), gilt sie nur auf diesem Gerät — mit Hinweis (core#964).
   */
  async toggleCartSide(): Promise<void> {
    const user = this.currentUser()
    if (!user) return
    const next = this.cartSide() === PosHandedness.LEFT ? PosHandedness.RIGHT : PosHandedness.LEFT
    try {
      const outcome = await this.#handedness.choose(user._id, next)
      if (outcome === 'pending') this.#notify('POS_NAV.CART_SIDE_PENDING', 'info')
      if (outcome === 'local') this.#notify('POS_NAV.CART_SIDE_LOCAL')
    } catch (error) {
      console.error('Set cart side failed:', error)
      this.#notify('POS_NAV.CART_SIDE_FAILED', 'error')
    }
  }

  /**
   * Offline gesperrt: Die Wiederanmeldung braucht den Server (Begründung in `PosSessionService`).
   * Eine angefangene Bestellung fragt wie beim Seitenwechsel nach (core#1064); der Leave-Guard der
   * Kasse lässt `/login` danach ohne zweite Rückfrage durch.
   */
  async logout(): Promise<void> {
    if (this.isOffline()) {
      this.#notify('DASHBOARD.LOGOUT_OFFLINE_BLOCKED')
      return
    }
    if (!(await this.#kasse.confirmLeave())) return
    this.#endSession()
  }

  /** Zweite Offline-Prüfung mit Absicht: Zwischen Rückfrage bzw. Ausstempeln und hier kann die Verbindung weg sein. */
  #endSession(): void {
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

  async #run(label: string, call: () => Promise<unknown>, successKey: string): Promise<boolean> {
    try {
      // Der UserService faengt Serverfehler per `handleError` ab und loest mit `undefined` auf, auch bei der
      // Mandantensperre (Banner statt Toast). Das ist ein Fehlschlag, kein Erfolg (panary/panary-core#1117,
      // dasselbe Muster wie im Zeiterfassungs-Panel, core#810). Die Meldung dazu kam schon aus `handleError`.
      if ((await call()) == null) return false
      // Die Standardmeldungen des working-times-Service sind am POS stumm (core#962): das ist die eine Rückmeldung.
      this.#notify(successKey, 'success')
      return true
    } catch (error) {
      console.error(`${label} failed:`, error)
      // Bediener-Token abgelehnt (abgelaufen, fremdes Gerät): Das Gerät bleibt angemeldet, nur der
      // Bediener muss neu per PIN. Danach ist die Stempelung wiederholbar (panary/panary-core#923).
      if (isPosOperatorRejection(error)) {
        // Erst abmelden, dann der Hinweis: `AuthService.logout()` meldet sich selbst
        // („Benutzer erfolgreich abgemeldet“); der Hinweis soll oben im Stapel stehen (panary/panary-core#937).
        // `finally`: Auch wenn das Abmelden scheitert, erscheint der Hinweis, und `#run` wirft nicht.
        try {
          await this.#session.endSession('button')
        } catch (logoutError) {
          console.error('End session after operator rejection failed:', logoutError)
        } finally {
          this.#notify('POS_NAV.OPERATOR_PIN_REQUIRED')
        }
      }
      return false
    }
  }

  #notify(key: string, type: NotificationType = 'warning'): void {
    this.#notifications.notify(type, this.#translate.instant(key))
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
