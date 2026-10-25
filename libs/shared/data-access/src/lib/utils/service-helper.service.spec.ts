import '@angular/compiler'
import { Injector } from '@angular/core'
import { Router } from '@angular/router'
import { NotificationService } from '@panary/shared/ui-notifications'
import { describe, expect, it, onTestFinished, vi } from 'vitest'

// Der Token kommt sonst je nach Auflösung (Quelle oder dist) als `undefined` an.
vi.mock('@panary/shared/ui-notifications', () => ({ NotificationService: class NotificationService {} }))

import { TenantSuspensionService } from '../services/tenant-suspension.service'
import { ServiceHelper } from './service-helper.service'

// Kein TestBed: dieses Projekt initialisiert die Angular-Testumgebung nicht.
function setup() {
  const show = vi.fn()
  const navigate = vi.fn().mockResolvedValue(true)
  const injector = Injector.create({
    providers: [
      { provide: NotificationService, useValue: { error: show } },
      { provide: Router, useValue: { navigate } },
      { provide: TenantSuspensionService, useClass: TenantSuspensionService },
      { provide: ServiceHelper, useClass: ServiceHelper, deps: [] },
    ],
  })
  return { show, navigate, helper: injector.get(ServiceHelper), suspension: injector.get(TenantSuspensionService) }
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

describe('ServiceHelper.handleError — abgelehntes Bediener-Token (core#923)', () => {
  function stubSessionStorage() {
    const clear = vi.fn()
    vi.stubGlobal('sessionStorage', { clear })
    onTestFinished(() => {
      vi.unstubAllGlobals()
    })
    return clear
  }

  it('401 mit POS_OPERATOR_REQUIRED: wirft an den Aufrufer, Geräte-Sitzung bleibt, kein Toast', () => {
    const clear = stubSessionStorage()
    const { show, navigate, helper } = setup()
    const error = { code: 401, message: 'Bediener-Token abgelehnt', data: { reason: 'POS_OPERATOR_REQUIRED' } }
    expect(() => helper.handleError('users', error)).toThrow(expect.objectContaining({ code: 401 }))
    expect(clear).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
    expect(show).not.toHaveBeenCalled()
  })

  it('403 mit derselben Kennung ist keine Token-Ablehnung: Toast wie bisher, kein Wurf', () => {
    stubSessionStorage()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { show, helper } = setup()
    helper.handleError('users', { code: 403, message: 'verboten', data: { reason: 'POS_OPERATOR_REQUIRED' } })
    expect(show).toHaveBeenCalledTimes(1)
  })

  it('anderer 401: Geräte-Sitzung abgelaufen wie bisher — Toast, sessionStorage leer, Login', () => {
    const clear = stubSessionStorage()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { show, navigate, helper } = setup()
    helper.handleError('users', { code: 401, message: 'jwt expired', data: { reason: 'OTHER' } })
    expect(show).toHaveBeenCalledTimes(1)
    expect(clear).toHaveBeenCalledTimes(1)
    expect(navigate.mock.calls).toEqual([[['/login']]])
  })
})
