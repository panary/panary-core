import { Type, Static } from '@feathersjs/typebox'

export const businessDaySchema = Type.Object({
  _id: Type.String(),
  tenantId: Type.String(),
  locationId: Type.Union([Type.String(), Type.Null()]),
  openedAt: Type.String(),
  closedAt: Type.Union([Type.String(), Type.Null()]),
  isOpen: Type.Boolean(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
})

export type BusinessDay = Static<typeof businessDaySchema>
export type BusinessDaySchema = BusinessDay
