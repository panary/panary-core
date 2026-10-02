import '@angular/compiler'
import { Injector } from '@angular/core'
import { MatSnackBar } from '@angular/material/snack-bar'
import { Router } from '@angular/router'
import { NotificationService } from '@panary/shared/ui-notifications'
import { describe, expect, it, vi } from 'vitest'

import { TenantSuspensionService } from '../services/tenant-suspension.service'
import { ServiceHelper } from './service-helper.service'

// Kein TestBed: dieses Projekt initialisiert die Angular-Testumgebung nicht.
function setup() {
  const show = vi.fn()
  const injector = Injector.create({
    providers: [
      { provide: NotificationService, useValue: { show } },
      { provide: Router, useValue: { navigate: vi.fn().mockResolvedValue(true) } },
      { provide: MatSnackBar, useValue: { open: vi.fn() } },
      { provide: TenantSuspensionService, useClass: TenantSuspensionService },
      { provide: ServiceHelper, useClass: ServiceHelper, deps: [] },
    ],
  })
  return { show, helper: injector.get(ServiceHelper), suspension: injector.get(TenantSuspensionService) }
}

describe('ServiceHelper.handleError — Mandantensperre', () => {
  it('TENANT_SUSPENDED: kein Toast, Zustand gesetzt', () => {
    const { show, helper, suspension } = setup()
    helper.handleError('orders', {
      code: 403,
      message: 'TENANT_SUSPENDED: Der Mandant ist gesperrt (SUSPENDED).',
      data: { code: 'TENANT_SUSPENDED', tenantStatus: 'SUSPENDED' },
    })
    expect(show).not.toHaveBeenCalled()
    expect(suspension.suspended()).toBe(true)
    expect(suspension.tenantStatus()).toBe('SUSPENDED')
    suspension.clear()
  })

  it('anderer 403: Toast wie bisher, kein Zustand', () => {
    const { show, helper, suspension } = setup()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    helper.handleError('orders', { code: 403, message: 'You do not have permission' })
    expect(show).toHaveBeenCalledTimes(1)
    expect(suspension.suspended()).toBe(false)
  })
})
