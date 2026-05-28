import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog'
import { TranslateModule } from '@ngx-translate/core'

import { CashSession } from '@panary/businessdays/domain'
import { CashSessionService } from '@panary/businessdays/data-access'
import { User, UserSystemRole } from '@panary/users/domain'
import { UserService } from '@panary/users/data-access'

export interface ManagerAuthorizeCashSessionDialogData {
  businessDayId: string
  /** Kassierer, FÜR den die Kasse eröffnet wird (i.d.R. der aktuelle POS-User). */
  cashierId: string
  cashierName?: string
  /** Standard-Wechselgeld (Cents) aus den Standort-Einstellungen — Vorbelegung. */
  defaultOpeningFloatCents?: number
}

type DialogPhase = 'input' | 'submitting' | 'submitted' | 'failed'

/** Rollen, die eine Kassen-Eröffnung autorisieren dürfen (Spiegel von PRIVILEGED_CASH_SESSION_ROLES). */
const AUTHORIZING_ROLES = new Set<string>([
  UserSystemRole.PLATFORM_OWNER,
  UserSystemRole.PLATFORM_ADMIN,
  UserSystemRole.PLATFORM_SUPPORT,
  UserSystemRole.TENANT_OWNER,
  UserSystemRole.TENANT_MANAGER,
  UserSystemRole.TENANT_TECHNICIAN,
])

/**
 * POS-Dialog: Eine Kasse muss durch einen berechtigten Mitarbeiter
 * (Schichtleiter/Manager/Inhaber) freigegeben werden. Dieser wählt sich aus,
 * gibt seinen POS-PIN ein und hinterlegt das Wechselgeld (vorausgefüllt aus dem
 * Standort-Default). Die Kasse wird auf den KASSIERER eröffnet (openedBy), nicht
 * auf den autorisierenden Manager. Der PIN wird server-seitig geprüft
 * (cash-sessions.openAuthorized → users.verifyPin).
 */
@Component({
  selector: 'app-manager-authorize-cash-session-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, TranslateModule, FormsModule],
  template: `
    <h2 mat-dialog-title>Kasse freigeben</h2>
    <mat-dialog-content class="text-sm space-y-3">
      @if (phase() === 'input') {
        <p class="text-gray-600 dark:text-gray-300">
          Für
          <span class="font-medium">{{ data.cashierName || 'den Kassierer' }}</span>
          ist noch keine Kasse eröffnet. Ein berechtigter Mitarbeiter muss die Eröffnung freigeben.
        </p>

        <label class="flex flex-col gap-1">
          <span class="text-xs text-gray-500 dark:text-gray-400">Freigebende Person</span>
          <select
            [ngModel]="managerId()"
            (ngModelChange)="managerId.set($event)"
            class="border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2 bg-white dark:bg-gray-900 h-12"
          >
            <option value="">— bitte wählen —</option>
            @for (m of managers(); track m._id) {
              <option [value]="m._id">{{ m.firstName }} {{ m.lastName }}</option>
            }
          </select>
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-xs text-gray-500 dark:text-gray-400">PIN</span>
          <input
            type="password"
            inputmode="numeric"
            autocomplete="off"
            [ngModel]="pin()"
            (ngModelChange)="pin.set($event)"
            class="border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2 bg-white dark:bg-gray-900 h-12"
          />
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-xs text-gray-500 dark:text-gray-400">Wechselgeld-Anfangsbestand (€)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            [ngModel]="openingFloatEuros()"
            (ngModelChange)="openingFloatEuros.set($event)"
            class="border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2 bg-white dark:bg-gray-900 h-12"
          />
        </label>
      } @else if (phase() === 'submitting') {
        <p>Kasse wird freigegeben…</p>
      } @else if (phase() === 'submitted') {
        <p>Kasse eröffnet — die Bestellung kann jetzt kassiert werden.</p>
      } @else {
        <div class="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-xl">
          {{ errorMessage() }}
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions class="flex justify-end gap-2">
      @if (phase() === 'submitted') {
        <button class="bg-white dark:bg-gray-800 border rounded-xl px-4 h-12" (click)="close()">
          {{ 'COMMON.CLOSE' | translate }}
        </button>
      } @else {
        <button
          class="bg-white dark:bg-gray-800 border rounded-xl px-4 h-12"
          (click)="cancel()"
          [disabled]="phase() === 'submitting'"
        >
          {{ 'COMMON.CANCEL' | translate }}
        </button>
        <button
          class="bg-blue-600 text-white rounded-xl px-4 h-12 disabled:opacity-50"
          [disabled]="!canSubmit() || phase() === 'submitting'"
          (click)="submit()"
        >
          Freigeben
        </button>
      }
    </mat-dialog-actions>
  `,
})
export class ManagerAuthorizeCashSessionDialogComponent {
  private dialogRef = inject(MatDialogRef<ManagerAuthorizeCashSessionDialogComponent>)
  private cashSessionService = inject(CashSessionService)
  private userService = inject(UserService)
  protected readonly data = inject<ManagerAuthorizeCashSessionDialogData>(MAT_DIALOG_DATA)

  protected readonly phase = signal<DialogPhase>('input')
  protected readonly errorMessage = signal<string | null>(null)
  protected resultSession: CashSession | null = null

  // Formular-State als Signals, damit `canSubmit` (computed) auf Änderungen
  // reagiert. Plain Properties + [(ngModel)] mutieren nur die Property, aber
  // triggern kein Signal-Re-Compute → der Submit-Button bliebe dauerhaft
  // deaktiviert.
  protected readonly managerId = signal<string>('')
  protected readonly pin = signal<string>('')
  protected readonly openingFloatEuros = signal<number | null>(
    typeof this.data.defaultOpeningFloatCents === 'number' && this.data.defaultOpeningFloatCents > 0
      ? this.data.defaultOpeningFloatCents / 100
      : null,
  )

  /** Berechtigte Mitarbeiter zur Auswahl. */
  protected readonly managers = computed<User[]>(() =>
    this.userService.users().filter(u => !!u.role && AUTHORIZING_ROLES.has(u.role)),
  )

  protected readonly canSubmit = computed(() => {
    const float = this.openingFloatEuros()
    return (
      this.managerId().trim().length > 0 &&
      this.pin().trim().length > 0 &&
      float !== null &&
      float >= 0
    )
  })

  async submit(): Promise<void> {
    this.phase.set('submitting')
    this.errorMessage.set(null)
    try {
      this.resultSession = await this.cashSessionService.openAuthorized({
        businessDayId: this.data.businessDayId,
        openedBy: this.data.cashierId,
        openingFloatCents: Math.round((this.openingFloatEuros() ?? 0) * 100),
        label: this.data.cashierName ? `Kasse ${this.data.cashierName}` : 'Kasse',
        authorizedByUserId: this.managerId(),
        pin: this.pin(),
      })
      this.phase.set('submitted')
    } catch (err) {
      this.phase.set('failed')
      this.errorMessage.set((err as Error).message ?? 'Freigabe fehlgeschlagen')
    }
  }

  cancel(): void {
    this.dialogRef.close(null)
  }

  close(): void {
    this.dialogRef.close(this.resultSession)
  }
}
