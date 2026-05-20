import { computed, effect, inject, Injectable, Signal, signal, untracked, WritableSignal } from '@angular/core'
import { MatSnackBar } from '@angular/material/snack-bar'
import { Router } from '@angular/router'
import { HttpClient, HttpErrorResponse } from '@angular/common/http'
import { catchError, Observable, throwError } from 'rxjs'
import { AuthenticationItem } from '@panary/auth/domain'
import { User, UserSystemRole } from '@panary/users/domain'
import { httpErrorCodesDE } from '@panary/util-error-handling'
import { NotificationService } from '@panary/shared/ui-notifications'
import { Id } from '@feathersjs/feathers'
import { APP_CONFIG, AppConfigService } from '@panary/shared/data-access-config'
import { ConnectionService } from '@panary/shared/data-access'

type LoginBody = {
  loginname?: string
  password?: string
  strategy: string
  cardId?: Id
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  /** STATIC PROPERTIES */
  static readonly SNACKBAR_DURATION: number = 2000
  static readonly SNACKBAR_ACTION: string = 'OK'
  static readonly DEFAULT_BOOLEAN = false
  static readonly DEFAULT_UNDEFINED: undefined = undefined
  static readonly DEFAULT_FULL_NAME = 'Unknown User'
  static readonly AUTH_ROUTE = '/authentication'

  /** INJECTION */
  #notificationService: NotificationService = inject(NotificationService)
  #matSnackBar: MatSnackBar = inject(MatSnackBar)
  #router: Router = inject(Router)
  #httpClient: HttpClient = inject(HttpClient)
  #appConfigService: AppConfigService = inject(AppConfigService)
  #connectionService: ConnectionService = inject(ConnectionService)

  /** PRIVATE PROPERTIES */
  // Option 1: Direkt Environment Config (Build-Zeit)
  #appConfig = inject(APP_CONFIG)

  // Option 2: Service mit Runtime Config (Server-geladen)
  // #configService = inject(AppConfigService)

  #authenticationItem: WritableSignal<AuthenticationItem | null> = signal(null)
  #lastLoggedInUser: WritableSignal<string | null | undefined> = signal(null)

  /** PUBLIC PROPERTIES */
  user: Signal<User | undefined> = computed(() => this.#authenticationItem()?.user || undefined)
  isAdmin: Signal<boolean> = computed((): boolean => {
    const role: string | undefined = this.user()?.role
    return (
      role === UserSystemRole.PLATFORM_OWNER ||
      role === UserSystemRole.PLATFORM_ADMIN ||
      role === UserSystemRole.TENANT_OWNER ||
      role === UserSystemRole.TENANT_MANAGER ||
      false
    )
  })
  isSuperAdmin: Signal<boolean> = computed((): boolean => this.user()?.role === UserSystemRole.PLATFORM_OWNER)
  isLoggedIn: Signal<boolean> = computed(() => !!this.#authenticationItem())
  fullName: Signal<string> = computed((): string =>
    this.user() ? `${this.user()?.firstName} ${this.user()?.lastName}` : AuthService.DEFAULT_FULL_NAME,
  )
  loginName: Signal<string | undefined> = computed((): string | undefined => this.user()?.loginname || undefined)
  accessToken: Signal<string | undefined> = computed(() => this.#authenticationItem()?.accessToken)
  lastLoggedInUser: Signal<string | null | undefined> = computed(() => this.#lastLoggedInUser())
  mustChangePassword: Signal<boolean> = computed(() => this.user()?.mustChangePassword || false)
  tenantId: Signal<Id | null | undefined> = computed(() => this.user()?.tenantId)

  /** CONSTRUCTOR */
  constructor() {
    // Handle last logged-in user
    this.#lastLoggedInUser.set(localStorage.getItem(this.#appConfig.localStorageLastLoggedInUserKey))

    // Handle authentication item
    const storedAuthenticationItem: string | null = sessionStorage.getItem('authenticationItem')

    if (!storedAuthenticationItem) {
      this.#authenticationItem.set(null)
    } else {
      try {
        this.#authenticationItem.set(JSON.parse(storedAuthenticationItem))
        const exp: number | undefined = this.#authenticationItem()?.authentication.payload.exp

        if (!exp || this.validateExploration(exp)) {
          console.warn(
            '[AuthService] Token expired or invalid during init. Exp:',
            exp,
            'Now:',
            Math.floor(Date.now() / 1000),
          )
          this.logout().then()
        }
      } catch (error) {
        console.error('[AuthService] Error parsing authenticationItem:', error)
        this.#authenticationItem.set(null)
        sessionStorage.removeItem('authenticationItem')
        console.log('Error to login via sessionStorage')
      }
    }
    // React to login state changes to manage socket connection
    effect(() => {
      const loggedIn = this.isLoggedIn()
      queueMicrotask(() => {
        if (loggedIn) {
          setTimeout(() => this.#connectionService.socketLogin(), 100)
        } else {
          setTimeout(() => this.#connectionService.socketLogout(), 100)
        }
      })
    })

    // Session-Ablauf-Wächter: Wenn der WS-Layer den Token server-seitig als
    // ungültig zurückbekommt (401), wird der User sauber ausgeloggt und zum
    // Login geleitet — statt mit leerem Hauptinhalt in einer stillen
    // WS-Reconnect-Schleife hängenzubleiben (siehe ConnectionService).
    // `userSessionExpired()` ist getrackt; logout()/isLoggedIn() laufen via
    // untracked() (Effect-Loop-Schutz, siehe angular.md §2.1).
    effect(() => {
      const expired = this.#connectionService.userSessionExpired()
      if (!expired) return
      untracked(() => {
        if (this.isLoggedIn()) {
          console.warn('[AuthService] WS-Session server-seitig abgelaufen — Logout + Login-Redirect.')
          void this.logout()
        }
      })
    })

    // Periodischer Ablauf-Check: Der JWT-Ablauf wurde bisher nur beim App-Init
    // geprüft. Läuft das Token bei offenem Tab ab (lange Session), blieb der
    // Nutzer mit leerem Hauptinhalt und „Kein gültiger Token"-WS-Schleife
    // zurück, ohne Re-Login-Aufforderung. Alle 30 s prüfen und ggf. ausloggen.
    setInterval(() => {
      if (!this.isLoggedIn()) return
      const exp = this.#authenticationItem()?.authentication.payload.exp
      if (!exp || this.validateExploration(exp)) {
        console.warn('[AuthService] Token während Laufzeit abgelaufen — Logout + Login-Redirect.')
        void this.logout()
      }
    }, 30_000)
  }

  /** PRIVATE METHODS */
  /**
   * Parses an error object to extract a user-friendly error message.
   *
   * @param {HttpErrorResponse | any} error The error object to parse. It can either be a HttpErrorResponse
   *                                        or any other type containing a message and/or code.
   * @return {string} A formatted error message string containing the error phrase and description,
   *                  or a default message in case of an unexpected error.
   */
  private parseError(error: HttpErrorResponse | unknown): string {
    try {
      const err = error as { code?: number; message?: string }
      let statusCode = err.code
      const match = err.message?.match(/: (\d{3})/)
      if (match) {
        statusCode = parseInt(match[1], 10)
      }

      const errorPhrase: string = httpErrorCodesDE.getErrorPhrase(statusCode ?? 0)
      const errorDescription: string = httpErrorCodesDE.getErrorDescription(statusCode ?? 0)
      return `${errorPhrase}\n${errorDescription}`
    } catch {
      return 'Ein unerwarteter Fehler ist aufgetreten.'
    }
  }

  /**
   * Handles HTTP errors by displaying a notification and logging the error details.
   *
   * @param {HttpErrorResponse | any} httpError The HTTP error object or any other error to handle.
   * @return {Observable<never>} An observable that throws an error with the provided error details.
   */
  private handleError(httpError: HttpErrorResponse | unknown): Observable<never> {
    const err = httpError as Record<string, unknown>
    this.#notificationService.show('error', this.parseError(httpError), 5000, err?.['name'] as string)

    this.logErrorDetails(httpError)

    return throwError(() => new Error(String(err?.['message'] ?? httpError)))
  }

  private logErrorDetails(error: HttpErrorResponse | unknown): void {
    const err = error as Record<string, unknown>
    console.error({
      code: err?.['code'],
      message: err?.['message'],
      name: err?.['name'],
      data: err?.['data'],
    })
  }

  private validateExploration(exp: number): boolean {
    return exp <= Math.floor(Date.now() / 1000)
  }

  /**
   * Method to handle user authentication.
   *
   * @param body - The request payload for authentication.
   */
  private authenticate(body: LoginBody): void {
    const url = `${this.#appConfigService.apiUrl || this.#appConfig.basicServerUrl}${AuthService.AUTH_ROUTE}`

    this.#httpClient
      .post<AuthenticationItem>(url, body)
      .pipe(catchError(this.handleError.bind(this)))
      .subscribe((authenticationItem: AuthenticationItem): void => {
        if (!authenticationItem || Object.keys(authenticationItem).length === 0) {
          this.handleEmptyAuthenticationError(url)
          return
        }

        this.handleAuthentication(authenticationItem)
      })
  }

  private handleAuthentication(authenticationItem: AuthenticationItem): void {
    if (authenticationItem.authentication.strategy === 'smartcard') {
      if (this.isLoggedIn() && authenticationItem.user._id === this.#authenticationItem()?.user._id) {
        this.#matSnackBar.open('Sie sind bereits angemeldet', AuthService.SNACKBAR_ACTION, {
          duration: AuthService.SNACKBAR_DURATION,
        })
        return
      }

      this.logout(false).then(result => {
        this.storeAuthentication(authenticationItem)

        const snackBarMessage = `Benutzer ${authenticationItem.user.loginname} erfolgreich angemeldet`
        this.#matSnackBar.open(snackBarMessage, AuthService.SNACKBAR_ACTION, {
          duration: AuthService.SNACKBAR_DURATION,
        })

        this.#router.navigateByUrl('/home').then()
      })
    } else {
      this.storeAuthentication(authenticationItem)

      const snackBarMessage = `Benutzer ${authenticationItem.user.loginname} erfolgreich angemeldet`
      this.#matSnackBar.open(snackBarMessage, AuthService.SNACKBAR_ACTION, { duration: AuthService.SNACKBAR_DURATION })

      this.#router.navigateByUrl('/home').then()
    }
  }

  /**
   * Handles cases where the authentication data returned is invalid or empty.
   *
   * @param url - The authentication URL used in the request.
   */
  private handleEmptyAuthenticationError(url: string): void {
    const error = new HttpErrorResponse({
      error: {
        code: 401,
        message: 'Authentication failed: Empty authentication object received',
        name: 'NotAuthenticated',
        data: null,
      },
      status: 401,
      statusText: 'Unauthorized',
      url,
    })
    this.handleError(error)
  }

  /**
   * Stores authentication details in appropriate locations.
   *
   * @param authenticationItem - The AuthenticationItem object returned by the server.
   */
  private storeAuthentication(authenticationItem: AuthenticationItem): void {
    const loginname = authenticationItem.user.loginname

    this.#authenticationItem.set(authenticationItem)
    this.#lastLoggedInUser.set(loginname)

    sessionStorage.setItem('authenticationItem', JSON.stringify(authenticationItem))
    localStorage.setItem(this.#appConfig.localStorageLastLoggedInUserKey, loginname!)
  }

  /** PUBLIC METHODS */
  login(username: string, password: string): void {
    const loginBody: LoginBody = { loginname: username, password, strategy: 'local' }
    this.authenticate(loginBody)
  }

  loginWithSmartcard(cardId: Id): void {
    const smartCardBody: LoginBody = { strategy: 'smartcard', cardId }
    this.authenticate(smartCardBody)
  }

  logout(redirect = true): Promise<boolean> {
    console.warn('[AuthService] logout() called. Redirect:', redirect, new Error().stack)
    this.#authenticationItem.set(null)
    sessionStorage.clear()

    const snackBarMessage = 'Benutzer erfolgreich abgemeldet'
    this.#matSnackBar.open(snackBarMessage, AuthService.SNACKBAR_ACTION, { duration: AuthService.SNACKBAR_DURATION })

    if (redirect) return this.#router.navigate(['/login'], { replaceUrl: true })
    else return Promise.resolve(true)
  }

  isAuthorized(permission: string | undefined): boolean {
    if (!permission || !this.#authenticationItem()?.user.permissions) return false

    return this.#authenticationItem()?.user.permissions?.includes(permission) || false
  }
}
