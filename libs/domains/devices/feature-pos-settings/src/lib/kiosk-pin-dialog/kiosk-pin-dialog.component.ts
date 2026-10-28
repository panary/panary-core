import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core'
import { TranslateModule, TranslateService } from '@ngx-translate/core'
import { ConnectionService } from '@panary/shared/data-access'
import { KioskService, LogService } from '@panary/shared/data-access-updater'
import { KIOSK_EXIT_ALLOWED_ROLES, POS_PIN_LENGTH } from '@panary/users/domain'
import { IconComponent, type IconName } from '@panary/shared/ui-common'

/** Was der Notausgang nach erfolgreicher PIN tut (panary/panary-core#1188). */
export type KioskAction = 'exit' | 'window-mode' | 'enable' | 'disable'

interface EligibleUser {
  _id: string
  firstName: string
  lastName: string
  initials: string
  staffRole?: string
  role: string
}

type DialogStep = 'loading' | 'select-user' | 'enter-pin' | 'working' | 'error'

const ACTION_KEYS: Record<KioskAction, { title: string; icon: IconName }> = {
  exit: { title: 'SETTINGS.KIOSK_EXIT', icon: 'sign-out' },
  'window-mode': { title: 'SETTINGS.KIOSK_WINDOW_MODE', icon: 'frame-corners' },
  enable: { title: 'SETTINGS.KIOSK_ENABLE', icon: 'lock' },
  disable: { title: 'SETTINGS.KIOSK_DISABLE', icon: 'prohibit' },
}

/**
 * PIN-Abfrage vor dem Kiosk-Notausgang. Muster: `unpair-device-dialog`.
 *
 * Die Shell-Commands pruefen selbst keine PIN, der Schutz liegt hier: Kandidaten nur
 * aus `KIOSK_EXIT_ALLOWED_ROLES`, und die Rolle des von `verifyPin` zurueckgegebenen
 * Users wird nochmals gegengeprueft (eine per DevTools manipulierte Liste faellt dort auf).
 * Ohne Edge gibt es keine PIN-Pruefung und damit keinen Notausgang. Bewusst so.
 */
