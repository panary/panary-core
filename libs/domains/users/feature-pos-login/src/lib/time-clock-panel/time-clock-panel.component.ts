import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  inject,
  input,
  signal,
  ViewChild,
  WritableSignal,
} from '@angular/core'
import { CommonModule } from '@angular/common'
import { TranslateService } from '@ngx-translate/core'
import { TranslateModule } from '@ngx-translate/core'
import { readTenantSuspension, TenantSuspensionService } from '@panary/shared/data-access'
import { IconComponent } from '@panary/shared/ui-common'
import { STAMP_LOCKED, STAMP_NUMBER_REJECTED, StampAction, UserService } from '@panary/users/data-access'

export type TimeClockAction = 'clock-in' | 'clock-out' | 'break-start' | 'break-end'
export type TimeClockMode = 'embedded' | 'mobile'

/** Buchungsart des Servers je Panel-Aktion. */
const STAMP_ACTION_OF: Record<TimeClockAction, StampAction> = {
  'clock-in': 'checkin',
  'clock-out': 'checkout',
  'break-start': 'startBreak',
  'break-end': 'endBreak',
}

/** Zeigt die Bestätigung vor der Buchung: nur das, was der Server als Vorschau herausgibt. */
export interface TimeClockConfirmation {
  /** „Max M." — Vorname und Initial des Nachnamens. */
  displayName: string
}

@Component({
  selector: 'lib-time-clock-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, TranslateModule, IconComponent],
  templateUrl: './time-clock-panel.component.html',
  styleUrl: './time-clock-panel.component.scss',
})
export class TimeClockPanelComponent {
  //#region Injection
  readonly #userService = inject(UserService)
  readonly #translateService = inject(TranslateService)
  readonly #tenantSuspension = inject(TenantSuspensionService)
  readonly #destroyRef = inject(DestroyRef)
  //#endregion

  //#region ViewChild
  @ViewChild('panel') panelRef!: ElementRef<HTMLDivElement>
  //#endregion

  //#region Inputs
  /** Mode: 'embedded' for desktop (inside dark panel), 'mobile' for slide-in */
  readonly mode = input<TimeClockMode>('mobile')

  //#endregion

  //#region State
  /** Panel is expanded (mobile slide-in) */
  readonly isExpanded: WritableSignal<boolean> = signal(false)

  /** Current selected action */
  readonly selectedAction: WritableSignal<TimeClockAction | null> = signal(null)

  /** Show PIN input dialog */
  readonly showPinDialog: WritableSignal<boolean> = signal(false)

  /** Eingegebene Personalnummer — bleibt ein String, führende Nullen zählen. */
  readonly employeeNumberInput: WritableSignal<string> = signal('')

  /** Bestätigungsschritt: Name aus der Vorschau des Servers, solange noch nichts gebucht ist. */
  readonly confirmation: WritableSignal<TimeClockConfirmation | null> = signal(null)

  /** Verbleibende Sekunden der Sperre nach zu vielen Fehlversuchen (0 = nicht gesperrt). */
  readonly lockSecondsLeft: WritableSignal<number> = signal(0)

  /** PIN error state */
  readonly pinError: WritableSignal<boolean> = signal(false)

  /** Error message for failed actions */
  readonly errorMessage: WritableSignal<string | null> = signal(null)

  /** Loading state during action submission */
  readonly isLoading: WritableSignal<boolean> = signal(false)

  /** Success message after action */
  readonly successMessage: WritableSignal<string | null> = signal(null)
  //#endregion

  //#region Touch Tracking
  private touchStartY = 0
  private touchCurrentY = 0
  private isDragging = false
  private readonly DRAG_THRESHOLD = 50
  //#endregion

