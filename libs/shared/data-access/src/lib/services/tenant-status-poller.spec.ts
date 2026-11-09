import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TENANT_STATUS_POLL_MS, TenantStatusPoller } from './tenant-status-poller'

/** Je Test eigene Aufzeichnung (§10): ein Nachzügler schreibt in sein eigenes Objekt. */
function setup(fetchTenantStatus: () => Promise<unknown>) {
  const applied: unknown[] = []
  const fetch = vi.fn(fetchTenantStatus)
  const poller = new TenantStatusPoller({ fetchTenantStatus: fetch, applyTenantStatus: s => applied.push(s) })
  return { poller, fetch, applied }
}

describe('TenantStatusPoller (#1401)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('fragt beim Aktivieren sofort ab und reicht tenantStatus weiter', async () => {
    const { poller, fetch, applied } = setup(async () => ({ tenantStatus: 'SUSPENDED', planCode: 'basic' }))
    poller.setActive(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(applied).toEqual(['SUSPENDED'])
    poller.stop()
  })

  it('fragt danach im Takt ab, solange aktiv, und hört beim Deaktivieren auf', async () => {
    const { poller, fetch } = setup(async () => ({ tenantStatus: 'ACTIVE' }))
    poller.setActive(true)
    await vi.advanceTimersByTimeAsync(2 * TENANT_STATUS_POLL_MS)
    expect(fetch).toHaveBeenCalledTimes(3)
    poller.setActive(false)
    await vi.advanceTimersByTimeAsync(2 * TENANT_STATUS_POLL_MS)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('ein zweites Aktivieren startet keinen zweiten Takt', async () => {
    const { poller, fetch } = setup(async () => ({ tenantStatus: 'ACTIVE' }))
    poller.setActive(true)
    poller.setActive(true)
    await vi.advanceTimersByTimeAsync(TENANT_STATUS_POLL_MS)
    expect(fetch).toHaveBeenCalledTimes(2)
    poller.stop()
  })

  it('ein fehlgeschlagener Abruf meldet nichts weiter', async () => {
    const { poller, applied } = setup(async () => {
      throw new Error('offline')
    })
    await poller.poll()
    expect(applied).toEqual([])
  })

  it('eine Antwort ohne Objekt meldet „unbekannt", nicht „entsperrt"', async () => {
    const { poller, applied } = setup(async () => null)
    await poller.poll()
    expect(applied).toEqual([undefined])
  })
})
