import {
  Component,
  inject,
  signal,
  WritableSignal,
  computed,
  effect,
  viewChild,
  ElementRef,
} from '@angular/core'
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
  HubDiscoveryService,
} from '@panary/shared/data-access-config'
import { ThemeServiceService } from '@panary/shared/data-access-theme'
import { LanguageService, LANGUAGES } from '@panary/shared/data-access'
import { TranslateModule, TranslateService } from '@ngx-translate/core'

/**
 * Setup-/Pairing-Schritte:
 *  welcome        – Cloud (Default) vs. lokaler Hub
 *  hub-prep       – Hinweis + Animation „Hub angeschlossen?"
 *  hub-discover   – mDNS-Liste + QR + manuelle IP
 *  hub-setup-hint – gewählter Hub ist noch nicht eingerichtet
 *  hub-auth       – Pairing-Code (bevorzugt) | Admin-Login
 *  server-login   – Admin-Login (Cloud + Hub-Login-Fallback)
 *  select-org     – Organisation/Standort
 *  device-info    – Gerätename/-typ
 *  registering / success / error
 */
type SetupStep =
  | 'welcome'
  | 'hub-prep'
  | 'hub-discover'
  | 'hub-setup-hint'
  | 'hub-auth'
  | 'server-login'
  | 'select-org'
  | 'device-info'
  | 'registering'
  | 'success'
  | 'error'

