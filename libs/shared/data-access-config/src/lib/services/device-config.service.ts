import { Injectable, signal, WritableSignal } from '@angular/core'
import {
  DeviceConfig,
  DeviceRegistrationRequest,
  DeviceRegistrationResponse,
  SetupCredentials,
} from '../models/device-config.model'
import { feathers, Application } from '@feathersjs/feathers'
import socketio from '@feathersjs/socketio-client'
import authentication from '@feathersjs/authentication-client'
import io, { Socket } from 'socket.io-client'

/** Result einer Unpair-Operation. */
export interface UnpairResult {
  backendDeleted: boolean
  backendError?: string
}

export type RegistrationStatus =
  | 'idle'
  | 'connecting'
  | 'authenticating'
  | 'loading-orgs'
  | 'registering'
  | 'success'
  | 'error'

/**
 * Organization/Location für Setup-Auswahl
 */
export interface Organization {
  _id: string
  name: string
}

export interface Location {
  _id: string
  name: string
  tenantId: string
}

// Type-safe Feathers client
type SetupClient = Application & {
  authenticate(credentials: { strategy: string; email: string; password: string }): Promise<unknown>
  logout(): Promise<void>
  service(name: string): {
    find(params?: { query?: Record<string, unknown> }): Promise<{ data: unknown[] } | unknown[]>
    create(data: unknown): Promise<unknown>
  }
}

@Injectable({
  providedIn: 'root',
})
export class DeviceConfigService {
  private readonly STORAGE_KEY = 'panary_device_config'

  // Reactive state for registration progress
  readonly registrationStatus: WritableSignal<RegistrationStatus> = signal('idle')
  readonly registrationError: WritableSignal<string | null> = signal(null)

  // Available organizations and locations after admin login
  readonly organizations: WritableSignal<Organization[]> = signal([])
  readonly locations: WritableSignal<Location[]> = signal([])

  // Feathers client for setup (temporary, JWT-based)
  #setupClient: SetupClient | null = null
  #setupSocket: Socket | null = null

  //#region Config Management
  /**
   * Prüft ob eine vollständige Geräte-Registrierung existiert
   */
  hasConfig(): boolean {
    const config = this.getConfig()
    return config !== null && !!config.deviceId && !!config.apiKey && !!config.serverUrl
  }

  /**
   * Prüft ob das Gerät registriert ist (hat deviceId und apiKey vom Backend)
   */
  isRegistered(): boolean {
    const config = this.getConfig()
    return config !== null && !!config.deviceId && !!config.apiKey
  }

  /**
   * Holt die aktuelle Sprache
   */
  getLanguage(): string {
    const config = this.getConfig()
    return config?.language || 'de'
  }

