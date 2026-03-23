import { Id } from '@feathersjs/feathers'

// TODO: Nach vollständiger Domain-Migration aus @panary-core/working-times/domain re-exportieren
export interface WorkingTime {
  _id: string
  tenantId: string
  locationId: string
  createdAt?: string
  updatedAt?: string

  userId: Id
  businessDay?: string

  breaks: Array<{ from: Date; to?: Date }>

  checkinDate: string
  checkoutDate?: string

  originCheckinDate?: string
  originCheckoutDate?: string

  updatedBy?: string
}
