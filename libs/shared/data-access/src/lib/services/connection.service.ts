import { computed, inject, Injectable, signal, Signal, WritableSignal } from '@angular/core'

import { feathers, Id, Params, Service } from '@feathersjs/feathers'
import { FeathersError } from '@feathersjs/errors'

import socketio, { SocketService } from '@feathersjs/socketio-client'
import io, { Socket } from 'socket.io-client'
import { Utils } from '@panary-core/shared/util-helpers'

import { AppConfigService, DeviceConfigService } from '@panary-core/shared/data-access-config'
import { BusinessDaySchema } from '@panary-core/businessdays/domain'

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
            console.warn('[WS]: Token nicht gültig – Logout wird ausgeführt.')
            this.socketLogout()
            return
          }
          console.error('[WS]: Fehler bei Authentifizierung', error)
          return
        }
        console.log('[WS]: User "' + newAuthResult.user.loginname + '" authenticated!')
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
    try {
      const res = await fetch(`${baseUrl}/health`)
      if (res.ok) {
        const data = await res.json()
        if (data.systemMode) {
          this.#systemMode.set(data.systemMode)
        }
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
