import type { ProductSchema } from '@panary/products/domain'

/**
 * UI-Zustand und Legacy-Flags, die der Bestelldialog an POS-Tasten hängt.
 * Reines View-Model — darf NIE auf Objekten aus dem ProductService-Store gesetzt
 * werden (app-weit geteilter Cache), sondern nur auf Kopien via toPosButton().
 */
export interface PosButtonUiState {
  callback?: () => void
  pressed?: boolean
  /** Legacy-Anzeige-Index synthetischer Tasten; echte Produkte nutzen ui.index */
  index?: number
  isFunctionButton?: boolean
  isExtra?: boolean
  isMenu?: boolean
  isMenuSideDish?: boolean
  isMenuSideDishSauce?: boolean
  isMenuDrink?: boolean
  isMenuSubButton?: boolean
  /** Legacy itemType (ersetzt durch productType) — nur für alte Menü-Konfigurationen */
  itemType?: string
  backgroundColor?: string
  fontColor?: string
  table?: string
  productionTime?: number
  productGroupExternalId?: string
}

/** Produkt-Taste: KOPIE der Produkt-Felder + UI-Zustand — nie die Store-Referenz selbst. */
export type PosProductButton = ProductSchema & PosButtonUiState

/** Trägertyp der Button-Arrays im Dialog: Produkt-Kopie ODER synthetische Funktionstaste. */
export type PosButton = Partial<ProductSchema> & PosButtonUiState & Pick<ProductSchema, '_id' | 'name'>

/**
 * Erzeugt eine Button-VM als Shallow-Copy des Produkts. Reicht aus, weil der
 * Dialog ausschließlich Top-Level-Felder (callback/pressed/price/Flags) setzt.
 */
export function toPosButton(product: ProductSchema, ui: PosButtonUiState = {}): PosProductButton {
  return { ...product, ...ui }
}
