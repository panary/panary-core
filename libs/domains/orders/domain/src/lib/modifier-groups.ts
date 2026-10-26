import type { LineComponent, ModifierLineItem, OrderLineItem } from './order.schema'

/** Modifier einer Bundle-Komponente aus `components[]`, die weder Beilage noch Getränk ist. */
export interface ComponentModifierGroup {
  component: LineComponent
  modifiers: ModifierLineItem[]
}

/**
 * Modifier einer Zeile, gruppiert nach der Stelle, unter der sie stehen (panary/panary-core#1127).
 * Jeder Modifier landet in genau einer Gruppe, die Reihenfolge innerhalb einer Gruppe ist die der Zeile.
 */
export interface LineModifierGroups {
  /** Ohne `componentExternalId` oder mit einer Referenz, die die Zeile nicht auflöst. */
  main: ModifierLineItem[]
  sideDish: ModifierLineItem[]
  drink: ModifierLineItem[]
  /** Nur Komponenten mit mindestens einem Modifier, in der Reihenfolge von `components[]`. */
  components: ComponentModifierGroup[]
}

export interface GroupModifiersOptions {
  /**
   * `false`: Modifier einer reinen `components[]`-Komponente zählen zum Hauptartikel. Für Leser, die
   * `components[]` nicht ausgeben (POS-Karte, Druck) — sonst verschwänden diese Modifier still.
   */
  components?: boolean
}

/**
 * Ordnet die Modifier einer Zeile ihrer Menü-Komponente zu, über `componentExternalId`.
 *
 * Aufgelöst wird in dieser Reihenfolge: Beilage (`menuSideDish`), Getränk (`menuDrink`), dann ein
 * `components[]`-Eintrag außer dem Hauptgericht (`role: 'main'`). Ein FIXED_PROPORTIONAL-Menü trägt
 * Beilage und Getränk in beiden Wegen mit derselben `externalId`; sie landen deshalb bei Beilage bzw.
 * Getränk. Eine Referenz, die die Zeile nicht kennt, fällt auf den Hauptartikel zurück — so sehen
 * Bestandsbestellungen ohne das Feld aus wie vorher.
 *
 * Reine Anzeige: Preis, Steuer und Verbrauch rechnen weiter über alle Modifier der Zeile.
 */
export function groupModifiersByComponent(
  line: Pick<OrderLineItem, 'modifiers' | 'menuSideDish' | 'menuDrink' | 'components'>,
  options: GroupModifiersOptions = {},
): LineModifierGroups {
  const withComponents = options.components ?? true
  const groups: LineModifierGroups = { main: [], sideDish: [], drink: [], components: [] }
  const sideId = line.menuSideDish?.externalId || null
  const drinkId = line.menuDrink?.externalId || null
  const byComponent = new Map<string, ModifierLineItem[]>()
  const components = (line.components ?? []).filter(c => c.role !== 'main' && c.externalId)

  for (const mod of line.modifiers ?? []) {
    const ref = mod.componentExternalId
    if (!ref) groups.main.push(mod)
    else if (ref === sideId) groups.sideDish.push(mod)
    else if (ref === drinkId) groups.drink.push(mod)
    else if (withComponents && components.some(c => c.externalId === ref)) {
      byComponent.set(ref, [...(byComponent.get(ref) ?? []), mod])
    } else groups.main.push(mod)
  }

  for (const component of components) {
    const modifiers = byComponent.get(component.externalId)
    if (!modifiers) continue
    groups.components.push({ component, modifiers })
    // Gleiche Komponente zweimal in `components[]`: die Modifier stehen unter der ersten.
    byComponent.delete(component.externalId)
  }
  return groups
}

/** Trägt mindestens ein Modifier eine aufgelöste Komponenten-Zuordnung? Sonst bleibt die Bestandsdarstellung. */
export function hasComponentModifiers(groups: LineModifierGroups): boolean {
  return groups.sideDish.length > 0 || groups.drink.length > 0 || groups.components.length > 0
}