type PairingMode = 'cloud' | 'local'

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
  private readonly hubDiscovery = inject(HubDiscoveryService)
  private readonly router = inject(Router)
  readonly themeService = inject(ThemeServiceService)
  readonly languageService = inject(LanguageService)
  readonly translateService = inject(TranslateService)
  private readonly appConfig = inject(APP_CONFIG)
  readonly appVersion = this.appConfig.appVersion
  //#endregion

  //#region Form Data
  serverUrl = 'http://localhost:3030'
  email = ''
  password = ''
  selectedTenantId = ''
  selectedLocationId = ''
  deviceName = ''
  deviceType: DeviceType = 'pos-counter'

  // Lokaler-Hub-Pfad
  manualHubUrl = ''
  pairingCode = ''
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
  readonly currentStep: WritableSignal<SetupStep> = signal('welcome')
  readonly language: WritableSignal<string> = signal('de')

  readonly pairingMode: WritableSignal<PairingMode> = signal('cloud')

  // Verbindungsziel-Anzeige (Cloud-Name oder Hub-organizationName/URL)
  readonly connectedHubName: WritableSignal<string | null> = signal(null)
  readonly probing = signal(false)
  readonly hubError: WritableSignal<string | null> = signal(null)

  // Hub-Discovery (aus dem Service)
  readonly hubs = this.hubDiscovery.hubs
  readonly scanning = this.hubDiscovery.scanning
  readonly isTauri = this.hubDiscovery.isTauri

  // Registrierungs-State (aus dem Service)
  readonly registrationStatus = this.configService.registrationStatus
  readonly registrationError = this.configService.registrationError
  readonly organizations = this.configService.organizations
  readonly locations = this.configService.locations

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
    switch (this.currentStep()) {
      case 'welcome':
        return 'SETUP.WELCOME_TITLE'
      case 'hub-prep':
        return 'SETUP.HUB_PREP_TITLE'
      case 'hub-discover':
        return 'SETUP.HUB_DISCOVER_TITLE'
      case 'hub-setup-hint':
        return 'SETUP.HUB_SETUP_HINT_TITLE'
      case 'hub-auth':
        return 'SETUP.HUB_AUTH_TITLE'
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
    const status = this.registrationStatus()
    switch (this.currentStep()) {
      case 'welcome':
        return 'SETUP.WELCOME_DESC'
      case 'hub-prep':
        return 'SETUP.HUB_PREP_DESC'
      case 'hub-discover':
        return 'SETUP.HUB_DISCOVER_DESC'
      case 'hub-setup-hint':
        return 'SETUP.HUB_SETUP_HINT_DESC'
      case 'hub-auth':
        return 'SETUP.HUB_AUTH_DESC'
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
  //#endregion

  //#region Language Config
  readonly languages = LANGUAGES
  //#endregion

  //#region Constructor
  constructor() {
    this.language.set(this.configService.getLanguage())

    // Auf Registrierungs-Fehler reagieren → Error-Screen.
    effect(() => {
      const status = this.registrationStatus()
      this.handleStatusChange(status)
    })
  }
  //#endregion

  //#region Language / Theme
  cycleLanguage(): void {
    const codes = this.languages.map(l => l.code)
    const idx = codes.indexOf(this.languageService.currentLanguage())
    const next = codes[(idx + 1) % codes.length]
    this.languageService.setLanguage(next)
    this.language.set(next)
  }

  toggleTheme(): void {
    const current = this.themeService.theme
    const next = current === 'light' ? 'dark' : current === 'dark' ? 'system' : 'light'
    this.themeService.setTheme(next)
  }
  //#endregion

  //#region Welcome → Pfadwahl
  /** Default: direkt gegen die fest hinterlegte Panary-Cloud koppeln. */
  chooseCloud(): void {
    this.pairingMode.set('cloud')
    this.serverUrl = this.appConfig.cloudUrl || 'https://cloud.panary.io'
    this.connectedHubName.set('Panary Cloud')
    this.configService.resetStatus()
    this.currentStep.set('server-login')
  }

  /** Alternativ: lokalen Panary Hub im Netzwerk suchen. */
  chooseLocalHub(): void {
    this.pairingMode.set('local')
    this.currentStep.set('hub-prep')
  }
  //#endregion

  //#region Lokaler Hub: Discovery
  /** Nutzer bestätigt, dass der Hub angeschlossen ist → Suche starten. */
  confirmHubConnected(): void {
    this.currentStep.set('hub-discover')
    void this.runDiscovery()
  }

  async runDiscovery(): Promise<void> {
    this.hubError.set(null)
    await this.hubDiscovery.discoverHubs()
  }

  /** Hub aus der mDNS-Liste gewählt. */
  async selectHub(hubUrl: string, displayName?: string): Promise<void> {
    this.serverUrl = hubUrl
    await this.probeAndRoute(displayName)
  }

  /** Manuelle IP/URL-Eingabe als Fallback. */
  async submitManualHub(): Promise<void> {
    if (!this.isManualHubValid()) return
    this.serverUrl = this.normalizeUrl(this.manualHubUrl)
    await this.probeAndRoute()
  }

  /** QR-Scan lieferte URL (+ optional Code) → wie Hub-Auswahl behandeln. */
  async onQrDecoded(payload: { url?: string; code?: string }): Promise<void> {
    if (!payload.url) return
    this.serverUrl = this.normalizeUrl(payload.url)
    if (payload.code) this.pairingCode = payload.code
    await this.probeAndRoute()
  }

  //#region QR-Scan (dependency-frei via BarcodeDetector; degradiert auf WebKitGTK)
  readonly qrActive = signal(false)
  readonly qrError: WritableSignal<string | null> = signal(null)
  private readonly qrVideo = viewChild<ElementRef<HTMLVideoElement>>('qrVideo')
  private qrStream: MediaStream | null = null
  private qrStop = false

  async startQrScan(): Promise<void> {
    this.qrError.set(null)
    const BarcodeDetectorCtor = (window as unknown as { BarcodeDetector?: new (o?: unknown) => { detect(s: unknown): Promise<{ rawValue: string }[]> } }).BarcodeDetector
    if (!BarcodeDetectorCtor || !navigator.mediaDevices?.getUserMedia) {
      this.qrError.set('SETUP.QR_UNSUPPORTED')
      return
    }
    this.qrActive.set(true)
    this.qrStop = false
    try {
      this.qrStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      // Video-Element existiert erst nach dem nächsten Render (qrActive=true).
      await new Promise(r => setTimeout(r, 0))
      const video = this.qrVideo()?.nativeElement
      if (!video) {
        this.stopQrScan()
        return
      }
      video.srcObject = this.qrStream
      await video.play()
      const detector = new BarcodeDetectorCtor({ formats: ['qr_code'] })
      const loop = async () => {
        if (this.qrStop) return
        try {
          const codes = await detector.detect(video)
          if (codes && codes.length > 0) {
            const raw = codes[0].rawValue
            this.stopQrScan()
            this.#handleQrPayload(raw)
            return
          }
        } catch {
          // einzelne Frame-Fehler ignorieren
        }
        requestAnimationFrame(() => void loop())
      }
      void loop()
    } catch {
      this.qrError.set('SETUP.QR_CAMERA_DENIED')
      this.stopQrScan()
    }
  }

  stopQrScan(): void {
    this.qrStop = true
    this.qrStream?.getTracks().forEach(t => t.stop())
    this.qrStream = null
    this.qrActive.set(false)
  }

  #handleQrPayload(raw: string): void {
    // Erwartet JSON {url, code} oder eine nackte URL.
    try {
      const parsed = JSON.parse(raw) as { url?: string; code?: string }
      void this.onQrDecoded({ url: parsed.url, code: parsed.code })
    } catch {
      void this.onQrDecoded({ url: raw })
    }
  }
  //#endregion

  private async probeAndRoute(displayName?: string): Promise<void> {
    this.probing.set(true)
    this.hubError.set(null)
    try {
      const result = await this.hubDiscovery.probeHub(this.serverUrl)
      if (!result.reachable) {
        this.hubError.set('SETUP.HUB_UNREACHABLE')
        return
      }
      this.connectedHubName.set(result.organizationName || displayName || this.serverUrl)
      if (result.setupComplete === false) {
        this.currentStep.set('hub-setup-hint')
      } else {
        this.currentStep.set('hub-auth')
      }
    } finally {
      this.probing.set(false)
    }
  }

  /** Hub-Setup-Hinweis: erneut prüfen, ob der Hub inzwischen eingerichtet ist. */
  retryHubCheck(): void {
    void this.probeAndRoute(this.connectedHubName() ?? undefined)
  }

  chooseAnotherHub(): void {
    this.hubError.set(null)
    this.currentStep.set('hub-discover')
    void this.runDiscovery()
  }
  //#endregion

  //#region Lokaler Hub: Pairing-Code
  isPairingCodeValid(): boolean {
    return /^\d{6}$/.test(this.pairingCode.trim())
  }

  async submitPairingCode(): Promise<void> {
    if (!this.isPairingCodeValid() || !this.isStep3Valid()) return
    this.currentStep.set('registering')

    const config = await this.configService.redeemPairingCode(this.serverUrl, this.pairingCode, {
      deviceName: this.deviceName.trim(),
      deviceType: this.deviceType,
    })

    if (config) {
      this.finishSuccess(config.deviceId)
    }
    // Fehlerfall: handleStatusChange()-Effect schaltet auf 'error'.
  }
  //#endregion

  //#region Admin-Login-Pfad (Cloud + Hub-Fallback)
  /** Hub-Pfad: vom Pairing-Code auf den Admin-Login-Fallback wechseln. */
  goToServerLogin(): void {
    this.configService.resetStatus()
    this.currentStep.set('server-login')
  }

  isStep1Valid(): boolean {
    return this.serverUrl.trim().length > 0 && this.email.trim().length > 0 && this.password.length > 0
  }

  isStep2Valid(): boolean {
    return this.selectedTenantId.length > 0 && this.selectedLocationId.length > 0
  }

  readonly DEVICE_NAME_MAX_LENGTH = 50
  readonly DEVICE_NAME_PATTERN = /^[a-zA-Z0-9äöüÄÖÜß\s\-_]+$/

  isStep3Valid(): boolean {
    const name = this.deviceName.trim()
    return name.length > 0 && name.length <= this.DEVICE_NAME_MAX_LENGTH && this.DEVICE_NAME_PATTERN.test(name)
  }

  getDeviceNameError(): string | null {
    const name = this.deviceName.trim()
    if (name.length === 0) return null
    if (name.length > this.DEVICE_NAME_MAX_LENGTH) {
      return `Maximal ${this.DEVICE_NAME_MAX_LENGTH} Zeichen erlaubt`
    }
    if (!this.DEVICE_NAME_PATTERN.test(name)) {
      return 'Nur Buchstaben, Zahlen, Leerzeichen, Bindestriche und Unterstriche erlaubt'
    }
    return null
  }

  /** Admin-Login (Cloud-URL oder lokaler Hub). */
  async submitStep1(): Promise<void> {
    if (!this.isStep1Valid()) return

    const credentials: SetupCredentials = {
      serverUrl: this.serverUrl.trim(),
      email: this.email.trim(),
      password: this.password,
    }

    const success = await this.configService.adminLogin(credentials)
    if (success) {
      this.currentStep.set('select-org')
      const orgs = this.organizations()
      if (orgs.length === 1) {
        this.selectedTenantId = orgs[0]._id
        this.onOrganizationChange()
      }
    }
  }

  onOrganizationChange(): void {
    this.selectedLocationId = ''
    const locs = this.filteredLocations()
    if (locs.length === 1) {
      this.selectedLocationId = locs[0]._id
    }
  }

  submitStep2(): void {
    if (!this.isStep2Valid()) return
    this.currentStep.set('device-info')
  }

  async submitStep3(): Promise<void> {
    if (!this.isStep3Valid()) return
    this.currentStep.set('registering')

    const request: DeviceRegistrationRequest = {
      name: this.deviceName.trim(),
      type: this.deviceType,
      tenantId: this.selectedTenantId,
      locationId: this.selectedLocationId,
    }

    const config = await this.configService.registerDevice(this.serverUrl.trim(), request)
    if (config) {
      this.finishSuccess(config.deviceId)
    } else {
      this.currentStep.set('error')
    }
  }
  //#endregion

  //#region Navigation / Erfolg
  private finishSuccess(deviceId: string): void {
    this.registeredDeviceId.set(deviceId)
    this.currentStep.set('success')
    setTimeout(() => {
      void this.router.navigate(['/login'])
    }, 2500)
  }

  /** Kontextabhängiges Zurück. */
  goBack(): void {
    switch (this.currentStep()) {
      case 'hub-prep':
        this.currentStep.set('welcome')
        break
      case 'hub-discover':
        this.currentStep.set('hub-prep')
        break
      case 'hub-setup-hint':
      case 'hub-auth':
        this.currentStep.set('hub-discover')
        break
      case 'server-login':
        this.currentStep.set(this.pairingMode() === 'local' ? 'hub-auth' : 'welcome')
        break
      case 'select-org':
        this.currentStep.set('server-login')
        break
      case 'device-info':
        // device-info wird nur im Admin-Login-Pfad erreicht.
        this.currentStep.set('select-org')
        break
    }
  }
  //#endregion

  //#region Helpers / Error
  private normalizeUrl(input: string): string {
    let url = input.trim().replace(/\/$/, '')
    if (!/^https?:\/\//.test(url)) {
      url = `http://${url}`
    }
    // Standard-Edge-Port ergänzen, wenn keiner angegeben ist.
    if (!/:\d+$/.test(url) && !/^https:\/\//.test(url)) {
      url = `${url}:3030`
    }
    return url
  }

  isManualHubValid(): boolean {
    return this.manualHubUrl.trim().length > 0
  }

  resetForm(): void {
    this.currentStep.set('welcome')
    this.configService.resetStatus()
    this.registeredDeviceId.set(null)
    this.password = ''
    this.pairingCode = ''
    this.hubError.set(null)
  }

  retryRegistration(): void {
    this.resetForm()
  }

  private handleStatusChange(status: RegistrationStatus): void {
    if (status === 'error') {
      this.currentStep.set('error')
    }
  }
  //#endregion
}