  /**
   * Aktualisiert die Sprache
   */
  updateLanguage(language: string): void {
    const config = this.getConfig()
    if (config) {
      config.language = language
      this.saveConfig(config)
    } else {
      // Create minimal config with just language
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify({ language }))
    }
  }

  /**
   * Speichert die Konfiguration (inkl. apiKey).
   *
   * Begruendung fuer localStorage-Storage ohne Verschluesselung:
   * - POS-Geraet ist single-tenant, single-user, dedizierter Hardware
   *   (Sunmi D3 Tablet im Tauri-WebView bzw. Admin-Browser im Backoffice).
   * - Kein User-Generated-Content im UI → kein realistisches XSS-Vehikel.
   * - apiKey ist scope-limitiert (Geraete-Rolle, nicht User-Rolle) und
   *   kann via apikeys-Service jederzeit rotiert werden.
   * - Web-Crypto-Verschluesselung mit non-extractable Key wuerde die
   *   Sicherheit nur marginal erhoehen (XSS-Code kann den Key trotzdem
   *   ueber das Crypto-Subject nutzen) bei deutlich hoeherer Komplexitaet.
   *
   * Fuer zukuenftige Haertung (Phase 3 Security): apiKey aus Tauri-
   * Secure-Store (`tauri-plugin-stronghold`) lesen, statt localStorage.
   */
  // lgtm[js/clear-text-storage-of-sensitive-data]
  saveConfig(config: DeviceConfig): void {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(config))
  }

  /**
   * Lädt die Konfiguration
   */
  getConfig(): DeviceConfig | null {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY)
      return stored ? JSON.parse(stored) : null
    } catch {
      return null
    }
  }

  /**
   * Getter für einzelne Config-Werte
   */
  getServerUrl(): string | null {
    return this.getConfig()?.serverUrl || null
  }

  getDeviceId(): string | null {
    return this.getConfig()?.deviceId || null
  }

  getApiKey(): string | null {
    return this.getConfig()?.apiKey || null
  }

  getDeviceName(): string | null {
    return this.getConfig()?.deviceName || null
  }

  getTenantId(): string | null {
    return this.getConfig()?.tenantId || null
  }

  getLocationId(): string | null {
    return this.getConfig()?.locationId || null
  }
  //#endregion

  //#region Setup Flow
  /**
   * Testet die Verbindung zum Server (Health-Check)
   */
  async testConnection(serverUrl: string): Promise<boolean> {
    this.registrationStatus.set('connecting')
    this.registrationError.set(null)

    try {
      const response = await fetch(`${serverUrl}/health`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
      })

      if (response.ok) {
        return true
      }

      throw new Error(`Server responded with status ${response.status}`)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Verbindung zum Server fehlgeschlagen'
      console.error('Connection test failed:', error)
      this.registrationError.set(message)
      this.registrationStatus.set('error')
      return false
    }
  }

  /**
   * Admin-Login für Setup-Prozess
   *
   * Flow:
   * 1. Verbinde via WebSocket
   * 2. Authentifiziere mit local strategy (JWT)
   * 3. Lade Organizations und Locations
   */
  async adminLogin(credentials: SetupCredentials): Promise<boolean> {
    this.registrationStatus.set('connecting')
    this.registrationError.set(null)

    try {
      // 1. Test connection first
      const isConnected = await this.testConnection(credentials.serverUrl)
      if (!isConnected) {
        return false
      }

      this.registrationStatus.set('authenticating')

      // 2. Create WebSocket connection
      this.#setupSocket = io(credentials.serverUrl, {
        path: '/ws',
        transports: ['websocket'],
      })

      // 3. Configure Feathers client with authentication
      const client = feathers()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client.configure(socketio(this.#setupSocket) as any)
      client.configure(authentication())
      this.#setupClient = client as SetupClient

      // 4. Wait for connection
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Connection timeout')), 10000)
        if (this.#setupSocket) {
          this.#setupSocket.on('connect', () => {
            clearTimeout(timeout)
            resolve()
          })
          this.#setupSocket.on('connect_error', err => {
            clearTimeout(timeout)
            reject(err)
          })
        } else {
          reject(new Error('Socket not initialized'))
        }
      })

      // 5. Authenticate with local strategy
      await this.#setupClient.authenticate({
        strategy: 'local',
        email: credentials.email,
        password: credentials.password,
      })

      // 6. Load organizations and locations
      this.registrationStatus.set('loading-orgs')
      await this.loadOrganizationsAndLocations()

      // 7. Reset status to idle (ready for step 2 and 3)
      this.registrationStatus.set('idle')

      return true
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Admin-Login fehlgeschlagen'
      console.error('Admin login failed:', error)
      this.registrationError.set(message)
      this.registrationStatus.set('error')
      this.cleanupSetupClient()
      return false
    }
  }

  /**
   * Lädt Organizations und Locations für die Auswahl
   */
  private async loadOrganizationsAndLocations(): Promise<void> {
    if (!this.#setupClient) {
      throw new Error('Setup client not initialized')
    }

    try {
      // Load organizations
      const orgsResult = await this.#setupClient.service('organizations').find({
        query: { $limit: 100 },
      })
      const orgs = Array.isArray(orgsResult) ? orgsResult : orgsResult.data || []
      this.organizations.set(orgs as Organization[])

      // Load locations
      const locsResult = await this.#setupClient.service('locations').find({
        query: { $limit: 100 },
      })
      const locs = Array.isArray(locsResult) ? locsResult : locsResult.data || []
      this.locations.set(locs as Location[])
    } catch (error) {
      console.error('Failed to load organizations/locations:', error)
      throw new Error('Organisationen/Standorte konnten nicht geladen werden')
    }
  }

  /**
   * Registriert das Gerät beim Backend
   *
   * Voraussetzung: Admin ist bereits eingeloggt (adminLogin wurde aufgerufen)
   *
   * Flow:
   * 1. Sende Registrierungs-Request an /devices
   * 2. Backend generiert deviceId + apiKey
   * 3. Speichere Credentials lokal
   * 4. Cleanup Setup-Client
   */
  async registerDevice(serverUrl: string, request: DeviceRegistrationRequest): Promise<DeviceConfig | null> {
    if (!this.#setupClient) {
      this.registrationError.set('Nicht authentifiziert. Bitte zuerst Admin-Login durchführen.')
      this.registrationStatus.set('error')
      return null
    }

    this.registrationStatus.set('registering')
    this.registrationError.set(null)

    try {
      // 1. Register device via Feathers service
      const registrationResponse = (await this.#setupClient
        .service('devices')
        .create(request)) as DeviceRegistrationResponse

      // 2. Create and save local config
      const config: DeviceConfig = {
        serverUrl: serverUrl,
        deviceId: registrationResponse.deviceId,
        apiKey: registrationResponse.apiKey,
        deviceName: registrationResponse.name,
        deviceType: registrationResponse.type,
        tenantId: registrationResponse.tenantId,
        locationId: registrationResponse.locationId,
        language: this.getLanguage(),
        registeredAt: new Date(),
      }

      this.saveConfig(config)
      this.registrationStatus.set('success')

      // 3. Cleanup setup client
      this.cleanupSetupClient()

      return config
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Geräte-Registrierung fehlgeschlagen'
      console.error('Device registration failed:', error)
      this.registrationError.set(message)
      this.registrationStatus.set('error')
      return null
    }
  }

  /**
   * Cleanup: Disconnect setup client
   */
  private cleanupSetupClient(): void {
    if (this.#setupClient) {
      try {
        this.#setupClient.logout()
      } catch {
        // Ignore logout errors
      }
    }
    if (this.#setupSocket) {
      this.#setupSocket.disconnect()
      this.#setupSocket = null
    }
    this.#setupClient = null
  }
  //#endregion

  //#region Config Management
  /**
   * Löscht die Konfiguration (z.B. für Reset)
   */
  clearConfig(): void {
    localStorage.removeItem(this.STORAGE_KEY)
    this.registrationStatus.set('idle')
    this.registrationError.set(null)
    this.organizations.set([])
    this.locations.set([])
    this.cleanupSetupClient()
  }

  /**
   * Aktualisiert lastSync Timestamp
   */
  updateLastSync(): void {
    const config = this.getConfig()
    if (config) {
      config.lastSync = new Date()
      this.saveConfig(config)
    }
  }

  /**
   * Reset des Status (z.B. für Retry)
   */
  resetStatus(): void {
    this.registrationStatus.set('idle')
    this.registrationError.set(null)
  }
  //#endregion

  //#region Unpair / Factory-Reset
  /**
   * Entkoppelt das Gerät vom Backend und führt einen Hard-Reset durch.
   *
   * Aufgerufen vom Unpair-Dialog nach erfolgreicher PIN-Verifikation eines
   * Users mit Rolle TENANT_OWNER, TENANT_MANAGER oder TENANT_TECHNICIAN.
   *
   * Schritte:
   * 1. Backend-DELETE versuchen (best-effort, fehlerresilient — bei 403/offline
   *    wird trotzdem lokal entkoppelt, sonst hängt das Gerät bei abgelaufenem
   *    Token / Server-Migration fest).
   * 2. Socket trennen (verhindert Reconnect-Loop nach Reset).
   * 3. Alle POS-bezogenen localStorage-Keys löschen.
   * 4. sessionStorage komplett leeren.
   * 5. Alle IndexedDB-Datenbanken löschen (Caches, Feathers-Sync-Daten).
   *
   * Der Caller sollte nach erfolgreichem Return `window.location.reload()` aufrufen,
   * damit der setupGuard die App zum Setup-Wizard leitet.
   */
  async unpair(): Promise<UnpairResult> {
    const config = this.getConfig()
    const result: UnpairResult = { backendDeleted: false }

    // 1. Backend-Cleanup (best-effort)
    if (config?.deviceId && config?.serverUrl) {
      try {
        await this.#callBackendDelete(config)
        result.backendDeleted = true
      } catch (err) {
        // Fehler tolerieren — lokaler Reset läuft trotzdem weiter.
        // Verwaister Device-Eintrag muss ggf. im Admin-UI bereinigt werden.
        result.backendError = err instanceof Error ? err.message : String(err)
        console.warn(
          '[unpair] Backend-DELETE fehlgeschlagen, fahre mit lokalem Reset fort:',
          result.backendError,
        )
      }
    }

    // 2. localStorage / sessionStorage clearen
    const keysToRemove = [
      this.STORAGE_KEY, // panary_device_config
      'pos_current_user',
      'panary_users',
      'panary_usernames',
      'panary_company',
      'panary_server_settings',
      'authenticationItem',
    ]
    keysToRemove.forEach(k => localStorage.removeItem(k))
    sessionStorage.clear()

    // 3. IndexedDB löschen (Caches, Feathers-Sync-DBs)
    if ('databases' in indexedDB && typeof indexedDB.databases === 'function') {
      try {
        const dbs = await indexedDB.databases()
        const dbNames: string[] = dbs.map(db => db.name).filter((n): n is string => !!n)
        await Promise.all(
          dbNames.map(
            name =>
              new Promise<void>(resolve => {
                const req = indexedDB.deleteDatabase(name)
                // Bei allen Outcomes resolven — wir blockieren niemals den Reset.
                req.onsuccess = () => resolve()
                req.onerror = () => resolve()
                req.onblocked = () => resolve()
              }),
          ),
        )
      } catch (err) {
        console.warn('[unpair] IndexedDB-Cleanup teilweise fehlgeschlagen:', err)
      }
    }

    // 4. In-Memory-State zurücksetzen (Status-Signale, Setup-Client)
    this.clearConfig()

    return result
  }

  /**
   * Sendet ein DELETE /devices/:deviceId an das Backend.
   *
   * Authentifizierung via Device-API-Key als Bearer-Token. DEVICE_POS hat aktuell
   * keinen `devices: DELETE` in der Permission-Matrix — der Call wird daher mit
   * hoher Wahrscheinlichkeit mit 403 fehlschlagen. Wird trotzdem versucht, damit
   * spätere Backend-Erweiterungen (Custom-Method `devices.unregister` für
   * Self-Delete) ohne weiteren Frontend-Change funktionieren.
   */
  async #callBackendDelete(config: DeviceConfig): Promise<void> {
    const url = `${config.serverUrl.replace(/\/$/, '')}/devices/${config.deviceId}`
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) {
      throw new Error(`Backend antwortete mit ${response.status}`)
    }
  }
  //#endregion
}
