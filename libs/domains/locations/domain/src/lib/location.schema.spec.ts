import { describe, expect, it } from 'vitest'

import { Ajv, addFormats } from '@feathersjs/schema'
import type { FormatsPluginOptions } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'

import { generateDefaultLocationSettings } from './default-settings'
import { locationDataSchema } from './location.schema'

// Regression Standort-Settings-Sync (2026-07-28): Das Data-Schema war ein
// strikter Pick OHNE `_id`/`createdAt`/`updatedAt` (additionalProperties:
// false). Der Cloud→Edge-Sync-Pull-Apply legt eine unbekannte Cloud-Location
// aber per CREATE mit dem KOMPLETTEN Cloud-Record an → validateData verwarf
// jeden Record als „additional property", die Standort-Settings (Drucker/
// Pager/Tische/Oeffnungszeiten) kamen nie am Edge an. Diese Spec validiert
// mit derselben AJV-Konfiguration wie der Feathers-`dataValidator`
// (@panary/shared-backend), damit exakt die Runtime-Semantik geprueft wird.
const formats: FormatsPluginOptions = ['date-time', 'date', 'email', 'uri', 'uuid']
const validator = getValidator(locationDataSchema, addFormats(new Ajv({}), formats))

const syncedCloudLocation = {
  _id: '01890a5d-ac96-774b-bcce-b302099a8057',
  tenantId: '01890a5d-ac96-774b-bcce-b302099a8058',
  brandId: '01890a5d-ac96-774b-bcce-b302099a8059',
  handle: 'hauptfiliale',
  name: 'Hauptfiliale',
  address: {
    street: 'Musterstr. 1',
    city: 'Musterstadt',
    postalCode: '12345',
    country: 'Deutschland',
  },
  status: 'ACTIVE',
  operationMode: 'pos-cashier',
  settings: generateDefaultLocationSettings,
  createdAt: '2026-07-28T10:00:00.000Z',
  updatedAt: '2026-07-28T12:00:00.000Z',
}

describe('locationDataSchema (Sync-Pull-Apply-CREATE)', () => {
  it('akzeptiert einen kompletten Cloud-Record inkl. _id/createdAt/updatedAt', async () => {
    await expect(validator(syncedCloudLocation)).resolves.toBeTruthy()
  })

  it('akzeptiert weiterhin einen lokalen Create ohne Server-Felder', async () => {
    await expect(
      validator({
        name: 'Neue Filiale',
        tenantId: '01890a5d-ac96-774b-bcce-b302099a8058',
        address: syncedCloudLocation.address,
      }),
    ).resolves.toBeTruthy()
  })

  it('lehnt unbekannte Felder weiterhin ab (kein Wildcard-Passthrough)', async () => {
    await expect(validator({ ...syncedCloudLocation, evilField: 'x' })).rejects.toThrow()
  })
})

// Bootstrap-Push Edge→Cloud (#183, Befund Testserver 2026-08-12). Migration
// `20260728170000_locations_add_brand_columns` legt brandId/handle/locale/
// defaultCurrency `nullable()` an; der Edge befuellt sie nie. `collectAllRecords`
// liest die Row roh, also kommen die Felder als `null` — nicht als `undefined`.
// Mit reinem `Type.Optional` wies die Cloud den Record mit
// „/brandId: must be string" ab und riss den GESAMTEN Bootstrap mit
// (`locations` ist der erste Service in MASTER_DATA_SERVICES).
describe('locationDataSchema (Bootstrap-Push mit leeren SQLite-Spalten)', () => {
  const edgeLocationWithNulls = {
    ...syncedCloudLocation,
    brandId: null,
    handle: null,
    locale: null,
    defaultCurrency: null,
  }

  it('akzeptiert eine Edge-Location mit null in allen vier Brand-Spalten', async () => {
    await expect(validator(edgeLocationWithNulls)).resolves.toBeTruthy()
  })

  it.each(['brandId', 'handle', 'locale', 'defaultCurrency'])('akzeptiert null in %s einzeln', async field => {
    await expect(validator({ ...syncedCloudLocation, [field]: null })).resolves.toBeTruthy()
  })

  it('validiert gesetzte Werte weiterhin gegen ihr Pattern', async () => {
    await expect(validator({ ...syncedCloudLocation, handle: 'Groß Buchstaben' })).rejects.toThrow()
    await expect(validator({ ...syncedCloudLocation, defaultCurrency: 'euro' })).rejects.toThrow()
    await expect(validator({ ...syncedCloudLocation, locale: 'de_DE' })).rejects.toThrow()
  })
})

