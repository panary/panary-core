import type { ProductSchema } from '@panary/products/domain'
import type { OrderLineItem } from '@panary/orders/data-access'
import { LineComponent, withFixedBundleMainComponent } from '@panary/orders/domain'

/**
 * Katalog-Lookups des Bundle-Flows — als Funktionen injiziert, damit die Klasse
 * ohne Angular-DI (und damit ohne TestBed) testbar bleibt.
 */
export interface BundleFlowCatalog {
  findProductById: (id: string) => ProductSchema | undefined
  findProductByExternalId: (externalId: string) => ProductSchema | undefined
  /** Gruppenname der ersten Kategorie eines Produkts (Order-`topic`). */
  topicForProduct: (product: ProductSchema) => string
}

/**
 * Menü-/Bundle-Flow des Bestelldialogs: OptionGroup-Sequenz (Pflicht vor
 * optional), HIGHEST-Preisregel und FIXED_PROPORTIONAL-Komponentenaufbau.
 * Bewusst eine plain class ohne Angular-Abhängigkeiten — die UI-Orchestrierung
 * (Buttons, Blocking, InfoBox) bleibt in der OrderDialogComponent.
 */
export class BundleFlow {
  #completedGroups = new Set<string>()

  constructor(private readonly catalog: BundleFlowCatalog) {}

  /** Beginnt einen neuen Bundle-Durchlauf (vergisst abgeschlossene Gruppen). */
  reset(): void {
    this.#completedGroups = new Set()
  }

  markCompleted(groupId: string): void {
    this.#completedGroups.add(groupId)
  }

  /** Prüft ob ein Produkt ein BUNDLE mit Pflicht-Optionen ist */
  isBundleProduct(product: ProductSchema): boolean {
    // Neues Schema: productType + optionGroups
    if (product.productType === 'BUNDLE' && (product.optionGroups?.length ?? 0) > 0) return true
    // Legacy-Fallback: isMenu-Flag
    return (product as any).isMenu === true
  }

  /** Gibt die nächste unvollständige OptionGroup zurück (Pflicht zuerst, dann optional) */
  getNextMandatoryGroup(product: ProductSchema): any | null {
    if (!product.optionGroups?.length) return null
    // Zuerst Pflicht-Gruppen (minSelections > 0)
    const mandatory = product.optionGroups.find(g =>
      g.minSelections > 0 && !this.#completedGroups.has(g.id),
    )
    if (mandatory) return mandatory
    // Dann optionale Gruppen (minSelections === 0) — mit Skip-Möglichkeit
    return product.optionGroups.find(g =>
      g.minSelections === 0 && !this.#completedGroups.has(g.id),
    ) ?? null
  }