@Component({
  selector: 'lib-kiosk-pin-dialog',
  imports: [IconComponent, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './kiosk-pin-dialog.component.html',
})
export class KioskPinDialogComponent implements OnInit {
  readonly action = input.required<KioskAction>()
  readonly closed = output<void>()

  readonly #connectionService = inject(ConnectionService)
  readonly #kiosk = inject(KioskService)
  readonly #log = inject(LogService)
  readonly #translate = inject(TranslateService)

  /**
   * Verzoegerter Auto-Submit. Er muss verfallen, sobald der Dialog schliesst oder die
   * Eingabe sich aendert: Sonst loeste ein Escape innerhalb der 100 ms die Aktion
   * (z. B. Beenden) trotzdem aus.
   */
  #submitTimer: ReturnType<typeof setTimeout> | null = null
  #closed = false

  readonly pinLength = POS_PIN_LENGTH
  readonly pinSlots = Array.from({ length: POS_PIN_LENGTH }, (_, i) => i)

  readonly step = signal<DialogStep>('loading')
  readonly eligibleUsers = signal<EligibleUser[]>([])
  readonly selectedUser = signal<EligibleUser | null>(null)
  readonly pinInput = signal('')
  readonly pinError = signal(false)
  readonly errorMessage = signal<string | null>(null)
  readonly isVerifying = signal(false)

  readonly hasEligibleUsers = computed(() => this.eligibleUsers().length > 0)
  readonly titleKey = computed(() => ACTION_KEYS[this.action()].title)
  readonly icon = computed(() => ACTION_KEYS[this.action()].icon)

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.#closed = true
      this.#clearSubmit()
    })
  }

  ngOnInit(): void {
    void this.#loadEligibleUsers()
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboardInput(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      this.cancel()
      return
    }
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

  selectUser(user: EligibleUser): void {
    this.#clearSubmit()
    this.selectedUser.set(user)
    this.pinInput.set('')
    this.pinError.set(false)
    this.errorMessage.set(null)
    this.step.set('enter-pin')
  }

  backToUserList(): void {
    this.#clearSubmit()
    this.selectedUser.set(null)
    this.pinInput.set('')
    this.pinError.set(false)
    this.step.set('select-user')
  }

  addDigit(digit: string): void {
    if (this.pinInput().length >= POS_PIN_LENGTH) return
    this.pinInput.update(c => c + digit)
    this.pinError.set(false)
    if (this.pinInput().length === POS_PIN_LENGTH) {
      this.#clearSubmit()
      this.#submitTimer = setTimeout(() => void this.verifyPin(), 100)
    }
  }

  deleteDigit(): void {
    this.#clearSubmit()
    this.pinInput.update(c => c.slice(0, -1))
    this.pinError.set(false)
  }

  async verifyPin(): Promise<void> {
    this.#submitTimer = null
    const user = this.selectedUser()
    if (!user || this.isVerifying() || this.#closed) return
    if (this.step() !== 'enter-pin' || this.pinInput().length !== POS_PIN_LENGTH) return

    this.isVerifying.set(true)
    try {
      const usersService = this.#connectionService.usersService as unknown as {
        verifyPin: (data: { userId: string; pin: string }) => Promise<EligibleUser>
      }
      const verified = await usersService.verifyPin({ userId: user._id, pin: this.pinInput() })

      if (!verified.role || !KIOSK_EXIT_ALLOWED_ROLES.has(verified.role)) {
        this.#reject(this.#translate.instant('SETTINGS.KIOSK_ROLE_NOT_ALLOWED'))
        return
      }

      await this.#perform(verified)
    } catch {
      this.#reject(null)
    } finally {
      this.isVerifying.set(false)
    }
  }

  cancel(): void {
    if (this.step() === 'working') return
    this.#closed = true
    this.#clearSubmit()
    this.closed.emit()
  }

  retry(): void {
    this.errorMessage.set(null)
    void this.#loadEligibleUsers()
  }

  async #perform(user: EligibleUser): Promise<void> {
    const action = this.action()
    this.step.set('working')
    // Nur Aktion, Rolle und ID des Bedieners, nie PIN oder Klarname (PII, logging.md).
    this.#log.info(`[kiosk] ${action} freigegeben von ${user._id} (${user.role})`)
    try {
      switch (action) {
        case 'exit':
          await this.#kiosk.exit()
          return
        case 'window-mode':
          await this.#kiosk.enterWindowMode()
          break
        case 'enable':
        case 'disable':
          await this.#kiosk.setEnabled(action === 'enable')
          break
      }
      this.closed.emit()
    } catch (err) {
      this.errorMessage.set(err instanceof Error ? err.message : String(err))
      this.step.set('error')
    }
  }

  #clearSubmit(): void {
    if (this.#submitTimer !== null) clearTimeout(this.#submitTimer)
    this.#submitTimer = null
  }

  #reject(message: string | null): void {
    this.pinError.set(true)
    this.pinInput.set('')
    this.errorMessage.set(message)
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate([100, 50, 100])
  }

  async #loadEligibleUsers(): Promise<void> {
    this.step.set('loading')
    this.errorMessage.set(null)

    try {
      const usersService = this.#connectionService.usersService
      if (!usersService) throw new Error('Users service nicht verfügbar')

      const result = await usersService.find({
        query: {
          role: { $in: Array.from(KIOSK_EXIT_ALLOWED_ROLES) },
          isPosUser: true,
          $limit: 100,
          $sort: { firstName: 1 },
        },
      })
      const rawUsers = Array.isArray(result) ? result : ((result as { data?: unknown[] }).data ?? [])

      const mapped: EligibleUser[] = (rawUsers as Array<Record<string, unknown>>)
        .filter(u => typeof u['role'] === 'string' && KIOSK_EXIT_ALLOWED_ROLES.has(u['role'] as string))
        .map(u => {
          const firstName = String(u['firstName'] ?? '')
          const lastName = String(u['lastName'] ?? '')
          return {
            _id: String(u['_id']),
            firstName,
            lastName,
            initials: `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase(),
            staffRole: u['staffRole'] as string | undefined,
            role: u['role'] as string,
          }
        })

      this.eligibleUsers.set(mapped)
      this.step.set('select-user')
    } catch (err) {
      this.errorMessage.set(err instanceof Error ? err.message : String(err))
      this.step.set('error')
    }
  }
}
