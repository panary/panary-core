import { Component, HostListener, inject, OnInit, signal, WritableSignal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { Router } from '@angular/router'
import { APP_CONFIG, DeviceConfigService } from '@panary/shared/data-access-config'
// Direct import to avoid circular dependency with Admin's ConnectionService
import { ConnectionService } from '@panary/shared/data-access'
import { POS_PIN_LENGTH, requiresPosPinChange } from '@panary/users/domain'
import { TimeClockEvent, TimeClockPanelComponent } from './time-clock-panel/time-clock-panel.component'
import { PinPadComponent } from './pin-pad/pin-pad.component'
import { ThemeServiceService } from '@panary/shared/data-access-theme'
import { UpdateService } from '@panary/shared/data-access-updater'
import { LanguageService, LANGUAGES } from '@panary/shared/data-access'
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

type LoginStep = 'loading' | 'select-user' | 'enter-pin' | 'change-pin' | 'error'

/** Phasen innerhalb des erzwungenen PIN-Wechsels. */
type ChangePinPhase = 'new' | 'confirm'

@Component({
  selector: 'lib-login',
  imports: [CommonModule, TimeClockPanelComponent, TranslateModule, PinPadComponent],
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

  // Erzwungener PIN-Wechsel (mustChangePosPin)
  readonly changePinPhase: WritableSignal<ChangePinPhase> = signal('new')
  readonly newPin: WritableSignal<string> = signal('')
  readonly confirmPin: WritableSignal<string> = signal('')
  readonly changePinError: WritableSignal<string | null> = signal(null)

  /**
   * Der beim Login verifizierte Klartext-PIN. Wird als Proof-of-Possession an
   * `changePin` weitergereicht — das Terminal hat keine Mitarbeiter-Session,
   * der alte PIN ist die einzige Bindung an die Person.
   *
   * Bewusst ein privates Feld und kein Signal: nicht im DevTools-Signal-Graph,
   * nie im localStorage, weg beim Reload (dann ist ein neuer Login faellig).
   */
  #verifiedPin: string | null = null
  #pendingUser: Record<string, unknown> | null = null

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
    const step = this.currentStep()

    // Nur in den beiden PIN-Eingabe-Schritten reagieren
    if (step !== 'enter-pin' && step !== 'change-pin') {
      return
    }

    const isChangePin = step === 'change-pin'

    // Backspace oder Delete zum Löschen
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault()
      if (isChangePin) this.deleteChangePinDigit()
      else this.deleteDigit()
      return
    }

    // Escape um zurück zur Benutzerauswahl zu gehen. Im Wechsel-Schritt bedeutet
    // das kompletten Rueckzug (inkl. Verwerfen des verifizierten PINs) — der
    // Zwang laesst sich damit nicht umgehen, nur neu beginnen.
    if (event.key === 'Escape') {
      event.preventDefault()
      if (isChangePin) this.cancelChangePin()
      else this.backToUsers()
      return
    }

    // Nur Ziffern 0-9 akzeptieren
    if (/^[0-9]$/.test(event.key)) {
      event.preventDefault()
      if (isChangePin) this.addChangePinDigit(event.key)
      else this.addDigit(event.key)
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
          // $select ist hier eine Sicherheitsmassnahme, keine Optimierung: ohne
          // sie liefert der Server auch `employeeNumber` aller Mitarbeiter aus
          // (der externalResolver strippt nur password/posPin). Die
          // Personalnummer ist aber das alleinige Credential fuer
          // Time-Clock-Aktionen — jedes Terminal haette damit die Stempel-Codes
          // der gesamten Belegschaft. Der Login-Screen braucht sie nicht.
          //
          // Nur echte Spalten auflisten (virtuelle Felder wie `hasPosPin`
          // wuerde Knex als "no such column" quittieren). `tenantId` bleibt
          // drin, damit das Sicherheitsnetz ensureTenantIsolation() weiter
          // greifen kann — es ueberspringt Records ohne tenantId.
          $select: ['_id', 'tenantId', 'firstName', 'lastName', 'isPosUser', 'staffRole'],
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

      // Erzwungener PIN-Wechsel: Der Admin hat den PIN vergeben und kennt ihn
      // daher — bis zum Wechsel waere keine POS-Aktion eindeutig zurechenbar.
      // Auswertung ueber den Domain-Helfer, weil der Edge SQLite-Booleans als
      // 0/1 liefert (siehe requiresPosPinChange).
      if (requiresPosPinChange(verifiedUser)) {
        this.#verifiedPin = this.pinInput()
        this.#pendingUser = { ...verifiedUser, initials: user.initials }
        this.pinInput.set('')
        this.#resetChangePinInputs()
        this.currentStep.set('change-pin')
        // Bewusst KEIN localStorage-Write und keine Navigation: ohne
        // `pos_current_user` schickt der posAuthGuard jede geschuetzte Route
        // zurueck auf /login — der Zwang haelt auch gegen manuelle URL-Eingabe.
        return
      }

      this.#completeLogin({ ...verifiedUser, initials: user.initials })
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

  /**
   * Schliesst den Login ab: Sitzungs-User ablegen und ins Dashboard.
   *
   * `employeeNumber` bleibt bewusst draussen — sie ist Sole-Credential fuer
   * Time-Clock-Aktionen und soll nicht im localStorage liegen. Die
   * Einstellungs-Seite laedt sie bei Bedarf frisch vom Server.
   */
  #completeLogin(user: Record<string, any>): void {
    localStorage.setItem(
      'pos_current_user',
      JSON.stringify({
        _id: user['_id'],
        firstName: user['firstName'],
        lastName: user['lastName'],
        initials: user['initials'],
        staffRole: user['staffRole'],
      }),
    )

    this.#verifiedPin = null
    this.#pendingUser = null
    this.router.navigate(['/dashboard'])
  }

  //#endregion

  //#region Forced PIN Change
  #resetChangePinInputs(): void {
    this.changePinPhase.set('new')
    this.newPin.set('')
    this.confirmPin.set('')
    this.changePinError.set(null)
  }

  /** Aktuell befuellte Eingabe — je nach Phase neuer oder bestaetigter PIN. */
  private activeChangePin(): WritableSignal<string> {
    return this.changePinPhase() === 'new' ? this.newPin : this.confirmPin
  }

  addChangePinDigit(digit: string): void {
    const target = this.activeChangePin()
    if (target().length >= POS_PIN_LENGTH) return

    this.changePinError.set(null)
    target.update(current => current + digit)

    if (target().length < POS_PIN_LENGTH) return

    if (this.changePinPhase() === 'new') {
      // Zweite Phase: Bestaetigung. Kein Auto-Submit vor dem Abgleich.
      this.changePinPhase.set('confirm')
      return
    }

    setTimeout(() => this.submitNewPin(), 100)
  }

  deleteChangePinDigit(): void {
    const target = this.activeChangePin()
    this.changePinError.set(null)

    // Am Anfang der Bestaetigung zurueck in die erste Phase — sonst haengt der
    // Nutzer in einer Eingabe fest, die er nicht mehr korrigieren kann.
    if (target().length === 0 && this.changePinPhase() === 'confirm') {
      this.changePinPhase.set('new')
      this.newPin.set('')
      return
    }

    target.update(current => current.slice(0, -1))
  }

  async submitNewPin(): Promise<void> {
    const userId = this.#pendingUser?.['_id'] as string | undefined
    const currentPin = this.#verifiedPin
    if (!userId || !currentPin) return

    if (this.newPin() !== this.confirmPin()) {
      this.#failChangePin('LOGIN.PIN_MISMATCH')
      return
    }

    if (this.newPin() === currentPin) {
      this.#failChangePin('LOGIN.PIN_SAME_AS_OLD')
      return
    }

    this.isLoading.set(true)
    try {
      const usersService = this.connectionService.usersService as any
      const updated = await usersService.changePin({ userId, currentPin, newPin: this.newPin() })

      this.#completeLogin({ ...this.#pendingUser, ...updated, initials: this.#pendingUser?.['initials'] })
    } catch (error) {
      const code = (error as { code?: number })?.code
      const message = (error as { message?: string })?.message

      if (code === 429) {
        this.#failChangePin('LOGIN.PIN_TOO_MANY_ATTEMPTS')
      } else if (code === 400 && message) {
        // Server-Meldung (Format/gleiche PIN) direkt zeigen — sie ist bereits
        // benutzergerecht formuliert.
        this.#failChangePin(null, message)
      } else {
        this.#failChangePin('LOGIN.PIN_CHANGE_FAILED')
      }
    } finally {
      this.isLoading.set(false)
    }
  }

  /**
   * Setzt die Eingabe zurueck, behaelt aber `#verifiedPin` — sonst muesste sich
   * der Mitarbeiter nach jedem Vertipper komplett neu anmelden.
   */
  #failChangePin(translationKey: string | null, rawMessage?: string): void {
    this.changePinError.set(translationKey ? this.#translateService.instant(translationKey) : (rawMessage ?? ''))
    this.changePinPhase.set('new')
    this.newPin.set('')
    this.confirmPin.set('')

    if (navigator.vibrate) {
      navigator.vibrate([100, 50, 100])
    }
  }

  /** Abbruch im Wechsel-Dialog: kompletter Rueckzug zur Benutzerauswahl. */
  cancelChangePin(): void {
    this.#verifiedPin = null
    this.#pendingUser = null
    this.#resetChangePinInputs()
    this.selectedUser.set(null)
    this.pinInput.set('')
    this.currentStep.set('select-user')
  }

  //#endregion

  //#region Error Handling
  /**
   * Erneut versuchen — aber nur, wenn der laufende Socket ueberhaupt noch zur
   * gespeicherten DeviceConfig passt.
   *
   * Nach einem frischen Pairing (oder einem Serverwechsel) wurde er im Bootstrap
   * mit der alten, ggf. leeren Config gebaut; URL und auth-Payload sind danach
   * unveraenderlich. Ein Reconnect kann dann nie ein `device:authenticated`
   * bekommen und liefe garantiert erneut in den Timeout. Einziger Ausweg ist ein
   * Neustart der App.
   */
  retry(): void {
    if (!this.connectionService.isConfiguredFor(this.configService.getConfig())) {
      this.refreshPage()
      return
    }
    void this.connectAndLoadUsers()
  }

  /**
   * Neustart statt Navigation: nach `clearConfig()` traegt der laufende Socket
   * weiterhin die alten Geraete-Credentials und reconnected dauerhaft gegen den
   * alten Server. Bliebe er stehen, koennte ein `device:deactivated` waehrend
   * des Re-Setups `clearConfig()` ausloesen und die soeben geschriebene neue
   * Config wieder loeschen. Der `posAuthGuard` schickt nach dem Neustart wegen
   * `hasConfig() === false` von selbst nach /setup.
   */
  goToSetup(): void {
    this.configService.clearConfig()
    this.refreshPage()
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
