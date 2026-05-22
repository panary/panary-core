import { Type } from '@feathersjs/typebox'

export const addressSchema = Type.Object({
  address1: Type.String({ maxLength: 200 }), // z. B. Straßenname + Hausnummer
  address2: Type.Optional(Type.String({ maxLength: 200 })), // Zusatz (z. B. Gebäude, Stockwerk, Apartment)
  city: Type.String({ maxLength: 100 }),
  zipCode: Type.String({ maxLength: 20 }),
  country: Type.Optional(Type.String({ pattern: '^[A-Z]{2}$' })), // z. B. "DE"
  countryCode: Type.Optional(Type.String({ pattern: '^[A-Z]{2,3}$' })), // ISO-Code
  countryName: Type.Optional(Type.String({ maxLength: 100 })), // "Deutschland"
  province: Type.Optional(Type.String({ maxLength: 100 })), // Bundesland
  state: Type.Optional(Type.String({ maxLength: 100 })), // Im Deutschen oft synonym zu province
})
