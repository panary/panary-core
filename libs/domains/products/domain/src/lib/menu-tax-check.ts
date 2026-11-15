import type { Product } from './product.schema'
import { menuOptionGroupSlot } from './menu-option-group-slot'

/**
 * Prüft die Steuer-Konfiguration eines Menüs nach festen Regeln (core#1455). Die Regeln beschreiben die Rechnung
 * der Kasse, nicht das Steuerrecht: Sie sagen, ob die Konfiguration zu dem passt, was `computeOrderTax` aus ihr
 * macht. Reine Funktion, kein Text: Anzeige und Wortlaut gehören den Aufrufern (Edge-Admin, Cloud-Katalog).
 */

/** `warnung`: die Kasse bucht erkennbar anders als gewollt. `hinweis`: zulässig, aber ungünstig oder ungeprüft. */
export type MenuTaxSeverity = 'warnung' | 'hinweis'

export const MENU_TAX_FINDING_CODES = [
  'EXTRA_GROUP_RATE_DIFFERS',
  'OPTION_WITHOUT_PRICE_OTHER_RATE',
  'MAIN_WITHOUT_SHARE',
  'MAIN_PRICE_MISSING',
  'RATE_NOT_IN_LOCATION',
  'RATE_MISSING_OR_ZERO',
  'OPTION_UNRESOLVED',
] as const
export type MenuTaxFindingCode = (typeof MENU_TAX_FINDING_CODES)[number]

export type MenuTaxRecommendation =
  | 'GROUP_AS_SIDE_OR_DRINK'
  | 'MOVE_OPTION_TO_OWN_SIDE_OR_DRINK_GROUP'
  | 'ENTER_OPTION_PRICE'
  | 'ENTER_MAIN_PRICE_OR_CHECK_FIXED_PRICE'
  | 'ENTER_MAIN_PRICE'
  | 'CHECK_LOCATION_TAX_RATES'
  | 'ENTER_TAX_RATE_EXPLICITLY'
  | 'CHECK_OPTION_PRODUCT'

export interface MenuTaxFinding {
  /** Nummer der Regel im ADR, 1 bis 7. */
  rule: 1 | 2 | 3 | 4 | 5 | 6 | 7
  code: MenuTaxFindingCode
  severity: MenuTaxSeverity
  recommendation: MenuTaxRecommendation
  /** Auswahlgruppe, in der die Option steht. Fehlt bei Befunden am Menü selbst. */
  groupId?: string
  /** Options-Produkt, auf das sich der Befund bezieht, bzw. das Menü selbst bei Befunden ohne `groupId`. */
  productId: string
  /** Nur bei `RATE_NOT_IN_LOCATION`: der wirksame Satz, der in der Filiale fehlt. */
  rate?: number
}

type TaxFields = Pick<Product, 'taxInside' | 'taxOutside'>
type OptionProduct = Pick<Product, '_id' | 'price' | 'optionGroups'> & Partial<TaxFields>
export type MenuTaxCheckMenu = Pick<Product, '_id' | 'price'> &
  Partial<Pick<Product, 'taxInside' | 'taxOutside' | 'bundlePricingMode' | 'mainPrice' | 'optionGroups'>>

export interface MenuTaxCheckInput {
  menu: MenuTaxCheckMenu
  /** Löst ein Options-Produkt auf; `undefined` heißt gelöscht oder nicht geladen. */
  resolveOption: (productId: string) => OptionProduct | undefined
  /** Steuersätze der Filiale (`taxSettings`). Leer: Regel 5 entfällt, es gibt nichts zu vergleichen. */
  locationTaxRates: readonly number[]
}

type Group = NonNullable<Product['optionGroups']>[number]

// Die Kasse ersetzt einen fehlenden oder auf 0 stehenden Satz durch diese Werte (bundle-flow.ts, increaseLineItem).
const DEFAULT_TAX_INSIDE = 19
const DEFAULT_TAX_OUTSIDE = 7

const effectiveInside = (p: Partial<TaxFields>): number => p.taxInside || DEFAULT_TAX_INSIDE
const effectiveOutside = (p: Partial<TaxFields>): number => p.taxOutside || DEFAULT_TAX_OUTSIDE
const ratesDiffer = (a: Partial<TaxFields>, b: Partial<TaxFields>): boolean =>
  effectiveInside(a) !== effectiveInside(b) || effectiveOutside(a) !== effectiveOutside(b)

const toCents = (euro: number): number => Math.round(euro * 100)

interface Reached {
  group: Group
  product: OptionProduct | undefined
  productId: string
}

/** Alle erreichbaren Optionen samt verschachtelter Untergruppen; ein Produkt wird je Pfad nur einmal betreten. */
function collectOptions(
  groups: readonly Group[] | undefined,
  resolve: MenuTaxCheckInput['resolveOption'],
  path: ReadonlySet<string>,
): Reached[] {
  const out: Reached[] = []
  for (const group of groups ?? []) {
    for (const option of group.options) {
      const product = resolve(option.productId)
      out.push({ group, product, productId: option.productId })
      if (product && !path.has(product._id)) {
        out.push(...collectOptions(product.optionGroups, resolve, new Set([...path, product._id])))
      }
    }
  }
  return out
}

/**
 * Teuerste wählbare Kombination in Cents, gebildet wie die Summe in `fixedBundleMainWeight`: alle Gruppen
 * einschließlich Extras und Untergruppen, je Gruppe die `maxSelections` teuersten Optionen.
 */
