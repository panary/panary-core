// JIT-Compiler zuerst laden: @angular/material ist partial-compiled (siehe pre-order-quick-dialog.spec).
import '@angular/compiler'
import { describe, expect, it, vi } from 'vitest'
import {
  APP_ID,
  createEnvironmentInjector,
  type EnvironmentInjector,
  Injector,
  runInInjectionContext,
  ɵChangeDetectionScheduler as ChangeDetectionScheduler,
  ɵEffectScheduler as EffectScheduler,
} from '@angular/core'
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog'
import { CashSessionService } from '@panary/businessdays/data-access'
import { CashSessionDialogComponent, type CashSessionDialogData } from './cash-session-dialog.component'

// core#1174: Der Kassen-Dialog läuft im Eröffnen-Modus auf Signal Forms. Vorher las `canSubmit` die
// einfachen Felder `label_` und `openingFloatEuros` in einem computed, das sie nicht verfolgte. Geprüft
// werden Schema und `submit()`; das Template rendert diese Lib (environment: 'node') nicht.

function setup(data: Partial<CashSessionDialogData> = {}) {
  const openSession = vi.fn().mockResolvedValue({ _id: 'cs-1' })
  const closeSession = vi.fn().mockResolvedValue({ _id: 'cs-1' })
  // `form()` braucht AppId und die beiden Scheduler, die sonst die Plattform stellt.
  const injector = createEnvironmentInjector(
    [
      { provide: ChangeDetectionScheduler, useValue: { notify: () => undefined, runningTick: false } },
      {
        provide: EffectScheduler,
        useValue: { add: () => undefined, schedule: () => undefined, remove: () => undefined, flush: () => undefined },
      },
      { provide: APP_ID, useValue: 'test' },
      { provide: MatDialogRef, useValue: { close: vi.fn() } },
      { provide: MAT_DIALOG_DATA, useValue: { businessDayId: 'bd-1', ...data } },
      { provide: CashSessionService, useValue: { openSession, closeSession } },
    ],
    Injector.create({ providers: [] }) as EnvironmentInjector,
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dialog = runInInjectionContext(injector, () => new CashSessionDialogComponent()) as any
  return { dialog, openSession, closeSession }
}

describe('CashSessionDialogComponent – Eröffnen', () => {
  it('gibt „Eröffnen" erst mit Bezeichnung und Anfangsbestand frei', () => {
    const { dialog } = setup({ defaultLabel: 'Kasse 1' })
    expect(dialog.canSubmit()).toBe(false)

    dialog.openForm.openingFloatEuros().value.set(150)
    expect(dialog.canSubmit()).toBe(true)

    dialog.openForm.label().value.set('   ')
    expect(dialog.canSubmit()).toBe(false)
  })

  it('sperrt einen negativen Anfangsbestand', () => {
    const { dialog } = setup({ defaultLabel: 'Kasse 1' })
    dialog.openForm.openingFloatEuros().value.set(-5)
    expect(dialog.canSubmit()).toBe(false)
  })

  it('schickt Bezeichnung und Anfangsbestand in Cent', async () => {
    const { dialog, openSession } = setup({ defaultLabel: ' Kasse 1 ' })
    dialog.openForm.openingFloatEuros().value.set(150.5)

    await dialog.submit()

    expect(openSession).toHaveBeenCalledWith({ businessDayId: 'bd-1', label: 'Kasse 1', openingFloatCents: 15050 })
  })

  it('schickt bei ungültigem Formular nichts', async () => {
    const { dialog, openSession } = setup({ defaultLabel: 'Kasse 1' })
    await dialog.submit()
    expect(openSession).not.toHaveBeenCalled()
  })
})

describe('CashSessionDialogComponent – Schließen', () => {
  it('zählt Stückelungen, ein leeres Feld (NaN) zählt wie 0', async () => {
    const { dialog, closeSession } = setup({ session: { _id: 'cs-1' } as never })
    expect(dialog.canSubmit()).toBe(true)

    dialog.setCount(200, 3)
    dialog.setCount(50, Number.NaN)
    await dialog.submit()

    expect(closeSession).toHaveBeenCalledWith('cs-1', { denominationCounts: { d_200: 3 } })
  })
})
