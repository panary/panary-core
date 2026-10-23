import { ChangeDetectionStrategy, Component, inject, signal, computed, OnInit, viewChild } from '@angular/core'
import { TranslateModule, TranslateService } from '@ngx-translate/core'
import { ApiService } from '../../core/api.service'
import { ApikeyFormComponent } from './apikey-form'
import { ApikeyCreatedDialogComponent } from './apikey-created-dialog'
import { ConfirmDialogComponent } from '../../core/confirm-dialog'

interface Apikey {
  _id: string
  name: string
  role: string
  active: boolean
  deviceId?: string
  lastUsedAt?: string
  validUntil?: string
  description?: string
}

@Component({
  selector: 'app-apikey-list',
  standalone: true,
  imports: [ApikeyFormComponent, ApikeyCreatedDialogComponent, ConfirmDialogComponent, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex h-full overflow-hidden">
      <!-- Linke Seite: Tabelle -->
      <div [class]="selectedId() ? 'w-72 shrink-0 border-r border-line-soft' : 'flex-1'" class="overflow-y-auto">
        <div class="p-6 space-y-4">
          <div class="flex items-center justify-between min-h-9">
            <h1 class="text-xl font-bold tracking-tight">{{ 'APIKEYS.TITLE' | translate }}</h1>
            <button
              (click)="selectItem('new')"
              class="bg-ink text-surface-panel font-bold px-4 py-2 rounded-xl text-xs
                     hover:bg-ink/90 transition"
            >
              + {{ 'COMMON.NEW' | translate }}
            </button>
          </div>

          @if (loading()) {
            <p class="text-ink-faint text-sm">{{ 'COMMON.LOADING' | translate }}</p>
          } @else if (apikeys().length === 0) {
            <p class="text-ink-faint text-center py-12 text-sm">
              {{ 'APIKEYS.NO_KEYS' | translate }}
            </p>
          } @else {
            <div class="admin-table-wrap">
              <table class="admin-table">
                <thead>
                  <tr>
                    <th>{{ 'COMMON.NAME' | translate }}</th>
                    @if (!selectedId()) {
                      <th>{{ 'USERS.ROLE' | translate }}</th>
                      <th>{{ 'COMMON.STATUS_ACTIVE' | translate }}</th>
                      <th>{{ 'APIKEYS.LAST_USED' | translate }}</th>
                      <th>{{ 'APIKEYS.VALID_UNTIL' | translate }}</th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (key of apikeys(); track key._id) {
                    <tr
                      (click)="selectItem(key._id)"
                      [class]="
                        key._id === selectedId()
                          ? 'bg-surface-bg dark:bg-white/5 border-l-2 border-l-ink'
                          : 'hover:bg-surface-elevated dark:hover:bg-surface-elevated/30 border-l-2 border-l-transparent'
                      "
                      class="cursor-pointer transition"
                    >
                      <td class="font-medium truncate max-w-40">{{ key.name }}</td>
                      @if (!selectedId()) {
                        <td>
                          <span
                            class="text-xs px-2 py-0.5 rounded-full border border-line-strong
                                       text-ink-muted dark:text-ink"
                          >
                            {{ formatRole(key.role) }}
                          </span>
                        </td>
                        <td>
                          @if (key.active) {
                            <span class="inline-block w-2 h-2 rounded-full bg-green-400"></span>
                          } @else {
                            <span class="inline-block w-2 h-2 rounded-full bg-line-strong"></span>
                          }
                        </td>
                        <td class="text-ink-muted text-xs">
                          {{ key.lastUsedAt ? formatDateTime(key.lastUsedAt) : '—' }}
                        </td>
                        <td class="text-ink-muted text-xs">
                          {{ key.validUntil ? formatDate(key.validUntil) : ('APIKEYS.UNLIMITED' | translate) }}
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
          <div
            class="shrink-0 bg-surface-bg border-b border-line-soft
                      px-4 py-2.5 flex items-center gap-2"
          >
            <button
              (click)="prevItem()"
              [disabled]="currentIndex() <= 0"
              class="text-ink-muted hover:text-ink
                     disabled:text-line-strong disabled:cursor-not-allowed
                     w-8 h-8 flex items-center justify-center rounded-lg
                     hover:bg-line-soft transition text-sm"
            >
              ◀
            </button>
            <span class="text-xs text-ink-faint min-w-12 text-center">
              @if (selectedId() !== 'new') {
                {{ currentIndex() + 1 }} / {{ apikeys().length }}
              } @else {
                {{ 'COMMON.NEW' | translate }}
              }
            </span>
            <button
              (click)="nextItem()"
              [disabled]="currentIndex() >= apikeys().length - 1"
              class="text-ink-muted hover:text-ink
                     disabled:text-line-strong disabled:cursor-not-allowed
                     w-8 h-8 flex items-center justify-center rounded-lg
                     hover:bg-line-soft transition text-sm"
            >
              ▶
            </button>
            <div class="flex-1"></div>
            <button
              (click)="selectedId.set(null)"
              class="text-ink-faint hover:text-ink w-8 h-8
                     flex items-center justify-center rounded-lg
                     hover:bg-line-soft transition text-sm"
            >
              ✕
            </button>
          </div>

          <div class="flex-1 overflow-y-auto">
            <app-apikey-form
              #formRef
              [id]="selectedId()!"
              [panelMode]="true"
              (saved)="onItemSaved()"
              (created)="onKeyCreated($event)"
              (closed)="tryClose()"
            />
          </div>
        </div>
      }

      @if (pendingNavAction) {
        <app-confirm-dialog
          (confirmed)="onDialogSave()"
          (dismissed)="onDialogDiscard()"
          (cancelled)="onDialogCancel()"
        />
      }

      @if (createdApikey()) {
        <app-apikey-created-dialog [apikey]="createdApikey()!" (closed)="createdApikey.set(null)" />
      }
    </div>
  `,
})
export class ApikeyListComponent implements OnInit {
  private api = inject(ApiService)
  private t = inject(TranslateService)
  apikeys = signal<Apikey[]>([])
  loading = signal(true)
  selectedId = signal<string | null>(null)
  createdApikey = signal<string | null>(null)

  private formRef = viewChild<ApikeyFormComponent>('formRef')
  pendingNavAction: (() => void) | null = null

  currentIndex = computed(() => {
    const id = this.selectedId()
    if (!id || id === 'new') return -1
    return this.apikeys().findIndex(k => k._id === id)
  })

  formatRole(role: string): string {
    const map: Record<string, string> = {
      'device:pos-client': 'ROLES.DEVICE_POS',
      'device:kds': 'ROLES.DEVICE_KDS',
      'device:tablet': 'ROLES.DEVICE_TABLET',
      'device:kiosk': 'ROLES.DEVICE_KIOSK',
    }
    return map[role] ? this.t.instant(map[role]) : role
  }

  /** Tagesgenau — fuer „Gueltig bis". */
  formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
    } catch {
      return iso
    }
  }

  /** Minutengenau — fuer „Letzte Nutzung"; dort ist die Uhrzeit die Information. */
  formatDateTime(iso: string): string {
    try {
      return new Date(iso).toLocaleString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return iso
    }
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
    if (idx > 0) this.navigateWithDirtyCheck(() => this.selectedId.set(this.apikeys()[idx - 1]._id))
  }

  nextItem() {
    const idx = this.currentIndex()
    if (idx < this.apikeys().length - 1)
      this.navigateWithDirtyCheck(() => this.selectedId.set(this.apikeys()[idx + 1]._id))
  }

  tryClose() {
    this.navigateWithDirtyCheck(() => this.selectedId.set(null))
  }

  async onDialogSave() {
    const form = this.formRef()
    if (form) {
      const ok = await form.saveAndContinue()
      if (ok) {
        await this.loadApikeys()
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
    await this.loadApikeys()
  }

  onKeyCreated(result: any) {
    if (result?.apikey) {
      this.createdApikey.set(result.apikey)
    }
    this.loadApikeys()
    this.selectedId.set(result?._id || null)
  }

  async ngOnInit() {
    await this.loadApikeys()
  }

  private async loadApikeys() {
    try {
      const result = await this.api.find<Apikey>('apikeys', { $limit: 100 })
      this.apikeys.set(result.data)
    } catch (e) {
      console.error('Fehler beim Laden der API-Schlüssel:', e)
    }
    this.loading.set(false)
  }
}
