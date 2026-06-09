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

//#region Sub-Aggregat: customDomain (Phase 7 / DOM-01 + DOM-02, D-01..D-05/D-31)
// Strukturierter Lifecycle-State für eigene Domains pro Brand. Ersetzt den
// Phase-6-string[]-Stub durch ein Object-Array mit Status-Diskriminator.
//
// Backward-Kompat: V1-Brands haben `customDomains: []` (vom string[]-Default
// der Phase 6) — das passt weiterhin auf `Type.Array(customDomainSchema, {
// default: [] })`. Patch-Bump v26.7.0 → v26.7.1 ist additiv (D-03).
//
// Felder:
// - hostname: FQDN, lowercase, ohne Protokoll/Port/Trailing-Dot. Punycode
//   für IDN akzeptiert (xn--…). Phase-7-Pitfall-4-Schutz: striktes Regex.
// - status: pending → verified → active (Lifecycle D-04..D-07). failed nur
//   bei DNS-/Verifikations-Fehler. Storefront-Resolve matched ausschließlich
//   `status='active'` (D-08 Hijacking-Schutz).
// - verificationToken: uuidv7 (D-05) — opaque Secret für DNS-TXT-Match an
//   `_panary-verify.<hostname>`. NIE im Log/Response (D-31 Wide-Event-Regel).
// - verifiedAt/activatedAt/lastCheckAt: ISO 8601, optional (Lifecycle-Stage,
//   D-06/D-07).
// - failureReason: User-sichtbarer Fehlertext bei status='failed' (NXDOMAIN,
//   wrong-token, dns-error). maxLength 500 hält Storefront-UI lesbar.
export const customDomainSchema = Type.Object(
  {
    hostname: Type.String({
      minLength: 4,
      maxLength: 253,
      pattern: '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$',
      description: 'FQDN, lowercase, ohne Protokoll/Port. Punycode für IDN.',
    }),
    status: Type.Union(
      [
        Type.Literal('pending'),
        Type.Literal('verified'),
        Type.Literal('active'),
        Type.Literal('failed'),
      ],
      { default: 'pending' },
    ),
    verificationToken: Type.String({
      description: 'uuidv7 — opaque Secret für DNS-TXT-Match. NIE loggen.',
    }),
    verifiedAt: Type.Optional(Type.String({ description: 'ISO 8601 — Zeitpunkt der DNS-Verifikation (D-06)' })),
    activatedAt: Type.Optional(Type.String({ description: 'ISO 8601 — Zeitpunkt des ersten TLS-Cert (D-07)' })),
    lastCheckAt: Type.Optional(Type.String({ description: 'ISO 8601 — letzter DNS-Re-Check' })),
    failureReason: Type.Optional(Type.String({ maxLength: 500, description: 'Fehler-Text bei status=failed' })),
  },
  { $id: 'CustomDomain', additionalProperties: false },
)
export type CustomDomain = Static<typeof customDomainSchema>
//#endregion

//#region Brand Haupt-Schema
// Dedizierte Brand-Entity (D-01) — NICHT parentTenantId umgezweckt.
// `tenantId` = Owner-Tenant; 1 Tenant kann N Brands haben.
// `handle` = URL-Slug, unique pro Tenant (D-18). Pflicht für Subdomain-Routing
// `<location-handle>.<brand-handle>.<tld>` (D-14 / BRAND-03).
//
// Phase 7 (DOM-01/DOM-02, v26.7.1 — additive Patch-Erweiterung):
// - `customDomains` von `Type.Array(Type.String())` (Phase-6-Stub) zu
//   `Type.Array(customDomainSchema)` (strukturiert). V1-Bestand ist überall
//   leeres Array [] — Migration trivial (D-02).
// - `defaultLocationId` additiv optional — Custom-Domain-Routing-Default
//   (D-26, konsumiert in storefront-resolve D-17/D-20).
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
    customDomains: Type.Array(customDomainSchema, {
      default: [],
      maxItems: 20,
      description: 'Phase 7 DOM-01/DOM-02 — Lifecycle-Object-Array, max 20 pro Brand.',
    }),
    defaultLocationId: Type.Optional(
      Type.String({
        description: 'uuidv7 — Default-Location-Target für Custom-Domain-Routing (DOM-01 D-26).',
      }),
    ),
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
