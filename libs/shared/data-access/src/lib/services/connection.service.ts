import { computed, inject, Injectable, signal, Signal, WritableSignal } from '@angular/core'

import { feathers, Id, Params, Service } from '@feathersjs/feathers'
import { FeathersError } from '@feathersjs/errors'

import socketio, { SocketService } from '@feathersjs/socketio-client'
import io, { Socket } from 'socket.io-client'
import { Utils } from '@panary/shared/util-helpers'

import { AppConfigService, DeviceConfigService } from '@panary/shared/data-access-config'
import { BusinessDaySchema } from '@panary/businessdays/domain'
import { matchesSocketIdentity, type SocketIdentity } from './socket-identity'

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

/**
 * Pairing-Zustaende, wie sie `/health` als **untypisierter JSON-String**
 * liefert. Bewusst lokal statt via `PairingStatus` aus
 * `@panary/cloud-connection/domain`: der Wert kommt hier nie als
 * Domain-Objekt an, und ein Wert-Import wuerde eine Build-Kante von
 * `shared/data-access` auf eine Domain-Lib ziehen, die diese Lib sonst
 * nirgends braucht. Die Konstanten muessen mit `PairingStatus` in
 * `libs/domains/cloud-connection/domain` uebereinstimmen.
 */
const PAIRING_CONNECTED = 'connected'
const PAIRING_DISCONNECTED = 'disconnected'

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
  // Sync-Erwartung aus /health: der eingestellte Modus und der Zeitpunkt, zu
  // dem der Edge den naechsten automatischen Abgleich fahren will. `null` =
  // keine Erwartung (Modus `manual`/`disabled`) → dann gibt es kein
  // „veraltet", weil es nichts gibt, wogegen etwas veralten koennte.
  readonly #syncMode: WritableSignal<string | null> = signal(null)
  readonly #nextExpectedSyncAt: WritableSignal<string | null> = signal(null)
  readonly #edgeTokenExpiresAt: WritableSignal<string | null> = signal(null)
  // Cloud-Erreichbarkeit + Offline-Override (aus /health, RBAC-frei) — speisen
  // den priorisierten Cloud-Status-Banner (cloudUnreachable / offlineModeActive).
  readonly #lastCloudContactAt: WritableSignal<string | null> = signal(null)
  readonly #offlineOverrideActiveUntil: WritableSignal<string | null> = signal(null)
  // Notfall-Modus (ADR 0001, aus /health): erlaubt lokale Drucker-Patches trotz
  // Cloud-Pairing. Speist den Notfall-Banner UND die Seiten-Sperren im Admin.
  readonly #emergencyOverride: WritableSignal<boolean> = signal(false)
  readonly #emergencyOverrideSince: WritableSignal<string | null> = signal(null)
  // `false`, bis der erste /health-Roundtrip durch ist. Konsumenten wie der
  // CloudManagedService duerfen eine Sperre erst behaupten, wenn der Zustand
  // wirklich bekannt ist — sonst flackert bei jedem Seitenaufruf ein
  // "cloud-verwaltet"-Banner auf, das gleich wieder verschwindet.
  readonly #healthLoaded: WritableSignal<boolean> = signal(false)
  readonly #tick: WritableSignal<number> = signal(0)
  #tickTimer: ReturnType<typeof setInterval> | null = null

  // Compatibility for POS
  readonly #connectionError: WritableSignal<string | null> = signal(null)

  // Der Server hat die Geraete-Authentifizierung aktiv ABGELEHNT (deaktiviertes
  // oder revoziertes Geraet) — im Unterschied zu `#connectionError`, das reine
  // Transportfehler traegt. Bewusst getrennt: eine Ablehnung ist terminal
  // (Warten hilft nicht), waehrend socket.io bei Transportfehlern selbsttaetig
  // weiter reconnected. Und sie darf NICHT den `client-offline`-Banner
  // ausloesen — der Client ist ja verbunden, nur nicht autorisiert.
  readonly #deviceAuthRejection: WritableSignal<string | null> = signal(null)

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
  // Mit welcher Identitaet wurde `#socket` gebaut? Nicht aus
  // `connectionState().deviceId` ableitbar — das ist der LIVE-Wert der Config,
  // waehrend hier der eingefrorene Wert des Sockets stehen muss.
  #socketIdentity: SocketIdentity = { deviceId: null, baseUrl: '' }

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

  /**
   * Edge-Proxy auf den Cloud-Rabattcode-Endpunkt (ADR 0032). Am Edge gibt es
   * KEINE Code-Tabelle — `discountCodesService` ist deshalb nur cloud-seitig
   * bedienbar, der POS geht ausschliesslich hierueber.
   */
  get discountCodeRedeemService(): Service {
    return this.#app.service('discount-code-redeem')
  }

  get productService(): Service {
    return this.#app.service('products')
  }

  get businessDayService(): Service {
    return this.#app.service('businessdays')
  }

  get cashSessionService(): Service {
    return this.#app.service('cash-sessions')
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
    return this.#cloudPairingStatus() === PAIRING_DISCONNECTED
  })

  /**
   * True, wenn der Edge mit der Cloud gepairt ist. Single Source of Truth fuer
   * „die Cloud verwaltet diese Daten" — sowohl fuer den Status-Banner als auch
   * fuer die Read-only-Sperren im Admin-Client (siehe CloudManagedService).
   */
  readonly cloudPaired = computed(() => this.#cloudPairingStatus() === PAIRING_CONNECTED)

  /** Notfall-Modus aktiv: lokale Drucker-Patches werden trotz Pairing akzeptiert (ADR 0001). */
  readonly emergencyOverrideActive = computed(() => this.#emergencyOverride())

  /** Minuten seit Aktivierung des Notfall-Modus (null, wenn inaktiv/unbekannt). */
  readonly emergencyOverrideSinceMin = computed(() => {
    this.#tick()
    const ts = this.#emergencyOverrideSince()
    if (!ts) return null
    const ageMs = Date.now() - Date.parse(ts)
    if (!Number.isFinite(ageMs) || ageMs < 0) return null
    return Math.floor(ageMs / 60_000)
  })

  /**
   * True, sobald mindestens ein /health-Roundtrip erfolgreich war. Konsumenten
   * duerfen vorher keine Sperre behaupten — der Zustand ist schlicht unbekannt.
   */
  readonly healthLoaded = computed(() => this.#healthLoaded())

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
  //
  // Gemessen wird die UEBERFAELLIGKEIT gegenueber `nextExpectedSyncAt`, nicht
  // mehr das absolute Alter von `lastSyncAt`. Der Unterschied ist der ganze
  // Punkt: ein Edge im Modus `scheduled` mit Slot 22:00 hat um 14:00 einen
  // 16 Stunden alten Abgleich und ist trotzdem voellig in Ordnung. Nur wer
  // seinen eigenen Termin reissen laesst, ist auffaellig.
  static readonly SYNC_OVERDUE_WARN_SEC = 5 * 60 // 5 min ueberfaellig
  static readonly SYNC_OVERDUE_CRIT_SEC = 30 * 60 // 30 min ueberfaellig
  // Token-Warn auf 4 h gesenkt — 24 h war zu aggressiv (Pille blieb den
  // ganzen Tag sichtbar). 4 h gibt genug Vorlauf zum Re-Pairing, ohne
  // Operator-Noise im Normalbetrieb.
  static readonly TOKEN_WARN_SEC = 4 * 3600 // 4 h
  static readonly TOKEN_CRIT_SEC = 3600 // 1 h
  // Cloud gilt als unerreichbar, wenn der letzte Cloud-Kontakt aelter ist als
  // diese Schwelle. SINGLE SOURCE OF TRUTH fuer Dashboard-Pille, Cloud-Status-
  // Banner und Cloud-Kopplung-Live-Status — alle drei muessen konsistent sein.
  // 5 min: ruhig genug, dass kurze Cloud-Blips/Neustarts keinen Alarm ausloesen.
  static readonly CLOUD_CONTACT_STALE_SEC = 5 * 60 // 5 min

  /** Eingestellter Sync-Modus laut Edge (`auto` | `scheduled` | `manual` | `disabled`). */
  readonly syncMode = computed(() => this.#syncMode())

  /**
   * Zeitpunkt des naechsten vom Edge eingeplanten Abgleichs — `null`, wenn gar
   * keiner eingeplant ist (`manual`/`disabled`). Speist die Zeile „Naechster
   * geplanter Abgleich" im Edge-Admin.
   */
  readonly nextExpectedSyncAt = computed(() => this.#nextExpectedSyncAt())

  /**
   * Zustand des Datenabgleichs mit der Cloud.
   *
   * `ageSec` ist das Alter des letzten Abgleichs (`lastSyncAt`, `null` = noch
   * keiner) — reine Anzeige. `level` beantwortet dagegen die Frage, ob das ein
   * PROBLEM ist, und misst dafuer die Ueberfaelligkeit gegenueber dem Termin,
   * den der Edge sich selbst gesetzt hat (`nextExpectedSyncAt`):
   *
   *   - `ok`   : kein Termin eingeplant (manual/disabled) ODER Termin noch nicht
   *              erreicht ODER weniger als SYNC_OVERDUE_WARN_SEC darueber
   *   - `warn` : SYNC_OVERDUE_WARN_SEC ≤ Ueberfaelligkeit < …CRIT_SEC
   *   - `crit` : Ueberfaelligkeit ≥ SYNC_OVERDUE_CRIT_SEC
   *
   * Die beiden Groessen sind bewusst entkoppelt. Frueher war `level` direkt aus
   * dem Alter abgeleitet, was in jedem Modus ausser `auto` mit Default-Intervall
   * ein Dauer-Fehlalarm war — und was schlimmer wog: `lastSyncAt` wurde damals
   * vom blossen Heartbeat fortgeschrieben, das Badge behauptete also einen
   * Abgleich, den es nie gab. Beides ist jetzt getrennt (panary-core ADR 0017).
   *
   * Re-Computed alle 60s ueber `#tick`, plus bei jedem /health-Poll.
   */
  readonly syncStaleness = computed<{ ageSec: number | null; level: 'ok' | 'warn' | 'crit' }>(() => {
    this.#tick()
    const ts = this.#lastSyncAt()
    const ageSec = ts ? Math.floor((Date.now() - Date.parse(ts)) / 1000) : null

    const expected = this.#nextExpectedSyncAt()
    if (!expected) return { ageSec, level: 'ok' }
    const expectedMs = Date.parse(expected)
    if (!Number.isFinite(expectedMs)) return { ageSec, level: 'ok' }

    const overdueSec = Math.floor((Date.now() - expectedMs) / 1000)
    const level =
      overdueSec >= ConnectionService.SYNC_OVERDUE_CRIT_SEC
        ? 'crit'
        : overdueSec >= ConnectionService.SYNC_OVERDUE_WARN_SEC
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

  /**
   * Offline-Modus aktiv: Operator hat den 2h-Override (`offlineOverrideActiveUntil`)
   * gesetzt, der lokale Geschaeftstag-Rotation trotz Cloud-Ausfall erlaubt.
   * Re-Computed ueber `#tick`, damit der Countdown ohne Poll frisch bleibt.
   */
  readonly offlineModeActive = computed(() => {
    this.#tick()
    const ts = this.#offlineOverrideActiveUntil()
    if (!ts) return false
    const untilMs = Date.parse(ts)
    return Number.isFinite(untilMs) && untilMs > Date.now()
  })

  /** Restminuten des aktiven Offline-Override (0, wenn inaktiv). */
  readonly offlineModeRemainingMin = computed(() => {
    this.#tick()
    const ts = this.#offlineOverrideActiveUntil()
    if (!ts) return 0
    const remainingMs = Date.parse(ts) - Date.now()
    return Math.max(0, Math.floor(remainingMs / 60_000))
  })

  /**
   * Cloud unerreichbar: Edge ist gepairt (Tier 3, pairing connected), aber der
   * letzte Cloud-Kontakt ist aelter als CLOUD_CONTACT_STALE_SEC — und es ist
   * KEIN Offline-Override aktiv (sonst zeigt der Banner den Offline-Modus).
   * Neue Bestellungen werden in diesem Zustand blockiert.
   */
  readonly cloudUnreachable = computed(() => {
    this.#tick()
    if (this.#systemMode() !== 'connected') return false
    if (!this.cloudPaired()) return false
    if (this.offlineModeActive()) return false
    const ts = this.#lastCloudContactAt()
    if (!ts) return false
    const ageSec = Math.floor((Date.now() - Date.parse(ts)) / 1000)
    return Number.isFinite(ageSec) && ageSec > ConnectionService.CLOUD_CONTACT_STALE_SEC
  })

  /**
   * Es ist gar kein Cloud-Kontakt bekannt. Unterschieden von `cloudUnreachable`,
   * das bewusst `false` liefert, solange nie Kontakt bestand — sonst wuerde ein
   * frisch gepairter Edge sofort als „unerreichbar" gemeldet.
   *
   * Fuer den Notfall-Modus ist die Unterscheidung wichtig: „seit dem Pairing nie
   * erreicht" ist genau der Zustand, in dem der Operator die Drucker manuell
   * freischalten koennen muss.
   */
  readonly cloudContactUnknown = computed(() => this.cloudPaired() && this.#lastCloudContactAt() === null)

  /** Minuten seit letztem Cloud-Kontakt (null, wenn unbekannt). */
  readonly lastCloudContactAgeMin = computed(() => {
    this.#tick()
    const ts = this.#lastCloudContactAt()
    if (!ts) return null
    const ageMs = Date.now() - Date.parse(ts)
    if (!Number.isFinite(ageMs) || ageMs < 0) return null
    return Math.floor(ageMs / 60_000)
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
        'changePin',
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
    // cash-sessions inkl. Custom-Method openAuthorized (manager-autorisierte
    // Kassen-Eröffnung am POS) — ohne explizite Registrierung wäre die
    // Custom-Method clientseitig unsichtbar.
    this.#app.use('cash-sessions', socketClient.service('cash-sessions'), {
      methods: ['find', 'get', 'create', 'update', 'patch', 'remove', 'openAuthorized'],
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
    // #deviceAuthRejection wird hier bewusst NICHT zurueckgesetzt: der Socket
    // verbindet bereits im Konstruktor, die Ablehnung trifft also regelmaessig
    // ein, bevor der Login-Screen ueberhaupt steht. Ein Reset an dieser Stelle
    // wuerde sie verwerfen — und weil ein bereits verbundener Socket keinen
    // zweiten Handshake macht, kaeme nie ein neues `device:authenticated`.
    // Zurueckgesetzt wird ausschliesslich beim `connect`-Event, wo tatsaechlich
    // ein frischer Handshake laeuft.
    this.#app.io?.connect()
  }

  /**
   * Der Server hat die Geraete-Authentifizierung abgelehnt (Grund als String),
   * sonst `null`. Terminal — im Gegensatz zu einem Transportfehler bringt
   * Weiterwarten hier nichts.
   */
  get deviceAuthRejection(): Signal<string | null> {
    return this.#deviceAuthRejection.asReadonly()
  }

  /**
   * Passt der laufende Socket noch zur uebergebenen DeviceConfig?
   *
   * Der Socket wird genau einmal im Konstruktor gebaut — und der laeuft im
   * `provideAppInitializer`, also vor jeder Route. Wird die Config danach
   * geaendert (Pairing, Serverwechsel, Entkopplung), traegt der Socket
   * unveraenderlich die alte URL und den alten `auth`-Payload. Konsumenten
   * erzwingen dann einen App-Neustart, statt aussichtslos zu reconnecten.
   */
  isConfiguredFor(config: { deviceId?: string | null; serverUrl?: string | null } | null): boolean {
    return matchesSocketIdentity(this.#socketIdentity, config)
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
        // WebSocket zuerst, Polling als Rueckfallweg — analog zum Device-Zweig.
        // Ohne `polling` gibt es keinen Ausweg, sobald ein Reverse-Proxy den
        // Upgrade-Header nicht weiterreicht: der Client bleibt dann dauerhaft in
        // der Reconnect-Schleife statt auf HTTP-Long-Polling zurueckzufallen.
        transports: ['websocket', 'polling'],
        timeout: 10000,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        randomizationFactor: 0.5,
        autoConnect: true,
      }
    }

    // Health-URL sofort merken, nicht erst im `connect`-Handler: `refreshHealth()`
    // war sonst ein stiller No-op, solange die Socket-Verbindung nicht stand —
    // und genau dann brauchen die Seiten den Zustand, weil `healthLoaded` noch
    // false ist und alle Formulare entsperrt rendern.
    this.#lastHealthUrl = url
    this.#socketIdentity = { deviceId: deviceConfig?.deviceId ?? null, baseUrl: url }

    const socket = io(url, options)

    // Common Events
    socket
      .on('connect', () => {
        this.#serverLink.set({
          isConnected: true,
          connectedAt: new Date().toLocaleString(),
        })
        this.#connectionError.set(null)
        // Frischer Handshake laeuft — ein alter Ablehnungsgrund ist damit
        // ueberholt und wird gleich durch ein neues `device:authenticated`
        // ersetzt (Erfolg oder erneute Ablehnung).
        this.#deviceAuthRejection.set(null)
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
          this.#deviceAuthRejection.set(null)
          this.deviceConfigService.updateLastSync()
        } else {
          console.error(`[POS-WS] ✗ Authentication failed:`, data.error)
          this.#isAuthenticated.set(false)
          // Ohne gesetzten Zustand liefe der Login-Screen in denselben
          // 15-Sekunden-Timeout wie bei "Server nicht erreichbar" — der Bediener
          // saehe "Verbindungsfehler", obwohl das Geraet serverseitig abgelehnt
          // wurde. Zwei grundverschiedene Ursachen, eine Meldung.
          this.#deviceAuthRejection.set(typeof data.error === 'string' && data.error ? data.error : 'DEVICE_REJECTED')
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
        this.#cloudPairingStatus.set(typeof data.cloudPairingStatus === 'string' ? data.cloudPairingStatus : null)
        this.#cloudTokenErrorReason.set(
          typeof data.cloudTokenErrorReason === 'string' ? data.cloudTokenErrorReason : null,
        )
        this.#lastSyncAt.set(typeof data.lastSyncAt === 'string' ? data.lastSyncAt : null)
        this.#syncMode.set(typeof data.syncMode === 'string' ? data.syncMode : null)
        this.#nextExpectedSyncAt.set(typeof data.nextExpectedSyncAt === 'string' ? data.nextExpectedSyncAt : null)
        this.#edgeTokenExpiresAt.set(typeof data.edgeTokenExpiresAt === 'string' ? data.edgeTokenExpiresAt : null)
        this.#lastCloudContactAt.set(typeof data.lastCloudContactAt === 'string' ? data.lastCloudContactAt : null)
        this.#offlineOverrideActiveUntil.set(
          typeof data.offlineOverrideActiveUntil === 'string' ? data.offlineOverrideActiveUntil : null,
        )
        this.#emergencyOverride.set(data.emergencyOverride === true)
        this.#emergencyOverrideSince.set(
          typeof data.emergencyOverrideSince === 'string' ? data.emergencyOverrideSince : null,
        )
        this.#healthLoaded.set(true)
      }
    } catch {
      // Health-Endpoint nicht erreichbar — Fallback bleibt 'standalone'
    }
  }

  /**
   * Erzwingt einen sofortigen /health-Roundtrip, statt bis zu 60 s auf den
   * naechsten Poll zu warten. Noetig nach Zustandswechseln, die der User
   * gerade selbst ausgeloest hat (Notfall-Modus schalten) oder nach einem
   * 403 CLOUD_MANAGED — dann war der lokale Zustand nachweislich veraltet.
   */
  async refreshHealth(): Promise<void> {
    if (this.#lastHealthUrl) await this.#fetchHealth(this.#lastHealthUrl)
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
