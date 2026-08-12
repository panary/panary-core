import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog'
import { TranslateModule, TranslateService } from '@ngx-translate/core'

import { CashSession } from '@panary/businessdays/domain'
import { CashSessionService } from '@panary/businessdays/data-access'
import { AppError } from '@panary/shared-common'
import { ConnectionService } from '@panary/shared/data-access'
import { CASH_SESSION_AUTHORIZING_ROLES, User, UserStatus } from '@panary/users/domain'

export interface ManagerAuthorizeCashSessionDialogData {
  businessDayId: string
  /** Kassierer, FÜR den die Kasse eröffnet wird (i.d.R. der aktuelle POS-User). */
  cashierId: string
  cashierName?: string
  /** Standard-Wechselgeld (Cents) aus den Standort-Einstellungen — Vorbelegung. */
  defaultOpeningFloatCents?: number
}

type DialogStep = 'loading' | 'input' | 'enter-pin' | 'submitting' | 'submitted' | 'load-error'

interface AuthorizingManager {
  _id: string
  fullName: string
  initials: string
  staffRole?: string
  role: string
}

/**
 * Rollen, die eine Kassen-Eröffnung autorisieren dürfen (Spiegel von
 * PRIVILEGED_CASH_SESSION_ROLES). Zentral in `@panary/users/domain`, weil die
 * Geräte-Zuweisung (`DEVICE_ACCESS_EXEMPT_ROLES`) genau diesen Kreis auf
 * zugewiesenen Geräten sichtbar halten muss — sonst wäre die Freigabe tot.
 */
const AUTHORIZING_ROLES = CASH_SESSION_AUTHORIZING_ROLES

/** POS-PINs sind über alle POS-Oberflächen hinweg vierstellig (vgl. Login, Storno, Unpair). */
const PIN_LENGTH = 4

/** Anzeigedauer des Erfolgs-Screens, bevor der Dialog sich selbst schließt. */
const AUTO_CLOSE_MS = 1200

/**
 * Fehlercodes des Edge-Backends → i18n-Key. Die Server-Messages sind hartkodiert
 * deutsch; über den Code können wir sie lokalisiert ausgeben.
 */
const AUTH_ERROR_KEYS: Record<string, string> = {
  [AppError.CASH_SESSION_PIN_INVALID]: 'CASH_SESSION.AUTH_ERROR_PIN_INVALID',
  [AppError.CASH_SESSION_ROLE_DENIED]: 'CASH_SESSION.AUTH_ERROR_ROLE_DENIED',
  [AppError.CASH_SESSION_AUTH_REQUIRED]: 'CASH_SESSION.AUTH_ERROR_NOT_AUTHORIZED',
}

/**
 * POS-Dialog: Eine Kasse muss durch einen berechtigten Mitarbeiter
 * (Schichtleiter/Manager/Inhaber) freigegeben werden. Schritt 1 erfasst das
 * Wechselgeld und die freigebende Person, Schritt 2 deren POS-PIN. Die Kasse
 * wird auf den KASSIERER eröffnet (openedBy), nicht auf den autorisierenden
 * Manager. Der PIN wird server-seitig geprüft (cash-sessions.openAuthorized →
 * users.verifyPin).
 *
 * Ein Fehlversuch führt bewusst NICHT in einen eigenen Schritt zurück, sondern
 * bleibt in `enter-pin` — Managerauswahl und Betrag bleiben erhalten, damit nur
 * der PIN korrigiert werden muss.
 */
@Component({
  selector: 'app-manager-authorize-cash-session-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule],
  templateUrl: './manager-authorize-cash-session-dialog.component.html',
  styleUrl: './manager-authorize-cash-session-dialog.component.scss',
})
export class ManagerAuthorizeCashSessionDialogComponent {
  readonly #dialogRef = inject(MatDialogRef<ManagerAuthorizeCashSessionDialogComponent, CashSession | null>)
  readonly #cashSessionService = inject(CashSessionService)
  readonly #connectionService = inject(ConnectionService)
  readonly #translate = inject(TranslateService)
  protected readonly data = inject<ManagerAuthorizeCashSessionDialogData>(MAT_DIALOG_DATA)

  protected readonly step = signal<DialogStep>('loading')
  protected readonly managers = signal<AuthorizingManager[]>([])
  /** Berechtigte Mitarbeiter ohne POS-PIN — steuert die aussagekräftigere Leer-Meldung. */
  protected readonly managersWithoutPin = signal(0)
  protected readonly selectedManager = signal<AuthorizingManager | null>(null)
  protected readonly pin = signal('')
  protected readonly pinError = signal(false)
  protected readonly errorMessage = signal<string | null>(null)

