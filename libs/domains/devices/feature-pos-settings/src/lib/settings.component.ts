import { Component, computed, effect, inject, OnInit, signal, untracked } from '@angular/core'
import { CommonModule } from '@angular/common'
import { HttpClient } from '@angular/common/http'
import { lastValueFrom } from 'rxjs'
import { ThemeServiceService } from '@panary/shared/data-access-theme'
import { LocationService } from '@panary/locations/data-access'
import { ConnectionService, LanguageService, OFFLINE_OUTBOX, OFFLINE_REPLAY } from '@panary/shared/data-access'
import type { OfflineOutboxRejectedEntry } from '@panary/shared-common'
import { APP_CONFIG, DeviceConfigService } from '@panary/shared/data-access-config'
import { FormsModule } from '@angular/forms'
import { Router } from '@angular/router'

import { MatSnackBar } from '@angular/material/snack-bar'
import { MatTooltipModule } from '@angular/material/tooltip'
import { TranslateModule, TranslateService } from '@ngx-translate/core'
import { UnpairDeviceDialogComponent } from './unpair-device-dialog/unpair-device-dialog.component'

interface EdgeServerInfo {
  status: string
  uptime: number
  version: string
  systemMode: string
  nodeVersion: string
  platform: string
  hostname: string
  memory: { rss: number; heapUsed: number; heapTotal: number }
  localIp: string
  port: number
  database: { type: string }
}

@Component({
  selector: 'lib-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, MatTooltipModule, TranslateModule, UnpairDeviceDialogComponent],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss'],
})
export class SettingsComponent implements OnInit {
  themeService = inject(ThemeServiceService)
  languageService = inject(LanguageService)
  locationService = inject(LocationService)
  connectionService = inject(ConnectionService)
  deviceConfigService = inject(DeviceConfigService)
  router = inject(Router)
  translateService = inject(TranslateService)
  #http = inject(HttpClient)
  appConfig = inject(APP_CONFIG)
  // Connect-Tier: nur in der POS-App belegt (admin liefert keinen Provider → null).
  #outbox = inject(OFFLINE_OUTBOX, { optional: true })
  #replay = inject(OFFLINE_REPLAY, { optional: true })
  #snackBar = inject(MatSnackBar)

  // For the sidebar selection
  activeSection = 'general'
  menuOpen = signal(false)

  // Unpair-Dialog (Verbindungs-Sektion → Danger-Zone)
  showUnpairDialog = signal(false)

  // Edge Server Info
  edgeInfo = signal<EdgeServerInfo | null>(null)

  // User State
  currentUser = signal<any>(null)
  newPin = signal('')
  confirmPin = signal('')
  pinError = signal<string | null>(null)
  isSaving = signal(false)
  saveMessage = signal<string | null>(null)

  // Theme options
  themeOptions = [
    { value: 'system', label: 'SETTINGS.THEME_SYSTEM', icon: 'brightness_auto' },
    { value: 'light', label: 'SETTINGS.THEME_LIGHT', icon: 'light_mode' },
    { value: 'dark', label: 'SETTINGS.THEME_DARK', icon: 'dark_mode' },
  ]

