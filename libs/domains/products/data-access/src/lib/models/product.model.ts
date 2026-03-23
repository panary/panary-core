export type { Product } from '@panary-core/products/domain'

// Legacy-Typ-Alias für Migration (product.service.ts verwendet noch 'ProductSchema')
export type { Product as ProductSchema } from '@panary-core/products/domain'

// ItemType existiert im neuen Domain-Schema nicht mehr (ersetzt durch productType).
// Stub für Abwärtskompatibilität während der Migration.
export enum ItemType {
  // TODO: Migration – productType 'MODIFIER' verwenden
  extra = 'MODIFIER',
  product = 'PRODUCT',
  bundle = 'BUNDLE',
  service = 'SERVICE',
  // Legacy-Werte aus panary/pos-counter – nicht mehr im neuen Schema
  mainDish = 'MAIN_DISH',
  sauce = 'SAUCE',
}

// Stub für nicht-migriertes Pricelist-Feature
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
