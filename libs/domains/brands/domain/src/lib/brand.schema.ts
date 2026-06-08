import type { Static } from '@feathersjs/typebox'
import { querySyntax, Type } from '@feathersjs/typebox'

//#region Sub-Aggregat: branding (Fallback auf Tenant-Branding)
// Brand-Branding ist optional. Wenn nicht gesetzt, fällt die Storefront auf
// Tenant-Branding zurück (siehe D-02 / Phase-6-CONTEXT „Brand-Logo-Hierarchie").
// `primaryColor` 6-stelliges Hex-Pattern wie bei Tenant-Branding.
export const brandBrandingSchema = Type.Object(
  {
    // KEIN format:'uri' — nicht im TypeBox-FormatRegistry registriert (Phase-02-
    // Konvention: format aus Schemas entfernt, vgl. STATE.md). URL-Constraint
    // via maxLength + serverseitige Validierung im Brand-Service-Resolver.
    logoUrl: Type.Optional(Type.String({ maxLength: 2000, description: 'absolute URL (https://…)' })),
    primaryColor: Type.Optional(Type.String({ pattern: '^#[0-9a-fA-F]{6}$' })),
  },
  { $id: 'BrandBranding', additionalProperties: false },
)
export type BrandBranding = Static<typeof brandBrandingSchema>
//#endregion

//#region Brand Haupt-Schema
// Dedizierte Brand-Entity (D-01) — NICHT parentTenantId umgezweckt.
// `tenantId` = Owner-Tenant; 1 Tenant kann N Brands haben.
// `handle` = URL-Slug, unique pro Tenant (D-18). Pflicht für Subdomain-Routing
// `<location-handle>.<brand-handle>.<tld>` (D-14 / BRAND-03).
// `customDomains` Default [] — Phase 7 nutzt das Feld, V1 bleibt leer.
export const brandSchema = Type.Object(
  {
    _id: Type.String({ description: 'uuidv7' }),
    tenantId: Type.String({ description: 'uuidv7 — Owner-Tenant; 1 Tenant kann N Brands haben' }),
    name: Type.String({ minLength: 1, maxLength: 200 }),
    handle: Type.String({
      minLength: 1,
      maxLength: 60,
      pattern: '^[a-z0-9-]+$',
      description: 'URL-Slug; unique pro tenantId (D-18). Slugify(name) als Default.',
    }),
    branding: Type.Optional(brandBrandingSchema),
    customDomains: Type.Array(Type.String({ maxLength: 253 }), {
      default: [],
      maxItems: 20,
      description: 'Phase 7 DOM-01 — V1 bleibt leer (Wildcard-Subdomain nutzen).',
    }),
    createdAt: Type.String({ description: 'ISO 8601' }),
    updatedAt: Type.String({ description: 'ISO 8601' }),
  },
  { $id: 'Brand', additionalProperties: false },
)
export type Brand = Static<typeof brandSchema>
//#endregion

//#region Create / Patch / Query
export const brandDataSchema = Type.Omit(brandSchema, ['_id', 'createdAt', 'updatedAt'], {
  $id: 'BrandData',
  additionalProperties: false,
})
export type BrandData = Static<typeof brandDataSchema>

export const brandPatchSchema = Type.Partial(brandSchema, {
  $id: 'BrandPatch',
  additionalProperties: false,
})
export type BrandPatch = Static<typeof brandPatchSchema>

export const brandQueryProperties = Type.Pick(brandSchema, ['_id', 'tenantId', 'handle', 'name'])
export const brandQuerySchema = Type.Intersect(
  [querySyntax(brandQueryProperties), Type.Object({}, { additionalProperties: false })],
  { additionalProperties: false },
)
export type BrandQuery = Static<typeof brandQuerySchema>
//#endregion
