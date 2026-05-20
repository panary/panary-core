import { inject, NgZone } from '@angular/core'
import { Observable, Observer } from 'rxjs'

// Feathers/Connection Service & Typs
import type { Id, Paginated, Params } from '@feathersjs/feathers'
import { cloneDeep } from 'lodash'
import { BaseDocument, ExtendedParams } from '@panary/shared-common'
import { ServiceHelper } from '../utils/service-helper.service'
import { MatSnackBar } from '@angular/material/snack-bar'
import { TranslateService } from '@ngx-translate/core'

// Optional: Reusable type
export type PaginatedOrArray<T> = Promise<Paginated<T> | T[]>

/**
 * Abstract class. Creates a new resource or multiple resources and handles any errors that may occur during creation.
 *
 * @param {T | T[]} data - The data representing the resource(s) to be created.
 * @return {Promise<T | T[]>} A promise that resolves to the created resource(s).
 */
export abstract class BaseService<T> {
  /** STATIC PROPERTIES */
  static readonly SNACKBAR_ACTION: string | undefined = 'OK'
  static readonly SNACKBAR_DURATION: number = 2500

  /** INJECTION */
  protected helper: ServiceHelper = inject(ServiceHelper)
  protected matSnackBar: MatSnackBar = inject(MatSnackBar)
  protected translate: TranslateService = inject(TranslateService)
  protected ngZone: NgZone = inject(NgZone)

  /** i18n-Key für den Entitätsnamen — Subklassen überschreiben diesen Wert */
  protected entityLabelKey = 'ENTITY.DOCUMENT'

  /** PRIVATE PROPERTIES */
  protected service: any
  protected serviceName: string

  /**
   * Constructs an instance of the class.
   *
   * @param {any} service - The feathers service instance.
   * @param {string} serviceName - The name of the service (for logging/errors).
   */
  protected constructor(service: any, serviceName: string) {
    this.serviceName = serviceName
    this.service = service
    this.configureSocketListeners()
  }

  /**
   * Configures socket listeners for handling various item events such as creation, updates, patches, and removals.
   * The corresponding handler methods are invoked for each event type, and a notification is displayed using a snackbar.
   *
   * @return {void} No value is returned as this method is used to set up socket event listeners.
   */
  private configureSocketListeners(): void {
    if (!this.service || typeof this.service.on !== 'function') {
      return
    }

    this.service
      .on('created', (item: T): void => {
        this.ngZone.run(() => {
          this.handleItemCreated(item)
          this.showSnackbar(Array.isArray(item) ? 'SNACKBAR.CREATED_PLURAL' : 'SNACKBAR.CREATED')
        })
      })
      .on('updated', (item: T): void => {
        this.ngZone.run(() => {
          this.handleItemUpdated(item)
          this.showSnackbar(Array.isArray(item) ? 'SNACKBAR.UPDATED_PLURAL' : 'SNACKBAR.UPDATED')
        })
      })
      .on('patched', (item: T): void => {
        this.ngZone.run(() => {
          this.handleItemUpdated(item)
          this.showSnackbar(Array.isArray(item) ? 'SNACKBAR.CHANGED_PLURAL' : 'SNACKBAR.CHANGED')
        })
      })
      .on('removed', (item: T): void => {
        this.ngZone.run(() => {
          this.handleItemRemoved(item)
          this.showSnackbar(Array.isArray(item) ? 'SNACKBAR.DELETED_PLURAL' : 'SNACKBAR.DELETED')
        })
      })
  }

  /** Zeigt eine übersetzte Snackbar-Nachricht mit dem Entitätsnamen */
  protected showSnackbar(messageKey: string): void {
    const entity = this.translate.instant(this.entityLabelKey)
    const message = this.translate.instant(messageKey, { entity })
    const action = this.translate.instant('SNACKBAR.OK')
    this.matSnackBar.open(message, action, {
      duration: (this.constructor as typeof BaseService).SNACKBAR_DURATION,
    })
  }

  protected generateUniqueId(): string {
    return Math.random().toString(36).substring(2, 9)
  }

  /** PRIVATE HELP METHODS to prevent the code in the socket listeners from becoming too large. */
  protected handleItemCreated(document: T | Array<T>): void {
    // Bsp.: Items in einem Subject/Signal updaten
    // ...
  }

  protected handleItemUpdated(document: T | Array<T>): void {
    // ...
  }

  protected handleItemRemoved(document: T | Array<T>): void {
    // ...
  }

  /**
   * Abstract method to load documents. This method should be implemented by subclasses
   * to define the specific logic for loading documents.
   *
   * @return {void} No return value.
   */
  protected abstract loadDocuments(): void

