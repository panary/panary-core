// Kunden und Firmenkunden am gepairten Edge sind read-only (panary/panary-core#620).
//
// Beide stehen in `SyncableMasterDataService`, aber nicht in `SyncableTransactionService`: Sie
// reisen Edge→Cloud nur im Bootstrap. Ein externer Write am gepairten Edge erreichte die Cloud
// nie und wuerde beim naechsten Pull still ueberschrieben — dieselbe Klasse wie #607. Heute
// schreibt kein Edge-UI darauf; die Luecke war ein REST-/Socket-Write mit gueltigem Token.
//
// Vorlage: `test/services/products/cloud-managed-products.test.ts`. Bewusst gegen die volle
// Hook-Kette, weil die fehlende Registrierung am Service mit einer Hook-Spec nicht sichtbar ist.
// Jede Sperre hat eine Gegenprobe (ohne Pairing, interner Pull-Pfad), sonst ginge ein Test gruen,
// der aus einem anderen Grund ablehnt (Rechte, Validierung).
import assert from 'assert'
import { uuidv7 } from 'uuidv7'
import { PairingStatus } from '@panary/cloud-connection/domain'
import { app } from '../../../src/app'

interface StoredRecord {
  _id: string
  name1: string
}

const isCloudManaged = (err: unknown): boolean =>
  (err as { code?: number; data?: { code?: string } }).code === 403 &&
  (err as { data?: { code?: string } }).data?.code === 'CLOUD_MANAGED'

