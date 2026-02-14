import { ObjectIdSchema, Type } from '@feathersjs/typebox'

export const baseSchema = {
  _id: ObjectIdSchema(), // Database ID (optional)

  createdAt: Type.Optional(Type.String({ format: 'date-time' })), // Creation date
  updatedAt: Type.Optional(Type.String({ format: 'date-time' })), // Change date

  locationId: ObjectIdSchema(), // Location affiliation
  tenantId: ObjectIdSchema(), // Organizational affiliation
}
