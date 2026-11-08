import { computed, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core'
import { Router } from '@angular/router'
import { AuthenticationItem } from '@panary/auth/domain'
import { User, UserSystemRole } from '@panary/users/domain'
import { NotificationService } from '@panary/shared/ui-notifications'
import { Id } from '@feathersjs/feathers'
import { APP_CONFIG } from '@panary/shared/data-access-config'
import { clearPosOperatorToken, errorName } from '@panary/shared/data-access'

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  /** STATIC PROPERTIES */
  static readonly DEFAULT_BOOLEAN = false
  static readonly DEFAULT_UNDEFINED: undefined = undefined
  static readonly DEFAULT_FULL_NAME = 'Unknown User'

  /** INJECTION */
  #notificationService: NotificationService = inject(NotificationService)
  #router: Router = inject(Router)

  /** PRIVATE PROPERTIES */
  #appConfig = inject(APP_CONFIG)

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
        // Die SyntaxError-Meldung zitiert ein Stück der Eingabe, hier des gespeicherten Tokens.
        console.error('[AuthService] authenticationItem in sessionStorage nicht lesbar:', errorName(error))
        this.#authenticationItem.set(null)
        sessionStorage.removeItem('authenticationItem')
        console.log('Error to login via sessionStorage')
      }
    }
  }

  /** PRIVATE METHODS */
  private validateExploration(exp: number): boolean {
    return exp <= Math.floor(Date.now() / 1000)
  }

  /** PUBLIC METHODS */
  logout(redirect = true): Promise<boolean> {
    console.info('[AuthService] logout() Redirect:', redirect)
    this.#authenticationItem.set(null)
    sessionStorage.clear()
    // Der POS fuehrt eine zweite Sitzungsebene: das Geraet haengt am
    // sessionStorage-JWT, der MITARBEITER an `pos_current_user` im
    // localStorage — und `posAuthGuard` entscheidet ausschliesslich daran.
    // Blieb der Eintrag hier liegen, kam der Nutzer nach einem Logout zwar
    // auf /login, konnte aber jede geschuetzte Route weiter aufrufen.
    // Im Admin-Client existiert der Schluessel nicht — dort ist die Zeile ein No-Op.
    localStorage.removeItem('pos_current_user')
    // Das Bediener-Token gehoert zu derselben Sitzungsebene (#619).
    clearPosOperatorToken()

    const snackBarMessage = 'Benutzer erfolgreich abgemeldet'
    this.#notificationService.success(snackBarMessage)

    if (redirect) return this.#router.navigate(['/login'], { replaceUrl: true })
    else return Promise.resolve(true)
  }

  isAuthorized(permission: string | undefined): boolean {
    if (!permission || !this.#authenticationItem()?.user.permissions) return false

    return this.#authenticationItem()?.user.permissions?.includes(permission) || false
  }
}
