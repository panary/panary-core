import { describe, expect, it } from 'vitest'
import { cloudConnectionDataSchema, cloudConnectionPatchSchema } from './cloud-connection.schema'

// Feldliste des `upsertData`-Objekts aus
// apps/api-edge/src/services/cloud-connection/cloud-connection.ts (startBootstrap).
// Der Upsert nimmt bei einer Erstinstallation den create-Pfad (Data-Schema) und
// beim Re-Pairing den patch-Pfad (Patch-Schema) — beide Schemas sind
// additionalProperties:false, also MUSS jedes Feld in beiden stehen. Genau diese
// Asymmetrie liess am 2026-07-27 jede Neuinstallation mit
// "must NOT have additional properties: tokenErrorReason" auflaufen, waehrend
// Re-Pairings auf Bestands-Edges weiterliefen.
const START_BOOTSTRAP_UPSERT_FIELDS = [
  'cloudUrl',
  'edgeName',
  'cloudToken',
  'cloudEdgeId',
  'edgeTokenExpiresAt',
  'tokenErrorReason',
  'lastTokenErrorAt',
  'pairingStatus',
  'connectedAt',
  'syncEnabled',
  'initialDirection',
  'bootstrapStatus',
  'bootstrapStartedAt',
  'syncMode',
  'syncIntervalSec',
  'preflightSnapshot',
  'bootstrapUserAllowlist',
] as const

const propertiesOf = (schema: unknown): Record<string, unknown> =>
  (schema as { properties: Record<string, unknown> }).properties

describe('cloudConnection-Schemas — startBootstrap-Upsert', () => {
  it('deckt jedes Upsert-Feld im Data-Schema ab (create-Pfad, Erstinstallation)', () => {
    const props = propertiesOf(cloudConnectionDataSchema)
    for (const field of START_BOOTSTRAP_UPSERT_FIELDS) {
      expect(props, `Feld "${field}" fehlt im Data-Schema`).toHaveProperty(field)
    }
  })

  it('deckt jedes Upsert-Feld im Patch-Schema ab (patch-Pfad, Re-Pairing)', () => {
    const props = propertiesOf(cloudConnectionPatchSchema)
    for (const field of START_BOOTSTRAP_UPSERT_FIELDS) {
      expect(props, `Feld "${field}" fehlt im Patch-Schema`).toHaveProperty(field)
    }
  })

  it('haelt das Data-Schema auf additionalProperties:false', () => {
    expect((cloudConnectionDataSchema as { additionalProperties?: boolean }).additionalProperties).toBe(false)
  })

  it('laesst den Token-Fehlerzustand nullbar leeren (Clear-Pattern beim Re-Pairing)', () => {
    for (const schema of [cloudConnectionDataSchema, cloudConnectionPatchSchema]) {
      for (const field of ['tokenErrorReason', 'lastTokenErrorAt']) {
        const prop = propertiesOf(schema)[field] as { anyOf?: { type?: string }[] }
        expect(
          prop.anyOf?.some(variant => variant.type === 'null'),
          `${field} muss null erlauben`,
        ).toBe(true)
      }
    }
  })
})
