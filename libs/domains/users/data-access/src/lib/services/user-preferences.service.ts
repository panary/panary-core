import { effect, inject, Injectable } from '@angular/core'
import { Id, Paginated, Params } from '@feathersjs/feathers'
import { UserPreferenceSchema } from '../models/user-preference.model'
import { BaseService, ConnectionService } from '@panary/shared/data-access-infrastructure'

@Injectable({
  providedIn: 'root',
})
export class UserPreferencesService extends BaseService<UserPreferenceSchema> {
  /** CONSTANTS */
  private readonly STORAGE_KEY_PREFIX = 'app_preference.'
  protected connectionService: ConnectionService = inject(ConnectionService)

  /** PRIVATE PROPERTIES */
  #syncInProgress = false
  #syncQueue: Set<string> = new Set()

  /** GETTER */
  get syncInProgress() {
    return this.#syncInProgress
  }

  get syncQueue() {
    return this.#syncQueue
  }

  get currentUserId(): Id | undefined {
    return this.connectionService.userId
  }

  /** CONSTRUCTOR */
  constructor() {
    super(inject(ConnectionService).userPreferencesService, 'userPreferencesService')

    // Synchronisiere beim Start und bei Wiederherstellung der Netzwerkverbindung
    effect((): void => {
      if (this.connectionService.isAuthenticated()) {
        this.syncWithServer().then()
      }
    })
    window.addEventListener('online', () => this.syncWithServer())
  }

  /** PRIVATE METHODS */
  protected loadDocuments(): void {}

  protected override fileReaderOnLoad() {}

  /** PUBLIC METHODS */
  override async create(
    data:
      | Omit<UserPreferenceSchema, '_id' | 'locationId' | 'tenantId' | 'userId'>
      | Omit<UserPreferenceSchema, '_id' | 'locationId' | 'tenantId' | 'userId'>[],
    params: Params = {},
  ): Promise<UserPreferenceSchema | UserPreferenceSchema[]> {
    return this.service.create(data, params).catch((error: any) => this.helper.handleError(this.serviceName, error))
  }

  async getPreference<T>(key: string, defaultValue: T, syncOnLoad: boolean = false): Promise<T> {
    try {
      // Try to load from the server first if online and synchronization is desired
      if (syncOnLoad && navigator.onLine && this.connectionService.serverLink().isConnected) {
        const serverValue = await this.getFromServer<T>(key)

        if (serverValue !== null) {
          // Update the local memory with the server data
          this.saveToLocalStorage(key, serverValue)

          return serverValue
        }
      }
    } catch (error) {
      console.warn(`Konnte keine Daten vom Server laden für ${key}:`, error)
    }

    // Fallback to local storage
    const localValue = this.getFromLocalStorage<T>(key)

    return localValue !== null ? localValue : defaultValue
  }

  async setPreference<T>(
    key: string,
    value: T,
    options: {
      // For lists: limiting the number of elements
      maxItems?: number
      // For lists: Field for identifying duplicates
      idField?: keyof T
      // For lists: Whether the new element should be added at the beginning
      addToFront?: boolean
    } = {},
  ): Promise<T> {
    // Special handling for lists with idField (for "last used" functionality)
    if (Array.isArray(value) && options.idField && value.length > 0 && value[0][options.idField] !== undefined) {
      return (await this.updateRecentItemsList(key, value[0] as any, options)) as unknown as T
    }

    // Update local storage immediately
    this.saveToLocalStorage(key, value)

    // Attempts to synchronize with the server
    if (navigator.onLine && this.connectionService.serverLink().isConnected) {
      try {
        const serverValue = await this.saveToServer<T>(key, value)

        // Update local storage with the response from the server
        this.saveToLocalStorage(key, serverValue)

        return serverValue
      } catch (error) {
        console.warn(`Konnte nicht mit dem Server synchronisieren für ${key}:`, error)
        // Mark for later synchronization
        this.markForSync(key)
      }
    } else {
      // Mark for later synchronization
      this.markForSync(key)
    }

    return value
  }

