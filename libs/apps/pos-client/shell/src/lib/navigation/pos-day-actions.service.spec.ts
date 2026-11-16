// JIT-Compiler zuerst laden: @angular/material ist partial-compiled.
import '@angular/compiler'
import { Injector, runInInjectionContext, signal } from '@angular/core'
import { MatDialog } from '@angular/material/dialog'
import { TranslateService } from '@ngx-translate/core'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { BusinessDayService, CashSessionService } from '@panary/businessdays/data-access'
import { LocationService } from '@panary/locations/data-access'
import { evaluatePosVersion, PosVersionPolicyService } from '@panary/shared/data-access'
import { NotificationService } from '@panary/shared/ui-notifications'

// Der Dialog selbst (Material, Template) gehört nicht zu dieser Spec: Geprüft wird, ob der Menüweg ihn öffnet.
const authorizeOpened = vi.hoisted(() => vi.fn())
vi.mock('@panary/businessdays/feature-pos-closing-dialog', () => ({
  CashSessionDialogComponent: class CashSessionDialogComponent {},
  ClosingDialogComponent: class ClosingDialogComponent {},
  OpeningDialogComponent: class OpeningDialogComponent {},
  openManagerAuthorizeCashSessionDialog: authorizeOpened,
}))
vi.mock('@panary/write-offs/feature-pos-dialog', () => ({ PosWriteOffDialogComponent: class {} }))

import { PosDayActionsService } from './pos-day-actions.service'
import { PosStaffService } from './pos-staff.service'

function setup(options: { posVersion?: string; minVersion?: string | null; openSession?: boolean } = {}) {
  const { posVersion = '26.11.19', minVersion = null, openSession = false } = options
  authorizeOpened.mockClear()

  const notifications = new NotificationService()
  const error = vi.spyOn(notifications, 'error')
  const dialog = { open: vi.fn() }
  const findOpenForUser = vi.fn().mockResolvedValue(openSession ? { _id: 'cs-1' } : null)
  const refreshed = vi.fn()

  const injector = Injector.create({
    providers: [
      { provide: MatDialog, useValue: dialog },
      {
        provide: LocationService,
        useValue: {
          activeLocation: signal({ _id: 'loc-1', currentBusinessDay: { businessDayId: 'bd-1' } }),
        },
      },
      { provide: BusinessDayService, useValue: {} },
      { provide: CashSessionService, useValue: { findOpenForUser } },
      { provide: PosStaffService, useValue: { currentUser: () => ({ _id: 'u-anna', firstName: 'Anna' }) } },
      {
        provide: PosVersionPolicyService,
        useValue: {
          posVersion,
          requiredPosMinVersion: () => minVersion,
          verdictFresh: async () => {
            refreshed()
            return evaluatePosVersion({ posVersion, edgeVersion: '26.11.19', requiredPosMinVersion: minVersion })
          },
        },
      },
      { provide: NotificationService, useValue: notifications },
      {
        provide: TranslateService,
        useValue: {
          instant: (key: string, params: Record<string, string>) => `${key}:${params['current']}<${params['required']}`,
        },
      },
    ],
  })
  const service = runInInjectionContext(injector, () => new PosDayActionsService())
  // `manageCashSession` startet einen nicht abwartbaren Ablauf; ein Mikrotask-Durchlauf genügt für die Mocks.
  const run = async () => {
    service.manageCashSession()
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  return { run, error, dialog, authorizeOpened, refreshed }
}

describe('PosDayActionsService.manageCashSession — Mindestversion (core#1441)', () => {
  it('verweigert den Start der Kassensitzung unter der Mindestversion und nennt beide Versionen', async () => {
    const { run, error } = setup({ posVersion: '26.8.1', minVersion: '26.11.1' })

    await run()

    expect(authorizeOpened).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledTimes(1)
    expect(error.mock.calls[0][0]).toBe('VERSION.BELOW_MINIMUM:26.8.1<26.11.1')
  })

  it('holt vor der Entscheidung einen frischen Health-Stand', async () => {
    const { run, refreshed } = setup({ posVersion: '26.8.1', minVersion: '26.11.1' })

    await run()

    expect(refreshed).toHaveBeenCalledTimes(1)
  })

  it('startet die Kassensitzung ohne Mindestversion immer', async () => {
    const { run, error } = setup({ posVersion: '26.1.1', minVersion: null })

    await run()

    expect(authorizeOpened).toHaveBeenCalledTimes(1)
    expect(error).not.toHaveBeenCalled()
  })

  it('startet die Kassensitzung auf oder über der Mindestversion', async () => {
    const { run } = setup({ posVersion: '26.11.19', minVersion: '26.11.19' })

    await run()

    expect(authorizeOpened).toHaveBeenCalledTimes(1)
  })

  it('öffnet bei offener eigener Kasse den Zähl-Dialog, auch unter der Mindestversion', async () => {
    const { run, error, dialog } = setup({ posVersion: '26.8.1', minVersion: '26.11.1', openSession: true })

    await run()

    expect(dialog.open).toHaveBeenCalledTimes(1)
    expect(authorizeOpened).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })
})

// Ein laufender Verkauf scheitert nie an der Versionsprüfung (ADR 0070): Die Kassen-Freigabe mitten im Bezahlen und
// der Outbox-Replay öffnen die Kasse über `promptCashSessionAuthorization`, nicht über den Menüweg. Beide Wege dürfen
// die Versionsprüfung nie kennen. Die node-Config rendert nichts, deshalb prüft diese Spec die Quelle.
describe('Verkaufspfad — keine Versionsprüfung (core#1441)', () => {
  const read = (relative: string) => readFileSync(join(__dirname, '../../../../../../..', relative), 'utf8')

  it.each([
    'libs/domains/businessdays/feature-pos-closing-dialog/src/lib/cash-session-prompt.ts',
    'libs/domains/businessdays/feature-pos-closing-dialog/src/lib/manager-authorize-cash-session-dialog.component.ts',
    'libs/domains/businessdays/data-access/src/lib/services/cash-session.service.ts',
    'libs/domains/orders/feature-pos-order-dialog/src/lib/cash-payment-dialog.component.ts',
    'apps/pos-client/src/app/pos-outbox-replay.service.ts',
  ])('%s fragt die Versionspolitik nicht ab', file => {
    expect(read(file)).not.toMatch(/PosVersionPolicyService|versionBlocksStart|evaluatePosVersion/)
  })
})
