// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  readTenantSuspension,
  TENANT_SUSPENSION_STORAGE_KEY,
  TENANT_SUSPENSION_TTL_MS,
  TenantSuspensionService,
} from './tenant-suspension.service'

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
  beforeEach(() => {
    vi.useFakeTimers()
    sessionStorage.clear()
  })
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

  it('stellt die Sperre nach einem Neuladen wieder her, mit der Restlaufzeit', () => {
    new TenantSuspensionService().markSuspended('ARCHIVED')
    vi.advanceTimersByTime(20_000)
    const reloaded = new TenantSuspensionService()
    expect(reloaded.suspended()).toBe(true)
    expect(reloaded.tenantStatus()).toBe('ARCHIVED')
    vi.advanceTimersByTime(TENANT_SUSPENSION_TTL_MS - 20_000)
    expect(reloaded.suspended()).toBe(false)
    expect(sessionStorage.getItem(TENANT_SUSPENSION_STORAGE_KEY)).toBeNull()
  })

  it('stellt eine abgelaufene Sperre nicht wieder her und räumt den Eintrag', () => {
    new TenantSuspensionService().markSuspended('SUSPENDED')
    vi.setSystemTime(Date.now() + TENANT_SUSPENSION_TTL_MS + 1)
    expect(new TenantSuspensionService().suspended()).toBe(false)
    expect(sessionStorage.getItem(TENANT_SUSPENSION_STORAGE_KEY)).toBeNull()
  })

  it('clear() löscht auch den Eintrag', () => {
    const svc = new TenantSuspensionService()
    svc.markSuspended('SUSPENDED')
    svc.clear()
    expect(sessionStorage.getItem(TENANT_SUSPENSION_STORAGE_KEY)).toBeNull()
    expect(new TenantSuspensionService().suspended()).toBe(false)
  })

  it('verwirft einen unlesbaren oder zu weit in der Zukunft liegenden Eintrag', () => {
    sessionStorage.setItem(TENANT_SUSPENSION_STORAGE_KEY, 'kein json')
    expect(new TenantSuspensionService().suspended()).toBe(false)
    sessionStorage.setItem(
      TENANT_SUSPENSION_STORAGE_KEY,
      JSON.stringify({ tenantStatus: 'SUSPENDED', expiresAt: Date.now() + 10 * TENANT_SUSPENSION_TTL_MS }),
    )
    expect(new TenantSuspensionService().suspended()).toBe(false)
  })
})
