import { Type } from '@feathersjs/typebox'
import { addressSchema } from './address.schema'
import { baseSchema } from './base.schema'

export const baseCustomerSchema = {
  ...baseSchema,

  address: addressSchema, // Adresse

  phone: Type.Optional(Type.String()), // Telefonnummer
  email: Type.Union([Type.String(), Type.Null()]), // E-Mail-Adresse

  languagePreference: Type.Optional(Type.String()), // Falls wir Kunden in verschiedenen Sprachen ansprechen wollen
  notes: Type.Optional(Type.String()), // Allgemeine Notizen zum Kunden, z. B. für Kundensupport.
  status: Type.Optional(Type.String()), // Zum Beispiel, ob der Kunde aktiv, gesperrt, gekündigt etc. ist.

  // Falls wir später noch Felder für Zustimmung zu AGB, Datenschutz, usw. brauchen:
  // termsAccepted?: boolean
  // privacyPolicyAccepted?: boolean
}
