import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  OnInit,
  computed,
  inject,
  output,
  signal,
} from '@angular/core'
import { CommonModule } from '@angular/common'
import { TranslateModule, TranslateService } from '@ngx-translate/core'
import { ConnectionService, OFFLINE_OUTBOX } from '@panary/shared/data-access'
import { DeviceConfigService } from '@panary/shared/data-access-config'
import { UNPAIR_ALLOWED_ROLES } from '@panary/users/domain'

// `UNPAIR_ALLOWED_ROLES` liegt zentral in `@panary/users/domain`: Eine
// PIN-Verifikation muss auf einen User mit einer dieser Rollen treffen
// (Defense-in-Depth — Filter clientseitig, Backend-Rückgabe zusätzlich
// gegengeprüft). Der Kreis muss mit `DEVICE_ACCESS_EXEMPT_ROLES` der
// Geräte-Zuweisung übereinstimmen, sonst wäre das Entkoppeln auf einem
// zugewiesenen Gerät unwiderruflich blockiert.

interface EligibleUser {
  _id: string
  firstName: string
  lastName: string
  initials: string
  staffRole?: string
  role: string
}

type DialogStep = 'loading' | 'select-user' | 'enter-pin' | 'confirm' | 'confirm-pending' | 'unpairing' | 'error'

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
  // Connect-Tier: nur in der POS-App belegt (sonst null → Zähler 0, unveränderter Ablauf).
  readonly #outbox = inject(OFFLINE_OUTBOX, { optional: true })

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

  /**
   * Noch nicht übertragene Offline-Bestellungen. `unpair()` löscht alle lokalen
   * IndexedDB-Datenbanken — diese Einträge sind danach unwiederbringlich weg (#322).
   * Der Zähler wird im Moment der Anzeige gelesen; die Anzahl, die der zweite
   * Bestätigungsschritt nennt, ist damit die zuletzt gemessene.
   */
  readonly pendingOutboxCount = computed(() => this.#outbox?.pendingCount() ?? 0)

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

  /** Zurück aus der Datenverlust-Warnung zur regulären Bestätigung. */
  backToConfirm(): void {
    this.step.set('confirm')
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

  /**
   * Schritt zwischen „Endgültig entkoppeln" und dem tatsächlichen Reset: Stehen noch
   * Bestellungen in der Outbox, wird deren Anzahl genannt und ein zweites Mal gefragt.
   * Bei leerer Outbox bleibt der Ablauf unverändert — eine Rückfrage, die immer kommt,
   * wird weggeklickt wie jede andere.
   */
  requestUnpair(): void {
    if (this.pendingOutboxCount() > 0) {
      this.step.set('confirm-pending')
      return
    }
    void this.performUnpair()
  }

  async performUnpair(): Promise<void> {
    // VOR dem Socket-Trennen lesen: danach ist der Zähler nicht mehr aussagekräftig.
    const discarded = this.pendingOutboxCount()
    this.step.set('unpairing')
    this.errorMessage.set(null)

    try {
      // Socket trennen, damit nach dem Reset kein Reconnect-Loop entsteht.
      this.#connectionService.socketDisconnect()

      const result = await this.#deviceConfigService.unpair({ discardedOutboxCount: discarded })

      if (!result.backendDeleted) {
        // Backend-Cleanup fehlgeschlagen — lokal trotzdem entkoppelt.
        // Hinweis fürs Log, aber kein Block — der User soll zum Setup zurück.
        console.warn('[unpair] Backend-DELETE fehlgeschlagen, lokaler Reset erfolgreich:', result.backendError)
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
