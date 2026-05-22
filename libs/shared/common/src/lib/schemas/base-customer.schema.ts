import { Type } from '@feathersjs/typebox'
import { addressSchema } from './address.schema'
import { baseSchema } from './base.schema'

export const baseCustomerSchema = {
  ...baseSchema,

  address: addressSchema, // Adresse

  phone: Type.Optional(Type.String({ maxLength: 40 })), // Telefonnummer
  email: Type.Union([Type.String({ format: 'email', maxLength: 254 }), Type.Null()]), // E-Mail-Adresse

  languagePreference: Type.Optional(Type.String({ maxLength: 10 })), // Falls wir Kunden in verschiedenen Sprachen ansprechen wollen
  notes: Type.Optional(Type.String({ maxLength: 2000 })), // Allgemeine Notizen zum Kunden, z. B. für Kundensupport.
  status: Type.Optional(Type.String({ maxLength: 32 })), // Zum Beispiel, ob der Kunde aktiv, gesperrt, gekündigt etc. ist.

  // Falls wir später noch Felder für Zustimmung zu AGB, Datenschutz, usw. brauchen:
  // termsAccepted?: boolean
  // privacyPolicyAccepted?: boolean
}
