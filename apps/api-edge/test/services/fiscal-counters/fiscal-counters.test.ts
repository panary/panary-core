import assert from 'assert'
import { uuidv7 } from 'uuidv7'
import { type FiscalCounter, fiscalCounterId } from '@panary/tse/domain'
import { app } from '../../../src/app'
import { allocateFiscalCounter, fiscalCountersPath } from '../../../src/services/fiscal-counters/fiscal-counters'

// Integrationstest fuer die Erst-Anlage des lueckenlosen Fiskal-Zaehlers
// (KassenSichV-Vorgangsnummer): laeuft gegen die echte Test-SQLite und die
// volle Hook-Kette. Verankert die Regression, dass der Create-Validator gegen
// das Data-Schema (ohne createdAt/updatedAt) validiert — gegen das volle
// Schema scheiterte JEDE Erst-Anlage (validateData laeuft vor resolveData),
// der Zaehler-Datensatz entstand nie und signOrderTseStart fiel dauerhaft auf
// dailySequenceNumber zurueck.
describe('fiscal-counters service — lueckenlose Allokation', () => {
  const tenantId = uuidv7()
  const locationId = uuidv7()
  const id = fiscalCounterId(tenantId, locationId)

  beforeAll(async () => {
    await app.setup()
  })

  afterAll(async () => {
    try {
      await app.service(fiscalCountersPath).remove(id, { provider: undefined })
    } catch {
      // Datensatz existiert nicht — nichts aufzuraeumen
    }
  })

  it('legt den Zaehler bei der Erst-Allokation an und erhoeht monoton (1 → 2)', async () => {
    const first = await allocateFiscalCounter(app, tenantId, locationId)
    assert.strictEqual(first, 1, 'Erste Allokation muss 1 liefern')

    // Der Datensatz muss tatsaechlich persistiert sein — inkl. der vom
    // Data-Resolver gesetzten Timestamps.
    const record = (await app.service(fiscalCountersPath).get(id, { provider: undefined })) as FiscalCounter
    assert.strictEqual(record.lastValue, 1)
    assert.strictEqual(record.tenantId, tenantId)
    assert.strictEqual(record.locationId, locationId)
    assert.ok(record.createdAt, 'createdAt muss serverseitig gesetzt sein')
    assert.ok(record.updatedAt, 'updatedAt muss serverseitig gesetzt sein')

    const second = await allocateFiscalCounter(app, tenantId, locationId)
    assert.strictEqual(second, 2, 'Zweite Allokation muss 2 liefern')

    const updated = (await app.service(fiscalCountersPath).get(id, { provider: undefined })) as FiscalCounter
    assert.strictEqual(updated.lastValue, 2)
  })
})