  // Offline-Outbox (Connect-Tier): Zähler reaktiv aus dem Store-Signal, Detailliste async.
  readonly hasOutbox = this.#outbox !== null
  readonly outboxPending = computed(() => this.#outbox?.pendingCount() ?? 0)
  readonly outboxRejected = computed(() => this.#outbox?.rejectedCount() ?? 0)
  readonly rejectedEntries = signal<readonly OfflineOutboxRejectedEntry[]>([])
  readonly isRetrying = signal(false)

  // Connection-Section: Device-Konfiguration + Tier-Modell
  readonly deviceConfig = computed(() => this.deviceConfigService.getConfig())
  readonly tier = this.connectionService.tier
  readonly showsCloudSyncStatus = this.connectionService.showsCloudSyncStatus
  readonly syncStaleness = this.connectionService.syncStaleness
  readonly tierLabelKey = computed<string>(() => {
    switch (this.tier()) {
      case 'cloud-direct':
        return 'SETTINGS.BACKEND_TIER_CLOUD_DIRECT'
      case 'standalone':
        return 'SETTINGS.BACKEND_TIER_STANDALONE'
      case 'edge-with-cloud':
        return 'SETTINGS.BACKEND_TIER_EDGE_WITH_CLOUD'
      default:
        return 'SETTINGS.BACKEND_TIER_UNKNOWN'
    }
  })

  constructor() {
    this.loadCurrentUser()
    // Detailliste der abgelehnten Einträge an den reaktiven Zähler koppeln (angular.md §2.1).
    effect(() => {
      this.outboxRejected()
      untracked(() => void this.#loadRejected())
    })
  }

  async #loadRejected(): Promise<void> {
    if (!this.#outbox) return
    this.rejectedEntries.set(await this.#outbox.rejected())
  }

  /**
   * Operator-Retry: alle abgelehnten Einträge zurück auf pending setzen und sofort einen
   * Replay anstoßen (sonst greift der periodische Poll). Einträge mit fehlerhaftem Payload
   * werden dabei erneut abgelehnt — Hinweis im Toast.
   */
  async retryRejected(): Promise<void> {
    if (!this.#outbox || this.isRetrying()) return
    this.isRetrying.set(true)
    try {
      const count = await this.#outbox.requeueRejected()
      await this.#replay?.replayNow()
      await this.#loadRejected()
      this.#snackBar.open(
        this.translateService.instant('SETTINGS.OUTBOX_RETRY_DONE', { count }),
        'OK',
        { duration: 4000 },
      )
    } finally {
      this.isRetrying.set(false)
    }
  }

  /**
   * „Jetzt synchronisieren": Backoff aller pending-Einträge zurücksetzen + sofort
   * replayen — für Einträge, die nach Fehlversuchen im Backoff stecken und sonst erst
   * nach Stunden erneut versucht würden.
   */
  async syncNow(): Promise<void> {
    if (!this.#outbox || this.isRetrying()) return
    this.isRetrying.set(true)
    try {
      const count = await this.#outbox.resetPendingBackoff()
      await this.#replay?.replayNow()
      this.#snackBar.open(
        this.translateService.instant('SETTINGS.OUTBOX_SYNC_NOW_DONE', { count }),
        'OK',
        { duration: 4000 },
      )
    } finally {
      this.isRetrying.set(false)
    }
  }

  /**
   * Operator-Verwerfen: abgelehnte Einträge endgültig aus der Outbox löschen — für
   * unwiederbringliche Bad-Payload-Einträge, die nie syncen (z. B. das alte createdBy:'').
   */
  async discardRejected(): Promise<void> {
    if (!this.#outbox || this.isRetrying()) return
    if (!confirm(this.translateService.instant('SETTINGS.OUTBOX_DISCARD_CONFIRM'))) return
    this.isRetrying.set(true)
    try {
      const count = await this.#outbox.clearRejected()
      await this.#loadRejected()
      this.#snackBar.open(
        this.translateService.instant('SETTINGS.OUTBOX_DISCARD_DONE', { count }),
        'OK',
        { duration: 4000 },
      )
    } finally {
      this.isRetrying.set(false)
    }
  }

  async ngOnInit() {
    try {
      const info = await lastValueFrom(this.#http.get<EdgeServerInfo>('http://localhost:3030/health'))
      this.edgeInfo.set(info)
    } catch {
      /* Server nicht erreichbar */
    }
  }

  formatUptime(seconds: number): string {
    const d = Math.floor(seconds / 86400)
    const h = Math.floor((seconds % 86400) / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const parts: string[] = []
    if (d > 0) parts.push(`${d}d`)
    if (h > 0) parts.push(`${h}h`)
    parts.push(`${m}m`)
    return parts.join(' ')
  }

  formatBytes(bytes: number): string {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  loadCurrentUser() {
    try {
      const stored = localStorage.getItem('pos_current_user')
      if (stored) {
        this.currentUser.set(JSON.parse(stored))
      }
    } catch (e) {
      console.error('Failed to load user', e)
    }
  }

  async updatePin() {
    this.pinError.set(null)
    this.saveMessage.set(null)

    if (this.newPin().length < 4) {
      this.pinError.set(this.translateService.instant('SETTINGS.PIN_MIN_LENGTH'))
      return
    }

    if (this.newPin() !== this.confirmPin()) {
      this.pinError.set(this.translateService.instant('SETTINGS.PIN_MISMATCH'))
      return
    }

    const user = this.currentUser()
    if (!user || !user._id) return

    this.isSaving.set(true)

    try {
      // Use the connection service to patch the user
      // Note: In a real scenario, we might need a specific endpoint or re-auth
      // But for POS simplified flow, we try patching the user directly if allowed
      await this.connectionService.usersService.patch(user._id, {
        posPin: this.newPin(),
      })

      this.saveMessage.set(this.translateService.instant('SETTINGS.PIN_CHANGED'))
      this.newPin.set('')
      this.confirmPin.set('')
    } catch (error: any) {
      console.error('Failed to update PIN', error)
      this.pinError.set(error.message || this.translateService.instant('COMMON.SAVE_ERROR'))
    } finally {
      this.isSaving.set(false)
    }
  }

  setTheme(val: any) {
    if (val && typeof val === 'string') {
      this.themeService.setTheme(val)
    }
  }

  goBack() {
    this.router.navigate(['/dashboard'])
  }
}
