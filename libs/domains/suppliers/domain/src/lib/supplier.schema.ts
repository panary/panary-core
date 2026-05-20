import { Static, StringEnum, Type } from '@feathersjs/typebox'

export const SUPPLIER_STATUSES = ['ACTIVE', 'DRAFT', 'ARCHIVED'] as const
export const supplierStatusSchema = StringEnum([...SUPPLIER_STATUSES])
export type SupplierStatus = (typeof SUPPLIER_STATUSES)[number]

/**
 * Lieferanten-Klassifikation:
 *   WHOLESALE — Großhandel mit Liefer-/Rechnungsbeziehung (Metro, Handelshof, Brauereien)
 *   RETAIL    — Einzelhandel mit Beleg, typisch Spontankauf vor Ort (Rewe, Edeka, Aldi)
 *   OTHER     — alles andere (Privatperson, gelegentliche Aushilfe, „Sonstige"-Sammler)
 *
 * Optional in der Persistenz — bestehende Datensätze sind weiter gültig;
 * UI behandelt unbekannte/leere Werte als OTHER-Fallback.
 */
export const SUPPLIER_TYPES = ['WHOLESALE', 'RETAIL', 'OTHER'] as const
export const supplierTypeSchema = StringEnum([...SUPPLIER_TYPES])
export type SupplierType = (typeof SUPPLIER_TYPES)[number]

export const supplierAddressSchema = Type.Object(
  {
    street: Type.Optional(Type.String({ maxLength: 255 })),
    postalCode: Type.Optional(Type.String({ maxLength: 20 })),
    city: Type.Optional(Type.String({ maxLength: 120 })),
    country: Type.Optional(Type.String({ maxLength: 120 })),
  },
  { $id: 'SupplierAddress' },
)
export type SupplierAddress = Static<typeof supplierAddressSchema>

export const supplierSchema = Type.Object(
  {
    _id: Type.String(),
    name: Type.String({ minLength: 1, maxLength: 200 }),
    displayName: Type.Optional(Type.String({ maxLength: 200 })),
    /** GS1 Global Location Number — 13 Ziffern. */
    gln: Type.Optional(Type.String({ pattern: '^[0-9]{13}$' })),
    contactEmail: Type.Optional(Type.String({ format: 'email' })),
    phone: Type.Optional(Type.String({ maxLength: 64 })),
    address: Type.Optional(supplierAddressSchema),
    notes: Type.Optional(Type.String({ maxLength: 2000 })),
    status: Type.Optional(supplierStatusSchema),
    type: Type.Optional(supplierTypeSchema),
    /**
     * Optionale Verlinkung zu einem Eintrag im globalen Lieferanten-Katalog
     * (`@panary/suppliers/domain` → `globalSupplierSchema`). Wenn gesetzt:
     *   - Stammdaten wurden initial vom globalen Eintrag kopiert
     *   - Tenant kann lokal überschreiben (Notizen, abweichende Adresse für die Filiale)
     *   - Sync-Button in der Detail-Seite kopiert nicht-veraenderte Felder erneut
     */
    globalSupplierId: Type.Optional(Type.String()),
    tenantId: Type.String(),
    locationId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    createdAt: Type.Optional(Type.String({ format: 'date-time' })),
    updatedAt: Type.Optional(Type.String({ format: 'date-time' })),
  },
  { $id: 'Supplier' },
)
export type Supplier = Static<typeof supplierSchema>
