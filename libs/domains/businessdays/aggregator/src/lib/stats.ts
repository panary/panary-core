import { Order, OrderLineItem } from '@panary-core/orders/domain'
import { isRegularSale } from './classifications'
import { getOrderGrossCents } from './order-total'
import { toCents, multiplyCents } from './money'

export interface UserSalesEntry {
  userId: string
  userName: string
  salesCents: number
  orderCount: number
}

export interface ProductGroupSalesEntry {
  groupId: string                // productGroupExternalId
  salesCents: number
  quantity: number
}

export interface TopProductEntry {
  productExternalId: string
  productName: string
  quantity: number
  revenueCents: number
}

export interface HourlySalesEntry {
  hour: number                   // 0..23
  salesCents: number
  orderCount: number
}

export interface StatsAggregate {
  orderCount: number             // Bonzahl (alle regulären Verkäufe)
  averageOrderValueCents: number
  salesByUser: UserSalesEntry[]
  salesByProductGroup: ProductGroupSalesEntry[]
  topProducts: TopProductEntry[]
  salesByHour: HourlySalesEntry[]
}

const ZERO_STATS: StatsAggregate = Object.freeze({
  orderCount: 0,
  averageOrderValueCents: 0,
  salesByUser: [],
  salesByProductGroup: [],
  topProducts: [],
  salesByHour: [],
})

const TOP_PRODUCTS_LIMIT = 10

/**
 * Aggregiert KPIs für das Stats-Panel des Tagesabschluss-Reports.
 *
 * Nur reguläre Verkäufe (keine Stornos, keine Refunds, keine Subsidies)
 * fließen in Bonzahl, AOV, Bestseller-Listen.
 */
export function computeStats(orders: ReadonlyArray<Order>): StatsAggregate {
  if (orders.length === 0) return { ...ZERO_STATS, salesByUser: [], salesByProductGroup: [], topProducts: [], salesByHour: [] }

  const regular = orders.filter(isRegularSale)
  if (regular.length === 0) {
    return { ...ZERO_STATS, salesByUser: [], salesByProductGroup: [], topProducts: [], salesByHour: [] }
  }

  let totalGrossCents = 0
  const userMap = new Map<string, UserSalesEntry>()
  const groupMap = new Map<string, ProductGroupSalesEntry>()
  const productMap = new Map<string, TopProductEntry>()
  const hourMap = new Map<number, HourlySalesEntry>()

  for (const order of regular) {
    const grossCents = getOrderGrossCents(order)
    totalGrossCents += grossCents

    // Personalumsatz (createdBy aus creationContext)
    const userId = order.creationContext?.createdBy
    if (userId) {
      const entry = userMap.get(userId) ?? { userId, userName: '', salesCents: 0, orderCount: 0 }
      entry.salesCents += grossCents
      entry.orderCount++
      userMap.set(userId, entry)
    }

    // Produkt- und Warengruppen-Aggregation
    for (const item of order.lineItems ?? []) {
      accumulateProduct(productMap, item)
      accumulateProductGroup(groupMap, item)
    }

    // Stundenumsatz (recordingDate-Stunde)
    const hour = new Date(order.recordingDate).getHours()
    const hourEntry = hourMap.get(hour) ?? { hour, salesCents: 0, orderCount: 0 }
    hourEntry.salesCents += grossCents
    hourEntry.orderCount++
    hourMap.set(hour, hourEntry)
  }

  const orderCount = regular.length
  const averageOrderValueCents = Math.round(totalGrossCents / orderCount)

  return {
    orderCount,
    averageOrderValueCents,
    salesByUser: [...userMap.values()].sort((a, b) => b.salesCents - a.salesCents),
    salesByProductGroup: [...groupMap.values()].sort((a, b) => b.salesCents - a.salesCents),
    topProducts: [...productMap.values()]
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, TOP_PRODUCTS_LIMIT),
    salesByHour: [...hourMap.values()].sort((a, b) => a.hour - b.hour),
  }
}

function accumulateProduct(map: Map<string, TopProductEntry>, item: OrderLineItem): void {
  const externalId = item.externalId
  if (!externalId) return
  const entry = map.get(externalId) ?? {
    productExternalId: externalId,
    productName: item.name,
    quantity: 0,
    revenueCents: 0,
  }
  entry.quantity += item.amount
  entry.revenueCents += multiplyCents(toCents(item.price), item.amount)
  map.set(externalId, entry)
}

function accumulateProductGroup(map: Map<string, ProductGroupSalesEntry>, item: OrderLineItem): void {
  const groupId = item.productGroupExternalId
  if (!groupId) return
  const entry = map.get(groupId) ?? { groupId, salesCents: 0, quantity: 0 }
  entry.quantity += item.amount
  entry.salesCents += multiplyCents(toCents(item.price), item.amount)
  map.set(groupId, entry)
}
