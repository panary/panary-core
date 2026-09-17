import { ChangeDetectionStrategy, Component, HostListener, OnInit, computed, inject, output, signal } from '@angular/core'
import { TranslateModule, TranslateService } from '@ngx-translate/core'

import { ConnectionService } from '@panary/shared/data-access'
import { DEVICE_REVERIFY_AUTHORIZING_ROLES } from '@panary/users/domain'

import { PinPadComponent } from '../pin-pad/pin-pad.component'

/**
 * Bestaetigungsbildschirm nach langer Offline-Phase (panary/panary-core#325).
 *
 * Blockierend, aber ohne Sackgasse: Es gibt bewusst KEINE Entkopplungs-Option
 * an dieser Stelle. Der gefaehrliche Nachbarknopf hat schon einmal offline
 * erfasste Bestellungen gekostet (panary/panary-core#322), und hier steht
 * jemand unter Zeitdruck vor dem Geraet.
 *
 * Der Bildschirm ist Bedienerfuehrung, keine Sicherheitsgrenze — die sitzt im
 * `require-device-reverification.hook.ts` am Edge. Wer ihn umgeht, kommt
 * trotzdem nicht am Server vorbei.
 */
interface EligibleUser {
  _id: string
  firstName: string
  lastName: string
  initials: string
  role: string
  /** Traegt eine Leitungsrolle — sonst ist es eine Notfreigabe. */
  authorizing: boolean
}

type Step = 'loading' | 'select-user' | 'enter-pin' | 'error'

