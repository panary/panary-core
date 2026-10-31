import { calculateModifierPrice } from '@panary/orders/data-access'
import {
  groupModifiersByComponent,
  modifiersCountPerUnit,
  type ModifierLineItem,
  type OrderLineItem,
} from '@panary/orders/domain'

/** Wie `REMOVED_INGREDIENT_PREFIX` im Bestelldialog: eine abgewählte Zutat wird als „Ohne X" gebucht. */
const REMOVED_INGREDIENT_PREFIX = 'Ohne '

export interface HistoryModifierVm {
  id: string
  /** `extra`: „+ Name", `removed`: abgewählte Zutat, `without`: Modifier mit Menge unter 0. */
  kind: 'extra' | 'removed' | 'without'
  name: string
  icon?: string
  /** Abgerechnete Menge, ohne Vorzeichen — beim Je-Stück-Modifier für alle Stück (wie der Warenkorb). */
  amount: number
  /** Gespeicherter Betrag, `null` bei 0. */
  price: number | null
}

export interface HistoryLineVm {
  item: OrderLineItem
  modifiers: HistoryModifierVm[]
  sideDishModifiers: HistoryModifierVm[]
  drinkModifiers: HistoryModifierVm[]
}

function modifierVm(item: OrderLineItem, extra: ModifierLineItem): HistoryModifierVm {
  const removed = extra.amount > 0 && extra.name.startsWith(REMOVED_INGREDIENT_PREFIX)
  const kind = removed ? 'removed' : extra.amount < 0 ? 'without' : 'extra'
  const amount = Math.abs(modifiersCountPerUnit(item) ? extra.amount * item.amount : extra.amount)
  const priced = removed ? extra.price !== 0 : extra.amount > 0 && extra.price > 0
  return {
    id: extra._id,
    kind,
    name: removed ? extra.name.slice(REMOVED_INGREDIENT_PREFIX.length) : extra.name,
    icon: extra.icon,
    amount,
    price: priced ? calculateModifierPrice(item, extra) : null,
  }
}

/**
 * Ansicht einer Position der Historie: Extras beim Hauptartikel, bei Beilage und Getränk — dieselbe Zuordnung wie
 * „Offen" und Warenkorb (core#1127). Nur Anzeige: gespeicherte Preise, nichts wird neu gerechnet. Der Menü-Aufpreis
 * der Komponenten fehlt bewusst: Die gespeicherte Zeile trägt keinen, und aus der aktuellen Standort-Konfiguration
 * würde er für alte Bestellungen falsch (core#1235).
 */
export function buildHistoryLineVm(item: OrderLineItem): HistoryLineVm {
  // `components[]` gibt die Historie nicht aus — deren Modifier bleiben am Hauptartikel statt zu verschwinden.
  const groups = groupModifiersByComponent(item, { components: false })
  const vm = (list: ModifierLineItem[]) => list.map(extra => modifierVm(item, extra))
  return {
    item,
    modifiers: vm(groups.main),
    sideDishModifiers: vm(groups.sideDish),
    drinkModifiers: vm(groups.drink),
  }
}
