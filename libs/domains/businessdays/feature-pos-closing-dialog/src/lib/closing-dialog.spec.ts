// JIT-Compiler zuerst laden: @angular/material ist partial-compiled (siehe pre-order-quick-dialog.spec).
import '@angular/compiler'
import { describe, expect, it, vi } from 'vitest'
import { createEnvironmentInjector, type EnvironmentInjector, Injector, runInInjectionContext } from '@angular/core'
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog'
import { BusinessDayService, CashSessionService } from '@panary/businessdays/data-access'
import { ClosingDialogComponent } from './closing-dialog.component'

// core#1323: Im Kassenbetrieb ohne jede Kasse verlangt die Cloud beim Tagesabschluss einen gezählten Endbestand.
// Der Dialog fragt ihn dann ab; mit Kassen bleibt der Abschluss wie bisher ohne Bestand.
// Geprüft wird die Logik; das Template rendert diese Lib (environment: 'node') nicht.

function setup(operationMode: string, sessions: unknown[]) {
  const closeDay = vi.fn().mockResolvedValue({ _id: 'bd-1', isOpen: false })
  const loadForBusinessDay = vi.fn().mockResolvedValue(sessions)
  const injector = createEnvironmentInjector(
    [
      { provide: MatDialogRef, useValue: { close: vi.fn() } },
      { provide: MAT_DIALOG_DATA, useValue: { businessDay: { _id: 'bd-1', operationMode } } },
      { provide: BusinessDayService, useValue: { closeDay } },
      { provide: CashSessionService, useValue: { loadForBusinessDay } },
    ],
    Injector.create({ providers: [] }) as EnvironmentInjector,
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dialog = runInInjectionContext(injector, () => new ClosingDialogComponent()) as any
  return { dialog, closeDay, loadForBusinessDay }
}

describe('ClosingDialogComponent – Endbestand ohne Kasse', () => {
  it('fragt im Kassenbetrieb ohne Kasse den Bestand ab und schickt ihn in Cent', async () => {
    const { dialog, closeDay } = setup('pos-cashier', [])
    await dialog.sessionsLoaded

    expect(dialog.needsCountedFloat()).toBe(true)
    dialog.setCountedFloat('12,50')
    await dialog.submit()

    expect(closeDay).toHaveBeenCalledWith({ businessDayId: 'bd-1', countedClosingFloatCents: 1250 })
  })

  it('schickt ohne Eingabe einen Bestand von 0', async () => {
    const { dialog, closeDay } = setup('pos-cashier', [])
    await dialog.sessionsLoaded
    await dialog.submit()

    expect(closeDay).toHaveBeenCalledWith({ businessDayId: 'bd-1', countedClosingFloatCents: 0 })
  })

  it('lehnt einen negativen oder unlesbaren Bestand ab, ohne abzuschließen', async () => {
    const { dialog, closeDay } = setup('pos-cashier', [])
    await dialog.sessionsLoaded

    dialog.setCountedFloat('-5')
    await dialog.submit()
    dialog.setCountedFloat('abc')
    await dialog.submit()

    expect(closeDay).not.toHaveBeenCalled()
  })

  it('schließt mit Kassen wie bisher ohne Bestand', async () => {
    const { dialog, closeDay } = setup('pos-cashier', [{ _id: 'cs-1' }])
    await dialog.sessionsLoaded

    expect(dialog.needsCountedFloat()).toBe(false)
    await dialog.submit()

    expect(closeDay).toHaveBeenCalledWith({ businessDayId: 'bd-1' })
  })

  it('lädt im Bestellsystem-Modus keine Kassen und fragt keinen Bestand ab', async () => {
    const { dialog, closeDay, loadForBusinessDay } = setup('orders-only', [])
    await dialog.sessionsLoaded
    await dialog.submit()

    expect(loadForBusinessDay).not.toHaveBeenCalled()
    expect(closeDay).toHaveBeenCalledWith({ businessDayId: 'bd-1' })
  })
})
