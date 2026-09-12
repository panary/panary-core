import { ItemType, type ProductSchema } from '@panary/products/domain'

/**
 * UI-Zustand und Legacy-Flags, die der Bestelldialog an POS-Tasten hängt.
 * Reines View-Model — darf NIE auf Objekten aus dem ProductService-Store gesetzt
 * werden (app-weit geteilter Cache), sondern nur auf Kopien via toPosButton().
 */
export interface PosButtonUiState {
  callback?: () => void
  pressed?: boolean
  /** Farbcodierung nach Wirkung: cancel=Rot (verwirft), skip=Amber (lässt weg), confirm=Teal (übernimmt) */
  variant?: 'cancel' | 'skip' | 'confirm'
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

/**
 * Darf diese Taste als Zusatz auf eine Bestellzeile gebucht werden?
 *
 * Vier Erkennungswege, weil Alt-Kataloge das heutige `productType` nicht kennen:
 * der Typ selbst und die Legacy-Flags `isExtra`, `isMenuSideDishSauce` sowie
 * `itemType` (sauce/extra). Die Flags bleiben bewusst stehen — Bestandsdaten
 * hängen daran (#273).
 *
 * `increaseExtra` und `decreaseExtra` prüften das bis #273 mit **verschiedenen**
 * Listen: Der OHNE-Modus kannte `isExtra`/`isMenuSideDishSauce` nicht. Solange
 * beide Pfade still zurückkehrten, fiel das nicht auf; sobald sie es melden,
 * behauptete der OHNE-Modus „ist kein Extra" über eine Kachel, die im
 * PLUS-Modus funktioniert. Deshalb eine Quelle für beide.
 */
export function isModifierButton(article: Partial<ProductSchema> & PosButtonUiState): boolean {
  return (
    article.productType === 'MODIFIER' ||
    article.isExtra === true ||
    article.isMenuSideDishSauce === true ||
    article.itemType === ItemType.sauce ||
    article.itemType === ItemType.extra
  )
}

/**
 * Meldung für den Tap auf eine Extras-Kachel, deren Produkt kein Modifier ist.
 *
 * Nennt den Produkttyp, weil genau der die Ursache ist: Der Cloud-CSV-Import
 * setzt ein fehlendes Feld auf `PRODUCT`, und die Optionsgruppe zeigt die
 * Kachel trotzdem an. Der Text adressiert den Katalogpfleger, nicht die Kasse.
 */
export function extraNotModifierMessage(article: Partial<ProductSchema> & PosButtonUiState): string {
  const name = article.name ?? 'Dieses Produkt'
  return `„${name}" ist kein Extra (Produkttyp: ${article.productType ?? 'fehlt'}) — im Admin auf Modifier stellen`
}
