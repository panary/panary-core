// JIT-Compiler zuerst laden: @angular/material ist partial-compiled (siehe pre-order-quick-dialog.spec).
import '@angular/compiler'
import { describe, expect, it, vi } from 'vitest'
import { createEnvironmentInjector, type EnvironmentInjector, Injector, runInInjectionContext } from '@angular/core'
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog'
import { CashSessionService } from '@panary/businessdays/data-access'
import { CashSessionDialogComponent, type CashSessionDialogData } from './cash-session-dialog.component'

// Der Kassen-Dialog zählt und schließt nur noch; eröffnet wird über die Manager-Freigabe (#888, #1322).
// Geprüft wird `submit()`; das Template rendert diese Lib (environment: 'node') nicht.

function setup(data: Partial<CashSessionDialogData>) {
  const closeSession = vi.fn().mockResolvedValue({ _id: 'cs-1' })
  const injector = createEnvironmentInjector(
    [
      { provide: MatDialogRef, useValue: { close: vi.fn() } },
      { provide: MAT_DIALOG_DATA, useValue: { businessDayId: 'bd-1', ...data } },
      { provide: CashSessionService, useValue: { closeSession } },
    ],
    Injector.create({ providers: [] }) as EnvironmentInjector,
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dialog = runInInjectionContext(injector, () => new CashSessionDialogComponent()) as any
  return { dialog, closeSession }
}

describe('CashSessionDialogComponent – Schließen', () => {
  it('zählt Stückelungen, ein leeres Feld (NaN) zählt wie 0', async () => {
    const { dialog, closeSession } = setup({ session: { _id: 'cs-1' } as never })

    dialog.setCount(200, 3)
    dialog.setCount(50, Number.NaN)
    await dialog.submit()

    expect(closeSession).toHaveBeenCalledWith('cs-1', { denominationCounts: { d_200: 3 } })
  })

  it('schickt bei doppeltem Absenden nur einmal', async () => {
    const { dialog, closeSession } = setup({ session: { _id: 'cs-1' } as never })

    const first = dialog.submit()
    await dialog.submit()
    await first

    expect(closeSession).toHaveBeenCalledTimes(1)
  })
})