@Component({
  selector: 'lib-device-reverify',
  standalone: true,
  imports: [TranslateModule, PinPadComponent],
  templateUrl: './device-reverify.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeviceReverifyComponent implements OnInit {
  /** Freigabe erteilt — der Aufrufer nimmt den regulaeren Login wieder auf. */
  readonly released = output<void>()

  readonly #connectionService = inject(ConnectionService)
  readonly #translate = inject(TranslateService)

  protected readonly step = signal<Step>('loading')
  protected readonly users = signal<EligibleUser[]>([])
  protected readonly selectedUser = signal<EligibleUser | null>(null)
  protected readonly pinInput = signal('')
  protected readonly pinError = signal(false)
  protected readonly errorMessage = signal<string | null>(null)
  protected readonly isVerifying = signal(false)
  /** Notweg sichtbar? Erst auf ausdrueckliche Anforderung — siehe Template. */
  protected readonly showEmergency = signal(false)

  protected readonly authorizingUsers = computed(() => this.users().filter(u => u.authorizing))
  protected readonly otherUsers = computed(() => this.users().filter(u => !u.authorizing))
  protected readonly hasAuthorizingUsers = computed(() => this.authorizingUsers().length > 0)

  /**
   * Volle Tage seit dem letzten Serverkontakt. `null`, wenn der Server keinen
   * Zeitpunkt mitgeschickt hat — dann nennt der Text keine Zahl, statt eine zu
   * erfinden.
   */
  protected readonly offlineDays = computed(() => {
    const since = this.#connectionService.deviceOfflineSince()
    if (!since) return null
    const stamped = Date.parse(since)
    if (!Number.isFinite(stamped)) return null
    return Math.max(1, Math.floor((Date.now() - stamped) / 86_400_000))
  })

  ngOnInit(): void {
    void this.#loadUsers()
  }

  @HostListener('window:keydown', ['$event'])
  protected handleKeyboardInput(event: KeyboardEvent): void {
    if (this.step() !== 'enter-pin') return
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault()
      this.deleteDigit()
      return
    }
    if (/^[0-9]$/.test(event.key)) {
      event.preventDefault()
      this.addDigit(event.key)
    }
  }

  protected selectUser(user: EligibleUser): void {
    this.selectedUser.set(user)
    this.pinInput.set('')
    this.pinError.set(false)
    this.errorMessage.set(null)
    this.step.set('enter-pin')
  }

  protected backToUserList(): void {
    this.selectedUser.set(null)
    this.pinInput.set('')
    this.pinError.set(false)
    this.step.set('select-user')
  }

  protected revealEmergency(): void {
    this.showEmergency.set(true)
  }

  protected addDigit(digit: string): void {
    if (this.pinInput().length >= 6) return
    this.pinInput.update(current => current + digit)
    this.pinError.set(false)
    // Auto-Submit bei 4 Ziffern wie im Login-Flow.
    if (this.pinInput().length === 4) setTimeout(() => void this.verifyPin(), 100)
  }

  protected deleteDigit(): void {
    this.pinInput.update(current => current.slice(0, -1))
    this.pinError.set(false)
  }

  protected async verifyPin(): Promise<void> {
    const user = this.selectedUser()
    if (!user || this.isVerifying()) return

    this.isVerifying.set(true)
    try {
      const usersService = this.#connectionService.usersService as unknown as {
        verifyPin: (data: { userId: string; pin: string }) => Promise<unknown>
      } | null
      if (!usersService) throw new Error('Users service nicht verfuegbar')

      await usersService.verifyPin({ userId: user._id, pin: this.pinInput() })

      // Der Server hat die Freigabe im selben Aufruf erteilt — ein zweites
      // `device:authenticated` kommt dafuer nicht, der Socket bleibt derselbe.
      this.#connectionService.markDeviceReverified()
      this.released.emit()
    } catch (err) {
      this.pinError.set(true)
      this.pinInput.set('')
      // 429 traegt eine eigene Meldung: „PIN falsch" waere hier schlicht
      // unwahr, und der Bediener probierte weiter, statt eine Minute zu warten.
      const code = (err as { code?: number } | null)?.code
      this.errorMessage.set(
        code === 429
          ? this.#translate.instant('LOGIN.REVERIFY_TOO_MANY_ATTEMPTS')
          : this.#translate.instant('LOGIN.REVERIFY_PIN_INVALID'),
      )
      if (navigator.vibrate) navigator.vibrate([100, 50, 100])
    } finally {
      this.isVerifying.set(false)
    }
  }

  protected retry(): void {
    this.errorMessage.set(null)
    void this.#loadUsers()
  }

  async #loadUsers(): Promise<void> {
    this.step.set('loading')
    this.errorMessage.set(null)

    try {
      const usersService = this.#connectionService.usersService
      if (!usersService) throw new Error('Users service nicht verfuegbar')

      // Lesen ist waehrend der ausstehenden Bestaetigung erlaubt (Allowlist im
      // require-device-reverification.hook.ts) — sonst stuende hier eine leere
      // Liste und der Zustand waere nicht aufloesbar.
      //
      // `$select` wie im Login-Screen: ohne ihn liefert der Server auch
      // `employeeNumber` aus, das alleinige Credential der Zeiterfassung.
      const result = await usersService.find({
        query: {
          isPosUser: true,
          $limit: 100,
          $sort: { firstName: 1 },
          $select: ['_id', 'tenantId', 'firstName', 'lastName', 'role'],
        },
      })
      const raw = Array.isArray(result) ? result : ((result as { data?: unknown[] }).data ?? [])

      this.users.set(
        (raw as Array<Record<string, unknown>>).map(entry => {
          const role = typeof entry['role'] === 'string' ? entry['role'] : ''
          const firstName = String(entry['firstName'] ?? '')
          const lastName = String(entry['lastName'] ?? '')
          return {
            _id: String(entry['_id']),
            firstName,
            lastName,
            initials: `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase(),
            role,
            authorizing: DEVICE_REVERIFY_AUTHORIZING_ROLES.has(role),
          }
        }),
      )
      this.step.set('select-user')
    } catch (err) {
      this.errorMessage.set(err instanceof Error ? err.message : String(err))
      this.step.set('error')
    }
  }
}
