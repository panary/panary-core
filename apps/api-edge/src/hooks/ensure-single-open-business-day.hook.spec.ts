import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequest } from '@feathersjs/errors'

vi.mock('@panary/shared-backend', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

import { ensureSingleOpenBusinessDay } from './ensure-single-open-business-day.hook'

import type { HookContext } from '../declarations'

const makeContext = (opts: {
  data: unknown
  fromSync?: boolean
  existingOpen?: unknown[]
  findThrows?: boolean
}): { context: HookContext; find: ReturnType<typeof vi.fn> } => {
  const find = opts.findThrows
    ? vi.fn().mockRejectedValue(new Error('db locked'))
    : vi.fn().mockResolvedValue({ data: opts.existingOpen ?? [] })

  const context = {
    data: opts.data,
    params: { fromSync: opts.fromSync },
    app: { service: () => ({ find }) },
  } as unknown as HookContext

  return { context, find }
}

const openDayData = { tenantId: 't-1', locationId: 'loc-1', status: 'open' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ensureSingleOpenBusinessDay', () => {
  it('laesst durch, wenn kein Tag offen ist', async () => {
    const { context } = makeContext({ data: openDayData })
    await expect(ensureSingleOpenBusinessDay(context)).resolves.toBe(context)
  })

  it('lehnt ab, wenn bereits ein Tag der Location offen ist', async () => {
    const { context } = makeContext({ data: openDayData, existingOpen: [{ _id: 'bd-alt' }] })
    await expect(ensureSingleOpenBusinessDay(context)).rejects.toBeInstanceOf(BadRequest)
  })

  it('filtert auf tenantId + locationId + status:open', async () => {
    const { context, find } = makeContext({ data: openDayData })
    await ensureSingleOpenBusinessDay(context)

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { tenantId: 't-1', locationId: 'loc-1', status: 'open', $limit: 1 },
        provider: undefined,
      }),
    )
  })

  // Ohne diese Ausnahme wuerde der Cloud-Pull-Worker Records dauerhaft rejecten:
  // ein 400 im Sync-Apply ist terminal, es gibt keinen Retry.
  it('greift bei fromSync nicht', async () => {
    const { context, find } = makeContext({ data: openDayData, fromSync: true, existingOpen: [{ _id: 'bd-alt' }] })
    await expect(ensureSingleOpenBusinessDay(context)).resolves.toBe(context)
    expect(find).not.toHaveBeenCalled()
  })

  it('ignoriert Records ohne locationId (Eindeutigkeit ist je Filiale definiert)', async () => {
    const { context, find } = makeContext({
      data: { tenantId: 't-1', locationId: null, status: 'open' },
      existingOpen: [{ _id: 'bd-alt' }],
    })
    await expect(ensureSingleOpenBusinessDay(context)).resolves.toBe(context)
    expect(find).not.toHaveBeenCalled()
  })

  it('ignoriert Records ohne tenantId', async () => {
    const { context, find } = makeContext({ data: { locationId: 'loc-1', status: 'open' } })
    await ensureSingleOpenBusinessDay(context)
    expect(find).not.toHaveBeenCalled()
  })

  it('ignoriert explizit nicht-offene Records', async () => {
    const { context, find } = makeContext({
      data: { tenantId: 't-1', locationId: 'loc-1', status: 'closed' },
      existingOpen: [{ _id: 'bd-alt' }],
    })
    await expect(ensureSingleOpenBusinessDay(context)).resolves.toBe(context)
    expect(find).not.toHaveBeenCalled()
  })

  // Fail-open: ein transienter DB-Fehler darf die Boot-Rotation nicht blockieren
  // (kein Geschaeftstag = keine Bestellungen).
  it('laesst bei einem Lookup-Fehler durch', async () => {
    const { context } = makeContext({ data: openDayData, findThrows: true })
    await expect(ensureSingleOpenBusinessDay(context)).resolves.toBe(context)
  })

  it('prueft jeden Record eines Array-Creates', async () => {
    const { context, find } = makeContext({
      data: [openDayData, { tenantId: 't-1', locationId: 'loc-2', status: 'open' }],
    })
    await ensureSingleOpenBusinessDay(context)
    expect(find).toHaveBeenCalledTimes(2)
  })
})
