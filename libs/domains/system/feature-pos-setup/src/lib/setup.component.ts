import { Component, inject, signal, WritableSignal, computed, effect } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Router } from '@angular/router'
import {
  DeviceConfigService,
  DeviceRegistrationRequest,
  RegistrationStatus,
  SetupCredentials,
  DeviceType,
  APP_CONFIG,
} from '@panary-core/shared/data-access-config'
import { ThemeServiceService } from '@panary-core/shared/data-access-theme'
import { LanguageService, LANGUAGES } from '@panary-core/shared/data-access'
import { TranslateModule, TranslateService } from '@ngx-translate/core'

/**
 * Setup-Schritte:
 * 1. server-login: Server-URL und Admin-Login
 * 2. select-org: Organisation und Standort auswählen
 * 3. device-info: Geräte-Name und -Typ eingeben
 * 4. registering: Gerät wird registriert
 * 5. success: Fertig
 * 6. error: Fehler
 */
type SetupStep = 'server-login' | 'select-org' | 'device-info' | 'registering' | 'success' | 'error'

@Component({
  selector: 'lib-setup',
  imports: [CommonModule, FormsModule, TranslateModule],
  templateUrl: './setup.component.html',
  styleUrl: './setup.component.scss',
  standalone: true,
})
export class SetupComponent {
  //#region Dependencies
  private readonly configService = inject(DeviceConfigService)
  private readonly router = inject(Router)
  readonly themeService = inject(ThemeServiceService)
  readonly languageService = inject(LanguageService)
  readonly translateService = inject(TranslateService)
  readonly appVersion = inject(APP_CONFIG).appVersion
  //#endregion

  //#region Form Data - Step 1: Server & Login
  serverUrl = 'http://localhost:3030'
  loginname = ''
  password = ''
  //#endregion

  //#region Form Data - Step 2: Organization
  selectedTenantId = ''
  selectedLocationId = ''
  //#endregion

  //#region Form Data - Step 3: Device
  deviceName = ''
  deviceType: DeviceType = 'pos-counter'
  //#endregion

  //#region Available Device Types
  readonly deviceTypes: { value: DeviceType; label: string }[] = [
    { value: 'pos-counter', label: 'POS Counter Terminal' },
    { value: 'kds', label: 'Kitchen Display System' },
    { value: 'tablet', label: 'Tablet-Client' },
    { value: 'other', label: 'Sonstige' },
  ]
  //#endregion

  //#region State Signals
  readonly currentStep: WritableSignal<SetupStep> = signal('server-login')
  readonly language: WritableSignal<string> = signal('de')

  // From service
  readonly registrationStatus = this.configService.registrationStatus
  readonly registrationError = this.configService.registrationError
  readonly organizations = this.configService.organizations
  readonly locations = this.configService.locations

  // Show registered device ID after success
  readonly registeredDeviceId: WritableSignal<string | null> = signal(null)
  //#endregion

  //#region Computed
  readonly isLoading = computed(() => {
    const status = this.registrationStatus()
    return (
      status === 'connecting' || status === 'authenticating' || status === 'loading-orgs' || status === 'registering'
    )
  })

  readonly filteredLocations = computed(() => {
    const orgId = this.selectedTenantId
    if (!orgId) return []
    return this.locations().filter(loc => loc.tenantId === orgId)
  })

  readonly stepTitleKey = computed(() => {
    const step = this.currentStep()
    switch (step) {
      case 'server-login':
        return 'SETUP.CONNECT_TITLE'
      case 'select-org':
        return 'SETUP.ORG_TITLE'
      case 'device-info':
        return 'SETUP.DEVICE_TITLE'
      case 'registering':
        return 'SETUP.REGISTERING_TITLE'
      case 'success':
        return 'SETUP.SUCCESS_TITLE'
      case 'error':
        return 'SETUP.ERROR_TITLE'
      default:
        return 'SETUP.TITLE'
    }
  })

  readonly stepDescriptionKey = computed(() => {
    const step = this.currentStep()
    const status = this.registrationStatus()
    switch (step) {
      case 'server-login':
        return 'SETUP.CONNECT_DESC'
      case 'select-org':
        return 'SETUP.ORG_DESC'
      case 'device-info':
        return 'SETUP.DEVICE_DESC'
      case 'registering':
        if (status === 'connecting') return 'SETUP.STATUS_CONNECTING'
        if (status === 'authenticating') return 'SETUP.STATUS_AUTH'
        if (status === 'loading-orgs') return 'SETUP.STATUS_LOADING'
        return 'SETUP.STATUS_REGISTERING'
      case 'success':
        return 'SETUP.SUCCESS_DESC'
      case 'error':
        return 'SETUP.GENERIC_ERROR'
      default:
        return ''
    }
  })

  readonly stepNumber = computed(() => {
    const step = this.currentStep()
    switch (step) {
      case 'server-login':
        return 1
      case 'select-org':
        return 2
      case 'device-info':
        return 3
      default:
        return 0
    }
  })
  //#endregion

  //#region Language Config
  readonly languages = LANGUAGES
  //#endregion

