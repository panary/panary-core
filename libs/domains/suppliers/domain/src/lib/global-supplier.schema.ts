import { Static, StringEnum, Type } from '@feathersjs/typebox'

import { supplierAddressSchema, supplierTypeSchema } from './supplier.schema'

/**
 * Branchen-Tag fuer den globalen Lieferanten-Katalog.
 *
 * Initial-Seed enthaelt nur Eintraege mit `gastronomy` oder `bakery`.
 * `retail`/`other` sind reserviert fuer spaetere Branchenerweiterungen
 * (z.B. wenn Panary Friseur, Einzelhandel oder generische B2B unterstuetzt).
 *
 * Schema-konform offen: weitere Werte koennen ohne Breaking Change ergaenzt
 * werden, sobald sie im Frontend-Filter relevant werden.
 */
export const SUPPLIER_INDUSTRIES = ['gastronomy', 'bakery', 'retail', 'other'] as const
export const supplierIndustrySchema = StringEnum([...SUPPLIER_INDUSTRIES])
export type SupplierIndustry = (typeof SUPPLIER_INDUSTRIES)[number]

/**
 * Globaler Lieferanten-Katalog — cross-tenant Master-Stammdaten, gepflegt
 * von Panary-Plattform-Usern. Tenants verlinken ihre lokalen `Supplier`-
 * Datensaetze ueber `Supplier.globalSupplierId` (Phase 2.1).
 *
 * Architektur-Sondersache: KEIN `tenantId`-Feld. Der zugehoerige Backend-
 * Service registriert mit `skipMultiTenancy: true` — alle authentifizierten
 * Tenant-User lesen, nur Plattform-Rollen schreiben (siehe RBAC-Matrix).
 */
export const globalSupplierSchema = Type.Object(
  {
    _id: Type.String(),
    name: Type.String({ minLength: 1, maxLength: 200 }),
    displayName: Type.Optional(Type.String({ maxLength: 200 })),
    /** Klassifikation aus `supplier.schema` — gleiche Werte wie tenant-lokal. */
    type: supplierTypeSchema,
    /** ISO-3166-1 Alpha-2. Pflicht fuer Default-Filter (`tenant.country`). */
    country: Type.String({ pattern: '^[A-Z]{2}$' }),
    /** Branchen-Tags — leere Liste = nicht eingeordnet. */
    industries: Type.Array(supplierIndustrySchema),
    /** GS1 Global Location Number — 13 Ziffern. */
    gln: Type.Optional(Type.String({ pattern: '^[0-9]{13}$' })),
    websiteUrl: Type.Optional(Type.String({ format: 'uri' })),

    /**
     * Plattform-gepflegte Stammdaten — werden beim Verlinken in den lokalen
     * `Supplier` als Default-Werte uebernommen. Tenants koennen sie lokal
     * ueberschreiben (z.B. Filial-Adresse statt Hauptanschrift).
     */
    address: Type.Optional(supplierAddressSchema),
    contactEmail: Type.Optional(Type.String({ format: 'email' })),
    phone: Type.Optional(Type.String({ maxLength: 64 })),

    /** Verifizierungs-Stand. Eintraege ohne Wert sind „pending verification". */
    verifiedAt: Type.Optional(Type.String({ format: 'date-time' })),
    /** `_id` des Plattform-Users, der die Verifizierung gemacht hat. */
    verifiedBy: Type.Optional(Type.String()),
    /**
     * Wieviele Tenants haben einen lokalen Supplier mit `globalSupplierId =
     * <this._id>` verknuepft. Wird per Hook beim `Supplier.create/patch`
     * inkrementiert (Phase 2.3). Diagnostisch + Sortier-Hilfe.
     */
    usageCount: Type.Optional(Type.Number({ default: 0 })),

    createdAt: Type.Optional(Type.String({ format: 'date-time' })),
    updatedAt: Type.Optional(Type.String({ format: 'date-time' })),
  },
  { $id: 'GlobalSupplier' },
)
export type GlobalSupplier = Static<typeof globalSupplierSchema>