  /**
   * Handles the FileReader onLoad event when processing files.
   *
   * @param {FileReader} fileReader - The FileReader instance used to read the file.
   * @param {Observer<any>} observer - The observer to emit events based on the read operation.
   * @param {Object} context - Additional context and data related to the file reading process.
   * @param {string[]} context.errorMessages - An array to store error messages encountered during processing.
   * @param {string[]} context.warnMessages - An array to store warning messages encountered during processing.
   * @param {number} context.successCount - A counter for successfully processed items.
   * @param {boolean} context.multi - A flag indicating if the operation is handling multiple files.
   * @return {void} This method does not return a value.
   */
  protected abstract fileReaderOnLoad(
    fileReader: FileReader,
    observer: Observer<any>,
    context: {
      errorMessages: string[]
      warnMessages: string[]
      successCount: number
      multi: boolean
    },
  ): void

  /**
   * Detects the most frequently occurring delimiter in the provided sample text from a predefined set of delimiters.
   *
   * @param {string} sampleText - The text in which the delimiter is to be detected. The text is analyzed to determine
   *                              the frequency of specific delimiters.
   * @return {string} Returns the detected delimiter. Defaults to ';' if no other delimiters are found.
   */
  protected detectDelimiter(sampleText: string): string {
    const delimiters = [',', ';', '\t', '|']
    const delimiterCounts: { [key: string]: number } = {}

    delimiters.forEach(delimiter => {
      delimiterCounts[delimiter] = 0
      const regex = new RegExp(`\\${delimiter}`, 'g')
      const matches = sampleText.match(regex)
      delimiterCounts[delimiter] = matches ? matches.length : 0
    })

    // Finde den Delimiter mit den meisten Treffern
    let detectedDelimiter = ';' // Standardwert
    let maxCount = 0
    for (const delimiter of delimiters) {
      if (delimiterCounts[delimiter] > maxCount) {
        maxCount = delimiterCounts[delimiter]
        detectedDelimiter = delimiter
      }
    }

    return detectedDelimiter
  }

  /** PUBLIC METHODS **/
  /**
   * Retrieves data based on the provided parameters.
   *
   * @param {ExtendedParams} [params={}] - The parameters used to filter or modify the data retrieval.
   * @return {Promise<PaginatedOrArray<T>>} A promise that resolves to the retrieved data, which can be paginated or an array of items.
   */
  async find(params: ExtendedParams = {}): PaginatedOrArray<T> {
    return this.service.find(params).catch((error: unknown) => {
      this.helper.handleError(this.serviceName, error)
      throw error
    })
  }

  /**
   * Retrieves a resource by its unique identifier.
   *
   * @param {Id} id - The unique identifier of the resource to be retrieved.
   * @param {Params} [params={}] - Optional parameters that may influence the retrieval process.
   * @return {Promise<T>} A promise that resolves to the resource of type T.
   */
  async get(id: Id, params: Params = {}): Promise<T> {
    return this.service.get(id, params).catch((error: unknown) => {
      this.helper.handleError(this.serviceName, error)
      throw error
    })
  }

  /**
   * Updates an existing resource with the specified data.
   *
   * @param {Id | null} id - The identifier of the resource to update. Pass `null` if the service supports multi-record updates.
   * @param {T} data - The data object to update the resource with.
   * @param {Params} [params={}] - Additional parameters to be sent with the update request.
   * @return {Promise<T | T[]>} A promise that resolves with the updated resource(s) or rejects with an error.
   */
  async update(id: Id | null, data: T, params: Params = {}): Promise<T | T[]> {
    return this.service.update(id, data, params).catch((error: unknown) => {
      this.helper.handleError(this.serviceName, error)
      throw error
    })
  }

  /**
   * Updates an existing resource or multiple resources with the given partial data.
   *
   * @param {Id | null} id - The identifier of the resource to patch. Use `null` to apply changes to multiple resources if supported.
   * @param {Partial<T>} data - The partial data to update the resource(s) with.
   * @param {Params} [params={}] - Additional parameters or query options to customize the patch operation.
   * @return {Promise<T | T[]>} A promise that resolves to the patched resource(s).
   */
  async patch(id: Id | Id[] | null, data: Partial<T>, params: Params = {}): Promise<T | T[]> {
    return this.service.patch(id, data, params).catch((error: unknown) => {
      this.helper.handleError(this.serviceName, error)
      throw error
    })
  }

  /**
   * Creates a new resource or multiple resources and handles any errors that may occur during creation.
   *
   * @param {T | T[]} data - The data representing the resource(s) to be created.
   * @param {Params} [params={}] - Additional parameters or query options to customize the patch operation.
   * @return {Promise<T | T[]>} A promise that resolves to the created resource(s).
   */
  async create(
    data: Omit<T, '_id' | 'locationId' | 'tenantId'> | Omit<T, '_id' | 'locationId' | 'tenantId'>[],
    params: Params = {},
  ): Promise<T | T[]> {
    return this.service.create(data, params).catch((error: unknown) => {
      this.helper.handleError(this.serviceName, error)
      throw error
    })
  }