function maxCombinationCents(
  groups: readonly Group[] | undefined,
  resolve: MenuTaxCheckInput['resolveOption'],
  path: ReadonlySet<string>,
): number {
  let total = 0
  for (const group of groups ?? []) {
    const values = group.options
      .map(option => {
        const product = resolve(option.productId)
        if (!product) return 0
        const nested = path.has(product._id)
          ? 0
          : maxCombinationCents(product.optionGroups, resolve, new Set([...path, product._id]))
        return toCents(product.price || 0) + nested
      })
      .sort((a, b) => b - a)
    total += values.slice(0, group.maxSelections).reduce((sum, v) => sum + v, 0)
  }
  return total
}

export function checkMenuTax(input: MenuTaxCheckInput): MenuTaxFinding[] {
  const { menu, resolveOption, locationTaxRates } = input
  const findings: MenuTaxFinding[] = []
  const reached = collectOptions(menu.optionGroups, resolveOption, new Set([menu._id]))

  // Regel 7: nicht auflösbare Option. Mehr lässt sich an ihr nicht prüfen.
  for (const r of reached) {
    if (!r.product) {
      findings.push({
        rule: 7,
        code: 'OPTION_UNRESOLVED',
        severity: 'hinweis',
        recommendation: 'CHECK_OPTION_PRODUCT',
        groupId: r.group.id,
        productId: r.productId,
      })
    }
  }
  const resolved = reached.filter((r): r is Reached & { product: OptionProduct } => !!r.product)

  for (const r of resolved) {
    const deviates = ratesDiffer(r.product, menu)
    // Regel 1: Die Kasse bucht die Wahl als Extra, ein Extra läuft immer zum Satz der Zeile.
    if (menuOptionGroupSlot(r.group.name) === null && deviates && (r.product.price || 0) > 0) {
      const single =
        r.group.minSelections > 0 &&
        r.group.maxSelections === 1 &&
        r.group.freeQuantity === 0 &&
        r.group.pricingMode !== 'HIGHEST'
      findings.push({
        rule: 1,
        code: 'EXTRA_GROUP_RATE_DIFFERS',
        severity: 'warnung',
        recommendation: single ? 'GROUP_AS_SIDE_OR_DRINK' : 'MOVE_OPTION_TO_OWN_SIDE_OR_DRINK_GROUP',
        groupId: r.group.id,
        productId: r.productId,
      })
    }
    // Regel 2: Ohne eigenen Preis bekommt der abweichende Satz keinen Anteil am Menü.
    if (deviates && (r.product.price || 0) === 0) {
      findings.push({
        rule: 2,
        code: 'OPTION_WITHOUT_PRICE_OTHER_RATE',
        severity: 'warnung',
        recommendation: 'ENTER_OPTION_PRICE',
        groupId: r.group.id,
        productId: r.productId,
      })
    }
  }

  // Regeln 3 und 4: Festpreis-Menü, Anteil des Hauptgerichts.
  if (menu.bundlePricingMode === 'FIXED_PROPORTIONAL') {
    const mainPrice = menu.mainPrice
    if (mainPrice === 0) {
      findings.push({
        rule: 3,
        code: 'MAIN_WITHOUT_SHARE',
        severity: 'warnung',
        recommendation: 'ENTER_MAIN_PRICE_OR_CHECK_FIXED_PRICE',
        productId: menu._id,
      })
    } else if (mainPrice == null) {
      const reachesFixed =
        maxCombinationCents(menu.optionGroups, resolveOption, new Set([menu._id])) >= toCents(menu.price)
      findings.push(
        reachesFixed
          ? {
              rule: 3,
              code: 'MAIN_WITHOUT_SHARE',
              severity: 'warnung',
              recommendation: 'ENTER_MAIN_PRICE_OR_CHECK_FIXED_PRICE',
              productId: menu._id,
            }
          : {
              rule: 4,
              code: 'MAIN_PRICE_MISSING',
              severity: 'hinweis',
              recommendation: 'ENTER_MAIN_PRICE',
              productId: menu._id,
            },
      )
    }
  }

  // Regel 5: wirksamer Satz kommt in der Filiale nicht vor. Regel 6: Satz fehlt oder steht auf 0.
  const subjects: Array<{ productId: string; groupId?: string; tax: Partial<TaxFields> }> = [
    { productId: menu._id, tax: menu },
    ...resolved.map(r => ({ productId: r.productId, groupId: r.group.id, tax: r.product })),
  ]
  for (const s of subjects) {
    if (!s.tax.taxInside || !s.tax.taxOutside) {
      findings.push({
        rule: 6,
        code: 'RATE_MISSING_OR_ZERO',
        severity: 'warnung',
        recommendation: 'ENTER_TAX_RATE_EXPLICITLY',
        ...(s.groupId ? { groupId: s.groupId } : {}),
        productId: s.productId,
      })
    }
    if (locationTaxRates.length > 0) {
      const effective = [...new Set([effectiveInside(s.tax), effectiveOutside(s.tax)])]
      for (const rate of effective) {
        if (!locationTaxRates.includes(rate)) {
          findings.push({
            rule: 5,
            code: 'RATE_NOT_IN_LOCATION',
            severity: 'warnung',
            recommendation: 'CHECK_LOCATION_TAX_RATES',
            ...(s.groupId ? { groupId: s.groupId } : {}),
            productId: s.productId,
            rate,
          })
        }
      }
    }
  }

  return findings
}
