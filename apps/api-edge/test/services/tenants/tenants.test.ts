// Regressionstest fuer die Tenant-Edge-Replica (OoS-Welle E Item 4).
//
// Verankert den Pull-Apply-Kontrakt: applyPulledRecords ruft
// `tenants.create/patch` intern (`provider: undefined, fromSync: true`) mit dem
// KOMPLETTEN projizierten Cloud-Record (projectTenantForEdge) auf — inklusive
// `_id`/`updatedAt`/`syncVersion` und verschachtelter JSON-Bloecke. Der Test
// stellt sicher, dass validateData diese Form akzeptiert (die Fehlerklasse des
// locations-Befunds v26.7.35: Data-Schema lehnte Sync-CREATEs terminal ab) und
// dass die JSON-Feld-Serialisierung (branding/localization/legalEntity/tse)
// verlustfrei durch SQLite roundtrippt.
import assert from 'assert'
import { uuidv7 } from 'uuidv7'
import { app } from '../../../src/app'

describe('tenants service (Edge-Replica)', () => {
  const tenantId = uuidv7()
  const tenants = () => app.service('tenants') as any

  // Reprаesentativer projizierter Cloud-Record (Shape von projectTenantForEdge).
  const projectedRecord = {
    _id: tenantId,
    name: 'Köttersfritte GmbH',
    status: 'ACTIVE',
    region: 'EU',
    branding: {
      primaryColor: '#2244aa',
      receiptHeader: 'Köttersfritte — Am Markt 1',
      receiptFooter: 'Vielen Dank für Ihren Besuch!',
      logo: {
        data: 'aGVsbG8=',
        contentType: 'image/webp',
        sizeBytes: 6,
        width: 64,
        height: 64,
        hash: 'a'.repeat(64),
        uploadedAt: '2026-07-01T10:00:00.000Z',
        uploadedByUserId: uuidv7(),
      },
    },
    localization: { locale: 'de-DE', timezone: 'Europe/Berlin', weekStart: 'monday', currency: 'EUR' },
    legalEntity: { registeredName: 'Köttersfritte GmbH', legalForm: 'GmbH', vatId: 'DE123456789', countryCode: 'DE' },
    tse: { provider: 'FISKALY', status: 'ACTIVE', jurisdiction: 'DE', apiKeyRef: 'bws-key-ref' },
    updatedAt: '2026-07-28T12:00:00.000Z',
    syncVersion: 3,
  }

  beforeAll(async () => {
    await app.setup()
  })

  afterAll(async () => {
    await tenants()
      .remove(tenantId, { provider: undefined })
      .catch(() => undefined)
  })

  it('registered the service', () => {
    assert.ok(tenants(), 'Registered the service')
  })

  it('akzeptiert den kompletten projizierten Cloud-Record im Sync-CREATE', async () => {
    const created = await tenants().create(projectedRecord, { provider: undefined, fromSync: true })
    assert.strictEqual(created._id, tenantId)
    // Replica-Semantik: Cloud-updatedAt wertschonend uebernommen, nicht ueberstempelt.
    assert.strictEqual(created.updatedAt, projectedRecord.updatedAt)
    assert.ok(created.createdAt, 'createdAt wird serverseitig gestempelt')
  })

  it('roundtrippt die JSON-Bloecke verlustfrei durch SQLite', async () => {
    const fetched = await tenants().get(tenantId, { provider: undefined })
    assert.deepStrictEqual(fetched.branding, projectedRecord.branding)
    assert.deepStrictEqual(fetched.localization, projectedRecord.localization)
    assert.deepStrictEqual(fetched.legalEntity, projectedRecord.legalEntity)
    assert.deepStrictEqual(fetched.tse, projectedRecord.tse)
  })

  it('wendet Sync-PATCHes mit Cloud-updatedAt wertschonend an', async () => {
    const patched = await tenants().patch(
      tenantId,
      { branding: { receiptFooter: 'Bis bald!' }, updatedAt: '2026-07-28T13:00:00.000Z', syncVersion: 4 },
      { provider: undefined, fromSync: true },
    )
    assert.strictEqual(patched.updatedAt, '2026-07-28T13:00:00.000Z')
    assert.strictEqual(patched.syncVersion, 4)
    assert.strictEqual(patched.branding.receiptFooter, 'Bis bald!')
  })
})