  //#region Action Config
  readonly actions: { action: TimeClockAction; label: string; icon: string; color: string; bgColor: string }[] = [
    {
      action: 'clock-in',
      label: 'TIME_CLOCK.CLOCK_IN',
      icon: 'login',
      color: 'text-emerald-600 dark:text-emerald-400',
      bgColor: 'bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:hover:bg-emerald-500/25',
    },
    {
      action: 'clock-out',
      label: 'TIME_CLOCK.CLOCK_OUT',
      icon: 'logout',
      color: 'text-red-600 dark:text-red-400',
      bgColor: 'bg-red-50 hover:bg-red-100 dark:bg-red-500/15 dark:hover:bg-red-500/25',
    },
    {
      action: 'break-start',
      label: 'TIME_CLOCK.BREAK_START',
      icon: 'coffee',
      color: 'text-amber-600 dark:text-amber-400',
      bgColor: 'bg-amber-50 hover:bg-amber-100 dark:bg-amber-500/15 dark:hover:bg-amber-500/25',
    },
    {
      action: 'break-end',
      label: 'TIME_CLOCK.BREAK_END',
      icon: 'play_arrow',
      color: 'text-blue-600 dark:text-blue-400',
      bgColor: 'bg-blue-50 hover:bg-blue-100 dark:bg-blue-500/15 dark:hover:bg-blue-500/25',
    },
  ]
  //#endregion

  //#region Panel Toggle
  togglePanel(): void {
    this.isExpanded.update(v => !v)
    if (!this.isExpanded()) {
      this.resetState()
    }
  }

  closePanel(): void {
    this.isExpanded.set(false)
    this.resetState()
  }

  private resetState(): void {
    this.selectedAction.set(null)
    this.showPinDialog.set(false)
    this.employeeNumberInput.set('')
    this.confirmation.set(null)
    this.pinError.set(false)
    this.errorMessage.set(null)
    this.successMessage.set(null)
  }

  //#endregion

  //#region Touch Gestures
  onTouchStart(event: TouchEvent): void {
    this.touchStartY = event.touches[0].clientY
    this.touchCurrentY = this.touchStartY
    this.isDragging = true
  }

  onTouchMove(event: TouchEvent): void {
    if (!this.isDragging) return
    this.touchCurrentY = event.touches[0].clientY

    const diff = this.touchCurrentY - this.touchStartY

    // Prevent default to avoid scroll
    if (Math.abs(diff) > 10) {
      event.preventDefault()
    }
  }

  onTouchEnd(): void {
    if (!this.isDragging) return

    const diff = this.touchCurrentY - this.touchStartY

    if (this.isExpanded()) {
      // Swipe down to close
      if (diff > this.DRAG_THRESHOLD) {
        this.closePanel()
      }
    } else {
      // Swipe up to open
      if (diff < -this.DRAG_THRESHOLD) {
        this.isExpanded.set(true)
      }
    }

    this.isDragging = false
  }

  //#endregion

  //#region Action Selection
  selectAction(action: TimeClockAction): void {
    this.selectedAction.set(action)
    this.showPinDialog.set(true)
    this.employeeNumberInput.set('')
    this.confirmation.set(null)
    this.pinError.set(false)
    this.errorMessage.set(null)
    if (this.isLocked()) this.#showLocked()
  }

  cancelAction(): void {
    this.selectedAction.set(null)
    this.showPinDialog.set(false)
    this.employeeNumberInput.set('')
    this.confirmation.set(null)
    this.pinError.set(false)
  }

  /** „Abbrechen" im Bestätigungsschritt: nichts wird gebucht, die Eingabe beginnt von vorn. */
  cancelConfirmation(): void {
    this.confirmation.set(null)
    this.employeeNumberInput.set('')
    this.pinError.set(false)
    this.errorMessage.set(null)
  }

  //#endregion

  //#region PIN Input
  /** Serverseitige Sperre nach zu vielen Fehlversuchen läuft noch. */
  isLocked(): boolean {
    return this.lockSecondsLeft() > 0
  }

