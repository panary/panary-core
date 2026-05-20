import { ChangeDetectionStrategy, Component, HostListener, OnInit, computed, inject, output, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { TranslateModule, TranslateService } from '@ngx-translate/core'
import { ConnectionService } from '@panary/shared/data-access'
import { DeviceConfigService } from '@panary/shared/data-access-config'

/**
 * Erlaubte Rollen für das Entkoppeln eines Geräts.
 *
 * Eine PIN-Verifikation muss auf einen User mit einer dieser Rollen treffen.
 * Defense-in-Depth: Filter clientseitig (Liste), zusätzlich Backend-Rückgabe
 * gegen-prüfen.
 */
const UNPAIR_ALLOWED_ROLES: ReadonlySet<string> = new Set([
  'tenant:owner',
  'tenant:manager',
  'tenant:technician',
])

interface EligibleUser {
  _id: string
  firstName: string
  lastName: string
  initials: string
  staffRole?: string
  role: string
}

type DialogStep = 'loading' | 'select-user' | 'enter-pin' | 'confirm' | 'unpairing' | 'error'

@Component({
  selector: 'lib-unpair-device-dialog',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './unpair-device-dialog.component.html',
})
export class UnpairDeviceDialogComponent implements OnInit {
  readonly closed = output<void>()

  readonly #connectionService = inject(ConnectionService)
  readonly #deviceConfigService = inject(DeviceConfigService)
  readonly #translate = inject(TranslateService)

  readonly step = signal<DialogStep>('loading')
  readonly eligibleUsers = signal<EligibleUser[]>([])
  readonly selectedUser = signal<EligibleUser | null>(null)
  readonly pinInput = signal('')
  readonly pinError = signal(false)
  readonly errorMessage = signal<string | null>(null)
  readonly isVerifying = signal(false)

  // Verifizierter User (für Confirm-Schritt verfügbar machen — z.B. für Audit-Anzeige)
  readonly verifiedUser = signal<EligibleUser | null>(null)

  readonly hasEligibleUsers = computed(() => this.eligibleUsers().length > 0)
  readonly deviceName = computed(() => this.#deviceConfigService.getDeviceName() ?? '–')

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
    this.selectedUser.set(user)
    this.pinInput.set('')
    this.pinError.set(false)
    this.step.set('enter-pin')
  }

  backToUserList(): void {
    this.selectedUser.set(null)
    this.pinInput.set('')
    this.pinError.set(false)
    this.step.set('select-user')
  }

  addDigit(digit: string): void {
    if (this.pinInput().length >= 6) return
    this.pinInput.update(c => c + digit)
    this.pinError.set(false)
    if (this.pinInput().length === 4) {
      // Auto-Submit bei 4 Ziffern wie im Login-Flow
      setTimeout(() => void this.verifyPin(), 100)
    }
  }

  deleteDigit(): void {
    this.pinInput.update(c => c.slice(0, -1))
    this.pinError.set(false)
  }

  async verifyPin(): Promise<void> {
    const user = this.selectedUser()
    if (!user || this.isVerifying()) return

    this.isVerifying.set(true)

    try {
      const usersService = this.#connectionService.usersService as unknown as {
        verifyPin: (data: { userId: string; pin: string }) => Promise<EligibleUser>
      }
      const verified = await usersService.verifyPin({ userId: user._id, pin: this.pinInput() })

      // Defense-in-Depth: Rolle nochmals serverseitig gegenprüfen.
      // Wenn jemand die User-Liste manipuliert (DevTools), schlägt hier auf.
      if (!verified.role || !UNPAIR_ALLOWED_ROLES.has(verified.role)) {
        this.pinError.set(true)
        this.pinInput.set('')
        this.errorMessage.set(this.#translate.instant('SETTINGS.UNPAIR_ROLE_NOT_ALLOWED'))
        if (navigator.vibrate) navigator.vibrate([100, 50, 100])
        return
      }

      this.verifiedUser.set(verified)
      this.errorMessage.set(null)
      this.step.set('confirm')
    } catch {
      this.pinError.set(true)
      this.pinInput.set('')
      if (navigator.vibrate) navigator.vibrate([100, 50, 100])
    } finally {
      this.isVerifying.set(false)
    }
  }

  async performUnpair(): Promise<void> {
    this.step.set('unpairing')
    this.errorMessage.set(null)

    try {
      // Socket trennen, damit nach dem Reset kein Reconnect-Loop entsteht.
      this.#connectionService.socketDisconnect()

      const result = await this.#deviceConfigService.unpair()

      if (!result.backendDeleted) {
        // Backend-Cleanup fehlgeschlagen — lokal trotzdem entkoppelt.
        // Hinweis fürs Log, aber kein Block — der User soll zum Setup zurück.
        console.warn(
          '[unpair] Backend-DELETE fehlgeschlagen, lokaler Reset erfolgreich:',
          result.backendError,
        )
      }

      // Hard-Reload — setupGuard sieht hasConfig()=false → /setup
      window.location.reload()
    } catch (err) {
      this.errorMessage.set(err instanceof Error ? err.message : String(err))
      this.step.set('error')
    }
  }

  cancel(): void {
    if (this.step() === 'unpairing') return // Während Unpair nicht abbrechen
    this.closed.emit()
  }

  retry(): void {
    this.errorMessage.set(null)
    void this.#loadEligibleUsers()
  }

  async #loadEligibleUsers(): Promise<void> {
    this.step.set('loading')
    this.errorMessage.set(null)

    try {
      const usersService = this.#connectionService.usersService
      if (!usersService) throw new Error('Users service nicht verfügbar')

      const result = await usersService.find({
        query: {
          role: { $in: Array.from(UNPAIR_ALLOWED_ROLES) },
          isPosUser: true,
          $limit: 100,
          $sort: { firstName: 1 },
        },
      })
      const rawUsers = Array.isArray(result) ? result : ((result as { data?: unknown[] }).data ?? [])

      const mapped: EligibleUser[] = (rawUsers as Array<Record<string, unknown>>)
        .filter(u => typeof u['role'] === 'string' && UNPAIR_ALLOWED_ROLES.has(u['role'] as string))
        .map(u => ({
          _id: String(u['_id']),
          firstName: String(u['firstName'] ?? ''),
          lastName: String(u['lastName'] ?? ''),
          initials: this.#initials(String(u['firstName'] ?? ''), String(u['lastName'] ?? '')),
          staffRole: u['staffRole'] as string | undefined,
          role: u['role'] as string,
        }))

      this.eligibleUsers.set(mapped)
      this.step.set('select-user')
    } catch (err) {
      this.errorMessage.set(err instanceof Error ? err.message : String(err))
      this.step.set('error')
    }
  }

  #initials(firstName: string, lastName: string): string {
    return `${firstName.charAt(0) || ''}${lastName.charAt(0) || ''}`.toUpperCase()
  }
}