  // Vorbelegung aus dem Standort-Default; ohne Default 0, damit die
  // Manager-Auswahl sofort tippbar ist („kein Wechselgeld" ist ein gültiger Wert).
  protected readonly openingFloatEuros = signal<number | null>(
    typeof this.data.defaultOpeningFloatCents === 'number' && this.data.defaultOpeningFloatCents > 0
      ? this.data.defaultOpeningFloatCents / 100
      : 0,
  )

  protected readonly digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
  protected readonly pinSlots = Array.from({ length: PIN_LENGTH }, (_, i) => i)

  protected readonly hasManagers = computed(() => this.managers().length > 0)

  protected readonly canContinue = computed(() => {
    const euros = this.openingFloatEuros()
    return euros !== null && Number.isFinite(euros) && euros >= 0
  })

  protected readonly openingFloatCents = computed(() => Math.round((this.openingFloatEuros() ?? 0) * 100))

  protected readonly openingFloatLabel = computed(() =>
    (this.openingFloatCents() / 100).toLocaleString('de-DE', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
    }),
  )

  protected readonly cashierLabel = computed(
    () => this.data.cashierName?.trim() || this.#translate.instant('CASH_SESSION.AUTH_CASHIER_FALLBACK'),
  )

  #resultSession: CashSession | null = null
  #autoCloseTimer: ReturnType<typeof setTimeout> | null = null
  #closed = false

  constructor() {
    // Backdrop-Fehltipp oder ESC dürfen mitten in der PIN-Eingabe nicht den
    // laufenden Kassiervorgang abbrechen — Schließen läuft nur über cancel()/close().
    this.#dialogRef.disableClose = true

    // Kein window:keydown — der CDK-OverlayKeyboardDispatcher routet Keydowns
    // an das oberste Overlay; ein globaler Listener würde zusätzlich fremde
    // Overlays mitlesen und ESC doppelt behandeln.
    this.#dialogRef
      .keydownEvents()
      .pipe(takeUntilDestroyed())
      .subscribe(event => this.#onKeydown(event))

    inject(DestroyRef).onDestroy(() => this.#clearAutoClose())

    void this.#loadManagers()
  }

  protected onOpeningFloatInput(event: Event): void {
    const value = (event.target as HTMLInputElement).valueAsNumber
    this.openingFloatEuros.set(Number.isNaN(value) ? null : value)
  }

  protected selectManager(manager: AuthorizingManager): void {
    if (!this.canContinue()) return
    this.selectedManager.set(manager)
    this.pin.set('')
    this.pinError.set(false)
    this.errorMessage.set(null)
    this.step.set('enter-pin')
  }

  protected backToInput(): void {
    this.selectedManager.set(null)
    this.pin.set('')
    this.pinError.set(false)
    this.errorMessage.set(null)
    this.step.set('input')
  }

  protected addDigit(digit: string): void {
    if (this.step() !== 'enter-pin' || this.pin().length >= PIN_LENGTH) return
    this.pin.update(current => current + digit)
    this.pinError.set(false)
    this.errorMessage.set(null)
    if (this.pin().length === PIN_LENGTH) {
      // Kurz verzögert, damit der vierte Punkt vor dem Request sichtbar wird (wie im Login).
      setTimeout(() => void this.submit(), 100)
    }
  }

  protected deleteDigit(): void {
    this.pin.update(current => current.slice(0, -1))
    this.pinError.set(false)
    this.errorMessage.set(null)
  }

  protected async submit(): Promise<void> {
    const manager = this.selectedManager()
    if (!manager || this.step() !== 'enter-pin' || this.pin().length < PIN_LENGTH) return

    const pin = this.pin()
    this.step.set('submitting')
    this.errorMessage.set(null)

    try {
      this.#resultSession = await this.#cashSessionService.openAuthorized({
        businessDayId: this.data.businessDayId,
        openedBy: this.data.cashierId,
        openingFloatCents: this.openingFloatCents(),
        label: this.data.cashierName ? `Kasse ${this.data.cashierName}` : 'Kasse',
        authorizedByUserId: manager._id,
        pin,
      })
      this.pin.set('')
      this.step.set('submitted')
      this.#autoCloseTimer = setTimeout(() => this.close(), AUTO_CLOSE_MS)
    } catch (err) {
      // Zurück in die PIN-Eingabe statt in einen Fehler-Schritt: Manager und
      // Betrag bleiben erhalten, nur der PIN muss korrigiert werden.
      this.errorMessage.set(this.#toErrorMessage(err))
      this.pin.set('')
      this.pinError.set(true)
      this.step.set('enter-pin')
      navigator.vibrate?.([100, 50, 100])
    }
  }

  protected retryLoad(): void {
    void this.#loadManagers()
  }

  protected cancel(): void {
    if (this.step() === 'submitting') return
    this.#close(null)
  }

  protected close(): void {
    this.#close(this.#resultSession)
  }

  async #loadManagers(): Promise<void> {
    this.step.set('loading')
    this.errorMessage.set(null)

    try {
      // Bewusst der rohe Feathers-Service statt UserService: letzterer läuft
      // durch handleError und würde zusätzlich zum Inline-Fehlerschritt eine
      // Notification werfen. Zudem ist die Rollen-Query hier explizit, statt
      // sich auf den paginierten Auto-Load der User-Liste zu verlassen.
      const response = await this.#connectionService.usersService.find({
        query: {
          role: { $in: [...AUTHORIZING_ROLES] },
          $sort: { firstName: 1 },
          $limit: 100,
        },
      })
      const eligible = (Array.isArray(response) ? response : (response?.data ?? [])) as User[]

      // `hasPosPin` ist ein virtuelles Feld des externen Resolvers und daher
      // nicht query-fähig — es spiegelt exakt die Server-Bedingung von verifyPin.
      // Kein isPosUser-Filter: das Backend prüft nur PIN und Rolle, ein
      // Manager ohne POS-Kennzeichnung dürfte also freigeben.
      const active = eligible.filter(user => user.status === UserStatus.ACTIVE)
      const withPin = active.filter(user => user.hasPosPin === true)

      this.managersWithoutPin.set(active.length - withPin.length)
      this.managers.set(withPin.map(user => this.#toManager(user)))
      this.step.set('input')
    } catch (err) {
      this.errorMessage.set(err instanceof Error ? err.message : String(err))
      this.step.set('load-error')
    }
  }

  #toManager(user: User): AuthorizingManager {
    const firstName = user.firstName ?? ''
    const lastName = user.lastName ?? ''
    return {
      _id: String(user._id),
      fullName: `${firstName} ${lastName}`.trim(),
      initials: `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase(),
      // `?? undefined`: `staffRole` ist seit #183 `string | null` (leere
      // SQLite-Spalte). Fuer dieses UI-DTO ist „nicht gesetzt" genau ein Zustand.
      staffRole: user.staffRole ?? undefined,
      role: user.role,
    }
  }

  #onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      this.cancel()
      return
    }
    // Der Dispatcher liefert auch Tastendrücke aus dem Wechselgeld-Feld —
    // ohne diese Sperre landeten sie im PIN.
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

  #toErrorMessage(err: unknown): string {
    const error = err as { message?: string; data?: { code?: string } } | undefined
    const appCode = error?.data?.code

    if (appCode && AUTH_ERROR_KEYS[appCode]) return this.#translate.instant(AUTH_ERROR_KEYS[appCode])
    // Unbekannter Code oder gar keiner (Timeout, 401, Validierung) — die
    // Server-Message ist besser als nichts, sonst der generische Text.
    return error?.message?.trim() || this.#translate.instant('CASH_SESSION.AUTH_ERROR_GENERIC')
  }

  /** Idempotent — Auto-Close-Timer und Button-Tipp dürfen sich nicht überholen. */
  #close(result: CashSession | null): void {
    if (this.#closed) return
    this.#closed = true
    this.#clearAutoClose()
    this.#dialogRef.close(result)
  }

  #clearAutoClose(): void {
    if (this.#autoCloseTimer === null) return
    clearTimeout(this.#autoCloseTimer)
    this.#autoCloseTimer = null
  }
}

/**
 * Öffnet den Kassen-Freigabe-Dialog mit der für alle Aufrufer identischen
 * Konfiguration. Liefert die eröffnete `CashSession` oder `null` bei Abbruch.
 */
export function openManagerAuthorizeCashSessionDialog(
  dialog: MatDialog,
  data: ManagerAuthorizeCashSessionDialogData,
): MatDialogRef<ManagerAuthorizeCashSessionDialogComponent, CashSession | null> {
  return dialog.open<
    ManagerAuthorizeCashSessionDialogComponent,
    ManagerAuthorizeCashSessionDialogData,
    CashSession | null
  >(ManagerAuthorizeCashSessionDialogComponent, {
    width: '28.75rem',
    maxWidth: '92vw',
    maxHeight: '90vh',
    panelClass: 'rounded-dialog',
    // Ohne Override fokussiert Material das erste Element (Schließen-X bzw. das
    // Betragsfeld) — auf dem Sunmi-Tablet spränge dabei die Bildschirmtastatur auf.
    autoFocus: 'dialog',
    data,
  })
}
