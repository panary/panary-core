import type { TObject, TSchema } from '@feathersjs/typebox'
import { SyncableMasterDataService } from '@panary/edge-pairing/domain'
import { businessDaySchema } from '@panary/businessdays/domain'
import { corporateCustomerSchema } from '@panary/corporate-customers/domain'
import { customerSchema } from '@panary/customers/domain'
import { locationSchema } from '@panary/locations/domain'
import { openingHourExceptionSchema } from '@panary/opening-hour-exceptions/domain'
import { productGroupSchema } from '@panary/product-groups/domain'
import { productSchema } from '@panary/products/domain'
import { userSchema } from '@panary/users/domain'

// SQLite kennt kein „Feld fehlt": Eine nullable Spalte ohne Wert liest sich als
// `null`. Das geteilte Schema unterscheidet aber zwischen `Optional(X)` (Feld darf
// fehlen, nie null) und `Optional(Union([X, Null]))` (Leeren erlaubt). Schickt der
// Bootstrap-Push `null` an ein Feld der ersten Art, lehnt die Cloud den ganzen
// Service ab — so jede aus der Cloud gezogene Filiale ohne `lastWorkdayOfWeek`
// (panary/panary-core#748). Diese Felder fallen deshalb weg; ein `null` an einem
// nullbaren Feld bleibt stehen, weil es ein gewolltes Leeren sein kann (#738).
const BOOTSTRAP_PUSH_SCHEMAS: Readonly<Record<string, TObject>> = {
  [SyncableMasterDataService.LOCATIONS]: locationSchema,
  [SyncableMasterDataService.OPENING_HOUR_EXCEPTIONS]: openingHourExceptionSchema,
  [SyncableMasterDataService.PRODUCT_GROUPS]: productGroupSchema,
  [SyncableMasterDataService.PRODUCTS]: productSchema,
  [SyncableMasterDataService.USERS]: userSchema,
  [SyncableMasterDataService.CORPORATE_CUSTOMERS]: corporateCustomerSchema,
  [SyncableMasterDataService.CUSTOMERS]: customerSchema,
  [SyncableMasterDataService.BUSINESS_DAYS]: businessDaySchema,
}

// Unbekanntes Feld oder Schema ohne Typ (Any/Unknown) gilt als nullbar: Hier wird
// nur weggelassen, was das Schema sicher ablehnen wuerde.
const acceptsNull = (schema: TSchema | undefined): boolean => {
  if (!schema) return true
  const s = schema as { type?: unknown; anyOf?: TSchema[]; oneOf?: TSchema[] }
  if (s.type === 'null' || (Array.isArray(s.type) && s.type.includes('null'))) return true
  const variants = s.anyOf ?? s.oneOf
  if (Array.isArray(variants)) return variants.some(acceptsNull)
  return s.type === undefined
}

export const stripNonNullableNulls = (service: string, record: Record<string, unknown>): Record<string, unknown> => {
  const schema = BOOTSTRAP_PUSH_SCHEMAS[service]
  if (!schema) return record
  const properties = schema.properties as Record<string, TSchema>
  return Object.fromEntries(
    Object.entries(record).filter(([key, value]) => value !== null || acceptsNull(properties[key])),
  )
}
