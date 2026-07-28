// Edge-Replica des Tenant-Docs (OoS-Welle E Item 4).
//
// Die Cloud liefert dem Edge NIE das volle Tenant-Doc — der Sync-Pull wendet
// die Allowlist-Projection `projectTenantForEdge` an (panary-cloud,
// apps/api-cloud/src/services/sync/projections/tenant-projection.ts). Dieses
// Schema beschreibt exakt diese projizierte Sicht: Receipt-Branding
// (Header/Footer/Logo fuer Offline-Bon-Druck), Localization, Rechtsperson-
// Stammdaten (Beleg-Footer) und kuratierte TSE-Referenzen (per-Tenant-
// Provider-Auswahl via `tseProviderFromTenant`). Stripe/Subscription/
// SecurityPolicy/Compliance/internalNotes bleiben Cloud-only und duerfen hier
// NIEMALS aufgenommen werden.
//
// Bewusst KEINE StringEnum-Kopplung an die Cloud-Enums (status/weekStart/
// tse.provider/...): Ein neuer Enum-Wert in der Cloud darf den Pull-Apply
// nicht terminal ablehnen — validateData wuerde sonst den ganzen Tenant-Record
// verwerfen (dieselbe Fehlerklasse wie der locations-Befund vom 2026-07-28).
// Deploy-Reihenfolge bei neuen Projektions-Feldern: erst dieses Schema am
// Edge erweitern, dann die Cloud-Projection.
import type { Static } from '@feathersjs/typebox'
import { querySyntax, Type } from '@feathersjs/typebox'

// Logo-Snapshot (OoS-Item-7): base64-BinData, damit POS-Belege offline mit
// Logo gedruckt werden koennen. Nur `data` + `contentType` sind Pflicht —
// Metadaten-Luecken aus Alt-Bestaenden duerfen den Pull nicht brechen.
export const edgeTenantLogoSchema = Type.Object(
  {
    data: Type.String({ minLength: 1, maxLength: 300_000 }),
    contentType: Type.String({ maxLength: 30 }),
    sizeBytes: Type.Optional(Type.Number({ minimum: 0 })),
    width: Type.Optional(Type.Number({ minimum: 0 })),
    height: Type.Optional(Type.Number({ minimum: 0 })),
    hash: Type.Optional(Type.String({ maxLength: 64 })),
    uploadedAt: Type.Optional(Type.String()),
    uploadedByUserId: Type.Optional(Type.String()),
  },
  { $id: 'EdgeTenantLogo', additionalProperties: false },
)
export type EdgeTenantLogo = Static<typeof edgeTenantLogoSchema>

export const edgeTenantBrandingSchema = Type.Object(
  {
    logo: Type.Optional(edgeTenantLogoSchema),
    primaryColor: Type.Optional(Type.String({ maxLength: 20 })),
    receiptHeader: Type.Optional(Type.String({ maxLength: 500 })),
    receiptFooter: Type.Optional(Type.String({ maxLength: 500 })),
  },
  { $id: 'EdgeTenantBranding', additionalProperties: false },
)
export type EdgeTenantBranding = Static<typeof edgeTenantBrandingSchema>

export const edgeTenantLocalizationSchema = Type.Object(
  {
    locale: Type.Optional(Type.String({ maxLength: 10 })),
    timezone: Type.Optional(Type.String({ maxLength: 60 })),
    weekStart: Type.Optional(Type.String({ maxLength: 10 })),
    currency: Type.Optional(Type.String({ maxLength: 3 })),
  },
  { $id: 'EdgeTenantLocalization', additionalProperties: false },
)
export type EdgeTenantLocalization = Static<typeof edgeTenantLocalizationSchema>

export const edgeTenantLegalEntitySchema = Type.Object(
  {
    registeredName: Type.Optional(Type.String({ maxLength: 200 })),
    legalForm: Type.Optional(Type.String({ maxLength: 50 })),
    vatId: Type.Optional(Type.String({ maxLength: 30 })),
    countryCode: Type.Optional(Type.String({ maxLength: 2 })),
  },
  { $id: 'EdgeTenantLegalEntity', additionalProperties: false },
)
export type EdgeTenantLegalEntity = Static<typeof edgeTenantLegalEntitySchema>

