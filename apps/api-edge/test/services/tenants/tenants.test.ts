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
//
// **Jeder Test legt seinen eigenen Tenant an** (Code-Style §10.1, #301): Vorher
// erzeugte Test 2 die Zeile, die Test 3 las und Test 4 patchte — unter
// `--sequence.shuffle` (mischt auch die Tests INNERHALB einer Datei) war das
// reihenfolgeabhaengig und rot. Gemessen am 2026-09-13: Seed 3 liess den
// PATCH vor dem CREATE laufen (NotFound), Seed 1 den Roundtrip nach dem PATCH
// (`receiptFooter` bereits 'Bis bald!').
import assert from 'assert'
import { uuidv7 } from 'uuidv7'
import { onTestFinished } from 'vitest'
import { app } from '../../../src/app'

describe('tenants service (Edge-Replica)', () => {
  const tenants = () => app.service('tenants') as any
  const internal = { provider: undefined } as const

  // Repraesentativer projizierter Cloud-Record (Shape von projectTenantForEdge).
  // Factory statt Konstante: Die `_id` ist der Ressourcenname im Sinne von §10.1 —
  // bliebe sie fix, teilten sich alle Tests weiterhin dieselbe Zeile in der
  // gemeinsamen Test-SQLite, auch wenn jeder seinen eigenen `create` faehrt.
  //
  // uuidv7 statt des in §10.1 empfohlenen Zaehlers: Die Test-DB ist eine Datei und
  // ueberlebt den Lauf (`apps/api-edge/data/api-edge.test.sqlite`). Ein
  // reproduzierbarer Name kollidiert nach einem Abbruch mit dem Rest des
  // vorherigen Laufs — genau die Sorte Fehlschlag, die wie ein Produktionsbug
  // aussieht. uuidv7 ist ausserdem das ID-Format des Produktivcodes.
  const makeProjectedRecord = () => ({
    _id: uuidv7(),
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
  })

  /** Legt einen Tenant per Sync-CREATE an und raeumt ihn am Ende DIESES Tests ab. */
  const createTenant = async () => {
    const record = makeProjectedRecord()
    const created = await tenants().create(record, { ...internal, fromSync: true })

    onTestFinished(async () => {
      await tenants()
        .remove(record._id, internal)
        .catch(() => undefined)
    })

    return { record, created }
  }

  beforeAll(async () => {
    await app.setup()
  })

  it('registered the service', () => {
    assert.ok(tenants(), 'Registered the service')
  })

  it('akzeptiert den kompletten projizierten Cloud-Record im Sync-CREATE', async () => {
    const { record, created } = await createTenant()

    assert.strictEqual(created._id, record._id)
    // Replica-Semantik: Cloud-updatedAt wertschonend uebernommen, nicht ueberstempelt.
    assert.strictEqual(created.updatedAt, record.updatedAt)
    assert.ok(created.createdAt, 'createdAt wird serverseitig gestempelt')
  })

  it('roundtrippt die JSON-Bloecke verlustfrei durch SQLite', async () => {
    const { record } = await createTenant()

    const fetched = await tenants().get(record._id, internal)
    assert.deepStrictEqual(fetched.branding, record.branding)
    assert.deepStrictEqual(fetched.localization, record.localization)
    assert.deepStrictEqual(fetched.legalEntity, record.legalEntity)
    assert.deepStrictEqual(fetched.tse, record.tse)
  })

  it('wendet Sync-PATCHes mit Cloud-updatedAt wertschonend an', async () => {
    const { record } = await createTenant()

    const patched = await tenants().patch(
      record._id,
      { branding: { receiptFooter: 'Bis bald!' }, updatedAt: '2026-07-28T13:00:00.000Z', syncVersion: 4 },
      { ...internal, fromSync: true },
    )
    assert.strictEqual(patched.updatedAt, '2026-07-28T13:00:00.000Z')
    assert.strictEqual(patched.syncVersion, 4)
    assert.strictEqual(patched.branding.receiptFooter, 'Bis bald!')
  })
})
