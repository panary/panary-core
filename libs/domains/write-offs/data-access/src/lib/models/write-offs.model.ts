import { Id } from '@feathersjs/feathers'

export enum WriteOffReason {
  WASTE = 'waste',
  PROMO = 'promo',
  EMPLOYEE_MEAL = 'employee_meal',
  TRANSFER = 'transfer',
  THEFT = 'theft',
  QUALITY_CHECK = 'quality_check',
  MISTAKE = 'mistake',
  SAMPLE = 'sample',
}

export enum WasteType {
  RAW = 'raw',
  FINISHED = 'finished',
}

export enum WriteOffItemType {
  INGREDIENT = 'ingredient',
  PRODUCT = 'product',
  RECIPE = 'recipe',
}

export interface WriteOff {
  _id: string
  tenantId: string
  locationId: string
  createdAt?: string
  updatedAt?: string

  businessDayId: string

  // Polymorphic Item Reference
  itemType: WriteOffItemType
  itemId: Id
  itemName: string
  itemVersion: number

  // Quantities & Value
  quantity: number
  unit: string
  costPerUnit: number
  totalCost: number

  // Classification
  reason: WriteOffReason
  wasteType?: WasteType

  // Meta
  userId: string
  comment?: string
}
