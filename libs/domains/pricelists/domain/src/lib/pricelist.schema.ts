import { Static, StringEnum, Type } from '@feathersjs/typebox'

/**
 * Item-Schema für die `productPrices`-Liste einer Preisliste.
 *
 * Eine Pricelist ist eine **Batch-Preisanpassung** über viele Produkte
 * hinweg, mit Tracking-Status pro Produkt:
 *  - `PENDING`: noch nicht angewendet
 *  - `APPLIED`: Preis am Produkt aktualisiert
 *  - `REVERTED`: Anpassung rückgängig gemacht
 *  - `SKIPPED`: vom User explizit übersprungen
 *
 * `oldPrice` ist Snapshot zum Zeitpunkt der Pricelist-Erstellung —
 * `newPrice` der Zielpreis. `updatedAt`/`updatedBy` werden gesetzt, sobald
 * der Status auf APPLIED/REVERTED/SKIPPED wechselt.
 */
export const pricelistProductPriceSchema = Type.Object({
  productId: Type.String({ format: 'uuid' }),
  oldPrice: Type.Number(),
  newPrice: Type.Optional(Type.Number()),
  updatedAt: Type.Optional(Type.String({ format: 'date-time' })),
  updatedBy: Type.Optional(Type.String()),
  updateStatus: StringEnum(['PENDING', 'APPLIED', 'REVERTED', 'SKIPPED']),
})
export type PricelistProductPrice = Static<typeof pricelistProductPriceSchema>

export const pricelistStatusSchema = StringEnum(['DRAFT', 'ACTIVE', 'APPLIED', 'ARCHIVED'])

/**
 * Kanonisches Pricelist-Schema. Single Source of Truth — wird von
 * panary-cloud via Reexport konsumiert (`@panary/pricelists/domain`).
 *
 * Pricelists haben aktuell **keine** Versionierung (kein
 * `currentVersion`/`history`) — Audit erfolgt über `appliedOn` und die
 * pro-Item-`updateStatus`-Tracking-Felder. Falls später ein
 * Versions-Workflow nötig wird, exakt dem Pattern aus
 * `code-style.md §9.8` folgen + Whitelist in `version-fields.ts` ergänzen.
 */
export const pricelistSchema = Type.Object(
  {
    _id: Type.String(),
    tenantId: Type.String(),
    locationId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    createdAt: Type.Optional(Type.String({ format: 'date-time' })),
    updatedAt: Type.Optional(Type.String({ format: 'date-time' })),

    externalId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    name: Type.String({ minLength: 1, maxLength: 255 }),
    description: Type.Optional(Type.String()),
    status: Type.Optional(pricelistStatusSchema),
    appliedOn: Type.Optional(Type.String({ format: 'date-time' })),
    productPrices: Type.Array(pricelistProductPriceSchema),
  },
  { $id: 'Pricelist', additionalProperties: false },
)
export type Pricelist = Static<typeof pricelistSchema>
