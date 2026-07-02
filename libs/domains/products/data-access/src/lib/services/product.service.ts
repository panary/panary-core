import { computed, effect, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core'
import { ItemType, Pricelist, ProductSchema } from '@panary/products/domain'
import { Id } from '@feathersjs/feathers'
import { Observer } from 'rxjs'
import { BaseService, ConnectionService } from '@panary/shared/data-access'
import { AuthService } from '@panary/auth/data-access'

// TODO: Migration – Status-Enum aus @panary/products/domain oder shared/common übernehmen
const Status = {
  active: 'ACTIVE',
  draft: 'DRAFT',
  archived: 'ARCHIVED',
} as const
type Status = (typeof Status)[keyof typeof Status]

// UUID wird nur als Typ verwendet
type UUID = string

/**
 * Pure Merge-Logik für Realtime-Events (created/updated/patched): hält die
 * Invariante von `loadDocuments()` aufrecht — die Liste enthält ausschließlich
 * ACTIVE-Produkte, sortiert nach `name`. Ein Status-Wechsel weg von ACTIVE
 * (z.B. Archivierung in einem anderen Tab) entfernt das Produkt aus der Liste.
 */
export function mergeActiveProducts(
  current: readonly ProductSchema[],
  incoming: ProductSchema | ProductSchema[],
): ProductSchema[] {
  const items = Array.isArray(incoming) ? incoming : [incoming]
  const byId = new Map<string, ProductSchema>()
  for (const doc of current) byId.set(doc._id, doc)
  for (const doc of items) {
    if (!doc?._id) continue
    if (doc.status === Status.active) {
      byId.set(doc._id, doc)
    } else {
      byId.delete(doc._id)
    }
  }
  return Array.from(byId.values()).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
}

/** Pure Remove-Logik für Realtime-`removed`-Events. */
export function removeProducts(
  current: readonly ProductSchema[],
  incoming: ProductSchema | ProductSchema[],
): ProductSchema[] {
  const ids = new Set((Array.isArray(incoming) ? incoming : [incoming]).map(doc => doc?._id))
  return current.filter(doc => !ids.has(doc._id))
}

@Injectable({
  providedIn: 'root',
})
export class ProductService extends BaseService<ProductSchema> {
  protected override entityLabelKey = 'ENTITY.PRODUCT'
  protected override cachePolicy = 'master-data' as const
  protected override cacheStoreName = 'products'

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
      // TODO: Migration – ehem. itemType === 'extra', jetzt productType === 'MODIFIER'
      .filter((products: ProductSchema): boolean => products.productType === ItemType.extra)
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
            $sort: { name: 1 },
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
      this.#isLoaded.set(true) // Endlosschleife verhindern
    } finally {
      this.#isLoading.set(false)
      console.log(`Gesamtanzahl der aktiven Produkte: ${ this.#documents().length }`)
    }
  }

  /**
   * Realtime-Pflege des `products`-Signals — überschreibt die leeren Stubs aus
   * `BaseService`. Ohne diese Handler blieb `#documents` nach dem initialen
   * `loadDocuments()` bis zum Full-Reload eingefroren (stale Verwendungszähler
   * und Vorschläge in Konsumenten, z.B. panary-cloud product-details).
   * `configureSocketListeners()` wrappt die Aufrufe bereits in `ngZone.run`.
   */
  protected override handleItemCreated(document: ProductSchema | ProductSchema[]): void {
    this.#documents.update(current => mergeActiveProducts(current, document))
  }

  protected override handleItemUpdated(document: ProductSchema | ProductSchema[]): void {
    this.#documents.update(current => mergeActiveProducts(current, document))
  }

  protected override handleItemRemoved(document: ProductSchema | ProductSchema[]): void {
    this.#documents.update(current => removeProducts(current, document))
  }

  protected override fileReaderOnLoad(_fileReader: FileReader, _observer: Observer<unknown>, _context: unknown) {
    // TODO: CSV-Import wurde in der Migration entfernt (Legacy-Felder nicht im neuen Schema)
    // Diese Funktion muss mit dem neuen Produktschema neu implementiert werden.
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
    // TODO: Im neuen Schema ist 'index' unter product.ui.index verschoben
    return this.#documents().find((record: ProductSchema): boolean => record.ui?.index === index)
  }

  /**
   * Retrieves a list of articles filtered by the specified product group ID.
   *
   * @param {string | undefined} productGroupExternalId - The ID of the product group to filter articles by.
   * @return {Array<ProductSchema>} An array of articles that belong to the specified product group,
   *                          sorted by their index in ascending order. Returns an empty array
   *                          if no articles match the provided group ID or if data is unavailable.
   */
  // categoryIds referenziert Produktgruppen — Zielkonvention ist die externalId,
  // Bestandsdaten enthalten teils noch die _id (categoryIds-Migration 2026-07).
  // Deshalb tolerant gegen beide Schlüssel matchen; Aufrufer geben beide mit.
  getProductsByGroupId(groupId: string | null, groupExternalId?: string | null): Array<ProductSchema> {
    if (!groupId || !this.#documents) return []

    return this.#documents()
      .filter((p: ProductSchema) =>
        p.categoryIds?.some(ref => ref === groupId || (groupExternalId != null && ref === groupExternalId)),
      )
      .sort((a, b) => (a.ui?.index ?? 0) - (b.ui?.index ?? 0))
  }

  /** @deprecated Verwende getProductsByGroupId() — matcht tolerant _id UND externalId */
  getProductsByProductGroupExternalId(categoryId: UUID | null): Array<ProductSchema> {
    return this.getProductsByGroupId(categoryId as string)
  }

  async getUniqueProductGroupExternalIds() {
    const total = await this.count()

    const fetchAllPages = async (skip = 0, limit = 200, accumulatedResults: UUID[] = []): Promise<UUID[]> => {
      // TODO: Im neuen Schema wird über categoryIds gefiltert, nicht productGroupExternalId
      const params = { query: { $skip: skip, $limit: limit, $select: ['categoryIds'] } }

      try {
        const response = await this.find(params)

        if (Array.isArray(response)) {
          const results: UUID[] = response.flatMap((value: ProductSchema): UUID[] => value.categoryIds ?? [])

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
            ? response.data.flatMap((value: ProductSchema): UUID[] => value.categoryIds ?? [])
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
