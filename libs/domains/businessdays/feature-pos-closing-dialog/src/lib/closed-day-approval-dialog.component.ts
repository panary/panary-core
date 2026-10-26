import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog'
import { TranslateModule, TranslateService } from '@ngx-translate/core'

import { BusinessDayService, type ClosedDayApproval } from '@panary/businessdays/data-access'
import { CLOSED_DAY_APPROVER_ROLES } from '@panary/locations/domain'
import { AppError } from '@panary/shared-common'
import { ConnectionService } from '@panary/shared/data-access'
import { User, UserStatus } from '@panary/users/domain'
import { IconComponent } from '@panary/shared/ui-common'

export interface ClosedDayApprovalDialogData {
  /** Kalendertag in Filialzeit (`YYYY-MM-DD`), wie ihn die Edge meldet. */
  date: string
  policy: 'manager-approval' | 'block'
  /** Betriebsart der Filiale — steuert „verkaufen" vs. „Bestellungen annehmen" (ADR 0037). */
  operationMode?: string | null
}

type DialogStep = 'loading' | 'input' | 'enter-pin' | 'submitting' | 'submitted' | 'load-error'

interface Approver {
  _id: string
  fullName: string
  initials: string
  staffRole?: string
  role: string
}

/** POS-PINs sind über alle POS-Oberflächen hinweg vierstellig (vgl. Login, Storno, Kassen-Freigabe). */
const PIN_LENGTH = 4

/** Anzeigedauer des Erfolgs-Screens, bevor der Dialog sich selbst schließt. */
const AUTO_CLOSE_MS = 1200

const APPROVE_ERROR_KEYS: Record<string, string> = {
  [AppError.CLOSED_DAY_PIN_INVALID]: 'CLOSED_DAY.ERROR_PIN_INVALID',
  [AppError.CLOSED_DAY_ROLE_DENIED]: 'CLOSED_DAY.ERROR_ROLE_DENIED',
}

/**
 * POS-Dialog: Laut Öffnungszeiten ist heute Ruhetag (panary/panary-core#1133, ADR 0062).
 * Weiter nur mit der PIN eines Kontos, das die Ruhetag-Regel des Standorts zulässt —
 * `manager-approval`: Manager oder Inhaber, `block`: nur Inhaber. PIN und Rolle prüft
 * die Edge (`businessdays.approveClosedDay`); die Auswahl hier zeigt nur, wer in Frage
 * kommt. Aufbau wie die Kassen-Freigabe: Person wählen, dann PIN.
 */
@Component({
  selector: 'app-closed-day-approval-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, TranslateModule],
  templateUrl: './closed-day-approval-dialog.component.html',
  styleUrl: './closed-day-approval-dialog.component.scss',
})
export class ClosedDayApprovalDialogComponent {
  readonly #dialogRef = inject(MatDialogRef<ClosedDayApprovalDialogComponent, ClosedDayApproval | null>)
  readonly #businessDayService = inject(BusinessDayService)
  readonly #connectionService = inject(ConnectionService)
  readonly #translate = inject(TranslateService)
  protected readonly data = inject<ClosedDayApprovalDialogData>(MAT_DIALOG_DATA)

  protected readonly step = signal<DialogStep>('loading')
  protected readonly approvers = signal<Approver[]>([])
  protected readonly approversWithoutPin = signal(0)
  protected readonly selectedApprover = signal<Approver | null>(null)
  protected readonly pin = signal('')
  protected readonly pinError = signal(false)
  protected readonly errorMessage = signal<string | null>(null)

  protected readonly digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
  protected readonly pinSlots = Array.from({ length: PIN_LENGTH }, (_, i) => i)

  protected readonly hasApprovers = computed(() => this.approvers().length > 0)
  protected readonly isBlock = computed(() => this.data.policy === 'block')
  protected readonly isOrdersOnly = computed(() => this.data.operationMode === 'orders-only')
  /** `26.10.2026` statt `2026-10-26` — der Tag, um den es geht, ohne Zeitzonen-Umweg. */
  protected readonly dateLabel = computed(() => this.data.date.split('-').reverse().join('.'))

  #result: ClosedDayApproval | null = null
  #autoCloseTimer: ReturnType<typeof setTimeout> | null = null
  #closed = false

