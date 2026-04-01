import { computed, effect, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core'
import { User } from '../models/user.model'
import { Id, Paginated, Params } from '@feathersjs/feathers'
import { Observer } from 'rxjs'
import { BaseService, ConnectionService } from '@panary-core/shared/data-access'
import { AuthService } from '@panary-core/auth/data-access'
import { Location } from '@panary-core/locations/data-access'

@Injectable({
  providedIn: 'root',
})
export class UserService extends BaseService<User> {
  protected override entityLabelKey = 'ENTITY.USER'

  /** INJECTION */
  #authService: AuthService=inject(AuthService)
  protected connectionService: ConnectionService=inject(ConnectionService)

  /** PRIVATE PROPERTIES */
  #users: WritableSignal<User[]>=signal([])

  /** PUBLIC PROPERTIES */

  /** GETTER */
  get users(): Signal<User[]> {
    return this.#users.asReadonly()
  }

  get currentUser(): Signal<User|undefined> {
    return computed(() => this.#users().find((element: User): boolean => element._id===this.#authService.user()?._id))
  }

  /** CONSTRUCTOR */
  constructor() {
    super(inject(ConnectionService).userService, 'userService')

    effect((): void => {
      if (this.connectionService.isAuthenticated()) {
        this.loadDocuments()
      }
    })
  }

  /** PRIVATE METHODS */
  protected override handleItemCreated(document: User) {
    this.#users.update((currentValue: User[]) => [...currentValue, document])
  }

  protected override handleItemUpdated(document: User) {
    let reloadWindow=false
    this.#users.update((currentValue: User[]) => {
      const index: number=currentValue.findIndex((element: User): boolean => element._id===document._id)

      if (index!==-1) {
        if (currentValue[index].activeLocationId!==document.activeLocationId) {
          reloadWindow=true
        }

        currentValue[index]=document

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
      const index: number=currentValue.findIndex((element: User): boolean => element._id===document._id)

      if (index!==-1) {
        currentValue.splice(index, 1)
        return [...currentValue]
      }
      return currentValue
    })
  }

  protected override loadDocuments() {
    this.find({}).then((response: Paginated<User>|User[]): void => {
      if (Array.isArray(response)) {
        this.#users.set(response)
      } else {
        this.#users.set(response.data)
      }
    })
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
  async checkin(userId: Id, params: Params={}): Promise<User> {
    return this.service.checkin(userId, params).catch((error: unknown) => this.helper.handleError(this.serviceName, error))
  }

  async checkout(userId: Id, params: Params={}): Promise<User> {
    return this.service.checkout(userId, params).catch((error: unknown) => this.helper.handleError(this.serviceName, error))
  }

  async startBreak(userId: Id, params: Params={}): Promise<User> {
    return this.service
      .startBreak(userId, params)
      .catch((error: unknown) => this.helper.handleError(this.serviceName, error))
  }

  async endBreak(userId: Id, params: Params={}): Promise<User> {
    return this.service.endBreak(userId, params).catch((error: unknown) => this.helper.handleError(this.serviceName, error))
  }

  async mustChangePassword(data: { newPassword: string }, params: Params={}): Promise<User> {
    console.log(data)
    return this.service
      .mustChangePassword(data, params)
      .catch((error: unknown) => this.helper.handleError(this.serviceName, error))
  }

  updateLocalStorageUsers(): void {
    this.find({}).then((response: Paginated<User>|User[]): void => {
      let users: User[]
      if (Array.isArray(response)) {
        users=response
      } else {
        users=response.data
      }
      localStorage.setItem('usernameList', JSON.stringify(users.map((record: User) => record.loginname)))
    })
  }

  isUserStampedIn(userId: string): boolean {
    const user: User|undefined=this.#users().find((record: User): boolean => record._id===userId)

    return !(!user||!user.stampingId)
  }

  stampedInUsers(): Array<User> {
    return this.#users().filter((user: User) => user.stampingId!==undefined&&user.stampingId!==null)
  }

  getUserById(id: Id): User|undefined {
    return this.#users().find((record: User): boolean => {
      return record._id===id
    })
  }

  toggleLocation(location: Location) {
    const id: Id|undefined=this.currentUser()?._id

    if (!id) return

    this.patch(id, { activeLocationId: location._id }).then()
  }
}
