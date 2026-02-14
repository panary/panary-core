import { Type } from '@feathersjs/typebox'

export const addressSchema = Type.Object({
  address1: Type.String(), // z. B. Straßenname + Hausnummer
  address2: Type.Optional(Type.String()), // Zusatz (z. B. Gebäude, Stockwerk, Apartment)
  city: Type.String(),
  zipCode: Type.String(),
  country: Type.Optional(Type.String()), // z. B. "DE"
  countryCode: Type.Optional(Type.String()), // ISO-Code
  countryName: Type.Optional(Type.String()), // "Deutschland"
  province: Type.Optional(Type.String()), // Bundesland
  state: Type.Optional(Type.String()), // Im Deutschen oft synonym zu province
})
