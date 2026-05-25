import { computed, inject, Injectable, signal, Signal, WritableSignal } from '@angular/core'

import { feathers, Id, Params, Service } from '@feathersjs/feathers'
import { FeathersError } from '@feathersjs/errors'

import socketio, { SocketService } from '@feathersjs/socketio-client'
import io, { Socket } from 'socket.io-client'
import { Utils } from '@panary/shared/util-helpers'

import { AppConfigService, DeviceConfigService } from '@panary/shared/data-access-config'
import { BusinessDaySchema } from '@panary/businessdays/domain'

type ServiceTypes = {
  users: SocketService & {
    checkin: (data: { id: Id }) => Promise<{ workingTimeId: string }>
    checkout: (data: { id: Id }) => Promise<{ workingTimeId: string }>
    startBreak: (data: { id: Id }) => Promise<{ workingTimeId: string }>
    endBreak: (data: { id: Id }) => Promise<{ workingTimeId: string }>
    mustChangePassword: (data: { newPassword: string }, params?: Params) => Promise<any>
  }
  businessdays: SocketService & {
    open: (data: { locationId: string }) => Promise<{ businessDayId: Id; date: string }>
    close: (data: { locationId: string }) => Promise<{ businessDay: BusinessDaySchema }>
  }
  orders: SocketService & {
    multiPatchStatus: (data: { status: number }) => Promise<{ orders: any }>
  }
}

export type ServiceName = keyof ConnectionService

@Injectable({
  providedIn: 'root',
})
export class ConnectionService {
  //#region Dependencies
  protected readonly appConfigService: AppConfigService = inject(AppConfigService)
  protected readonly deviceConfigService: DeviceConfigService = inject(DeviceConfigService) // Inject DeviceConfigService
  //#endregion