// Standort-Grace fuer den Order-Gate (panary-cloud ADR 0046, panary-cloud#133 /
// panary-core#134). Die Gruppe ist optional: Bestands-Locations tragen sie nicht
// und muessen weiter validieren — sonst waere die Schema-Erweiterung ein
// Breaking Change fuer jeden bereits gesyncten Record.
describe('settings.businessDaySettings', () => {
  const withBusinessDaySettings = (businessDaySettings: unknown) => ({
    ...syncedCloudLocation,
    settings: { ...generateDefaultLocationSettings, businessDaySettings },
  })

  it('akzeptiert eine Location ohne die Gruppe (Bestand)', async () => {
    expect(generateDefaultLocationSettings).not.toHaveProperty('businessDaySettings')
    await expect(validator(syncedCloudLocation)).resolves.toBeTruthy()
  })

  it('akzeptiert maxOpenHours innerhalb der Grenzen', async () => {
    await expect(validator(withBusinessDaySettings({ maxOpenHours: 30 }))).resolves.toBeTruthy()
  })

  it('akzeptiert die leere Gruppe (kein Pflicht-Feld darin)', async () => {
    await expect(validator(withBusinessDaySettings({}))).resolves.toBeTruthy()
  })

  it('lehnt 0 und negative Werte ab — eine Sperre ab der ersten Sekunde ist kein gueltiger Betrieb', async () => {
    await expect(validator(withBusinessDaySettings({ maxOpenHours: 0 }))).rejects.toThrow()
    await expect(validator(withBusinessDaySettings({ maxOpenHours: -1 }))).rejects.toThrow()
  })

  it('lehnt Werte oberhalb einer Woche ab', async () => {
    await expect(validator(withBusinessDaySettings({ maxOpenHours: 169 }))).rejects.toThrow()
  })

  it('lehnt Nicht-Ganzzahlen ab', async () => {
    await expect(validator(withBusinessDaySettings({ maxOpenHours: 26.5 }))).rejects.toThrow()
  })

  // Auto-Rotation ueberlanger Betriebstage (panary-cloud ADR 0048 Stufe 2,
  // panary-cloud#177). Das Feld ist optional UND hat Default `false` — beides
  // ist noetig: optional, damit Bestands-Locations validieren; Default `false`,
  // damit ein Standort ohne ausdrueckliches Opt-in nie rotiert wird.
  it('akzeptiert autoRotate als Opt-in', async () => {
    await expect(validator(withBusinessDaySettings({ autoRotate: true }))).resolves.toBeTruthy()
    await expect(validator(withBusinessDaySettings({ autoRotate: false }))).resolves.toBeTruthy()
  })

  it('akzeptiert autoRotate zusammen mit maxOpenHours', async () => {
    await expect(validator(withBusinessDaySettings({ maxOpenHours: 30, autoRotate: true }))).resolves.toBeTruthy()
  })

  it('laesst autoRotate weg, wenn es nicht gesetzt ist — der Default macht daraus kein Opt-in', async () => {
    const validated = (await validator(withBusinessDaySettings({ maxOpenHours: 30 }))) as {
      settings: { businessDaySettings?: { autoRotate?: boolean } }
    }
    expect(validated.settings.businessDaySettings?.autoRotate).toBeFalsy()
  })

  it('lehnt nicht-boolesche autoRotate-Werte ab', async () => {
    await expect(validator(withBusinessDaySettings({ autoRotate: 'true' }))).rejects.toThrow()
    await expect(validator(withBusinessDaySettings({ autoRotate: 1 }))).rejects.toThrow()
  })
})
