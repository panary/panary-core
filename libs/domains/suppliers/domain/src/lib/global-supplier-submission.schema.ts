import { Static, StringEnum, Type } from '@feathersjs/typebox'

import { supplierAddressSchema, supplierTypeSchema } from './supplier.schema'
import { supplierIndustrySchema } from './global-supplier.schema'

/**
 * Workflow-Status einer Crowd-Submission.
 *
 *   PENDING   — eingereicht, wartet auf Plattform-Review
 *   APPROVED  — Reviewer hat Aufnahme bestaetigt; ein neuer GlobalSupplier
 *               ist daraus entstanden (Verlinkung optional)
 *   REJECTED  — Reviewer hat abgelehnt (z.B. fake oder unklarer Bezug)
 *   MERGED    — Reviewer hat erkannt, dass der vorgeschlagene Lieferant
 *               bereits im Katalog ist; `mergedIntoId` zeigt auf den
 *               existierenden GlobalSupplier
 */
export const GLOBAL_SUPPLIER_SUBMISSION_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'MERGED',
] as const
export const globalSupplierSubmissionStatusSchema = StringEnum([
  ...GLOBAL_SUPPLIER_SUBMISSION_STATUSES,
])
export type GlobalSupplierSubmissionStatus = (typeof GLOBAL_SUPPLIER_SUBMISSION_STATUSES)[number]

/**
 * Vorgeschlagene Lieferantendaten — ohne `_id`/`verifiedAt`/`verifiedBy`/
 * `usageCount` (das setzt erst der Plattform-User beim Approve).
 */
export const globalSupplierSubmissionProposedSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  displayName: Type.Optional(Type.String({ maxLength: 200 })),
  type: supplierTypeSchema,
  country: Type.String({ pattern: '^[A-Z]{2}$' }),
  industries: Type.Array(supplierIndustrySchema),
  gln: Type.Optional(Type.String({ pattern: '^[0-9]{13}$' })),
  websiteUrl: Type.Optional(Type.String({ format: 'uri' })),
  // Stammdaten — Tenant darf vorschlagen, Plattform-Reviewer kann beim
  // Approve in den finalen GlobalSupplier uebernehmen.
  address: Type.Optional(supplierAddressSchema),
  contactEmail: Type.Optional(Type.String({ format: 'email' })),
  phone: Type.Optional(Type.String({ maxLength: 64 })),
})
export type GlobalSupplierSubmissionProposed = Static<typeof globalSupplierSubmissionProposedSchema>

/**
 * Crowd-Vorschlag fuer einen neuen Eintrag im globalen Lieferanten-Katalog.
 * Wird von Tenant-Usern (`MANAGER` / `OWNER` / `TECHNICIAN`) erstellt und
 * von Plattform-Usern reviewed (Phase 2.2).
 *
 * Tenant-User sehen nur ihre eigenen Submissions (filtered nach
 * `submittedByTenantId` per Service-Hook). Plattform-User sehen alles.
 */
export const globalSupplierSubmissionSchema = Type.Object(
  {
    _id: Type.String(),
    /** Tenant, von dem der Vorschlag kommt — fuer Audit + Tenant-Filter. */
    submittedByTenantId: Type.String(),
    /** User-ID des Einreichenden (Tenant-Manager/Owner). */
    submittedByUserId: Type.String(),
    /** Vorgeschlagene Lieferantendaten. */
    proposed: globalSupplierSubmissionProposedSchema,
    status: globalSupplierSubmissionStatusSchema,
    /** Wenn `MERGED`: Referenz auf bestehenden GlobalSupplier. */
    mergedIntoId: Type.Optional(Type.String()),
    /** Optionaler Reviewer-Kommentar (z.B. „abgelehnt: Duplikat von X"). */
    reviewerNote: Type.Optional(Type.String({ maxLength: 1000 })),
    /** `_id` des Plattform-Users, der reviewed hat. */
    reviewedBy: Type.Optional(Type.String()),
    reviewedAt: Type.Optional(Type.String({ format: 'date-time' })),
    createdAt: Type.Optional(Type.String({ format: 'date-time' })),
    updatedAt: Type.Optional(Type.String({ format: 'date-time' })),
  },
  { $id: 'GlobalSupplierSubmission' },
)
export type GlobalSupplierSubmission = Static<typeof globalSupplierSubmissionSchema>
