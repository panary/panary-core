import { computed, effect, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core'
import { ItemType, ProductSchema } from '../models/product.model'
import { Id } from '@feathersjs/feathers'
import { catchError, concatMap, finalize, from, Observer, of, toArray } from 'rxjs'
import { BaseService, ConnectionService } from '@panary/shared/data-access-infrastructure'
import { Status } from '@panary/shared/models'
import { AuthService } from '@panary/domains/auth/data-access'
import { Pricelist } from '@panary/domains/pricelists/data-access'
import Papa from 'papaparse'
import { UUID } from 'node:crypto'

@Injectable({
  providedIn: 'root',
})
export class ProductService extends BaseService<ProductSchema> {
  #authService: AuthService = inject(AuthService)
  #documents: WritableSignal<ProductSchema[]> = signal([])
  #isLoading: WritableSignal<boolean> = signal(false)
  #isLoaded: WritableSignal<boolean> = signal(false)

  /** PUBLIC PROPERTIES */
  products: Signal<ProductSchema[]> = this.#documents.asReadonly()
  isLoading: Signal<boolean> = this.#isLoading.asReadonly()
  isLoaded: Signal<boolean> = this.#isLoaded.asReadonly()

  extras = computed(() =>
    this.#documents()
      .filter((products: ProductSchema): boolean => products.itemType === ItemType.extra)
      .sort((a: ProductSchema, b: ProductSchema): number => a.name.localeCompare(b.name)),
  )

  /** CONSTRUCTOR */
  protected connectionService: ConnectionService = inject(ConnectionService)

  constructor() {
    super(inject(ConnectionService).productService, 'productService')

    effect((): void => {
      if (this.connectionService.isAuthenticated() && !this.#isLoaded()) {
        this.loadDocuments().then()
      }
    })
  }

  /** PRIVATE METHODS */
  public async loadDocuments(): Promise<void> {
    if (this.#isLoading()) return // Verhindert doppeltes Laden

    this.#isLoading.set(true)

    try {
      const limit = 250

      // Erst die Gesamtanzahl der aktiven Produkte ermitteln
      const total = await this.count({ status: Status.active })
      const iterations = Math.ceil(total / limit)

      const allDocuments: ProductSchema[] = []

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

        const response = await this.find(params)
        const documents = Array.isArray(response) ? response : response.data

        allDocuments.push(...documents)
      }

      this.#documents.set(allDocuments)
      this.#isLoaded.set(true)
    } catch (error) {
      console.error('Fehler beim Laden der Produkte:', error)
    } finally {
      this.#isLoading.set(false)
      console.log(`Gesamtanzahl der aktiven Produkte: ${ this.#documents().length }`)
    }
  }

  protected override fileReaderOnLoad(fileReader: FileReader, observer: Observer<any>, context: any) {
    try {
      const text = fileReader.result as string

      Papa.parse(text, {
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
            'acronym',
            'index',
            'name',
            'price',
            'showExtrasAfterSelect',
            'productGroupExternalId',
            'taxInside',
            'taxOutside',
            'isInvalid',
            'isMenu',
            'isMenuDrink',
            'isMenuSideDish',
            'isMenuSideDishSauce',
            'isExtra',
            'menuFilterType',
            'nextProductGroupExternalId',
            'showSaucesAfterSelect',
            'freeSaucesQuantity',
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

          const data: Omit<ProductSchema, '_id' | 'locationId' | 'tenantId'>[] = []

          lines.forEach((line, i) => {
            const {
              _id = '',
              externalId = null,
              name,
              acronym,
              productGroupExternalId: productGroupExternalId,
              menuFilterType,
              nextProductGroupExternalId: nextProductGroupExternalId,
            } = line

            // Konvertierungen und Validierungen
            const statusStr = line.status?.trim().toUpperCase() || 'DRAFT'
            const excluded = Boolean(line.excluded || false)
            const index = Number(line.index)
            const price = Number(line.price)
            const taxInside = Number(line.taxInside)
            const taxOutside = Number(line.taxOutside)
            const isMenu = Boolean(line.isMenu || false)
            const isMenuDrink = Boolean(line.isMenu || false)
            const isMenuSideDish = Boolean(line.isMenuSideDish || false)
            const isMenuSideDishSauce = Boolean(line.isMenuSideDish || false)
            const isExtra = Boolean(line.isExtra || false)
            const freeSaucesQuantity = Number(line.freeSaucesQuantity)
            const showExtrasAfterSelect = Boolean(line.showExtrasAfterSelect || false)
            const showSaucesAfterSelect = Boolean(line.showSaucesAfterSelect || false)

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
                default: {
                  const warnMsg = `Default Wert für Zeile ${ i + 1 } wird angewendet: Ungültiger Status-Wert '${ statusStr }' in Speise ${ _id }.`
                  console.warn(warnMsg)
                  context.warnMessages.push(warnMsg)
                  statusEnum = Status.draft
                }
              }
            }

            if (!name || !acronym || isNaN(index) || isNaN(price) || isNaN(taxInside) || isNaN(taxOutside)) {
              let warnMsg = `Zeile ${ i + 1 } wird übersprungen: Ungültige Daten in Speise ${ _id }.`
              warnMsg += `\nname = ${ name }`
              warnMsg += `\nacronym = ${ acronym }`
              warnMsg += `\nindex = ${ index }`
              warnMsg += `\nprice = ${ price }`
              warnMsg += `\ntaxInside = ${ taxInside }`
              warnMsg += `\ntaxOutside = ${ taxOutside }`
              console.warn(warnMsg)
              context.warnMessages.push(warnMsg)
            }

            const products: Omit<ProductSchema, '_id' | 'locationId' | 'tenantId'> = {
              externalId,
              name,
              acronym,
              productGroupExternalId: productGroupExternalId,
              index,
              price,
              taxInside,
              taxOutside,
              showExtrasAfterSelect,
              showSaucesAfterSelect,
              isMenu,
              isMenuDrink,
              isMenuSideDish,
              isMenuSideDishSauce,
              isExtra,
            }

            if (acronym) {
              products.acronym = acronym
            }
            if (statusEnum) {
              products.status = statusEnum
            }
            if (nextProductGroupExternalId) {
              products.nextProductGroupExternalId = nextProductGroupExternalId
            }
            if (freeSaucesQuantity) {
              products.freeSaucesQuantity = freeSaucesQuantity
            }

            data.push(products)
          })

          console.log(`Verarbeitete Speisen: ${ data.length }`)
          console.log(`Gesammelte Fehler: ${ context.errorMessages.length }`)

          if (data.length === 0) {
            const error = 'Keine gültigen Speisen zum Importieren gefunden.'
            console.error(error)
            observer.next(context)
            observer.complete()
            return
          }

          if (!context.multi) {
            // Erstellung der ProductGroups einzeln über die API
            from(data)
              .pipe(
                concatMap(ag =>
                  from(this.create(ag)).pipe(
                    catchError(err => {
                      const msg = `Fehler beim Erstellen von Speisen '${ ag.name }': ${ err.message || err }`
                      console.error(msg)
                      context.errorMessages.push(msg)
                      return of(null) // Weiter mit dem nächsten Eintrag
                    }),
                  ),
                ),
                toArray(),
                finalize(() => {
                  context.successCount = data.length - context.errorMessages.length
                  observer.next(context)
                  observer.complete()
                }),
              )
              .subscribe()
          } else {
            // Erstellung der ProductGroups als Bulk über die API
            this.create(data).then((result: ProductSchema[] | ProductSchema) => {
              if (Array.isArray(result)) {
                context.successCount = data.length - context.errorMessages.length
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
      observer.next(context)
      observer.complete()
    }
  }

  /** PUBLIC METHODS */
  importFromJson(_imported: any): void {
    // try {
    //   let newObjectId: string = ''
    //   imported.forEach((importedArticle: any, index: number) => {
    //     let newArticle: TArticle = {
    //       _id: '',
    //       acronym: importedArticle.acronym,
    //       articleGroupId: importedArticle.articleGroupId,
    //       backgroundColor: importedArticle.backgroundColor,
    //       drinks: importedArticle.drinks,
    //       excludedButtons: importedArticle.excludedButtons,
    //       excludedSubButtons: importedArticle.excludedSubButtons,
    //       extras: importedArticle.extras,
    //       fontColor: importedArticle.fontColor,
    //       functionButton: importedArticle.functionButton,
    //       index: importedArticle.index,
    //       isExtra: importedArticle.isExtra,
    //       isMenu: importedArticle.isMenu,
    //       isMenuDrink: importedArticle.isMenuDrink,
    //       isMenuSideDish: importedArticle.isMenuSideDish,
    //       isMenuSideDishSouce: importedArticle.isMenuSideDishSouce,
    //       isMenuSubButton: importedArticle.isMenuSubButton,
    //       name: importedArticle.name,
    //       pressed: importedArticle.pressed,
    //       price: importedArticle.price,
    //       productionTime: importedArticle.productionTime,
    //       showExtrasAfterSelect: importedArticle.showExtrasAfterSelect,
    //       sideDishes: importedArticle.sideDishes,
    //       soucen: importedArticle.soucen,
    //       successorParentId: importedArticle.successorParentId,
    //       table: importedArticle.table,
    //     }
    //     this.create(newArticle).then((createdArticle: any) => {
    //       this.#documents.forEach((product) => {
    //         if (product._id !== createdArticle._id) {
    //           product.drinks?.forEach((drink) => {
    //             if (drink === importedArticle._id) {
    //               drink = createdArticle._id
    //             }
    //           })
    //           product.extras?.forEach((extra) => {
    //             if (extra === importedArticle._id) {
    //               extra = createdArticle._id
    //             }
    //           })
    //           product.sideDishes?.forEach((sideDish) => {
    //             if (sideDish === importedArticle._id) {
    //               sideDish = createdArticle._id
    //             }
    //           })
    //           product.soucen?.forEach((souce) => {
    //             if (souce === importedArticle._id) {
    //               souce = createdArticle._id
    //             }
    //           })
    //           this.patch(product._id, product)
    //         }
    //       })
    //     })
    //   })
    // } catch (error) {
    //   console.error(error)
    //   console.error(imported)
    // }
  }

  /**
   * Retrieves an product by its unique identifier.
   *
   * @param {string} id - The unique identifier of the product to be retrieved.
   * @return {ProductSchema | undefined} The product object if found, otherwise undefined.
   */
  findProductById(id: Id | null): ProductSchema | undefined {
    if (!id) return

    return this.#documents().find((record: ProductSchema): boolean => record._id === id)
  }

  /**
   * Retrieves an product by its unique external identifier.
   *
   * @return {ProductSchema | undefined} The product object if found, otherwise undefined.
   * @param externalId
   */
  findProductByExternalId(externalId: Id | null): ProductSchema | undefined {
    if (!externalId) return

    return this.#documents().find((record: ProductSchema): boolean => record.externalId === externalId)
  }

  /**
   * Retrieves an product by its name.
   *
   * @param {string} name - The name of the product to retrieve.
   * @return {ProductSchema | undefined} The product object if found, otherwise undefined.
   */
  findProductByName(name: string): ProductSchema | undefined {
    return this.#documents().find((record: ProductSchema): boolean => record.name === name)
  }

  /**
   * Retrieves an product by its index.
   *
   * @param {number} index - The index of the product to retrieve.
   * @return {ProductSchema | undefined} The product associated with the given index, or undefined if no match is found or an error occurs.
   */
  findProductByIndex(index: number): ProductSchema | undefined {
    return this.#documents().find((record: ProductSchema): boolean => record.index === index)
  }

  /**
   * Retrieves a list of articles filtered by the specified product group ID.
   *
   * @param {string | undefined} productGroupExternalId - The ID of the product group to filter articles by.
   * @return {Array<ProductSchema>} An array of articles that belong to the specified product group,
   *                          sorted by their index in ascending order. Returns an empty array
   *                          if no articles match the provided group ID or if data is unavailable.
   */
  getProductsByProductGroupExternalId(productGroupExternalId: UUID | null): Array<ProductSchema> {
    if (!productGroupExternalId || !this.#documents) return []

    const productList: Array<ProductSchema> = []

    this.#documents().forEach((products: ProductSchema): void => {
      if (products.productGroupExternalId === productGroupExternalId) {
        productList.push(products)
      }
    })

    return productList.sort((a, b) => {
      return a.index - b.index
    })
  }

  async getUniqueProductGroupExternalIds() {
    const total = await this.count()

    const fetchAllPages = async (skip = 0, limit = 200, accumulatedResults: UUID[] = []): Promise<UUID[]> => {
      const params = { query: { $skip: skip, $limit: limit, $select: ['productGroupExternalId'] } }

      try {
        const response = await this.find(params)

        if (Array.isArray(response)) {
          const results: UUID[] = response.flatMap((value: ProductSchema): UUID[] =>
            value.productGroupExternalId ? [value.productGroupExternalId] : [],
          )

          accumulatedResults.push(...results)

          if (results.length === limit && accumulatedResults.length < total) {
            // Recursive call for the next page
            return fetchAllPages(skip + limit, limit, accumulatedResults)
          } else {
            // Done, return all collected results
            return accumulatedResults
          }
        } else {
          const results: UUID[] = response.data
            ? response.data.flatMap((value: ProductSchema): UUID[] =>
              value.productGroupExternalId ? [value.productGroupExternalId] : [],
            )
            : []

          accumulatedResults.push(...results)

          if (response.data && response.data.length === limit) {
            // Recursive call for the next page
            return fetchAllPages(skip + limit, limit, accumulatedResults)
          } else {
            // Done, return all collected results
            return accumulatedResults
          }
        }
      } catch (error) {
        console.error('Fehler beim Abrufen der Menügruppen:', error)
        throw error
      }
    }

    return [...new Set(await fetchAllPages())]
  }

  async applyPrices(pricelist: Pricelist): Promise<Pricelist> {
    for (const product of pricelist.productPrices) {
      if (product.newPrice) {
        await this.patch(product.productId, { price: product.newPrice })
          .then((): void => {
            product.updateStatus = 'UPDATED'
            product.updatedAt = new Date()
            product.updatedBy = this.#authService.fullName()
          })
          .catch((err: Error): void => {
            product.updateStatus = err.message
          })
      }
    }

    await this.matSnackBar
      .open('Preise erfolgreich angewendet', BaseService.SNACKBAR_ACTION, { duration: BaseService.SNACKBAR_DURATION })
      .afterDismissed()
      .toPromise()

    return pricelist
  }
}
