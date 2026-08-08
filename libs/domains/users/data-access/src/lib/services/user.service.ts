import { computed, effect, inject, Injectable, Signal, signal, untracked, WritableSignal } from '@angular/core'
import { User } from '@panary/users/domain'
import { Id, Paginated, Params } from '@feathersjs/feathers'
import { Observer } from 'rxjs'
import { BaseService, ConnectionService, createEnsureLoaded } from '@panary/shared/data-access'
import { AuthService } from '@panary/auth/data-access'
import { Location } from '@panary/locations/data-access'

@Injectable({
  providedIn: 'root',
})
export class UserService extends BaseService<User> {
  protected override entityLabelKey = 'ENTITY.USER'

  /** INJECTION */
  #authService: AuthService = inject(AuthService)
  protected connectionService: ConnectionService = inject(ConnectionService)

  /** PRIVATE PROPERTIES */
  #users: WritableSignal<User[]> = signal([])
  #isLoaded: WritableSignal<boolean> = signal(false)

  /** PUBLIC PROPERTIES */
  readonly isLoaded: Signal<boolean> = this.#isLoaded.asReadonly()

  /** Idempotenter On-Demand-Load — Alternative zum Auto-Load (s. DATA_ACCESS_AUTO_LOAD). */
  readonly ensureLoaded: () => Promise<void> = createEnsureLoaded(this.#isLoaded, () => this.loadDocuments())

  /** GETTER */
  get users(): Signal<User[]> {
    return this.#users.asReadonly()
  }

  // Einmaliges computed-Klassenfeld — als Getter würde jeder Zugriff ein frisches
  // computed() anlegen (Memoisierung wirkungslos, neuer Reactive-Node pro Read).
  readonly currentUser: Signal<User | undefined> = computed(() =>
    this.#users().find((element: User): boolean => element._id === this.#authService.user()?._id),
  )

  /** CONSTRUCTOR */
  constructor() {
    super(inject(ConnectionService).userService, 'userService')

    // Auto-Load nur, wenn die App ihn nicht via DATA_ACCESS_AUTO_LOAD abgeschaltet hat.
    // Bewusst OHNE isLoaded-Bedingung: jeder Auth-Wechsel (Reconnect) lädt die Liste neu.
    if (this.autoLoadEnabled) {
      effect((): void => {
        // Getrackter Read explizit; Lade-Aufruf via untracked() entkoppelt (angular.md §2.1)
        const isAuthenticated = this.connectionService.isAuthenticated()

        if (isAuthenticated) {
          untracked(() => void this.loadDocuments())
        }
      })
    }
  }

  /** PRIVATE METHODS */
  protected override handleItemCreated(document: User) {
    this.#users.update((currentValue: User[]) => [...currentValue, document])
  }

  protected override handleItemUpdated(document: User) {
    let reloadWindow = false
    this.#users.update((currentValue: User[]) => {
      const index: number = currentValue.findIndex((element: User): boolean => element._id === document._id)

      if (index !== -1) {
        if (currentValue[index].activeLocationId !== document.activeLocationId) {
          reloadWindow = true
        }

        currentValue[index] = document

        return [...currentValue]
      }

      return currentValue
    })

    if (reloadWindow) {
      window.location.reload()
    }
  }

  protected override handleItemRemoved(document: User) {
    this.#users.update((currentValue: User[]) => {
      const index: number = currentValue.findIndex((element: User): boolean => element._id === document._id)

      if (index !== -1) {
        currentValue.splice(index, 1)
        return [...currentValue]
      }
      return currentValue
    })
  }

  protected override async loadDocuments(): Promise<void> {
    try {
      const response: Paginated<User> | User[] = await this.find({})
      this.#users.set(Array.isArray(response) ? response : response.data)
      this.#isLoaded.set(true)
    } catch (error) {
      // find() re-throwt nach handleError — hier fangen, damit der Auto-Load-Effect
      // keine unhandled rejection produziert; isLoaded bleibt false → ensureLoaded kann retryen
      console.error('Fehler beim Laden der Benutzer:', error)
    }
  }

  protected override fileReaderOnLoad(
    _fileReader: FileReader,
    _observer: Observer<unknown>,
    _context: {
      errorMessages: string[]
      warnMessages: string[]
      successCount: number
      multi: boolean
    },
  ) {
    /* empty */
  }

  /** PUBLIC METHODS */
  async checkin(userId: Id, params: Params = {}): Promise<User> {
    return this.service
      .checkin(userId, params)
      .catch((error: unknown) => this.helper.handleError(this.serviceName, error))
  }

  async checkout(userId: Id, params: Params = {}): Promise<User> {
    return this.service
      .checkout(userId, params)
      .catch((error: unknown) => this.helper.handleError(this.serviceName, error))
  }

  async startBreak(userId: Id, params: Params = {}): Promise<User> {
    return this.service
      .startBreak(userId, params)
      .catch((error: unknown) => this.helper.handleError(this.serviceName, error))
  }

  async endBreak(userId: Id, params: Params = {}): Promise<User> {
    return this.service
      .endBreak(userId, params)
      .catch((error: unknown) => this.helper.handleError(this.serviceName, error))
  }

  async mustChangePassword(data: { newPassword: string }, params: Params = {}): Promise<User> {
    console.log(data)
    return this.service
      .mustChangePassword(data, params)
      .catch((error: unknown) => this.helper.handleError(this.serviceName, error))
  }

  updateLocalStorageUsers(): void {
    this.find({}).then((response: Paginated<User> | User[]): void => {
      let users: User[]
      if (Array.isArray(response)) {
        users = response
      } else {
        users = response.data
      }
      localStorage.setItem('usernameList', JSON.stringify(users.map((record: User) => record.loginname)))
    })
  }

  isUserStampedIn(userId: string): boolean {
    const user: User | undefined = this.#users().find((record: User): boolean => record._id === userId)

    return !(!user || !user.stampingId)
  }

  stampedInUsers(): Array<User> {
    return this.#users().filter((user: User) => user.stampingId !== undefined && user.stampingId !== null)
  }

  getUserById(id: Id): User | undefined {
    return this.#users().find((record: User): boolean => {
      return record._id === id
    })
  }

  toggleLocation(location: Location) {
    const id: Id | undefined = this.currentUser()?._id

    if (!id) return

    this.patch(id, { activeLocationId: location._id }).then()
  }
}