  /**
   * Synchronisiert alle ausstehenden Änderungen mit dem Server
   */
  async syncWithServer(): Promise<void> {
    if (this.#syncInProgress || !navigator.onLine || !this.connectionService.serverLink().isConnected) return

    this.#syncInProgress = true

    try {
      const pendingSyncs = this.getPendingSyncs()

      for (const key of pendingSyncs) {
        const localValue = this.getFromLocalStorage(key)

        if (localValue !== null) {
          try {
            const serverValue = await this.saveToServer(key, localValue)
            this.saveToLocalStorage(key, serverValue)
            this.clearSyncMark(key)
          } catch (error) {
            console.error(`Fehler bei der Synchronisierung von ${key}:`, error)
          }
        } else {
          // If no local data is available, remove from the synchronization list
          this.clearSyncMark(key)
        }
      }
    } finally {
      this.#syncInProgress = false
    }
  }

  /**
   * Löst eine manuelle Synchronisierung für einen bestimmten Schlüssel aus
   */
  async forceSyncForKey(key: string): Promise<void> {
    if (!navigator.onLine || !this.connectionService.serverLink().isConnected) {
      this.markForSync(key)
      return
    }

    const localValue = this.getFromLocalStorage(key)

    if (localValue !== null) {
      try {
        const serverValue = await this.saveToServer(key, localValue)

        this.saveToLocalStorage(key, serverValue)
        this.clearSyncMark(key)
      } catch (error) {
        console.error(`Fehler bei der Synchronisierung von ${key}:`, error)
        this.markForSync(key)
      }
    }
  }

  /**
   * Spezialisierte Methode für Listen mit einem idField, um "letzte N" Elemente zu speichern.
   */
  private async updateRecentItemsList<T>(
    key: string,
    newItem: T,
    options: {
      maxItems?: number
      idField?: keyof T
      addToFront?: boolean
    },
  ): Promise<T[]> {
    const maxItems = options.maxItems || 10
    const idField = options.idField as keyof T
    const addToFront = options.addToFront !== false // Standard: true

    // Update local storage immediately
    let items = this.getFromLocalStorage<T[]>(key) || []

    // Remove duplicates based on idField
    items = items.filter(item => item[idField] !== newItem[idField])

    // Add the new element (front or back)
    if (addToFront) {
      items.unshift(newItem)
    } else {
      items.push(newItem)
    }

    // Limit the number of elements
    if (items.length > maxItems) {
      items = items.slice(0, maxItems)
    }

    this.saveToLocalStorage(key, items)

    // Attempts to synchronize with the server
    if (navigator.onLine || !this.connectionService.serverLink().isConnected) {
      try {
        const serverItems = this.saveToServer<T[]>(key, items)

        // Update local storage with the response from the server
        this.saveToLocalStorage(key, serverItems)

        return serverItems
      } catch (error) {
        console.warn(`Konnte nicht mit dem Server synchronisieren für ${key}:`, error)
        // Mark for later synchronization
        this.markForSync(key)
      }
    } else {
      // Mark for later synchronization
      this.markForSync(key)
    }

    return items
  }

  // Auxiliary methods
  private getFromLocalStorage<T>(key: string): T | null {
    try {
      const stored = localStorage.getItem(`${this.STORAGE_KEY_PREFIX}${key}`)
      return stored ? JSON.parse(stored) : null
    } catch (error) {
      console.error(`Fehler beim Lesen aus dem lokalen Speicher für ${key}:`, error)
      return null
    }
  }

  private saveToLocalStorage<T>(key: string, value: T): void {
    try {
      localStorage.setItem(`${this.STORAGE_KEY_PREFIX}${key}`, JSON.stringify(value))
    } catch (error) {
      console.error(`Fehler beim Speichern im lokalen Speicher für ${key}:`, error)
    }
  }

  private getFromServer<T>(key: string): T | null {
    try {
      this.find({ query: { key } }).then((response: Paginated<any> | any[]) => {
        if (Array.isArray(response)) {
          return response[0].value
        } else {
          return response.data[0].value
        }
      })

      return null
    } catch (error) {
      console.error(`Fehler beim Laden vom Server für ${key}:`, error)
      throw error
    }
  }

  private async saveToServer<T>(key: string, value: T): Promise<T> {
    try {
      const userId = this.currentUserId

      if (!userId) {
        throw new Error('User ID is missing')
      }

      // Feathers gibt entweder ein Array oder ein Paginated-Objekt zurück
      const response: Paginated<UserPreferenceSchema> | UserPreferenceSchema[] = await this.find({ query: { key } })

      let preferenceId: Id | null = null

      // Extract the ID if an entry exists
      if (Array.isArray(response)) {
        if (response.length > 0 && response[0]) {
          preferenceId = response[0]._id
        }
      } else if ('data' in response && response.data.length > 0 && response.data[0]) {
        preferenceId = response.data[0]._id
      }

      let result: UserPreferenceSchema | UserPreferenceSchema[]

      if (preferenceId) {
        // Update existing entry
        result = await this.service.patch(preferenceId, { value, userId })
      } else {
        const userPreference = {
          key,
          value,
          userId,
        }

        // Cast to any to bypass the Omit restriction of the wrapper method if we were using it,
        // or just use service.create directly to be safe and explicit.
        result = await this.service.create(userPreference as any)
      }

      // Extract and return the value
      if (Array.isArray(result)) return result[0].value
      else return result.value
    } catch (error) {
      console.error(`Fehler beim Speichern auf dem Server für ${key}:`, error)
      throw error
    }
  }

  private markForSync(key: string): void {
    const pendingSyncs = this.getPendingSyncs()

    if (!pendingSyncs.includes(key)) {
      pendingSyncs.push(key)
      localStorage.setItem('pendingSyncs', JSON.stringify(pendingSyncs))
    }
  }

  private clearSyncMark(key: string): void {
    const pendingSyncs = this.getPendingSyncs().filter(item => item !== key)
    localStorage.setItem('pendingSyncs', JSON.stringify(pendingSyncs))
  }

  private getPendingSyncs(): string[] {
    try {
      const stored = localStorage.getItem('pendingSyncs')
      return stored ? JSON.parse(stored) : []
    } catch (error) {
      return []
    }
  }
}
