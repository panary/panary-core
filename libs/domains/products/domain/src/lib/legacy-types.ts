// Legacy-Typen für die Migration aus panary/pos-counter — NICHT für neue Features verwenden.
// TODO: Nach abgeschlossener POS-Migration (Menu/Options/Extras-UI) entfernen.

import type { Product } from './product.schema'

// Legacy-Alias: Der alte Name 'ProductSchema' wird in pos-counter-Code noch verwendet.
// Entspricht direkt `Product` aus dem Domain-Schema.
export type ProductSchema = Product

// ItemType entspricht dem legacy `itemType`-Feld (ersetzt durch `productType` im neuen Schema).
// Die Werte PRODUCT/MODIFIER/BUNDLE/SERVICE sind mit `productType` deckungsgleich;
// MAIN_DISH und SAUCE existieren nur noch in alten Menu-Konfigurationen.
export enum ItemType {
  extra = 'MODIFIER',
  product = 'PRODUCT',
  bundle = 'BUNDLE',
  service = 'SERVICE',
  mainDish = 'MAIN_DISH',
  sauce = 'SAUCE',
}

// Pricelist wird nur vom legacy `ProductService.applyPrices()`-Flow konsumiert.
// Eigene Domain-Lib folgt, sobald das Pricelist-Feature vollständig migriert wird.
export interface Pricelist {
  _id: string
  name: string
  prices: Record<string, number>
  productPrices: Array<{
    productId: string
    newPrice?: number
    updateStatus?: string
    updatedAt?: Date
    updatedBy?: string
  }>
}
