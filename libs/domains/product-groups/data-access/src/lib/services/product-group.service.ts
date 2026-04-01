import { effect, Injectable, Signal, signal, WritableSignal, inject } from '@angular/core'
import { ProductGroupSchema } from '../models/product-group.model'
import { Id, Paginated } from '@feathersjs/feathers'
import { BaseService, ConnectionService } from '@panary-core/shared/data-access'

const Status = {
  active: 'ACTIVE',
  draft: 'DRAFT',
  archived: 'ARCHIVED',
} as const
type Status = (typeof Status)[keyof typeof Status]

@Injectable({
  providedIn: 'root',
})
export class ProductGroupService extends BaseService<ProductGroupSchema> {
  protected override entityLabelKey = 'ENTITY.PRODUCT_GROUP'

  /** PRIVATE PROPERTIES */
  #documents: WritableSignal<ProductGroupSchema[]> = signal([])
  #isLoading: WritableSignal<boolean> = signal(false)
  #isLoaded: WritableSignal<boolean> = signal(false)

  /** PUBLIC PROPERTIES */
  productGroups: Signal<ProductGroupSchema[]> = this.#documents.asReadonly()
  isLoading: Signal<boolean> = this.#isLoading.asReadonly()
  isLoaded: Signal<boolean> = this.#isLoaded.asReadonly()

  /** CONSTRUCTOR */
  protected connectionService: ConnectionService = inject(ConnectionService) // Needs to be injected for effect() usage
  constructor() {
    super(inject(ConnectionService).productGroupService, 'productGroupService')

    effect((): void => {
      if (this.connectionService.isAuthenticated() && !this.#isLoaded()) {
        this.loadDocuments().then()
      }
    })
  }

  /** PRIVATE METHODS */
  protected override handleItemCreated(document: ProductGroupSchema) {
    this.#documents.update((currentValue: ProductGroupSchema[]) => [...currentValue, document])
  }

