import { HookContext } from '@feathersjs/feathers'
import { uuidv7 } from 'uuidv7'
import { AppliedDiscount, computeOrderTax, Order, toCents } from '@panary/orders/domain'
import {
  Discount,
  DiscountContext,
  evaluateAutomaticDiscounts,
  resolveDiscountAmountCents,
} from '@panary/discounts/domain'

// Wertet automatische Rabatte (method=automatic) gegen die Order aus und injiziert
// den günstigsten passenden als `order.appliedDiscounts` — VOR `calculateTaxDetails`,
// damit die Engine ihn berücksichtigt.
//
// Kombinationsregel (Phase 2, konservativ):
//   - Greift nur, wenn KEIN manueller Rabatt gesetzt ist (appliedDiscounts/discount leer).
//   - Es wird höchstens EIN Automatik-Rabatt angewandt (der für den Kunden günstigste) —
//     kein Stacking.
//
// Geltungsbereich am Order-Level (Phase-2-Vereinfachung): PRODUCTS matcht über
// lineItem.externalId; CATEGORIES matcht über lineItem.productGroupExternalId
// (Produktgruppe ≈ Kategorie am POS). Feineres Category-Mapping → UAT/Folgeschritt.

function buildContext(order: Order): DiscountContext {
  const grossCents = toCents(computeOrderTax(order).brutto)
  const itemCount = order.lineItems.reduce((sum, li) => sum + (li.amount || 0), 0)
  const productExternalIds = order.lineItems.map(li => li.externalId).filter(Boolean)
  const categoryIds = order.lineItems
    .map(li => (li as { productGroupExternalId?: string }).productGroupExternalId)
    .filter((v): v is string => !!v)
  return {
    channel: order.orderChannel,
    now: new Date(),
    orderGrossCents: grossCents,
    itemCount,
    customerId: order.customerPaymentInfo?.customerId ?? null,
    productExternalIds,
    categoryIds,
  }
}

function toAppliedDiscount(d: Discount): AppliedDiscount {
  return {
    _id: uuidv7(),
    discountId: d._id,
    name: d.name,
    method: 'automatic',
    target: 'order',
    valueType: d.valueType,
    valuePercent: d.valueType === 'percent' ? d.valuePercent : 0,
    valueCents: d.valueType === 'amount' ? d.valueCents : 0,
    computedAmountCents: 0,
    appliedAt: new Date().toISOString(),
    isStaffMeal: d.isStaffMeal,
  }
}

export const applyAutomaticDiscounts = async (context: HookContext) => {
  const order = context.data as Order
  if (!order || !Array.isArray(order.lineItems) || order.lineItems.length === 0) return context

  // Kombinationsregel: Automatik nur ohne bestehenden (manuellen) Rabatt.
  if ((order.appliedDiscounts && order.appliedDiscounts.length > 0) || order.discount) return context

  const tenantId = (order as { tenantId?: string }).tenantId ?? context.params?.user?.tenantId
  if (!tenantId) return context

  // Interner Call → multiTenancy bypassed → tenant explizit scopen (Defense-in-Depth).
  const res = await context.app.service('discounts').find({
    paginate: false,
    query: { tenantId, method: 'automatic', status: 'ACTIVE', $limit: 200 },
  } as never)
  const all = (Array.isArray(res) ? res : (res as { data?: Discount[] }).data) as Discount[] | undefined
  if (!all || all.length === 0) return context

  const locationId = (order as { locationId?: string | null }).locationId ?? null
  const candidates = all.filter(d => d.locationId == null || d.locationId === locationId)
  if (candidates.length === 0) return context

  const ctx = buildContext(order)
  const applicable = evaluateAutomaticDiscounts(candidates, ctx)
  if (applicable.length === 0) return context

  // Günstigsten (höchster Abzug) wählen — kein Stacking.
  const gross = ctx.orderGrossCents ?? 0
  let best: Discount | null = null
  let bestAmount = -1
  for (const d of applicable) {
    const amt = resolveDiscountAmountCents(d, gross)
    if (amt > bestAmount) {
      best = d
      bestAmount = amt
    }
  }
  if (!best || bestAmount <= 0) return context

  order.appliedDiscounts = [toAppliedDiscount(best)]
  return context
}