  /** Noch nicht abgearbeitete OptionGroups eines (Unter-)Produkts. */
  pendingGroups(product: ProductSchema): NonNullable<ProductSchema['optionGroups']> {
    return (product.optionGroups ?? []).filter(g => !this.#completedGroups.has(g.id))
  }

  /** Erstellt ein GenericLineItem aus einem Produkt (für menuSideDish, menuDrink, modifiers) */
  toGenericLineItem(product: ProductSchema): any {
    return {
      _id: product._id,
      externalId: product.externalId ?? '',
      amount: 1,
      name: product.name,
      price: product.price || 0,
      taxInside: product.taxInside || 19,
      taxOutside: product.taxOutside || 7,
      ingredientReferences: (product as any).ingredientReferences || [],
      recipeReferences: product.recipeReferences || [],
      topic: this.catalog.topicForProduct(product),
    }
  }

  /**
   * Findet die Optionsgruppe eines LineItem-Produkts, deren Name dem `topic`
   * entspricht. Dient dem klassischen Extras-Pfad (`increaseExtra`), der nur den
   * `topic` kennt, um `pricingMode`/`freeQuantity` der Herkunftsgruppe aufzulösen.
   */
  findOptionGroupByTopic(
    lineItem: OrderLineItem,
    topic: string,
  ): { pricingMode?: 'SUM' | 'HIGHEST'; freeQuantity?: number } | undefined {
    const product =
      this.catalog.findProductById(lineItem._id) ??
      (lineItem.externalId ? this.catalog.findProductByExternalId(lineItem.externalId) : undefined)
    return product?.optionGroups?.find(g => g.name === topic)
  }

  /**
   * HIGHEST-Preisregel für eine Modifier-Gruppe (`topic`): Von allen gewählten
   * Optionen wird nur der HÖCHSTE Aufpreis wirksam, die übrigen kostenpflichtigen
   * werden auf 0 gesetzt. Reihenfolge (Auswahl-Reihenfolge im modifiers-Array):
   *   1. Die ersten `freeQty` Optionen der Gruppe sind Freimenge → Preis 0.
   *   2. Unter den verbleibenden kostenpflichtigen Optionen behält nur die mit
   *      dem höchsten KATALOG-Aufpreis ihren Preis; alle anderen → 0.
   *
   * Der Katalog-Preis wird pro Item frisch gelesen (Modifier-`_id` = product._id),
   * damit wiederholte Auswahl (ein teureres Item kommt dazu) ein zuvor genulltes
   * Item korrekt wieder bepreist. Rein preisliche Mutation der Order-Zeile —
   * keine Auswahl wird entfernt.
   */
  applyHighestPricingToGroup(lineItem: OrderLineItem, topic: string, freeQty: number): void {
    const groupMods = lineItem.modifiers.filter(m => m.topic === topic)
    if (groupMods.length === 0) return

    // Katalog-Aufpreis pro Item (Fallback: aktueller Item-Preis, falls Lookup fehlt).
    const catalogPrice = (m: (typeof groupMods)[number]): number =>
      this.catalog.findProductById(m._id)?.price ?? m.price ?? 0

    // Freimengen zuerst (Auswahl-Reihenfolge) → 0; Rest ist kostenpflichtig.
    const paid = groupMods.slice(freeQty)
    groupMods.slice(0, freeQty).forEach(m => (m.price = 0))
    if (paid.length === 0) return

    const maxPrice = Math.max(...paid.map(catalogPrice))
    // Nur EINE Option gewinnt: die erste mit Max-Preis behält, alle anderen → 0.
    let winnerAssigned = false
    for (const m of paid) {
      const price = catalogPrice(m)
      if (!winnerAssigned && price === maxPrice) {
        m.price = price
        winnerAssigned = true
      } else {
        m.price = 0
      }
    }
  }

  /** Rolle einer Bundle-Komponente aus dem OptionGroup-Namen (Bon/UI-Gruppierung). */
  roleFromGroupName(name: string): LineComponent['role'] {
    const n = (name || '').toLowerCase()
    if (n.includes('beilage') || n.includes('side')) return 'side'
    if (n.includes('getränk') || n.includes('getraenk') || n.includes('drink')) return 'drink'
    if (n.includes('sauce') || n.includes('soße') || n.includes('sosse') || n.includes('dip')) return 'sauce'
    return 'extra'
  }

  /**
   * Generische Bundle-Komponente (Engine-Eingabe) mit NORMALPREIS-Gewicht. Anders
   * als der Legacy-Slot wird hier bewusst der volle Normalpreis geführt (kein
   * freeQuantity-0): bei FIXED_PROPORTIONAL ist er das Marktwert-Gewicht der
   * Festpreis-Verteilung, nicht der berechnete Aufpreis.
   */
  toComponent(product: ProductSchema, group: { id?: string; name?: string }): LineComponent {
    return {
      ...this.toGenericLineItem(product),
      price: product.price || 0,
      optionGroupId: group?.id,
      role: this.roleFromGroupName(group?.name ?? ''),
    } as LineComponent
  }

  /**
   * Schließt eine FIXED_PROPORTIONAL-Bundle-Zeile ab: ergänzt das Hauptgericht als
   * Komponente (role 'main') mit Normalpreis-Gewicht. Quelle: product.mainPrice;
   * fehlt der Wert, dient der Restbetrag (Festpreis − Σ übrige Komponenten) als
   * Gewicht — so bleibt die Engine-Verteilung summen-exakt == Festpreis. Idempotenz
   * (kein Doppel-main) und Cents-Arithmetik liegen in der Domain-Funktion.
   */
  finalizeFixedBundle(lineItem: OrderLineItem, product: ProductSchema): void {
    if (product.bundlePricingMode !== 'FIXED_PROPORTIONAL') return

    lineItem.components = withFixedBundleMainComponent(
      lineItem.components ?? [],
      {
        ...this.toGenericLineItem(product),
        taxInside: product.taxInside || 19,
        taxOutside: product.taxOutside || 7,
        topic: 'main',
      },
      product.price,
      product.mainPrice,
    )
  }
}
