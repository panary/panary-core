import { Type } from '@feathersjs/typebox'

export const baseSchema = {
  _id: Type.String({ format: 'uuid' }), // Database ID (optional)

  createdAt: Type.Optional(Type.String({ format: 'date-time' })), // Creation date
  updatedAt: Type.Optional(Type.String({ format: 'date-time' })), // Change date

  locationId: Type.String({ format: 'uuid' }), // Location affiliation
  tenantId: Type.String({ format: 'uuid' }), // Organizational affiliation
}