  //#region Constructor
  constructor() {
    this.language.set(this.configService.getLanguage())

    // React to registration status changes
    effect(() => {
      const status = this.registrationStatus()
      this.handleStatusChange(status)
    })
  }
  //#endregion

  //#region Language Methods
  cycleLanguage(): void {
    const codes = this.languages.map(l => l.code)
    const idx = codes.indexOf(this.languageService.currentLanguage())
    const next = codes[(idx + 1) % codes.length]
    this.languageService.setLanguage(next)
    this.language.set(next)
  }
  //#endregion

  //#region Form Validation
  isStep1Valid(): boolean {
    return this.serverUrl.trim().length > 0 && this.loginname.trim().length > 0 && this.password.length > 0
  }

  isStep2Valid(): boolean {
    return this.selectedTenantId.length > 0 && this.selectedLocationId.length > 0
  }

  // Validation constants
  readonly DEVICE_NAME_MAX_LENGTH = 50
  readonly DEVICE_NAME_PATTERN = /^[a-zA-Z0-9äöüÄÖÜß\s\-_]+$/

  isStep3Valid(): boolean {
    const name = this.deviceName.trim()
    return name.length > 0 && name.length <= this.DEVICE_NAME_MAX_LENGTH && this.DEVICE_NAME_PATTERN.test(name)
  }

  getDeviceNameError(): string | null {
    const name = this.deviceName.trim()
    if (name.length === 0) return null // Noch nichts eingegeben
    if (name.length > this.DEVICE_NAME_MAX_LENGTH) {
      return `Maximal ${this.DEVICE_NAME_MAX_LENGTH} Zeichen erlaubt`
    }
    if (!this.DEVICE_NAME_PATTERN.test(name)) {
      return 'Nur Buchstaben, Zahlen, Leerzeichen, Bindestriche und Unterstriche erlaubt'
    }
    return null
  }
  //#endregion

  //#region Step Navigation
  /**
   * Step 1: Admin-Login durchführen
   */
  async submitStep1(): Promise<void> {
    if (!this.isStep1Valid()) return

    const credentials: SetupCredentials = {
      serverUrl: this.serverUrl.trim(),
      loginname: this.loginname.trim(),
      password: this.password,
    }

    const success = await this.configService.adminLogin(credentials)

    if (success) {
      this.currentStep.set('select-org')

      // Auto-select if only one option
      const orgs = this.organizations()
      if (orgs.length === 1) {
        this.selectedTenantId = orgs[0]._id
        this.onOrganizationChange()
      }
    }
  }

  /**
   * Organization changed - update filtered locations
   */
  onOrganizationChange(): void {
    this.selectedLocationId = ''

    // Auto-select if only one location
    const locs = this.filteredLocations()
    if (locs.length === 1) {
      this.selectedLocationId = locs[0]._id
    }
  }

  /**
   * Step 2: Organization ausgewählt
   */
  submitStep2(): void {
    if (!this.isStep2Valid()) return
    this.currentStep.set('device-info')
  }

  /**
   * Step 3: Gerät registrieren
   */
  async submitStep3(): Promise<void> {
    if (!this.isStep3Valid()) return

    this.currentStep.set('registering')

    // Generate default device name if empty
    const terminalNumber = Math.floor(10000 + Math.random() * 90000)
    const finalDeviceName = this.deviceName.trim() || `POS-Terminal-${terminalNumber}`

    const request: DeviceRegistrationRequest = {
      name: finalDeviceName,
      type: this.deviceType,
      tenantId: this.selectedTenantId,
      locationId: this.selectedLocationId,
    }

    const config = await this.configService.registerDevice(this.serverUrl.trim(), request)

    if (config) {
      this.registeredDeviceId.set(config.deviceId)
      this.currentStep.set('success')

      // Navigate to login after success animation
      setTimeout(() => {
        this.router.navigate(['/login'])
      }, 2500)
    } else {
      this.currentStep.set('error')
    }
  }

  /**
   * Zurück zum vorherigen Step
   */
  goBack(): void {
    const step = this.currentStep()
    if (step === 'select-org') {
      this.currentStep.set('server-login')
    } else if (step === 'device-info') {
      this.currentStep.set('select-org')
    }
  }
  //#endregion

  //#region Error Handling
  /**
   * Setzt das Formular zurück (z.B. nach Fehler)
   */
  resetForm(): void {
    this.currentStep.set('server-login')
    this.configService.resetStatus()
    this.registeredDeviceId.set(null)
    this.password = '' // Clear password for security
  }

  /**
   * Retry nach Fehler
   */
  retryRegistration(): void {
    this.resetForm()
  }
  //#endregion

  toggleTheme(): void {
    const current = this.themeService.theme
    const next = current === 'light' ? 'dark' : current === 'dark' ? 'system' : 'light'
    this.themeService.setTheme(next)
  }

  //#region Private Methods
  private handleStatusChange(status: RegistrationStatus): void {
    if (status === 'error') {
      this.currentStep.set('error')
    }
    // Other status changes are handled by the step-specific submit methods
  }
  //#endregion
}