  /**
   * Removes an existing resource or resources identified by the given ID.
   *
   * @param {Id|null} id - The ID of the resource to be removed. If null, this may remove multiple resources depending on the implementation.
   * @param {Params} [params={}] - Additional parameters that may be used during the removal operation.
   * @return {Promise<T|T[]>} A promise that resolves to the removed resource(s). The return type could be a single resource or an array of resources depending on the operation.
   */
  async remove(id: Id | null, params: Params = {}): Promise<T | T[]> {
    return this.service.remove(id, params).catch((error: unknown) => {
      this.helper.handleError(this.serviceName, error)
      throw error
    })
  }

  /**
   * Counts the total number of items available in the service using a query with a limit of 0.
   * The method retrieves the total count by querying the service and extracting the "total" from the resulting paginated response.
   *
   * @param {Params['query']} [query={}] - Optional query parameters to filter the count.
   * @return {Promise<number>} A promise that resolves with the total count of items.
   */
  async count(query: Params['query'] = {}): Promise<number> {
    return this.service.find({ query: { ...query, $limit: 0 } }).then((result: Paginated<T>) => result.total)
  }

  /**
   * Fetches the neighbouring documents based on the provided criteria.
   *
   * @param {Id} currentId - The identifier of the current item to find the neighbour for.
   * @param {Params['query']} [baseQuery={}] - The base query parameters used to filter items.
   * @param {string} [sortField='_id'] - The field used to sort items and locate the neighbour.
   * @param {boolean} [descending=true] - Determines the sorting order; true for descending, false for ascending.
   * @return {Promise<Id | null>} A promise that resolves to the neighbour's ID if found, otherwise null.
   */
  async fetchNeighbour(
    currentId: Id,
    baseQuery: Params['query'] = {},
    sortField = '_id',
    descending = true,
  ): Promise<Id | null> {
    const sortDirection: number = descending ? -1 : 1
    const cmp: string = descending ? '$lt' : '$gt'

    const query = {
      ...baseQuery,
      [sortField]: { [cmp]: currentId },
      $sort: { [sortField]: sortDirection },
      $limit: 1,
    }

    const response: Paginated<T> | T[] = await this.find({ query })
    const data: T[] = Array.isArray(response) ? response : response.data

    return (data[0] as any)?._id ?? null
  }

  /**
   * Creates a duplicate of the provided document, assigns a new unique identifier,
   * modifies its name to indicate that it's a duplicate, and saves it through the service.
   *
   * @param {T} document - The document to be duplicated. Must be an object inheriting from BaseDocument.
   * @return {Promise<T>} A promise resolving to the duplicated document.
   * @throws {Error} If the provided document is invalid or an issue occurs during duplication.
   */
  async duplicate<T extends BaseDocument>(document: T): Promise<T> {
    if (!document || typeof document !== 'object') {
      throw new Error('Invalid input: document is required and must be an object.')
    }

    try {
      const duplicate: T = cloneDeep(document)

      duplicate._id = this.generateUniqueId()
      duplicate.name = `${duplicate.name} (Duplikat)`

      return this.service.create(duplicate).catch((error: unknown) => {
      this.helper.handleError(this.serviceName, error)
      throw error
    })
    } catch (error) {
      this.matSnackBar.open('Artikel konnte nicht dupliziert werden!', 'OK', {
        duration: (this.constructor as typeof BaseService).SNACKBAR_DURATION,
      })
      throw error // Re-throw the error after logging
    }
  }

  /**
   * Imports a file in SSV (semicolon-separated values) format and processes its contents.
   * This method reads the file and emits the result through an observable,
   * including the number of successfully processed entries, errors, and warnings.
   *
   * @param {File} file The input file to be processed in SSV format.
   * @param {boolean} [multi=true] A flag indicating if the file contains multiple entries to process. Defaults to true.
   * @return {Observable<any>} An observable that emits an object containing `successCount`, `errorMessages`, and `warnMessages`.
   */
  importSSV(file: File, multi = true): Observable<any> {
    return new Observable(observer => {
      const fileReader = new FileReader()
      const errorMessages: string[] = []
      const warnMessages: string[] = []
      const successCount = 0

      fileReader.onload = () => {
        this.fileReaderOnLoad(fileReader, observer, {
          errorMessages,
          warnMessages,
          successCount,
          multi,
        })
      }

      fileReader.onerror = () => {
        const error = 'Fehler beim Einlesen der Datei.'
        console.error(error)
        observer.next({
          successCount,
          errorMessages,
          warnMessages,
        })
        observer.complete()
      }

      fileReader.readAsText(file, 'UTF-8')
    })
  }
}
