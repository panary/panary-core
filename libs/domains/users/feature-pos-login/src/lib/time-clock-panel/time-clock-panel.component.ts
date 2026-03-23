import {
  Component,
  ElementRef,
  HostListener,
  inject,
  input,
  output,
  signal,
  ViewChild,
  WritableSignal,
} from '@angular/core'
import { CommonModule } from '@angular/common'
import { User, UserService } from '@panary-core/users/data-access'

export type TimeClockAction = 'clock-in' | 'clock-out' | 'break-start' | 'break-end'
export type TimeClockMode = 'embedded' | 'mobile'

export interface TimeClockEvent {
  action: TimeClockAction
  employeeNumber: string
  timestamp: Date
}

@Component({
  selector: 'lib-time-clock-panel',
  imports: [CommonModule],
  templateUrl: './time-clock-panel.component.html',
  styleUrl: './time-clock-panel.component.scss',
})
export class TimeClockPanelComponent {
  //#region Injection
  readonly #userService = inject(UserService)
  //#endregion

  //#region ViewChild
  @ViewChild('panel') panelRef!: ElementRef<HTMLDivElement>
  //#endregion

  //#region Inputs
  /** Mode: 'embedded' for desktop (inside dark panel), 'mobile' for slide-in */
  readonly mode = input<TimeClockMode>('mobile')

  /** Users list for lookup (optional, falls back to UserService if empty or not provided, but preferred) */
  readonly users = input<Partial<User>[]>([])

  //#endregion

  //#region Outputs
  /** Emitted when a time clock action is confirmed */
  readonly actionConfirmed = output<TimeClockEvent>()
  //#endregion

  //#region State
  /** Panel is expanded (mobile slide-in) */
  readonly isExpanded: WritableSignal<boolean> = signal(false)

  /** Current selected action */
  readonly selectedAction: WritableSignal<TimeClockAction | null> = signal(null)

  /** Show PIN input dialog */
  readonly showPinDialog: WritableSignal<boolean> = signal(false)

  /** PIN input value */
  readonly pinInput: WritableSignal<string> = signal('')

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
      label: 'Kommen',
      icon: 'login',
      color: 'text-emerald-600',
      bgColor: 'bg-emerald-50 hover:bg-emerald-100',
    },
    {
      action: 'clock-out',
      label: 'Gehen',
      icon: 'logout',
      color: 'text-red-600',
      bgColor: 'bg-red-50 hover:bg-red-100',
    },
    {
      action: 'break-start',
      label: 'Pause',
      icon: 'coffee',
      color: 'text-amber-600',
      bgColor: 'bg-amber-50 hover:bg-amber-100',
    },
    {
      action: 'break-end',
      label: 'Pause Ende',
      icon: 'play_arrow',
      color: 'text-blue-600',
      bgColor: 'bg-blue-50 hover:bg-blue-100',
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
    this.pinInput.set('')
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
    this.pinInput.set('')
    this.pinError.set(false)
  }

  cancelAction(): void {
    this.selectedAction.set(null)
    this.showPinDialog.set(false)
    this.pinInput.set('')
    this.pinError.set(false)
  }

  //#endregion

  //#region PIN Input
  addDigit(digit: string): void {
    if (this.pinInput().length < 6) {
      this.pinInput.update(current => current + digit)
      this.pinError.set(false)
    }
  }

  deleteDigit(): void {
    this.pinInput.update(current => current.slice(0, -1))
    this.pinError.set(false)
  }

  clearPin(): void {
    this.pinInput.set('')
    this.pinError.set(false)
  }

  @HostListener('window:keydown', ['$event'])
  handleKeydown(event: KeyboardEvent): void {
    if (!this.showPinDialog()) return

    if (event.key === 'Escape') {
      this.cancelAction()
      return
    }

    if (event.key === 'Backspace') {
      event.preventDefault()
      this.deleteDigit()
      return
    }

    if (event.key === 'Enter' && this.pinInput().length >= 4) {
      event.preventDefault()
      this.confirmAction()
      return
    }

    if (/^[0-9]$/.test(event.key)) {
      event.preventDefault()
      this.addDigit(event.key)
    }
  }

  //#endregion

  //#region Confirm Action
  async confirmAction(): Promise<void> {
    const action = this.selectedAction()
    const employeePin = this.pinInput()

    if (!action || employeePin.length !== 6) {
      this.pinError.set(true)
      this.errorMessage.set('Bitte geben Sie eine gültige 6-stellige Personalnummer ein.')
      return
    }

    this.isLoading.set(true)
    this.pinError.set(false)
    this.errorMessage.set(null)

    try {
      // Find user by posPin (API lookup)
      const user = await this.#findUserByPin(employeePin)

      if (!user) {
        this.pinError.set(true)
        this.errorMessage.set('Kein Mitarbeiter mit dieser Personalnummer gefunden.')
        return
      }

      // Execute the time clock action
      await this.#executeTimeClockAction(action, user)

      const event: TimeClockEvent = {
        action,
        employeeNumber: employeePin,
        timestamp: new Date(),
      }

      this.actionConfirmed.emit(event)

      // Show success message
      const actionLabel = this.actions.find(a => a.action === action)?.label || action
      const userName = `${user.firstName} ${user.lastName}`
      this.successMessage.set(`${actionLabel} erfolgreich für ${userName}`)

      // Reset after delay
      setTimeout(() => {
        this.resetState()
      }, 2500)
    } catch (error: unknown) {
      console.error('Time clock action failed:', error)
      this.pinError.set(true)

      // Extract error message from backend response
      if (error && typeof error === 'object' && 'message' in error) {
        this.errorMessage.set((error as { message: string }).message)
      } else {
        this.errorMessage.set('Aktion fehlgeschlagen. Bitte versuchen Sie es erneut.')
      }
    } finally {
      this.isLoading.set(false)
    }
  }

  /**
   * Find user by Employee Number
   */
  /**
   * Find user by Employee Number (via Backend)
   * Bypass local cache/inputs to ensure we find any valid user, not just POS users.
   */
  async #findUserByPin(pin: string): Promise<User | undefined> {
    try {
      const pinAsNumber = parseInt(pin, 10)

      // Syntax confirmed: query uses Number type directly
      const query = {
        query: {
          employeeNumber: pinAsNumber,
          $limit: 1,
        },
      }

      const result = await this.#userService.find(query)

      const users = (Array.isArray(result) ? result : result.data) as User[]

      if (users.length > 0) {
        return users[0]
      }

      return undefined
    } catch (error) {
      console.error(`[TimeClock] Error searching user via API:`, error)
      return undefined
    }
  }

  /**
   * Execute the time clock action based on action type
   */
  async #executeTimeClockAction(action: TimeClockAction, user: User): Promise<void> {
    const userId = user._id
    console.log(`[TimeClock] Executing action "${action}" for user: ${userId}`)
    let result: any

    switch (action) {
      case 'clock-in':
        result = await this.#userService.checkin(userId)
        break
      case 'clock-out':
        result = await this.#userService.checkout(userId)
        break
      case 'break-start':
        result = await this.#userService.startBreak(userId)
        break
      case 'break-end':
        result = await this.#userService.endBreak(userId)
        break
    }
    console.log(`[TimeClock] Action "${action}" result:`, result)

    // Check if result is actually an error object (FeathersError)
    if (result && (result.code >= 400 || result.type === 'FeathersError' || result.name === 'NotAuthenticated')) {
      throw result
    }
  }

  //#endregion

  //#region Helpers
  getActionConfig(action: TimeClockAction) {
    return this.actions.find(a => a.action === action)
  }

  //#endregion
}
