import { HookContext } from '@feathersjs/feathers'
import { computeOrderTax, Order } from '@panary/orders/domain'

// Steuer-/Rabatt-Berechnung delegiert vollständig an die kanonische Engine
// `computeOrderTax` in `@panary/orders/domain` (Single Source of Truth, cents-intern,
// fiskalisch korrekte MwSt-Extraktion). Frühere lokale Duplikat-Logik entfernt.

export const calculateTaxDetails = async (context: HookContext) => {
  const order = context.data as Order
  context.data.taxSnapshot = computeOrderTax(order)
}

export const calculateTaxDetailsOnPatch = async (context: HookContext) => {
  const id = context.id
  const data = context.data as Partial<Order>

  if (!id) {
    return
  }

  // Preisrelevante Engine-Inputs, die per Patch erreichbar sind (`lineItems`
  // blockt der orderPatchResolver): Rabatte + dine-in/take-out (19 % vs. 7 %)
  // + die Split-Gegenbuchungen (panary/panary-core#349).
  // `undefined`-Check statt Truthiness — auch das ENTFERNEN aller Rabatte
  // (`appliedDiscounts: []`) muss den fiskalischen Snapshot neu berechnen.
  //
  // 🚨 `splitOff` MUSS hier stehen. Die Engine liest ueber `effectiveLineItems()`
  // nur noch, was der Vorgang wirklich traegt; faende der Hook die neue
  // Gegenbuchung nicht, rechnete er auf dem Stand VOR dem Split und schriebe
  // der Quelle die volle Steuer zurueck — still, ohne Fehler, auf einem
  // steuerrelevanten Dokument.
  const priceRelevant =
    data.appliedDiscounts !== undefined || data.dineLocation !== undefined || data.splitOff !== undefined
  if (!priceRelevant) {
    return
  }

  const order = await context.app.service('orders').get(id)
  if (!order) {
    return
  }

  // Patch-Werte auf den gespeicherten Stand mergen — die Engine rechnet auf dem
  // Zielzustand.
  if (data.appliedDiscounts !== undefined) order.appliedDiscounts = data.appliedDiscounts
  if (data.dineLocation !== undefined) order.dineLocation = data.dineLocation
  if (data.splitOff !== undefined) order.splitOff = data.splitOff

  context.data.taxSnapshot = computeOrderTax(order)
}
