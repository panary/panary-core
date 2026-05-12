import { Component, HostListener, inject, OnInit, signal, WritableSignal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { Router } from '@angular/router'
import { APP_CONFIG, DeviceConfigService } from '@panary-core/shared/data-access-config'
// Direct import to avoid circular dependency with Admin's ConnectionService
import { ConnectionService } from '@panary-core/shared/data-access'
import { TimeClockEvent, TimeClockPanelComponent } from './time-clock-panel/time-clock-panel.component'
import { ThemeServiceService } from '@panary-core/shared/data-access-theme'
import { UpdateService } from '@panary-core/shared/data-access-updater'
import { LanguageService, LANGUAGES } from '@panary-core/shared/data-access'
import { TranslateModule } from '@ngx-translate/core'
import { TranslateService } from '@ngx-translate/core'

interface PosUser {
  _id: string
  firstName: string
  lastName: string
  email?: string
  isPosUser: boolean
  employeeNumber?: string
  avatar?: string
  initials: string
  color: string
  staffRole?: string
}

type LoginStep = 'loading' | 'select-user' | 'enter-pin' | 'error'

@Component({
  selector: 'lib-login',
  imports: [CommonModule, TimeClockPanelComponent, TranslateModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent implements OnInit {
  //#region Dependencies
  private readonly router = inject(Router)
  private readonly configService = inject(DeviceConfigService)
  private readonly connectionService = inject(ConnectionService)
  readonly themeService = inject(ThemeServiceService)
  readonly languageService = inject(LanguageService)
  readonly updateService = inject(UpdateService)
  readonly appVersion = inject(APP_CONFIG).appVersion
  readonly #translateService = inject(TranslateService)
  readonly languages = LANGUAGES
  //#endregion

  //#region State
  readonly currentStep: WritableSignal<LoginStep> = signal('loading')
  readonly posUsers: WritableSignal<PosUser[]> = signal([])
  readonly selectedUser: WritableSignal<PosUser | null> = signal(null)
  readonly pinInput: WritableSignal<string> = signal('')
  readonly pinError: WritableSignal<boolean> = signal(false)
  readonly isLoading: WritableSignal<boolean> = signal(false)
  readonly errorMessage: WritableSignal<string | null> = signal(null)

  // Device info for display
  readonly deviceName: WritableSignal<string> = signal('')
  readonly locationName: WritableSignal<string> = signal('')

  // Connection status exposed for template
  readonly connectionState = this.connectionService.connectionState
  //#endregion

  //#region Avatar Colors
  private readonly avatarColors = [
    '#00B8D4', // Panary Aqua
    '#10B981', // Emerald
    '#8B5CF6', // Purple
    '#F59E0B', // Amber
    '#EC4899', // Pink
    '#06B6D4', // Cyan
    '#EF4444', // Red
    '#84CC16', // Lime
  ]
  //#endregion

  //#region Lifecycle
  ngOnInit(): void {
    this.loadDeviceInfo()
    this.connectAndLoadUsers().then(r => {
      /* empty */
    })
  }

  //#endregion

  //#region Keyboard Input
  @HostListener('window:keydown', ['$event'])
  handleKeyboardInput(event: KeyboardEvent): void {
    // Nur reagieren wenn wir im PIN-Eingabe-Schritt sind
    if (this.currentStep() !== 'enter-pin') {
      return
    }

    // Backspace oder Delete zum Löschen
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault()
      this.deleteDigit()
      return
    }

    // Escape um zurück zur Benutzerauswahl zu gehen
    if (event.key === 'Escape') {
      event.preventDefault()
      this.backToUsers()
      return
    }

    // Nur Ziffern 0-9 akzeptieren
    if (/^[0-9]$/.test(event.key)) {
      event.preventDefault()
      this.addDigit(event.key)
    }
  }

  //#endregion

  //#region Initialization
  private loadDeviceInfo(): void {
    const config = this.configService.getConfig()
    if (config) {
      this.deviceName.set(config.deviceName || 'POS Terminal')
    }
  }

  private async connectAndLoadUsers(): Promise<void> {
    this.currentStep.set('loading')
    this.errorMessage.set(null)

    try {
      // Connect to backend with device credentials
      // Note: invoke explicit connect for retry scenarios or initial activation
      this.connectionService.connect()

      // Wait for connection
      await this.waitForConnection()

      // Load POS users
      await this.loadPosUsers()

      this.currentStep.set('select-user')
    } catch (error) {
      console.error('Failed to connect or load users:', error)
      this.errorMessage.set(error instanceof Error ? error.message : this.#translateService.instant('LOGIN.CONNECTION_FAILED'))
      this.currentStep.set('error')
    }
  }

  private waitForConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      const checkConnection = () => {
        const state = this.connectionService.connectionState()
        if (state.status === 'authenticated') {
          resolve()
        } else if (state.status === 'error') {
          reject(new Error(state.error || 'Connection failed'))
        } else {
          setTimeout(checkConnection, 100)
        }
      }

      // Timeout after 15 seconds
      setTimeout(() => reject(new Error('Connection timeout')), 15000)
      checkConnection()
    })
  }

  private async loadPosUsers(): Promise<void> {
    try {
      const usersService = this.connectionService.usersService
      if (!usersService) {
        throw new Error('Users service not available')
      }

      const result = await usersService.find({
        query: {
          isPosUser: true,
          $limit: 50,
          $sort: { firstName: 1 },
        },
      })

      const users = Array.isArray(result) ? result : (result as { data: unknown[] }).data || []

      this.posUsers.set(
        users.map((user: unknown, index: number) => {
          const u = user as {
            _id: string
            firstName: string
            lastName: string
            email?: string
            isPosUser: boolean
            employeeNumber?: string
            staffRole?: string
            avatar?: string
          }
          return {
            ...u,
            initials: this.getInitials(u.firstName, u.lastName),
            color: this.avatarColors[index % this.avatarColors.length],
          }
        }),
      )
    } catch (error) {
      console.error('Failed to load POS users:', error)
      throw new Error('Could not load users')
    }
  }

  private getInitials(firstName: string, lastName: string): string {
    return `${firstName?.charAt(0) || ''}${lastName?.charAt(0) || ''}`.toUpperCase()
  }

  //#endregion

  //#region User Selection
  selectUser(user: PosUser): void {
    this.selectedUser.set(user)
    this.pinInput.set('')
    this.pinError.set(false)
    this.currentStep.set('enter-pin')
  }

  backToUsers(): void {
    this.selectedUser.set(null)
    this.pinInput.set('')
    this.pinError.set(false)
    this.currentStep.set('select-user')
  }

  //#endregion

  //#region PIN Input
  addDigit(digit: string): void {
    if (this.pinInput().length < 4) {
      this.pinInput.update(current => current + digit)
      this.pinError.set(false)

      // Auto-submit bei 4 Ziffern
      if (this.pinInput().length === 4) {
        setTimeout(() => this.verifyPin(), 100)
      }
    }
  }

  deleteDigit(): void {
    this.pinInput.update(current => current.slice(0, -1))
    this.pinError.set(false)
  }

  async verifyPin(): Promise<void> {
    const user = this.selectedUser()
    if (!user) return

    this.isLoading.set(true)

    try {
      // Serverseitige PIN-Verifizierung via Custom-Methode
      const usersService = this.connectionService.usersService as any
      const verifiedUser = await usersService.verifyPin({ userId: user._id, pin: this.pinInput() })

      // Store logged in user — bewusst OHNE employeeNumber, weil diese als
      // Sole-Credential fuer Time-Clock-Aktionen (PIN-Eingabe in
      // time-clock-panel) dient und nicht im localStorage liegen soll.
      // Konsumenten des pos_current_user lesen employeeNumber nirgends.
      localStorage.setItem(
        'pos_current_user',
        JSON.stringify({
          _id: verifiedUser._id,
          firstName: verifiedUser.firstName,
          lastName: verifiedUser.lastName,
          initials: user.initials,
          staffRole: verifiedUser.staffRole,
        }),
      )

      this.router.navigate(['/dashboard'])
    } catch (error) {
      this.pinError.set(true)
      this.pinInput.set('')

      // Vibrate if supported
      if (navigator.vibrate) {
        navigator.vibrate([100, 50, 100])
      }
    } finally {
      this.isLoading.set(false)
    }
  }

  //#endregion

  //#region Error Handling
  retry(): void {
    this.connectAndLoadUsers()
  }

  goToSetup(): void {
    this.configService.clearConfig()
    this.router.navigate(['/setup'])
  }

  //#endregion

  //#region Settings
  readonly showSettings = signal(false)

  openSettings(): void {
    this.showSettings.set(true)
  }

  closeSettings(): void {
    this.showSettings.set(false)
  }

  resetDevice(): void {
    if (
      confirm(
        'Möchten Sie das Gerät wirklich zurücksetzen? Alle Einstellungen gehen verloren und die Verbindung zum Server wird getrennt.',
      )
    ) {
      this.configService.clearConfig()
      this.refreshPage()
    }
  }

  private refreshPage(): void {
    window.location.reload()
  }
  //#endregion

  //#region Theme & Language
  toggleTheme(): void {
    const current = this.themeService.theme
    const next = current === 'light' ? 'dark' : current === 'dark' ? 'system' : 'light'
    this.themeService.setTheme(next)
  }

  cycleLanguage(): void {
    const codes = this.languages.map(l => l.code)
    const idx = codes.indexOf(this.languageService.currentLanguage())
    const next = codes[(idx + 1) % codes.length]
    this.languageService.setLanguage(next)
  }

  currentLanguageLabel(): string {
    return this.languages.find(l => l.code === this.languageService.currentLanguage())?.label ?? 'DE'
  }
  //#endregion

  //#region Time Clock
  /**
   * Handle time clock actions (Kommen, Gehen, Pause, Pause Ende)
   */
  async onTimeClockAction(event: TimeClockEvent): Promise<void> {
    console.log('Time clock action:', event)

    // TODO: Send action to backend worktimes service
    // Example:
    // const worktimesService = this.connectionService.worktimesService;
    // await worktimesService.create({
    //   employeeNumber: event.employeeNumber,
    //   action: event.action,
    //   timestamp: event.timestamp,
    //   deviceId: this.configService.getConfig()?.deviceId,
    //   locationId: this.configService.getConfig()?.locationId,
    // });
  }

  //#endregion
}
