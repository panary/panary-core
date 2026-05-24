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
  const data = context.data as Order

  if (!id) {
    return
  }

  const order = await context.app.service('orders').get(id)
  if (order && data.discount) {
    order.discount = data.discount
    context.data.taxSnapshot = computeOrderTax(order)
  }
}
