import { AppliedDiscount, StaffPaymentInfo } from '../order.schema'

// Invariante „Personalessen ist rabatt-exklusiv".
//
// Ist eine Bestellung als Personalessen erfasst (`staffPaymentInfo` gesetzt), traegt
// sie genau den zugewiesenen Personalessen-Rabatt — und sonst keinen. Ohne diese
// Regel liessen sich Rabatte stapeln (100 % Personalessen + 20 % Stammgast) und die
// Subventions-Auswertung im Tagesabschluss waere nicht mehr interpretierbar:
// `meal-subsidies.ts` rechnet den Differenzbetrag als Arbeitgeber-Zuschuss, kann aber
// nicht unterscheiden, welcher Anteil aus welchem Rabatt stammt.
//
// AUSSERHALB von Personalessen bleibt alles unveraendert — Gutscheine, Kulanz und
// Stammgast-Nachlaesse sind normal kombinierbar (Regeln dort: `combinable` am
// Discount). Diese Invariante greift ausschliesslich bei gesetztem `staffPaymentInfo`.
//
// Bewusst als Pure Function in der Domain-Lib: Der Edge-Hook erzwingt sie
// serverseitig, der POS-Bestelldialog nutzt dieselbe Quelle, um den Rabatt-Picker
// zu sperren — keine zwei divergierenden Regel-Implementierungen.

export interface StaffMealExclusivityInput {
  staffPaymentInfo?: StaffPaymentInfo | null
  appliedDiscounts?: AppliedDiscount[] | null
}

/**
 * Liefert eine Fehlerbeschreibung, wenn die Rabatt-Zusammenstellung der Invariante
 * widerspricht — sonst `null`. Nicht-werfend, damit UI-Code den Zustand abfragen
 * kann, ohne try/catch zu bauen.
 */
export function findStaffMealDiscountConflict(order: StaffMealExclusivityInput): string | null {
  if (!order.staffPaymentInfo) return null

  const discounts = Array.isArray(order.appliedDiscounts) ? order.appliedDiscounts : []
  if (discounts.length === 0) return null

  const foreign = discounts.filter(d => !d.isStaffMeal)
  if (foreign.length > 0) {
    const names = foreign.map(d => d.name).join(', ')
    return `Personalessen-Bestellungen erlauben keine zusaetzlichen Rabatte (gefunden: ${names}).`
  }

  const staffMeals = discounts.filter(d => d.isStaffMeal)
  if (staffMeals.length > 1) {
    return `Personalessen-Bestellungen erlauben genau einen Personalessen-Rabatt (gefunden: ${staffMeals.length}).`
  }

  return null
}

/** Werfende Variante fuer Server-Hooks. Wirft `Error` mit sprechender Meldung. */
export function assertStaffMealDiscountExclusivity(order: StaffMealExclusivityInput): void {
  const conflict = findStaffMealDiscountConflict(order)
  if (conflict) throw new Error(conflict)
}