// Kuratierte TSE-Konfiguration — NUR Referenzen/IDs, NIE Klartext-Secrets.
// `apiKeyRef`/`apiSecretRef` sind BWS-Secret-IDs; die echten Secrets holt der
// Edge zur Laufzeit via BWS. Kontaktdaten/Notizen/Health bleiben Cloud-only.
export const edgeTenantTseSchema = Type.Object(
  {
    provider: Type.Optional(Type.String({ maxLength: 40 })),
    status: Type.Optional(Type.String({ maxLength: 40 })),
    entityType: Type.Optional(Type.String({ maxLength: 40 })),
    jurisdiction: Type.Optional(Type.String({ maxLength: 10 })),
    externalAccountId: Type.Optional(Type.String({ maxLength: 200 })),
    apiKeyRef: Type.Optional(Type.String({ maxLength: 200 })),
    apiSecretRef: Type.Optional(Type.String({ maxLength: 200 })),
    atSignatureUnitId: Type.Optional(Type.String({ maxLength: 100 })),
    atRegisterNumber: Type.Optional(Type.String({ maxLength: 100 })),
    belegausgabepflichtExempt: Type.Optional(Type.Boolean()),
  },
  { $id: 'EdgeTenantTse', additionalProperties: false },
)
export type EdgeTenantTse = Static<typeof edgeTenantTseSchema>

//#region Haupt-Schema
// Bewusst KEIN tenantId-/locationId-Feld: das `_id` IST der Tenant-Identifier
// (analog Cloud-Tenant-Schema). `createdAt` stempelt der Edge-Data-Resolver —
// die Projection liefert es nicht mit.
export const edgeTenantSchema = Type.Object(
  {
    _id: Type.String({ format: 'uuid' }),
    name: Type.String({ minLength: 1, maxLength: 200 }),
    status: Type.Optional(Type.String({ maxLength: 40 })),
    region: Type.Optional(Type.String({ maxLength: 40 })),
    branding: Type.Optional(edgeTenantBrandingSchema),
    localization: Type.Optional(edgeTenantLocalizationSchema),
    legalEntity: Type.Optional(edgeTenantLegalEntitySchema),
    tse: Type.Optional(edgeTenantTseSchema),
    // Optimistic-Concurrency-Marker des Cloud→Edge-Syncs (Replica-Sicht).
    syncVersion: Type.Optional(Type.Number({ minimum: 0 })),
    createdAt: Type.Optional(Type.String({ format: 'date-time' })),
    updatedAt: Type.Optional(Type.String({ format: 'date-time' })),
  },
  { $id: 'EdgeTenant', additionalProperties: false },
)
export type EdgeTenant = Static<typeof edgeTenantSchema>

// Intersect von Objekt-Schemas wird von dieser TypeBox-Version zu EINEM
// flachen Objekt-Schema zusammengefuehrt (merged properties + required) —
// `additionalProperties: false` wirkt also wie erwartet. Sync-CREATEs aus dem
// Cloud-Pull bringen `_id`/`updatedAt` mit — ohne die optionalen Felder lehnte
// validateData jeden Sync-CREATE terminal ab (Muster locationDataSchema,
// Fix v26.7.35).
export const edgeTenantDataSchema = Type.Intersect(
  [
    Type.Omit(edgeTenantSchema, ['_id', 'createdAt', 'updatedAt']),
    Type.Partial(Type.Pick(edgeTenantSchema, ['_id', 'createdAt', 'updatedAt'])),
  ],
  { $id: 'EdgeTenantData', additionalProperties: false },
)
export type EdgeTenantData = Static<typeof edgeTenantDataSchema>

export const edgeTenantPatchSchema = Type.Partial(edgeTenantSchema, {
  $id: 'EdgeTenantPatch',
  additionalProperties: false,
})
export type EdgeTenantPatch = Static<typeof edgeTenantPatchSchema>

export const edgeTenantQueryProperties = Type.Pick(edgeTenantSchema, ['_id', 'name', 'status', 'updatedAt'])
export const edgeTenantQuerySchema = Type.Intersect(
  [querySyntax(edgeTenantQueryProperties), Type.Object({}, { additionalProperties: false })],
  { additionalProperties: false },
)
export type EdgeTenantQuery = Static<typeof edgeTenantQuerySchema>
//#endregion