  //#region Signals & State
  #serverLink: WritableSignal<{ isConnected: boolean; connectedAt: string }> = signal({
    isConnected: false,
    connectedAt: '-',
  })
  #isAuthenticated: WritableSignal<boolean> = signal(false)
  #systemMode: WritableSignal<string> = signal('standalone')

  // Signal: Die User-Session wurde server-seitig als ungültig/abgelaufen
  // zurückgewiesen (WS-Auth 401). Nur Admin/User-Mode relevant — Device-Mode
  // (POS) wird in `authenticateSocket()`/`socketLogout()` ohnehin ausgenommen.
  // Die `AuthService` reagiert auf dieses Signal mit `logout()` + Redirect zum
  // Login, statt bei abgelaufenem Token still in einer WS-Reconnect-Schleife mit
  // leerem Hauptinhalt hängenzubleiben.
  readonly #userSessionExpired: WritableSignal<boolean> = signal(false)

  // Cloud-Pairing-Status aus dem /health-Endpoint des Edge-Backends. Wird beim
  // Connect und periodisch gepollt (siehe #healthPoll), damit POS- und Setup-
  // Client einen Auto-Disconnect (z.B. nach Token-Ablauf via Standby) erkennen
  // koennen, ohne RBAC-Zugriff auf den `cloud-connection`-Service zu brauchen.
  readonly #cloudPairingStatus: WritableSignal<string | null> = signal(null)
  readonly #cloudTokenErrorReason: WritableSignal<string | null> = signal(null)
  #healthPoll: ReturnType<typeof setInterval> | null = null
  #lastHealthUrl: string | null = null

  // Cloud-Status-Badge-Datenquellen: aus /health gepollt, RBAC-frei lesbar.
  // `#tick` triggert ein Re-Compute alle 60s, damit Computed-Werte wie
  // `Date.now() - lastSyncAt` ohne Polling-Roundtrip aktualisiert werden.
  readonly #lastSyncAt: WritableSignal<string | null> = signal(null)
  readonly #edgeTokenExpiresAt: WritableSignal<string | null> = signal(null)
  readonly #tick: WritableSignal<number> = signal(0)
  #tickTimer: ReturnType<typeof setInterval> | null = null

  // Compatibility for POS
  readonly #connectionError: WritableSignal<string | null> = signal(null)

  readonly connectionState = computed(() => {
    const linked = this.#serverLink().isConnected
    const auth = this.#isAuthenticated()
    const err = this.#connectionError()

    let status: 'disconnected' | 'connecting' | 'connected' | 'authenticated' | 'error' = 'disconnected'

    if (err) status = 'error'
    else if (auth) status = 'authenticated'
    else if (linked) status = 'connected'
    else status = 'disconnected'

    return {
      status: status as 'disconnected' | 'connecting' | 'connected' | 'authenticated' | 'error',
      connectedAt: this.#serverLink().connectedAt,
      error: err,
      deviceId: this.deviceConfigService.getConfig()?.deviceId || null,
    }
  })
  //#endregion

  //#region Properties
  #app: any
  // Keep strict typing for internal usage if possible, or any
  #socket: Socket

  get userId(): Id | undefined {
    // Helper to decode token or get from storage if needed, but preferably used from AuthService in the app
    return undefined // ConnectionService shouldn't know about current user ID directly if possible, or decode it from token
  }

  get apikeyService(): Service {
    return this.#app.service('apikeys')
  }

  get productGroupService(): Service {
    return this.#app.service('product-groups')
  }

  get discountsService(): Service {
    return this.#app.service('discounts')
  }

  get discountCodesService(): Service {
    return this.#app.service('discount-codes')
  }

  get productService(): Service {
    return this.#app.service('products')
  }

  get businessDayService(): Service {
    return this.#app.service('businessdays')
  }

  get corporateCustomerService(): Service {
    return this.#app.service('corporate-customers')
  }

  get incomingGoodService(): Service {
    return this.#app.service('incoming-goods')
  }

  get inventoryService(): Service {
    return this.#app.service('inventories')
  }

  get inventorySnapshotService(): Service {
    return this.#app.service('inventory-snapshots')
  }

  get invoiceService(): Service {
    return this.#app.service('invoices')
  }

  get isAuthenticated(): Signal<boolean> {
    return this.#isAuthenticated.asReadonly()
  }

  get ingredientService(): Service {
    return this.#app.service('ingredients')
  }

  get locationService(): Service {
    return this.#app.service('locations')
  }

  // Alias for compatibility
  get locationsService(): Service {
    return this.locationService
  }

  get orderService(): Service {
    return this.#app.service('orders')
  }

  // Alias for compatibility
  get ordersService(): Service {
    return this.orderService
  }

  get organizationService(): Service {
    return this.#app.service('organizations')
  }

  get pricelistService(): Service {
    return this.#app.service('pricelists')
  }

  // Alias for compatibility
  get pricelistsService(): Service {
    return this.pricelistService
  }

  get privateCustomerService(): Service {
    return this.#app.service('private-customers')
  }

  get recipeService(): Service {
    return this.#app.service('recipes')
  }

  get serverLink(): Signal<{ isConnected: boolean; connectedAt: string }> {
    return this.#serverLink.asReadonly()
  }

  /** Systemmodus des verbundenen Backend-Servers (standalone | connected | cloud) */
  get systemMode(): Signal<string> {
    return this.#systemMode.asReadonly()
  }

  /**
   * Cloud-Pairing-Status, periodisch aus dem Edge-/health gepollt.
   * `null` = noch nicht ermittelt, ansonsten Werte aus `PairingStatus` aus
   * `@panary/cloud-connection/domain` (`disconnected | pairing | connected | error`).
   */
  get cloudPairingStatus(): Signal<string | null> {
    return this.#cloudPairingStatus.asReadonly()
  }

  /** Grund eines Cloud-Token-Fehlers (z.B. `token-expired`, `edge-revoked`). */
  get cloudTokenErrorReason(): Signal<string | null> {
    return this.#cloudTokenErrorReason.asReadonly()
  }

  /**
   * True, sobald die WS-Authentifizierung server-seitig mit 401 abgelehnt wurde
   * (Token abgelaufen/ungültig). Die `AuthService` beobachtet das und löst
   * `logout()` + Login-Redirect aus. Wird beim erfolgreichen (Re-)Auth und beim
   * `socketLogin()` zurückgesetzt.
   */
  get userSessionExpired(): Signal<boolean> {
    return this.#userSessionExpired.asReadonly()
  }

  /**
   * True, wenn die Cloud-Verbindung explizit auf DISCONNECTED steht (Re-Pairing erforderlich).
   *
   * Tier-Modell: Re-Pair-Warnung nur sinnvoll, wenn das Edge-Backend bewusst mit
   * der Cloud verbunden ist (Tier 3, `systemMode='connected'`). Im Cloud-Direkt-
   * Modus (Tier 1, `systemMode='cloud'`) und Standalone-Edge (Tier 2,
   * `systemMode='standalone'`) gibt es kein Pairing zwischen Edge und Cloud → keine
   * Warnung.
   */
  readonly cloudNeedsRePairing = computed(() => {
    if (this.#systemMode() !== 'connected') return false
    return this.#cloudPairingStatus() === 'disconnected'
  })

  /**
   * Aktuelles Tier-Modell des verbundenen Backends.
   * - `cloud-direct`: POS-Client direkt mit `api-cloud` (Tier 1, akzeptiertes Offline-Risiko).
   * - `standalone`: Lokaler Edge ohne Cloud-Pairing (Tier 2).
   * - `edge-with-cloud`: Lokaler Edge mit Cloud-Sync (Tier 3).
   * - `unknown`: /health noch nicht erreicht.
   */
  readonly tier = computed<'cloud-direct' | 'standalone' | 'edge-with-cloud' | 'unknown'>(() => {
    switch (this.#systemMode()) {
      case 'cloud':
        return 'cloud-direct'
      case 'standalone':
        return 'standalone'
      case 'connected':
        return 'edge-with-cloud'
      default:
        return 'unknown'
    }
  })

  /**
   * Sollen Cloud-Sync-Badges (Sync-Alter, Token-Restlaufzeit) angezeigt werden?
   * Nur in Tier 3 (Edge + Cloud-Sync) — Tier 1 hat nichts zu syncen, Tier 2 ist
   * bewusst offline-only.
   */
  readonly showsCloudSyncStatus = computed(() => this.#systemMode() === 'connected')

  // Schwellwerte fuer das Cloud-Status-Badge — bewusst hier zentral, damit
  // beide Apps (POS + Admin) konsistent rendern. Werte koennen spaeter ueber
  // Tenant-Settings ueberschrieben werden (siehe Plan-Doku §Schwellwerte).
  static readonly SYNC_WARN_SEC = 5 * 60 // 5 min
  static readonly SYNC_CRIT_SEC = 30 * 60 // 30 min
  // Token-Warn auf 4 h gesenkt — 24 h war zu aggressiv (Pille blieb den
  // ganzen Tag sichtbar). 4 h gibt genug Vorlauf zum Re-Pairing, ohne
  // Operator-Noise im Normalbetrieb.
  static readonly TOKEN_WARN_SEC = 4 * 3600 // 4 h
  static readonly TOKEN_CRIT_SEC = 3600 // 1 h

  /**
   * Alter des letzten erfolgreichen Cloud-Syncs.
   *
   * `level`-Mapping:
   *   - `ok`   : Sync < SYNC_WARN_SEC alt
   *   - `warn` : SYNC_WARN_SEC ≤ Sync-Alter < SYNC_CRIT_SEC
   *   - `crit` : Sync-Alter ≥ SYNC_CRIT_SEC oder `lastSyncAt` null
   *
   * Re-Computed alle 60s ueber `#tick`, plus bei jedem /health-Poll.
   */
  readonly syncStaleness = computed<{ ageSec: number | null; level: 'ok' | 'warn' | 'crit' }>(() => {
    this.#tick()
    const ts = this.#lastSyncAt()
    if (!ts) return { ageSec: null, level: 'crit' }
    const ageSec = Math.floor((Date.now() - Date.parse(ts)) / 1000)
    const level =
      ageSec >= ConnectionService.SYNC_CRIT_SEC
        ? 'crit'
        : ageSec >= ConnectionService.SYNC_WARN_SEC
          ? 'warn'
          : 'ok'
    return { ageSec, level }
  })

  /**
   * Restlaufzeit des Edge-Tokens.
   *
   * `level`-Mapping:
   *   - `ok`   : > TOKEN_WARN_SEC oder kein Datum bekannt (kein Pairing)
   *   - `warn` : TOKEN_CRIT_SEC < Rest ≤ TOKEN_WARN_SEC
   *   - `crit` : Rest ≤ TOKEN_CRIT_SEC oder bereits abgelaufen
   */
  readonly tokenExpiry = computed<{ remainingSec: number | null; level: 'ok' | 'warn' | 'crit' }>(() => {
    this.#tick()
    const ts = this.#edgeTokenExpiresAt()
    if (!ts) return { remainingSec: null, level: 'ok' }
    const remainingSec = Math.floor((Date.parse(ts) - Date.now()) / 1000)
    const level =
      remainingSec <= ConnectionService.TOKEN_CRIT_SEC
        ? 'crit'
        : remainingSec <= ConnectionService.TOKEN_WARN_SEC
          ? 'warn'
          : 'ok'
    return { remainingSec, level }
  })

  get smartcardService(): Service {
    return this.#app.service('smartcards')
  }

  get userService(): Service {
    return this.#app.service('users')
  }

  // Alias for compatibility
  get usersService(): Service {
    return this.userService
  }

  get workingTimeService(): Service {
    return this.#app.service('working-times')
  }

  get orderInteractionService(): Service {
    return this.#app.service('order-interactions')
  }

  get userPreferencesService(): Service {
    return this.#app.service('user-preferences')
  }

  // Missing properties from PosConnectionService
  get devicesService(): Service {
    return this.#app.service('devices')
  }

  get modifierService(): Service {
    return this.#app.service('modifiers')
  }

  get supplierProductService(): Service {
    return this.#app.service('supplier-products')
  }

  get writeOffService(): Service {
    return this.#app.service('write-offs')
  }

  get preOrdersService(): Service {
    return this.#app.service('pre-orders')
  }

  get openingHourExceptionsService(): Service {
    return this.#app.service('opening-hour-exceptions')
  }

  get leaveRequestService(): Service {
    return this.#app.service('leave-requests')
  }

  //#endregion

  //#region Constructor
  constructor() {
    this.#app = feathers<ServiceTypes>()

    // Determine config source (Device or AppConfig)
    const deviceConfig = this.deviceConfigService.getConfig()

    // Create socket with appropriate config
    this.#socket = this.createSocket(deviceConfig)

    const socketClient = socketio(this.#socket)

    this.#app.configure(socketClient)
    this.#app.use('users', socketClient.service('users'), {
      methods: [
        'find',
        'get',
        'create',
        'update',
        'patch',
        'remove',
        'checkin',
        'checkout',
        'startBreak',
        'endBreak',
        'verifyPin',
        'mustChangePassword',
      ],
    })
    this.#app.use('locations', socketClient.service('locations'), {
      methods: ['find', 'get', 'create', 'update', 'patch', 'remove', 'openBusinessDay', 'performDailyClosing'],
    })
    this.#app.use('orders', socketClient.service('orders'), {
      methods: ['find', 'get', 'create', 'update', 'patch', 'remove', 'multiPatchStatus'],
    })
    this.#app.use('businessdays', socketClient.service('businessdays'), {
      methods: ['find', 'get', 'create', 'update', 'patch', 'remove', 'open', 'close'],
    })
    this.#app.use('leave-requests', socketClient.service('leave-requests'), {
      methods: ['find', 'get', 'create', 'update', 'patch', 'remove'],
    })
    this.#app.use('pre-orders', socketClient.service('pre-orders'), {
      methods: ['find', 'get', 'create', 'update', 'patch', 'remove', 'convert'],
    })
    this.#app.use('opening-hour-exceptions', socketClient.service('opening-hour-exceptions'), {
      methods: ['find', 'get', 'create', 'update', 'patch', 'remove'],
    })

    // Explicitly connect if not auto-connected (Device Auth case)
    if (deviceConfig?.deviceId && !this.#socket.connected) {
      this.#socket.connect()
    }
  }

  //#endregion

  //#region Public Methods
  connect(_serverUrl?: string): void {
    this.socketConnect()
  }

  socketConnect(): void {
    this.#connectionError.set(null)
    this.#app.io?.connect()
  }

  socketDisconnect(): void {
    try {
      if (this.#app.io?.connected) {
        // Fixed: isConnected is not a prop on app
        this.#app.io?.disconnect()
      }
    } catch (error) {
      console.error('Error disconnecting socket:', error)
    }
  }

  public socketLogin() {
    // Only used for User Auth (JWT)
    // Frischer Login-Versuch → stale „Session abgelaufen"-Flag zurücksetzen,
    // damit der AuthService-Wächter nicht direkt nach dem Re-Login erneut feuert.
    this.#userSessionExpired.set(false)
    if (this.#app.io.connecting) {
      console.warn('socketLogin(): Verbindung läuft bereits, warte auf "connect"...')
      this.#app.io.once('connect', () => {
        this.authenticateSocket()
      })
      return
    }

    if (!this.#app.io.connected) {
      this.#app.io.once('connect', () => {
        this.authenticateSocket()
      })
      this.#app.io.connect()
    } else {
      this.authenticateSocket()
    }
  }

  public socketLogout() {
    // In Device Mode (POS), we want to keep the connection open!
    // AuthService might call this when no User is logged in, but Device Auth must persist.
    if (this.deviceConfigService.getConfig()?.deviceId) {
      console.log('socketLogout called, but ignored in Device Mode (keeping usage valid).')
      return
    }

    try {
      if (this.#app.io?.connected) {
        this.#app.io.disconnect()
        console.log('Socket disconnect initiated (logout).')
      }
    } catch (error) {
      console.error('Error during socket disconnect:', error)
    }

    this.#isAuthenticated.set(false)
    this.#serverLink.set({
      isConnected: false,
      connectedAt: '-',
    })
  }

  //#endregion

  //#region Private Methods
  private authenticateSocket() {
    // Strategy: JWT (User)

    // If we are in Device Mode (POS), we are already "authenticated" via the handshake/device:authenticated event.
    // However, if we need to escalate to User context, we might theoretically send a JWT.
    // But for now, if Device Config exists, we assume Device Auth handles the base connection.
    if (this.deviceConfigService.getConfig()?.deviceId) {
      // We trust the device:authenticated event handled in createSocket
      return
    }

    const token = this.getToken()
    if (!token || typeof token !== 'string' || token.trim().length < 10) {
      console.warn('[WS]: Kein gültiger Token vorhanden – Authentifizierung abgebrochen.')
      return
    }

    if (this.#app.io.connecting) {
      console.debug('[WS]: Socket is reconnecting, delaying authentication...')
      this.#app.io.once('connect', () => {
        this.authenticateSocket()
      })
      return
    }

    console.log('[WS]: starte Authentifizierung...')
    this.#app.io.emit(
      'create',
      'authentication',
      {
        strategy: 'jwt',
        accessToken: token,
      },
      (error: FeathersError, newAuthResult: any): void => {
        if (error) {
          if (error.code === 401) {
            console.warn('[WS]: Token nicht gültig – Session abgelaufen, Re-Login erforderlich.')
            // Signalisiert der AuthService, dass die User-Session server-seitig
            // ungültig ist → sauberer logout()+Login-Redirect statt stiller
            // Reconnect-Schleife. socketLogout() ignoriert Device-Mode.
            this.#userSessionExpired.set(true)
            this.socketLogout()
            return
          }
          console.error('[WS]: Fehler bei Authentifizierung', error)
          return
        }
        console.log('[WS]: User "' + newAuthResult.user.loginname + '" authenticated!')
        this.#userSessionExpired.set(false)
        this.#isAuthenticated.set(true)
      },
    )
  }

  private createSocket(deviceConfig: any) {
    let url = ''
    let options: any = {}

    if (deviceConfig?.deviceId && deviceConfig?.apiKey) {
      // --- POS DEVICE STRATEGY ---
      url = this.getBaseUrl(deviceConfig.serverUrl)
      console.log(`[Connection] Initializing socket (Device Mode) with URL: ${url}`)

      options = {
        path: '/ws',
        transports: ['websocket', 'polling'], // Try WebSocket first, fallback if needed (though usually upgrades from polling) - testing fixing timeout
        timeout: 30000,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        randomizationFactor: 0.5,
        autoConnect: false, // Wait for manual connect in constructor
        forceNew: true,
        auth: {
          apiKey: deviceConfig.apiKey,
          deviceId: deviceConfig.deviceId,
          deviceName: deviceConfig.deviceName || `POS-${deviceConfig.deviceId.substring(0, 8)}`,
        },
      }
    } else {
      // --- DEFAULT / ADMIN STRATEGY ---
      url = Utils.getBaseUrl(this.appConfigService.apiUrl)
      console.log(`[Connection] Initializing socket (Admin/User Mode) with URL: ${url}`)

      options = {
        path: '/ws',
        transports: ['websocket'],
        timeout: 10000,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        randomizationFactor: 0.5,
        autoConnect: true,
      }
    }

    const socket = io(url, options)

    // Common Events
    socket
      .on('connect', () => {
        this.#serverLink.set({
          isConnected: true,
          connectedAt: new Date().toLocaleString(),
        })
        this.#connectionError.set(null)
        console.log(`Socket "${socket.id}" established connection.`)

        // Systemmodus vom Backend abfragen
        this.fetchSystemMode(url)

        // POS: Wait for device authentication
        if (deviceConfig?.deviceId) {
          console.log(`[POS-WS] Waiting for device:authenticated event...`)
          // Fallback if needed could go here
        } else {
          // Admin/User: Try to re-authenticate if token exists (e.g. after reconnect)
          console.log(`[WS] Connection established. Checking for token to auto-authenticate...`)
          this.authenticateSocket()
        }
      })
      .on('disconnect', (reason: any): void => {
        this.#serverLink.set({
          isConnected: false,
          connectedAt: '-',
        })
        this.#isAuthenticated.set(false)
        console.log(`Socket disconnected. Reason:`, reason)
        // Reset error on disconnect (unless specific error caused it, but usually standard disconnect)
        // this.#connectionError.set(null)
      })
      // POS Device Events
      .on('device:authenticated', (data: any) => {
        console.log(`[POS-WS] Received device:authenticated event:`, data)
        if (data.success) {
          console.log(`[POS-WS] ✓ Device authenticated!`)
          this.#isAuthenticated.set(true)
          this.#connectionError.set(null)
          this.deviceConfigService.updateLastSync()
        } else {
          console.error(`[POS-WS] ✗ Authentication failed:`, data.error)
          this.#isAuthenticated.set(false)
        }
      })
      .on('device:deactivated', () => {
        console.warn(`[POS-WS] Device has been deactivated!`)
        this.socketDisconnect()
        this.deviceConfigService.clearConfig()
        this.#isAuthenticated.set(false)
      })
      // Admin/User Events
      .on('login', (_authResult: any) => {
        console.log('authResult', _authResult)
      })
      .on('logout', (_error: any) => {
        console.log('unauthorized', _error)
      })
      .on('connect_error', (error: Error) => {
        console.error(`[WS] Connection error:`, error)
        this.#connectionError.set(error.message)
      })

    return socket
  }

  private getToken(): string | null {
    try {
      const item = sessionStorage.getItem('authenticationItem')
      if (item) {
        const parsed = JSON.parse(item)
        return parsed.accessToken || null
      }
    } catch (e) {
      return null
    }
    return null
  }

  private async fetchSystemMode(baseUrl: string): Promise<void> {
    this.#lastHealthUrl = baseUrl
    await this.#fetchHealth(baseUrl)
    // Periodisches Polling, damit Cloud-Auto-Disconnect (Sync-Scheduler patcht
    // pairingStatus nach 401) im Frontend sichtbar wird, ohne Permission-Recht
    // auf den `cloud-connection`-Service zu brauchen. 60s ist ein Kompromiss
    // zwischen Reaktivitaet und Last — der Auto-Disconnect entsteht nach
    // einem fehlgeschlagenen Heartbeat (alle 30 min Default), also reicht das.
    if (!this.#healthPoll) {
      this.#healthPoll = setInterval(() => {
        if (this.#lastHealthUrl) void this.#fetchHealth(this.#lastHealthUrl)
      }, 60_000)
    }
    // Separater 60-Sek-Tick fuer das Cloud-Status-Badge — getrennt vom
    // Healthpoll, damit die "Wie alt"-Computeds auch dann frisch bleiben,
    // wenn das Health-Polling z.B. wegen Offline pausiert.
    if (!this.#tickTimer) {
      this.#tickTimer = setInterval(() => this.#tick.update(v => v + 1), 60_000)
    }
  }

  async #fetchHealth(baseUrl: string): Promise<void> {
    try {
      const res = await fetch(`${baseUrl}/health`)
      if (res.ok) {
        const data = await res.json()
        if (data.systemMode) {
          this.#systemMode.set(data.systemMode)
        }
        this.#cloudPairingStatus.set(
          typeof data.cloudPairingStatus === 'string' ? data.cloudPairingStatus : null,
        )
        this.#cloudTokenErrorReason.set(
          typeof data.cloudTokenErrorReason === 'string' ? data.cloudTokenErrorReason : null,
        )
        this.#lastSyncAt.set(typeof data.lastSyncAt === 'string' ? data.lastSyncAt : null)
        this.#edgeTokenExpiresAt.set(
          typeof data.edgeTokenExpiresAt === 'string' ? data.edgeTokenExpiresAt : null,
        )
      }
    } catch {
      // Health-Endpoint nicht erreichbar — Fallback bleibt 'standalone'
    }
  }

  private getBaseUrl(url: string): string {
    try {
      const parsed = new URL(url)
      return `${parsed.protocol}//${parsed.host}`
    } catch {
      return url
    }
  }

  //#endregion
}
