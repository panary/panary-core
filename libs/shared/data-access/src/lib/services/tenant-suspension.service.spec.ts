import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readTenantSuspension, TENANT_SUSPENSION_TTL_MS, TenantSuspensionService } from './tenant-suspension.service'

describe('readTenantSuspension', () => {
  it('erkennt den Code in error.data samt Status', () => {
    expect(readTenantSuspension({ data: { code: 'TENANT_SUSPENDED', tenantStatus: 'SUSPENDED' } })).toEqual({
      tenantStatus: 'SUSPENDED',
    })
  })

  it('fällt auf das Message-Präfix zurück', () => {
    expect(readTenantSuspension({ message: 'TENANT_SUSPENDED: Der Mandant ist gesperrt (SUSPENDED).' })).toEqual({
      tenantStatus: null,
    })
  })

  it('ignoriert einen generischen 403 und fremde Codes', () => {
    expect(readTenantSuspension({ message: 'You do not have permission', code: 403 })).toBeNull()
    expect(readTenantSuspension({ data: { code: 'OTHER' } })).toBeNull()
    expect(readTenantSuspension(null)).toBeNull()
    expect(readTenantSuspension([{ instancePath: '/x' }])).toBeNull()
  })
})

describe('TenantSuspensionService', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('setzt den Zustand und löscht ihn nach der TTL', () => {
    const svc = new TenantSuspensionService()
    expect(svc.suspended()).toBe(false)
    svc.markSuspended('ARCHIVED')
    expect(svc.suspended()).toBe(true)
    expect(svc.tenantStatus()).toBe('ARCHIVED')
    vi.advanceTimersByTime(TENANT_SUSPENSION_TTL_MS)
    expect(svc.suspended()).toBe(false)
  })

  it('verlängert die TTL bei jedem neuen 403', () => {
    const svc = new TenantSuspensionService()
    svc.markSuspended('SUSPENDED')
    vi.advanceTimersByTime(TENANT_SUSPENSION_TTL_MS - 1000)
    svc.markSuspended('SUSPENDED')
    vi.advanceTimersByTime(TENANT_SUSPENSION_TTL_MS - 1000)
    expect(svc.suspended()).toBe(true)
  })
})
