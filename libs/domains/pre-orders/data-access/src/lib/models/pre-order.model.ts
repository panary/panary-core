import type { OrderLineItem } from '@panary-core/orders/data-access'

export interface PreOrder {
  _id: string
  tenantId: string
  locationId: string
  createdAt?: string
  updatedAt?: string

  scheduledFor: string // ISO Date
  status: 'pending' | 'converted' | 'cancelled'

  customerContact: {
    name: string
    phone: string
  }

  lineItems: OrderLineItem[]

  note?: string
  metadata?: unknown
  convertedOrderId?: string
}