describe('Kunden und Firmenkunden am gepairten Edge — cloudManaged (#620)', () => {
  const tenantId = uuidv7()
  let locationId: string

  /** Inhaber — die Tenant-Rolle mit `customers:MANAGE` und `corporate-customers:MANAGE`. */
  const ownerParams = () =>
    ({
      provider: 'socketio',
      authenticated: true,
      user: { _id: uuidv7(), role: 'tenant:owner', tenantId, activeLocationId: locationId },
    }) as never

  const knex = () => app.get('sqliteClient') as any

  const pair = async (): Promise<void> => {
    await knex().table('cloud-connection').insert({
      _id: uuidv7(),
      tenantId,
      cloudUrl: 'https://cloud.example.test',
      pairingStatus: PairingStatus.CONNECTED,
      syncEnabled: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  }

  const unpair = async (): Promise<void> => {
    await knex().table('cloud-connection').del()
  }

  const customerData = (name1: string) => ({
    name1,
    name2: '',
    address1: 'Teststr. 1',
    address2: '',
    city: 'Teststadt',
    zipCode: '12345',
    phone: '0123',
    email: null,
    invoices: [],
  })

  const corporateData = (name1: string) => ({
    name1,
    address: { address1: 'Teststr. 1', city: 'Teststadt', zipCode: '12345' },
    email: null,
    invoices: [],
  })

  /**
   * Kunden direkt in die Tabelle: Der interne Create scheitert heute an `invoices` (Array in einer
   * TEXT-Spalte, panary/panary-core#624). Die Zeile entspricht dem, was nach einem Pull dort stuende.
   */
  const seedCustomer = async (name1: string): Promise<StoredRecord> => {
    const now = new Date().toISOString()
    const row = {
      ...customerData(name1),
      invoices: '[]',
      _id: uuidv7(),
      tenantId,
      locationId,
      createdAt: now,
      updatedAt: now,
    }
    await knex().table('customers').insert(row)
    return row
  }

  /** Interner Create — der Weg, auf dem der Sync-Pull Cloud-Datensaetze anlegt. */

  const seedCorporate = async (name1: string): Promise<StoredRecord> =>
    (await app
      .service('corporate-customers')
      .create({ ...corporateData(name1), tenantId, locationId } as never, { provider: undefined })) as StoredRecord

  const storedName = async (table: string, id: string): Promise<string | undefined> =>
    ((await knex().table(table).where({ _id: id }).first()) as StoredRecord | undefined)?.name1

  beforeAll(async () => {
    await app.setup()
    const location = (await app.service('locations').create(
      {
        name: 'Filiale #620',
        tenantId,
        address: { street: 'Teststr. 1', city: 'Teststadt', postalCode: '12345', country: 'DE' },
      } as never,
      { provider: undefined },
    )) as { _id: string }
    locationId = location._id
  })

  // Die Test-SQLite ist persistent und wird von allen Dateien geteilt (vitest.config.mts):
  // Eine stehengebliebene CONNECTED-Zeile sperrte jeder spaeteren Suite die Edge-Writes.
  beforeEach(unpair)
  afterAll(async () => {
    await unpair()
    await app.teardown()
  })

  describe('customers', () => {
    it('lehnt externen Patch, Create und Remove bei aktivem Pairing mit CLOUD_MANAGED ab', async () => {
      const customer = await seedCustomer('Original')
      await pair()

      await assert.rejects(
        () => app.service('customers').patch(customer._id, { name1: 'Am Edge umbenannt' } as never, ownerParams()),
        isCloudManaged,
      )
      await assert.rejects(
        () => app.service('customers').create({ ...customerData('Neu am Edge'), locationId } as never, ownerParams()),
        isCloudManaged,
      )
      await assert.rejects(() => app.service('customers').remove(customer._id, ownerParams()), isCloudManaged)
      assert.strictEqual(await storedName('customers', customer._id), 'Original')
    })

    it('laesst denselben externen Patch ohne Pairing durch (Gegenprobe: Rechte und Schema tragen)', async () => {
      const customer = await seedCustomer('Standalone')

      await app.service('customers').patch(customer._id, { name1: 'Standalone geaendert' } as never, ownerParams())

      assert.strictEqual(await storedName('customers', customer._id), 'Standalone geaendert')
    })

    it('laesst den internen Pfad des Sync-Pulls und Reads auch gepairt durch', async () => {
      const customer = await seedCustomer('Vor dem Pull')
      await pair()

      await app.service('customers').patch(customer._id, { name1: 'Aus der Cloud' } as never, { provider: undefined })
      const read = (await app.service('customers').get(customer._id, ownerParams())) as StoredRecord

      assert.strictEqual(read.name1, 'Aus der Cloud')
    })
  })

  describe('corporate-customers', () => {
    it('lehnt externen Patch, Create und Remove bei aktivem Pairing mit CLOUD_MANAGED ab', async () => {
      const corporate = await seedCorporate('Firma Original')
      await pair()

      await assert.rejects(
        () =>
          app
            .service('corporate-customers')
            .patch(corporate._id, { name1: 'Am Edge umbenannt' } as never, ownerParams()),
        isCloudManaged,
      )
      await assert.rejects(
        () =>
          app
            .service('corporate-customers')
            .create({ ...corporateData('Neu am Edge'), locationId } as never, ownerParams()),
        isCloudManaged,
      )
      await assert.rejects(
        () => app.service('corporate-customers').remove(corporate._id, ownerParams()),
        isCloudManaged,
      )
      assert.strictEqual(await storedName('corporate-customers', corporate._id), 'Firma Original')
    })

    it('laesst denselben externen Patch ohne Pairing durch (Gegenprobe)', async () => {
      const corporate = await seedCorporate('Firma Standalone')

      await app
        .service('corporate-customers')
        .patch(corporate._id, { name1: 'Firma geaendert' } as never, ownerParams())

      assert.strictEqual(await storedName('corporate-customers', corporate._id), 'Firma geaendert')
    })

    it('laesst den internen Pfad des Sync-Pulls und Reads auch gepairt durch', async () => {
      const corporate = await seedCorporate('Firma vor dem Pull')
      await pair()

      await app
        .service('corporate-customers')
        .patch(corporate._id, { name1: 'Firma aus der Cloud' } as never, { provider: undefined })
      const read = (await app.service('corporate-customers').get(corporate._id, ownerParams())) as StoredRecord

      assert.strictEqual(read.name1, 'Firma aus der Cloud')
    })
  })
})