  addDigit(digit: string): void {
    if (this.isLocked() || this.isLoading() || this.confirmation()) return
    if (this.employeeNumberInput().length < 6) {
      this.employeeNumberInput.update(current => current + digit)
      this.pinError.set(false)
    }
  }

  deleteDigit(): void {
    if (this.isLocked() || this.isLoading() || this.confirmation()) return
    this.employeeNumberInput.update(current => current.slice(0, -1))
    this.pinError.set(false)
  }

  clearPin(): void {
    if (this.isLocked() || this.isLoading() || this.confirmation()) return
    this.employeeNumberInput.set('')
    this.pinError.set(false)
  }

  @HostListener('window:keydown', ['$event'])
  handleKeydown(event: KeyboardEvent): void {
    if (!this.showPinDialog()) return

    if (event.key === 'Escape') {
      if (this.confirmation()) this.cancelConfirmation()
      else this.cancelAction()
      return
    }

    if (event.key === 'Backspace') {
      event.preventDefault()
      this.deleteDigit()
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      if (this.confirmation()) void this.confirmAction()
      else if (this.employeeNumberInput().length === 6) void this.lookupEmployee()
      return
    }

    if (/^[0-9]$/.test(event.key)) {
      event.preventDefault()
      this.addDigit(event.key)
    }
  }

  //#endregion

