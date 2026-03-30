import { ChangeDetectionStrategy, Component, inject, signal, computed, OnInit, viewChild } from '@angular/core'
import { ApiService } from '../../core/api.service'
import { UserFormComponent } from './user-form'
import { ConfirmDialogComponent } from '../../core/confirm-dialog'

interface User {
  _id: string
  loginname: string
  firstName: string
  lastName: string
  email: string
  role: string
  status: string
  isPosUser: boolean
}

@Component({
  selector: 'app-user-list',
  standalone: true,
  imports: [UserFormComponent, ConfirmDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex h-full overflow-hidden">
      <!-- Linke Seite: Tabelle -->
      <div [class]="selectedId() ? 'w-72 shrink-0 border-r border-slate-200 dark:border-gray-800' : 'flex-1'"
           class="overflow-y-auto">
        <div class="p-6 space-y-4">
          <div class="flex items-center justify-between min-h-9">
            <h1 class="text-xl font-bold tracking-tight">Benutzer</h1>
            <button (click)="selectItem('new')"
              class="bg-slate-900 dark:bg-white text-white dark:text-black font-bold px-4 py-2 rounded-xl text-xs
                     hover:bg-slate-800 dark:hover:bg-gray-200 transition">
              + Neu
            </button>
          </div>

          @if (loading()) {
            <p class="text-slate-400 dark:text-gray-500 text-sm">Laden...</p>
          } @else if (users().length === 0) {
            <p class="text-slate-400 dark:text-gray-500 text-center py-12 text-sm">Keine Benutzer</p>
          } @else {
            <div class="bg-white dark:bg-gray-900/50 border border-slate-200 dark:border-gray-800 rounded-xl overflow-hidden">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-slate-200 dark:border-gray-800 text-left text-slate-400 dark:text-gray-500
                             text-xs uppercase tracking-wider">
                    <th class="px-3 py-2.5">Name</th>
                    @if (!selectedId()) {
                      <th class="px-3 py-2.5">Login</th>
                      <th class="px-3 py-2.5">Rolle</th>
                      <th class="px-3 py-2.5">POS</th>
                      <th class="px-3 py-2.5">Status</th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (user of users(); track user._id) {
                    <tr (click)="selectItem(user._id)"
                        [class]="user._id === selectedId()
                          ? 'bg-slate-100 dark:bg-white/5 border-l-2 border-l-slate-900 dark:border-l-white'
                          : 'hover:bg-slate-50 dark:hover:bg-gray-800/30 border-l-2 border-l-transparent'"
                        class="cursor-pointer border-b border-slate-200/50 dark:border-gray-800/50 transition">
                      <td class="px-3 py-2.5 font-medium truncate max-w-40">
                        {{ user.firstName }} {{ user.lastName }}
                      </td>
                      @if (!selectedId()) {
                        <td class="px-3 py-2.5 text-slate-500 dark:text-gray-400 text-xs">{{ user.loginname }}</td>
                        <td class="px-3 py-2.5">
                          <span class="text-xs px-2 py-0.5 rounded-full border border-slate-300 dark:border-gray-700
                                       text-slate-600 dark:text-gray-300">
                            {{ formatRole(user.role) }}
                          </span>
                        </td>
                        <td class="px-3 py-2.5">
                          @if (user.isPosUser) {
                            <span class="text-green-400 text-xs">Ja</span>
                          } @else {
                            <span class="text-slate-400 dark:text-gray-600 text-xs">—</span>
                          }
                        </td>
                        <td class="px-3 py-2.5">
                          <span [class]="user.status === 'ACTIVE'
                            ? 'text-green-400 text-xs'
                            : 'text-slate-400 dark:text-gray-500 text-xs'">
                            {{ user.status }}
                          </span>
                        </td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </div>
      </div>

      <!-- Rechte Seite: Side-Panel -->
      @if (selectedId()) {
        <div class="flex-1 flex flex-col overflow-hidden">
          <div class="shrink-0 bg-slate-50 dark:bg-gray-950 border-b border-slate-200 dark:border-gray-800
                      px-4 py-2.5 flex items-center gap-2">
            <button (click)="prevItem()" [disabled]="currentIndex() <= 0"
              class="text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white
                     disabled:text-slate-300 dark:disabled:text-gray-700 disabled:cursor-not-allowed
                     w-8 h-8 flex items-center justify-center rounded-lg
                     hover:bg-slate-100 dark:hover:bg-gray-800 transition text-sm">
              ◀
            </button>
            <span class="text-xs text-slate-400 dark:text-gray-500 min-w-12 text-center">
              @if (selectedId() !== 'new') {
                {{ currentIndex() + 1 }} / {{ users().length }}
              } @else {
                Neu
              }
            </span>
            <button (click)="nextItem()" [disabled]="currentIndex() >= users().length - 1"
              class="text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white
                     disabled:text-slate-300 dark:disabled:text-gray-700 disabled:cursor-not-allowed
                     w-8 h-8 flex items-center justify-center rounded-lg
                     hover:bg-slate-100 dark:hover:bg-gray-800 transition text-sm">
              ▶
            </button>
            <div class="flex-1"></div>
            <button (click)="selectedId.set(null)"
              class="text-slate-400 dark:text-gray-500 hover:text-slate-900 dark:hover:text-white w-8 h-8
                     flex items-center justify-center rounded-lg
                     hover:bg-slate-100 dark:hover:bg-gray-800 transition text-sm">
              ✕
            </button>
          </div>

          <div class="flex-1 overflow-y-auto">
            <app-user-form #formRef
              [id]="selectedId()!"
              [panelMode]="true"
              (saved)="onItemSaved()"
              (closed)="tryClose()" />
          </div>
        </div>
      }

      @if (pendingNavAction) {
        <app-confirm-dialog
          (confirmed)="onDialogSave()"
          (dismissed)="onDialogDiscard()"
          (cancelled)="onDialogCancel()" />
      }
    </div>
  `,
})
export class UserListComponent implements OnInit {
  private api = inject(ApiService)
  users = signal<User[]>([])
  loading = signal(true)
  selectedId = signal<string | null>(null)

  private formRef = viewChild<UserFormComponent>('formRef')
  pendingNavAction: (() => void) | null = null

  currentIndex = computed(() => {
    const id = this.selectedId()
    if (!id || id === 'new') return -1
    return this.users().findIndex(u => u._id === id)
  })

  formatRole(role: string): string {
    const map: Record<string, string> = {
      'platform:owner': 'Plattform-Admin',
      'platform:admin': 'Admin',
      'tenant:owner': 'Inhaber',
      'tenant:manager': 'Manager',
      'tenant:staff': 'Mitarbeiter',
    }
    return map[role] || role
  }

  private navigateWithDirtyCheck(action: () => void) {
    const form = this.formRef()
    if (form?.isDirty()) {
      this.pendingNavAction = action
    } else {
      action()
    }
  }

  selectItem(id: string) {
    this.navigateWithDirtyCheck(() => this.selectedId.set(id))
  }

  prevItem() {
    const idx = this.currentIndex()
    if (idx > 0) this.navigateWithDirtyCheck(() => this.selectedId.set(this.users()[idx - 1]._id))
  }

  nextItem() {
    const idx = this.currentIndex()
    if (idx < this.users().length - 1) this.navigateWithDirtyCheck(() => this.selectedId.set(this.users()[idx + 1]._id))
  }

  tryClose() {
    this.navigateWithDirtyCheck(() => this.selectedId.set(null))
  }

  async onDialogSave() {
    const form = this.formRef()
    if (form) {
      const ok = await form.saveAndContinue()
      if (ok) {
        await this.loadUsers()
        this.pendingNavAction?.()
      }
    }
    this.pendingNavAction = null
  }

  onDialogDiscard() {
    this.formRef()?.discardChanges()
    this.pendingNavAction?.()
    this.pendingNavAction = null
  }

  onDialogCancel() {
    this.pendingNavAction = null
  }

  async onItemSaved() {
    await this.loadUsers()
  }

  async ngOnInit() {
    await this.loadUsers()
  }

  private async loadUsers() {
    try {
      const result = await this.api.find<User>('users', { $limit: 100 })
      this.users.set(result.data)
    } catch (e) {
      console.error('Fehler beim Laden der Benutzer:', e)
    }
    this.loading.set(false)
  }
}
