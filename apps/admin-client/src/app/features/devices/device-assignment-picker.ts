import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core'
import { TranslateModule } from '@ngx-translate/core'
import { DeviceAccessMode, MAX_ASSIGNED_USER_IDS, type DeviceAccessModeValue } from '@panary/devices/domain'

export interface PosUser {
  _id: string
  firstName?: string
  lastName?: string
  staffRole?: string
}

/**
 * Auswahl „geteiltes Terminal vs. zugewiesenes Gerät"
 * (PNRY-FEAT-DEVICE-ASSIGNMENT-001).
 *
 * Eigene Komponente, weil sie an zwei Stellen sitzt: im Zeilen-Overlay der
 * Geräteliste und im Pairing-Dialog, wo die Zuweisung schon beim Ausstellen des
 * Codes festgelegt wird.
 */
@Component({
  selector: 'app-device-assignment-picker',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-3 text-left">
      <div class="flex gap-2">
        <button
          type="button"
          (click)="modeChange.emit('shared')"
          [class]="mode() === 'shared' ? activeTabClass : inactiveTabClass"
        >
          {{ 'DEVICES.ASSIGNMENT_SHARED' | translate }}
        </button>
        <button
          type="button"
          (click)="modeChange.emit('assigned')"
          [class]="mode() === 'assigned' ? activeTabClass : inactiveTabClass"
        >
          {{ 'DEVICES.ASSIGNMENT_ASSIGNED' | translate }}
        </button>
      </div>

      @if (mode() === 'shared') {
        <p class="text-xs text-ink-muted">{{ 'DEVICES.ASSIGNMENT_SHARED_HINT' | translate }}</p>
      } @else {
        <p class="text-xs text-ink-muted">
          {{ 'DEVICES.ASSIGNMENT_ASSIGNED_HINT' | translate: { max: maxUsers } }}
        </p>

        @if (users().length === 0) {
          <p class="text-xs text-amber-600 dark:text-amber-400 py-3">
            {{ 'DEVICES.ASSIGNMENT_NO_POS_USERS' | translate }}
          </p>
        } @else {
          <div
            class="max-h-56 overflow-y-auto rounded-lg border border-line-soft divide-y
                      divide-line-soft"
          >
            @for (user of users(); track user._id) {
              <label
                class="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer
                       hover:bg-surface-elevated dark:hover:bg-surface-elevated/40 transition"
                [class.opacity-40]="!isSelected(user._id) && limitReached()"
              >
                <input
                  type="checkbox"
                  class="accent-ink"
                  [checked]="isSelected(user._id)"
                  [disabled]="!isSelected(user._id) && limitReached()"
                  (change)="toggle(user._id)"
                />
                <span class="truncate">{{ displayName(user) }}</span>
                @if (user.staffRole) {
                  <span class="ml-auto text-xs text-ink-faint shrink-0">{{ user.staffRole }}</span>
                }
              </label>
            }
          </div>

          @if (limitReached()) {
            <p class="text-xs text-ink-faint">
              {{ 'DEVICES.ASSIGNMENT_LIMIT' | translate: { max: maxUsers } }}
            </p>
          }
          @if (selected().length === 0) {
            <p class="text-xs text-amber-600 dark:text-amber-400">
              {{ 'DEVICES.ASSIGNMENT_EMPTY_WARNING' | translate }}
            </p>
          }
        }
      }
    </div>
  `,
})
export class DeviceAssignmentPickerComponent {
  users = input.required<PosUser[]>()
  mode = input.required<DeviceAccessModeValue>()
  selected = input.required<string[]>()

  modeChange = output<DeviceAccessModeValue>()
  selectedChange = output<string[]>()

  protected readonly maxUsers = MAX_ASSIGNED_USER_IDS
  protected limitReached = computed(() => this.selected().length >= MAX_ASSIGNED_USER_IDS)

  protected readonly activeTabClass = 'flex-1 py-2 rounded-lg text-sm font-medium bg-ink text-surface-panel transition'
  protected readonly inactiveTabClass =
    'flex-1 py-2 rounded-lg text-sm font-medium bg-line-soft text-ink ' + 'hover:bg-line transition'

  protected isSelected(id: string): boolean {
    return this.selected().includes(id)
  }

  protected displayName(user: PosUser): string {
    return [user.firstName, user.lastName].filter(Boolean).join(' ') || user._id
  }

  protected toggle(id: string): void {
    const current = this.selected()
    if (current.includes(id)) {
      this.selectedChange.emit(current.filter(entry => entry !== id))
      return
    }
    // Die Obergrenze wird auch serverseitig geprueft; hier verhindert sie nur,
    // dass der Admin eine Auswahl baut, die beim Speichern abgelehnt wird.
    if (current.length >= MAX_ASSIGNED_USER_IDS) return
    this.selectedChange.emit([...current, id])
  }

  protected readonly DeviceAccessMode = DeviceAccessMode
}