  protected override handleItemUpdated(document: ProductGroupSchema) {
    this.#documents.update((value: ProductGroupSchema[]) => {
      const index: number = value.findIndex((element: ProductGroupSchema): boolean => element._id === document._id)

      if (index !== -1) {
        value[index] = document
        return [...value]
      }
      return value
    })
  }

  protected override handleItemRemoved(document: ProductGroupSchema) {
    this.#documents.update((value: ProductGroupSchema[]) => {
      const index: number = value.findIndex((element: ProductGroupSchema): boolean => element._id === document._id)

      if (index !== -1) {
        value.splice(index, 1)
        return [...value]
      }
      return value
    })
  }

  public async loadDocuments(): Promise<void> {
    if (this.#isLoading()) return // Verhindert doppeltes Laden

    this.#isLoading.set(true)

    try {
      const limit = 250

      // Erst die Gesamtanzahl der aktiven Produkte ermitteln
      const total = await this.count({ status: Status.active })
      const iterations = Math.ceil(total / limit)

      const allDocuments: ProductGroupSchema[] = []

      // Alle Seiten nacheinander laden
      for (let i = 0; i < iterations; i++) {
        const skip = i * limit
        const params = {
          query: {
            status: Status.active,
            $sort: { index: 1 },
            $skip: skip,
            $limit: limit,
          },
        }

        const response: ProductGroupSchema[] | Paginated<ProductGroupSchema> = await this.find(params)
        const documents: ProductGroupSchema[] = Array.isArray(response) ? response : response.data

        allDocuments.push(...documents)
      }

      this.#documents.set(allDocuments)
      this.#isLoaded.set(true)
    } catch (error) {
      console.error('Fehler beim Laden der Produktgruppen:', error)
      this.#isLoaded.set(true) // Endlosschleife verhindern
    } finally {
      this.#isLoading.set(false)
      console.log(`Gesamtanzahl der aktiven Produktgruppen: ${this.#documents().length}`)
    }
  }

  protected override fileReaderOnLoad(_fileReader: unknown, _observer: unknown, _context: unknown) {
    // TODO: CSV-Import wurde in der Migration entfernt (papaparse nicht installiert)
    // Diese Funktion muss mit dem neuen Produktgruppen-Schema neu implementiert werden.
    /*
    Papa.parse((_fileReader as FileReader).result as string, {
        delimiter: this.detectDelimiter(text.slice(0, 1000)), // oder eine andere geeignete Probegröße
        header: true,
        skipEmptyLines: true,
        complete: results => {
          const lines = results.data as any[]
          const errors = results.errors

          if (lines.length < 1) {
            const error = 'Die SSV-Datei enthält keine Daten.'
            console.error(error)
            context.errorMessages.push(error)
            observer.next(context)
            observer.complete()
            return
          }

          // Validierung der Header
          const header = results.meta.fields
          const expectedHeader = [
            '_id',
            'name',
            'index',
            'color',
            'acronym',
            'updatedAt',
            'taxInside',
            'taxOutside',
            'createdAt',
            'excluded',
            'status',
          ]

          const isHeaderValid = expectedHeader.every((col, idx) => col === (header ? header[idx] : ''))
          if (!isHeaderValid) {
            const error = 'Die Header der SSV-Datei stimmen nicht mit den erwarteten Spalten überein.'
            console.error(error)
            context.errorMessages.push(error)
            observer.next(context)
            observer.complete()
            return
          }

          const productGroups: Omit<ProductGroupSchema, '_id' | 'locationId' | 'tenantId'>[] = []

          lines.forEach((line, i) => {
            const { _id = '', externalId, name, color, acronym, updatedAt, createdAt } = line

            // Konvertierungen und Validierungen
            const statusStr = line.status?.trim().toUpperCase() || 'DRAFT'
            const excluded = line.excluded || false
            const index = Number(line.index)
            const taxInside = Number(line.taxInside)
            const taxOutside = Number(line.taxOutside)

            let statusEnum: Status | undefined

            if (statusStr) {
              switch (statusStr) {
                case Status.active:
                  statusEnum = Status.active
                  break
                case Status.draft:
                  statusEnum = Status.draft
                  break
                case Status.archived:
                  statusEnum = Status.archived
                  break
                default:
                  const warnMsg = `Default Wert für Zeile ${i + 1} wird angewendet: Ungültiger Status-Wert '${statusStr}' in Artikelgruppe ${_id}.`
                  console.warn(warnMsg)
                  context.warnMessages.push(warnMsg)
                  statusEnum = Status.draft
              }
            }

            if (!name || !color || isNaN(index) || isNaN(taxInside) || isNaN(taxOutside)) {
              let warnMsg = `Zeile ${i + 1} wird übersprungen: Ungültige Daten in Artikelgruppe ${_id}.`
              warnMsg += `\nname = ${name}`
              warnMsg += `\nacronym = ${acronym}`
              warnMsg += `\nindex = ${index}`
              warnMsg += `\ntaxInside = ${taxInside}`
              warnMsg += `\ntaxOutside = ${taxOutside}`
              console.warn(warnMsg)
              context.warnMessages.push(warnMsg)
            }

            const productGroup: Omit<ProductGroupSchema, '_id' | 'locationId' | 'tenantId'> = {
              externalId,
              name,
              color,
              excluded,
              index,
              taxInside,
              taxOutside,
            }

            if (acronym) {
              productGroup.acronym = acronym
            }
            if (statusEnum) {
              productGroup.status = statusEnum
            }

            productGroups.push(productGroup)
          })

          console.log(`Verarbeitete Artikelgruppen: ${productGroups.length}`)
          console.log(`Gesammelte Fehler: ${context.errorMessages.length}`)

          if (productGroups.length === 0) {
            const error = 'Keine gültigen Artikelgruppen zum Importieren gefunden.'
            console.error(error)
            observer.next(context)
            observer.complete()
            return
          }

          if (!context.multi) {
            // Erstellung der ProductGroups einzeln über die API
            from(productGroups)
              .pipe(
                concatMap(ag =>
                  from(this.create(ag)).pipe(
                    catchError(err => {
                      const msg = `Fehler beim Erstellen von Artikelgruppe '${ag.name}': ${err.message || err}`
                      console.error(msg)
                      context.errorMessages.push(msg)
                      return of(null) // Weiter mit dem nächsten Eintrag
                    }),
                  ),
                ),
                toArray(),
                finalize(() => {
                  context.successCount = productGroups.length - context.errorMessages.length
                  observer.next(context)
                  observer.complete()
                }),
              )
              .subscribe()
          } else {
            // Erstellung der ProductGroups als Bulk über die API
            this.create(productGroups).then((result: ProductGroupSchema[] | ProductGroupSchema) => {
              if (Array.isArray(result)) {
                context.successCount = productGroups.length - context.errorMessages.length
              } else {
                context.successCount = 1
              }
              this.loadDocuments().then()
              observer.next(context)
              observer.complete()
            })
          }
        },
        error: (err: any) => {
          const error = 'Ein unerwarteter Fehler ist beim Parsen der Datei aufgetreten.'
          console.error(error, err)
          context.errorMessages.push(error)
          observer.next(context)
          observer.complete()
        },
      })
    } catch (err) {
      const error = 'Ein unerwarteter Fehler ist aufgetreten.'
      console.error(error, err)
      // observer.next(context)
      // observer.complete()
    }
    */
  }

  /** PUBLIC METHODS */
  importFromJson(_imported: any) {
    // try {
    //   imported.forEach((productGroup: any) => {
    //     const productGroupToCreate: TArticleGroup = {
    //       name: productGroup.name,
    //       index: productGroup.index,
    //       color: productGroup.color,
    //       taxInside: productGroup.taxInside,
    //       taxOutside: productGroup.taxOutside,
    //     }
    //     this.createArticleGroup(productGroupToCreate)
    //   })
    // } catch (error) {
    //   console.error(error)
    //   console.error(imported)
    // }
  }

  getProductGroupById(id: Id | undefined): ProductGroupSchema | undefined {
    if (!id) return undefined

    const index = this.#documents().findIndex((record: ProductGroupSchema): boolean => {
      return record._id === id
    })

    return index === -1 ? undefined : this.#documents()[index]
  }

  getProductGroupByExternId(externId: string | undefined): ProductGroupSchema | undefined {
    if (!externId) return undefined

    const index = this.#documents().findIndex((record: ProductGroupSchema): boolean => {
      return record.externalId === externId
    })
    return index === -1 ? undefined : this.#documents()[index]
  }
}
