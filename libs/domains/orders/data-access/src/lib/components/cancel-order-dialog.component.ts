import { ChangeDetectionStrategy, Component, inject, signal, computed } from '@angular/core'
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog'
import { MatSnackBar } from '@angular/material/snack-bar'
import { TranslateModule, TranslateService } from '@ngx-translate/core'
import { UserService } from '@panary-core/users/data-access'
import { User, UserSystemRole } from '@panary-core/users/domain'
import { OrderService } from '../services/order.service'
import { Order, OrderStatus } from '@panary-core/orders/domain'

const CANCEL_REASONS = [
  'CANCEL_ORDER.REASON_COMPLAINT',
  'CANCEL_ORDER.REASON_WRONG_INPUT',
  'CANCEL_ORDER.REASON_DUPLICATE',
  'CANCEL_ORDER.REASON_OTHER',
]

type DialogStep = 'reason' | 'pin'

@Component({
  selector: 'lib-cancel-order-dialog',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-6 min-w-[360px] max-w-[420px]">

      <!-- Step 1: Grund auswählen -->
      @if (step() === 'reason') {
        <h2 class="text-xl font-bold text-gray-900 dark:text-white mb-2">{{ 'CANCEL_ORDER.SELECT_REASON' | translate }}</h2>
        <p class="text-sm text-gray-500 dark:text-gray-400 mb-5">#{{ order.dailySequenceNumber }}</p>

        <div class="flex flex-col gap-2">
          @for (reason of reasons; track reason) {
            <button (click)="selectReason(reason)"
              class="w-full text-left px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700
                     bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 font-medium text-sm
                     hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-gray-300 dark:hover:border-gray-600
                     active:scale-[0.98] transition-all">
              {{ reason | translate }}
            </button>
          }
        </div>

        <div class="flex justify-end pt-4">
          <button (click)="close()"
            class="text-sm font-medium text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-4 py-2 rounded-lg
                   hover:bg-gray-50 dark:hover:bg-gray-800 transition">
            {{ 'COMMON.CANCEL' | translate }}
          </button>
        </div>
      }

      <!-- Step 2: Manager-PIN -->
      @if (step() === 'pin') {
        <h2 class="text-xl font-bold text-gray-900 dark:text-white mb-1">{{ 'CANCEL_ORDER.ENTER_PIN' | translate }}</h2>
        <p class="text-sm text-gray-500 dark:text-gray-400 mb-5">{{ 'CANCEL_ORDER.PIN_HINT' | translate }}</p>

        <!-- PIN Dots -->
        <div class="flex justify-center gap-3 mb-5">
          @for (i of [0, 1, 2, 3]; track i) {
            <div class="w-4 h-4 rounded-full transition-all duration-150"
              [class.bg-gray-200]="pin().length <= i"
              [class.dark:bg-gray-700]="pin().length <= i"
              [class.bg-red-500]="pin().length > i && pinError()"
              [class.bg-amber-500]="pin().length > i && !pinError()">
            </div>
          }
        </div>

        @if (pinError()) {
          <p class="text-center text-red-500 text-sm mb-3">{{ 'CANCEL_ORDER.INVALID_PIN' | translate }}</p>
        }

        <!-- Numpad -->
        <div class="grid grid-cols-3 gap-2 max-w-[240px] mx-auto">
          @for (digit of ['1','2','3','4','5','6','7','8','9']; track digit) {
            <button (click)="appendDigit(digit)"
              class="h-14 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700
                     active:bg-gray-300 dark:active:bg-gray-600 text-xl font-semibold text-gray-800 dark:text-white
                     transition-all active:scale-95">
              {{ digit }}
            </button>
          }
          <div></div>
          <button (click)="appendDigit('0')"
            class="h-14 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700
                   active:bg-gray-300 dark:active:bg-gray-600 text-xl font-semibold text-gray-800 dark:text-white
                   transition-all active:scale-95">
            0
          </button>
          <button (click)="deleteDigit()"
            class="h-14 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700
                   flex items-center justify-center transition-all active:scale-95">
            <svg class="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.414 6.414a2 2 0 001.414.586H19a2 2 0 002-2V7a2 2 0 00-2-2h-8.172a2 2 0 00-1.414.586L3 12z"></path>
            </svg>
          </button>
        </div>

        <div class="flex justify-between items-center pt-5">
          <button (click)="step.set('reason')"
            class="text-sm font-medium text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-4 py-2 rounded-lg
                   hover:bg-gray-50 dark:hover:bg-gray-800 transition">
            {{ 'COMMON.BACK' | translate }}
          </button>
          <button (click)="close()"
            class="text-sm font-medium text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-4 py-2 rounded-lg
                   hover:bg-gray-50 dark:hover:bg-gray-800 transition">
            {{ 'COMMON.CANCEL' | translate }}
          </button>
        </div>
      }
    </div>
  `,
})
export class CancelOrderDialogComponent {
  #dialogRef = inject(MatDialogRef<CancelOrderDialogComponent>)
  #orderService = inject(OrderService)
  #userService = inject(UserService)
  #snackBar = inject(MatSnackBar)
  #translate = inject(TranslateService)

  order: Order = inject(MAT_DIALOG_DATA)

  readonly reasons = CANCEL_REASONS
  step = signal<DialogStep>('reason')
  selectedReason = signal('')
  pin = signal('')
  pinError = signal(false)
  managerUsers = signal<User[]>([])

  // Prüft ob der aktuelle User ein Manager/Owner ist (kein PIN nötig)
  #isManagerOrOwner = computed(() => {
    const user = this.#userService.currentUser()
    if (!user) return false
    return user.role === UserSystemRole.TENANT_MANAGER || user.role === UserSystemRole.TENANT_OWNER
  })

  constructor() {
    this.loadManagerUsers()
  }

  selectReason(reason: string): void {
    this.selectedReason.set(reason)

    if (this.#isManagerOrOwner()) {
      // Manager/Owner können direkt stornieren — kein PIN nötig
      this.executeCancel(this.#userService.currentUser()!)
    } else {
      this.pin.set('')
      this.pinError.set(false)
      this.step.set('pin')
    }
  }

  appendDigit(digit: string): void {
    this.pinError.set(false)
    const current = this.pin()
    if (current.length < 6) {
      const newPin = current + digit
      this.pin.set(newPin)

      // Auto-Submit bei 4+ Stellen
      if (newPin.length >= 4) {
        this.verifyPin(newPin)
      }
    }
  }

  deleteDigit(): void {
    this.pin.update(p => p.slice(0, -1))
    this.pinError.set(false)
  }

  close(): void {
    this.#dialogRef.close()
  }

  private verifyPin(pin: string): void {
    const matched = this.managerUsers().find(u => u.posPin === pin)
    if (!matched) {
      if (pin.length >= 6) {
        // Maximale Länge erreicht, aber keine Übereinstimmung
        this.pinError.set(true)
        this.pin.set('')
      }
      return
    }
    this.executeCancel(matched)
  }

  private async executeCancel(authorizer: User): Promise<void> {
    const name = `${authorizer.firstName} ${authorizer.lastName}`.trim() || authorizer.loginname
    try {
      await this.#orderService.patch(this.order._id, {
        cancellation: {
          canceledBy: name,
          reason: this.#translate.instant(this.selectedReason()),
          canceledAt: new Date().toISOString(),
        },
        status: OrderStatus.ABORTED,
      })
      this.#snackBar.open(this.#translate.instant('CANCEL_ORDER.SUCCESS'), undefined, { duration: 2500 })
      this.#dialogRef.close({ success: true, canceledBy: name })
    } catch {
      this.#snackBar.open(this.#translate.instant('CANCEL_ORDER.ERROR'), 'OK', { duration: 3000 })
    }
  }

  private async loadManagerUsers(): Promise<void> {
    try {
      const result = await this.#userService.find({ query: { $limit: 200 } })
      const users: User[] = Array.isArray(result) ? result : (result as any).data
      this.managerUsers.set(
        users.filter(
          u => (u.role === UserSystemRole.TENANT_MANAGER || u.role === UserSystemRole.TENANT_OWNER) && !!u.posPin,
        ),
      )
    } catch {
      this.managerUsers.set([])
    }
  }
}
