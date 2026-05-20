import { Component, computed, inject, OnInit, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { HttpClient } from '@angular/common/http'
import { lastValueFrom } from 'rxjs'
import { ThemeServiceService } from '@panary-core/shared/data-access-theme'
import { LocationService } from '@panary-core/locations/data-access'
import { ConnectionService, LanguageService } from '@panary-core/shared/data-access'
import { APP_CONFIG, DeviceConfigService } from '@panary-core/shared/data-access-config'
import { FormsModule } from '@angular/forms'
import { Router } from '@angular/router'

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