  //#region Confirm Action
  /** Schritt 1: Nummer zur Vorschau an den Server — bucht nichts, zeigt Name und Initial zur Bestätigung. */
  async lookupEmployee(): Promise<void> {
    const action = this.selectedAction()
    const employeeNumber = this.employeeNumberInput()

    if (!action || employeeNumber.length !== 6 || this.isLocked() || this.isLoading()) {
      if (!this.isLocked()) {
        this.pinError.set(true)
        this.errorMessage.set(this.#translateService.instant('TIME_CLOCK.INVALID_6_DIGIT'))
      }
      return
    }

    // Wie im Dashboard: Bei gesperrtem Mandanten gar nicht erst senden (panary/panary-core#810).
    if (this.#tenantSuspension.suspended()) {
      this.pinError.set(true)
      this.errorMessage.set(this.#translateService.instant('CLOUD_STATUS.TENANT_SUSPENDED'))
      return
    }

    this.isLoading.set(true)
    this.pinError.set(false)
    this.errorMessage.set(null)

    try {
      const lookup = await this.#userService.lookupByEmployeeNumber(employeeNumber)
      if (!lookup?.firstName) throw new Error('empty lookup')
      const initial = lookup.lastNameInitial ? ` ${lookup.lastNameInitial}.` : ''
      this.confirmation.set({ displayName: `${lookup.firstName}${initial}` })
    } catch (error: unknown) {
      this.#showError(error)
    } finally {
      this.isLoading.set(false)
    }
  }

  /** Schritt 2: Der Mitarbeiter hat den Namen bestätigt — jetzt wird gebucht. */
  async confirmAction(): Promise<void> {
    const action = this.selectedAction()
    const employeeNumber = this.employeeNumberInput()
    const confirmation = this.confirmation()

    if (!action || !confirmation || employeeNumber.length !== 6 || this.isLoading()) return

    if (this.#tenantSuspension.suspended()) {
      this.pinError.set(true)
      this.errorMessage.set(this.#translateService.instant('CLOUD_STATUS.TENANT_SUSPENDED'))
      return
    }

    this.isLoading.set(true)
    this.pinError.set(false)
    this.errorMessage.set(null)

    try {
      const result = await this.#userService.stampByEmployeeNumber(employeeNumber, STAMP_ACTION_OF[action])

      // Ein Aufruf ohne Antwort ist ein Fehlschlag, kein Erfolg (panary/panary-core#810).
      if (!result) throw new Error('empty stamp result')

      const actionLabel = this.actions.find(a => a.action === action)?.label || action
      this.successMessage.set(
        this.#translateService.instant('TIME_CLOCK.ACTION_SUCCESS', {
          action: this.#translateService.instant(actionLabel),
          user: confirmation.displayName,
        }),
      )

      // Reset after delay
      setTimeout(() => {
        this.resetState()
      }, 2500)
    } catch (error: unknown) {
      this.#showError(error)
    } finally {
      this.isLoading.set(false)
    }
  }

  /**
   * Fehlerabbildung ohne Toast und ohne Sitzungs-Reset (der `UserService` reicht die Fehler unverändert durch).
   * Gesperrt → Wartezeit; Einheitsmeldung für jede abgelehnte Nummer; Zustandskonflikt (409) mit eigener Meldung;
   * alles andere als „fehlgeschlagen" — nie als Erfolg.
   */
  #showError(error: unknown): void {
    const { code, data, message } = (error ?? {}) as {
      code?: unknown
      data?: Record<string, unknown>
      message?: unknown
    }
    this.pinError.set(true)
    this.confirmation.set(null)

    const suspension = code === 403 ? readTenantSuspension(error) : null
    if (suspension) {
      this.#tenantSuspension.markSuspended(suspension.tenantStatus)
      this.errorMessage.set(this.#translateService.instant('CLOUD_STATUS.TENANT_SUSPENDED'))
      return
    }

    if (data?.['code'] === STAMP_LOCKED) {
      const seconds = Number(data['retryAfterSeconds'])
      this.#startLockout(Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 60)
      return
    }

    this.employeeNumberInput.set('')
    if (data?.['code'] === STAMP_NUMBER_REJECTED) {
      this.errorMessage.set(this.#translateService.instant('TIME_CLOCK.NUMBER_REJECTED'))
    } else if (code === 409) {
      this.errorMessage.set(this.#translateService.instant('TIME_CLOCK.STATE_CONFLICT'))
    } else {
      console.error('Time clock action failed:', error)
      this.errorMessage.set(this.#translateService.instant('TIME_CLOCK.ACTION_FAILED'))
    }
  }

  //#endregion

  //#region Lockout
  #lockTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    this.#destroyRef.onDestroy(() => this.#stopLockTimer())
  }

  #startLockout(seconds: number): void {
    this.employeeNumberInput.set('')
    this.lockSecondsLeft.set(seconds)
    this.#showLocked()
    if (this.#lockTimer) clearInterval(this.#lockTimer)
    this.#lockTimer = setInterval(() => {
      const left = this.lockSecondsLeft() - 1
      this.lockSecondsLeft.set(Math.max(left, 0))
      if (left <= 0) {
        this.#stopLockTimer()
        this.pinError.set(false)
        this.errorMessage.set(null)
      } else {
        this.#showLocked()
      }
    }, 1000)
  }

  #stopLockTimer(): void {
    if (this.#lockTimer) clearInterval(this.#lockTimer)
    this.#lockTimer = null
  }

  #showLocked(): void {
    this.pinError.set(true)
    this.errorMessage.set(this.#translateService.instant('TIME_CLOCK.LOCKED', { seconds: this.lockSecondsLeft() }))
  }

  //#endregion

  //#region Helpers
  /** Frage des Bestätigungsschritts je Aktion: „Max M. – Einstempeln?" */
  confirmQuestionKey(): string {
    const keys: Record<TimeClockAction, string> = {
      'clock-in': 'TIME_CLOCK.CONFIRM_CLOCK_IN',
      'clock-out': 'TIME_CLOCK.CONFIRM_CLOCK_OUT',
      'break-start': 'TIME_CLOCK.CONFIRM_BREAK_START',
      'break-end': 'TIME_CLOCK.CONFIRM_BREAK_END',
    }
    return keys[this.selectedAction() ?? 'clock-in']
  }

  getActionConfig(action: TimeClockAction) {
    return this.actions.find(a => a.action === action)
  }

  //#endregion
}