  constructor() {
    // Ein Fehltipp auf den Hintergrund darf die PIN-Eingabe nicht abbrechen.
    this.#dialogRef.disableClose = true
    this.#dialogRef
      .keydownEvents()
      .pipe(takeUntilDestroyed())
      .subscribe(event => this.#onKeydown(event))
    inject(DestroyRef).onDestroy(() => this.#clearAutoClose())
    void this.#loadApprovers()
  }

  protected selectApprover(approver: Approver): void {
    this.selectedApprover.set(approver)
    this.pin.set('')
    this.pinError.set(false)
    this.errorMessage.set(null)
    this.step.set('enter-pin')
  }

  protected backToInput(): void {
    this.selectedApprover.set(null)
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
      setTimeout(() => void this.submit(), 100)
    }
  }

  protected deleteDigit(): void {
    this.pin.update(current => current.slice(0, -1))
    this.pinError.set(false)
    this.errorMessage.set(null)
  }

  protected async submit(): Promise<void> {
    const approver = this.selectedApprover()
    if (!approver || this.step() !== 'enter-pin' || this.pin().length < PIN_LENGTH) return

    const pin = this.pin()
    this.step.set('submitting')
    this.errorMessage.set(null)
    try {
      this.#result = await this.#businessDayService.approveClosedDay({ authorizedByUserId: approver._id, pin })
      this.pin.set('')
      this.step.set('submitted')
      this.#autoCloseTimer = setTimeout(() => this.close(), AUTO_CLOSE_MS)
    } catch (err) {
      this.errorMessage.set(this.#toErrorMessage(err))
      this.pin.set('')
      this.pinError.set(true)
      this.step.set('enter-pin')
      navigator.vibrate?.([100, 50, 100])
    }
  }

  protected retryLoad(): void {
    void this.#loadApprovers()
  }

  protected cancel(): void {
    if (this.step() === 'submitting') return
    this.#close(null)
  }

  protected close(): void {
    this.#close(this.#result)
  }

  async #loadApprovers(): Promise<void> {
    this.step.set('loading')
    this.errorMessage.set(null)
    try {
      // Roher Feathers-Service statt UserService: kein zusätzliches handleError-Toast
      // neben dem Inline-Fehlerschritt (wie in der Kassen-Freigabe).
      const response = await this.#connectionService.usersService.find({
        query: {
          role: { $in: [...CLOSED_DAY_APPROVER_ROLES[this.data.policy]] },
          $sort: { firstName: 1 },
          $limit: 100,
        },
      })
      const eligible = (Array.isArray(response) ? response : (response?.data ?? [])) as User[]
      const active = eligible.filter(user => user.status === UserStatus.ACTIVE)
      const withPin = active.filter(user => user.hasPosPin === true)
      this.approversWithoutPin.set(active.length - withPin.length)
      this.approvers.set(withPin.map(user => this.#toApprover(user)))
      this.step.set('input')
    } catch (err) {
      this.errorMessage.set(err instanceof Error ? err.message : String(err))
      this.step.set('load-error')
    }
  }

  #toApprover(user: User): Approver {
    const firstName = user.firstName ?? ''
    const lastName = user.lastName ?? ''
    return {
      _id: String(user._id),
      fullName: `${firstName} ${lastName}`.trim(),
      initials: `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase(),
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
    if (appCode === AppError.CLOSED_DAY_ROLE_DENIED && this.isBlock()) {
      return this.#translate.instant('CLOSED_DAY.ERROR_OWNER_ONLY')
    }
    if (appCode && APPROVE_ERROR_KEYS[appCode]) return this.#translate.instant(APPROVE_ERROR_KEYS[appCode])
    return error?.message?.trim() || this.#translate.instant('CLOSED_DAY.ERROR_GENERIC')
  }

  #close(result: ClosedDayApproval | null): void {
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

/** Öffnet den Ruhetag-Freigabe-Dialog. Liefert die Freigabe oder `null` bei Abbruch. */
export function openClosedDayApprovalDialog(
  dialog: MatDialog,
  data: ClosedDayApprovalDialogData,
): MatDialogRef<ClosedDayApprovalDialogComponent, ClosedDayApproval | null> {
  return dialog.open<ClosedDayApprovalDialogComponent, ClosedDayApprovalDialogData, ClosedDayApproval | null>(
    ClosedDayApprovalDialogComponent,
    {
      width: '28.75rem',
      maxWidth: '92vw',
      maxHeight: '90vh',
      panelClass: 'rounded-dialog',
      // Wie bei der Kassen-Freigabe: sonst springt auf dem Sunmi die Bildschirmtastatur auf.
      autoFocus: 'dialog',
      data,
    },
  )
}
