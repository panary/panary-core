// JIT-Compiler zuerst laden: @angular/material ist partial-compiled (siehe pre-order-quick-dialog.spec).
import '@angular/compiler'
import { describe, expect, it, vi } from 'vitest'
import { createEnvironmentInjector, type EnvironmentInjector, Injector, runInInjectionContext } from '@angular/core'
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog'
import { BusinessDayService } from '@panary/businessdays/data-access'
import { ClosingDialogComponent } from './closing-dialog.component'

// core#1323: Im Kassenbetrieb ohne jede Kasse lehnt die Cloud den Tagesabschluss ohne gezählten Endbestand ab.
// Der Dialog fragt ihn dann ab und schickt ihn beim zweiten Absenden mit. Ob der Tag Kassen hatte, entscheidet
// die Cloud: Der POS sieht als Kassierer nur seine eigenen Kassen.
// Geprüft wird die Logik; das Template rendert diese Lib (environment: 'node') nicht.

const MISSING_FLOAT = new Error(
  'countedClosingFloatCents ist Pflicht im pos-cashier-Modus (oder mindestens eine Kassen-Session)',
)

function setup(operationMode: string, ...results: Array<Error | object>) {
  const closeDay = vi.fn()
  for (const r of results) {
    if (r instanceof Error) closeDay.mockRejectedValueOnce(r)
    else closeDay.mockResolvedValueOnce(r)
  }
  const injector = createEnvironmentInjector(
    [
      { provide: MatDialogRef, useValue: { close: vi.fn() } },
      { provide: MAT_DIALOG_DATA, useValue: { businessDay: { _id: 'bd-1', operationMode } } },
      { provide: BusinessDayService, useValue: { closeDay } },
    ],
    Injector.create({ providers: [] }) as EnvironmentInjector,
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dialog = runInInjectionContext(injector, () => new ClosingDialogComponent()) as any
  return { dialog, closeDay }
}

const CLOSED = { _id: 'bd-1', isOpen: false }

describe('ClosingDialogComponent – Endbestand ohne Kasse', () => {
  it('schließt mit Kassen wie bisher ohne Bestand ab', async () => {
    const { dialog, closeDay } = setup('pos-cashier', CLOSED)
    await dialog.submit()

    expect(closeDay).toHaveBeenCalledTimes(1)
    expect(closeDay).toHaveBeenCalledWith({ businessDayId: 'bd-1' })
    expect(dialog.phase()).toBe('submitted')
  })

  it('fragt nach der Ablehnung den Bestand ab und schickt ihn in Cent', async () => {
    const { dialog, closeDay } = setup('pos-cashier', MISSING_FLOAT, CLOSED)
    await dialog.submit()

    expect(dialog.needsCountedFloat()).toBe(true)
    expect(dialog.phase()).toBe('input')

    dialog.setCountedFloat('12,50')
    await dialog.submit()

    expect(closeDay).toHaveBeenLastCalledWith({ businessDayId: 'bd-1', countedClosingFloatCents: 1250 })
    expect(dialog.phase()).toBe('submitted')
  })

  it('schickt ohne Eingabe einen Bestand von 0', async () => {
    const { dialog, closeDay } = setup('pos-cashier', MISSING_FLOAT, CLOSED)
    await dialog.submit()
    await dialog.submit()

    expect(closeDay).toHaveBeenLastCalledWith({ businessDayId: 'bd-1', countedClosingFloatCents: 0 })
  })

  it('lehnt einen negativen oder unlesbaren Bestand ab, ohne erneut abzuschließen', async () => {
    const { dialog, closeDay } = setup('pos-cashier', MISSING_FLOAT)
    await dialog.submit()

    dialog.setCountedFloat('-5')
    await dialog.submit()
    dialog.setCountedFloat('abc')
    await dialog.submit()

    expect(closeDay).toHaveBeenCalledTimes(1)
  })

  it('zeigt jede andere Ablehnung als Fehler, ohne nach dem Bestand zu fragen', async () => {
    const { dialog } = setup('pos-cashier', new Error('Tagesabschluss blockiert — offene Vorbedingungen'))
    await dialog.submit()

    expect(dialog.needsCountedFloat()).toBe(false)
    expect(dialog.phase()).toBe('failed')
  })

  it('fragt im Bestellsystem-Modus nie nach dem Bestand', async () => {
    const { dialog } = setup('orders-only', MISSING_FLOAT)
    await dialog.submit()

    expect(dialog.needsCountedFloat()).toBe(false)
    expect(dialog.phase()).toBe('failed')
  })
})
