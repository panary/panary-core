import { Component, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { ThemeServiceService } from '@panary-core/shared/data-access-theme'
import { LocationService } from '@panary-core/locations/data-access'
import { ConnectionService } from '@panary-core/shared/data-access'
import { FormsModule } from '@angular/forms'
import { Router } from '@angular/router'

import { MatTooltipModule } from '@angular/material/tooltip'

@Component({
  selector: 'panary-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, MatTooltipModule],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss'],
})
export class SettingsComponent {
  themeService = inject(ThemeServiceService)
  locationService = inject(LocationService)
  connectionService = inject(ConnectionService)
  router = inject(Router)

  // For the sidebar selection
  activeSection = 'general'

  // User State
  currentUser = signal<any>(null)
  newPin = signal('')
  confirmPin = signal('')
  pinError = signal<string | null>(null)
  isSaving = signal(false)
  saveMessage = signal<string | null>(null)

  // Theme options
  themeOptions = [
    { value: 'system', label: 'System', icon: 'brightness_auto' },
    { value: 'light', label: 'Hell', icon: 'light_mode' },
    { value: 'dark', label: 'Dunkel', icon: 'dark_mode' },
  ]

  constructor() {
    this.loadCurrentUser()
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
      this.pinError.set('PIN muss mindestens 4 Stellen haben')
      return
    }

    if (this.newPin() !== this.confirmPin()) {
      this.pinError.set('PINs stimmen nicht überein')
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

      this.saveMessage.set('PIN erfolgreich geändert')
      this.newPin.set('')
      this.confirmPin.set('')
    } catch (error: any) {
      console.error('Failed to update PIN', error)
      this.pinError.set(error.message || 'Fehler beim Speichern')
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
