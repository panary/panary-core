import { computed, inject, Injectable } from '@angular/core'
import { MatSnackBar } from '@angular/material/snack-bar'
import { TranslateService } from '@ngx-translate/core'
import { AuthService, PosSessionService } from '@panary/auth/data-access'
import { TenantSuspensionService } from '@panary/shared/data-access'
import { PosHandednessService, UserService } from '@panary/users/data-access'
import { PosHandedness } from '@panary/users/domain'
import { timeTrackingBlockedHintKey } from './pos-navigation'

/**
 * Der per PIN angemeldete Mitarbeiter: Name, Stempelstatus, Stempeln und Abmelden.
 *
 * Bis core#832 lag das im Kopf des Dashboards; mit der Rail sitzt es im Avatar-Menü und muss von
 * jeder Seite aus erreichbar sein. Die Sperren (offline, Mandantensperre) sind Bedienhilfe — die
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
    const authUser = this.#users.currentUser()
    if (authUser) return authUser
    const id = storedPosUser()?._id
    return id ? this.#users.users().find(u => u._id === id) : undefined
  })

  readonly displayName = computed<string>(() => {
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

  async clockIn(): Promise<void> {
    const user = this.#timeTrackingUser()
    if (!user) return
    await this.#run('Clock in', () => this.#users.checkin(user._id))
  }

  /** Ausstempeln meldet ab — wie bisher am Dashboard. */
  async clockOut(): Promise<void> {
    const user = this.#timeTrackingUser()
    if (!user?.stampingId) return
    if (await this.#run('Clock out', () => this.#users.checkout(user._id))) this.logout()
  }

  async startBreak(): Promise<void> {
    const user = this.#timeTrackingUser()
    if (!user?.stampingId) return
    await this.#run('Start break', () => this.#users.startBreak(user._id))
  }

  async endBreak(): Promise<void> {
    const user = this.#timeTrackingUser()
    if (!user?.stampingId) return
    await this.#run('End break', () => this.#users.endBreak(user._id))
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

  /** Stempeln läuft ohne Outbox: offline oder gesperrt hinge der Aufruf still. */
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
      return false
    }
  }

  #notify(key: string): void {
    this.#snackBar.open(this.#translate.instant(key), undefined, { duration: 4000 })
  }
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
