import { describe, expect, it } from 'vitest'

import { rejectDeviceEmployeeNumberQuery } from './reject-device-employee-number-query.hook'

const run = (params: Record<string, unknown>) => rejectDeviceEmployeeNumberQuery({ params } as never)
const device = { role: 'device:pos-client' }

describe('rejectDeviceEmployeeNumberQuery (#1199)', () => {
  it.each([
    { employeeNumber: '123456' },
    { employeeNumber: { $in: ['123456'] } },
    { $or: [{ firstName: 'A' }, { employeeNumber: '123456' }] },
    { $and: [{ $or: [{ employeeNumber: { $ne: null } }] }] },
    { $sort: { employeeNumber: -1 } },
  ])('weist %j fuer ein Geraet ab', async query => {
    await expect(run({ provider: 'rest', user: device, query })).rejects.toMatchObject({ code: 403 })
  })

  it('laesst andere Queries, $select und interne Aufrufe durch', async () => {
    await expect(run({ provider: 'rest', user: device, query: { role: 'tenant:staff' } })).resolves.toBeDefined()
    await expect(
      run({ provider: 'rest', user: device, query: { $select: ['employeeNumber', '_id'] } }),
    ).resolves.toBeDefined()
    await expect(run({ user: device, query: { employeeNumber: '123456' } })).resolves.toBeDefined()
  })

  it('betrifft keine Nicht-Geraete (Verwaltung sucht weiter per Nummer)', async () => {
    const owner = { role: 'tenant:owner' }
    await expect(run({ provider: 'rest', user: owner, query: { employeeNumber: '123456' } })).resolves.toBeDefined()
  })
})
