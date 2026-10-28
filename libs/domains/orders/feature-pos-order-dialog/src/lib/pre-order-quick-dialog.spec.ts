// JIT-Compiler zuerst laden: @angular/material ist partial-compiled (siehe cancel-order-dialog.component.spec).
import '@angular/compiler'
import { describe, expect, it, vi } from 'vitest'
import {
  APP_ID,
  createEnvironmentInjector,
  type EnvironmentInjector,
  Injector,
  runInInjectionContext,
  signal,
  ɵChangeDetectionScheduler as ChangeDetectionScheduler,
  ɵEffectScheduler as EffectScheduler,
} from '@angular/core'
import { MatDialogRef } from '@angular/material/dialog'
import { LocationService } from '@panary/locations/data-access'
import { ConnectionService } from '@panary/shared/data-access'
import { buildQuickPreOrderPayload, PreOrderQuickDialogComponent } from './pre-order-quick-dialog.component'

// core#1017: Der Vorbestelldialog läuft auf Signal Forms. „Weiter“ hängt an der Gültigkeit des
// jeweiligen Schritts, „Abschließen“ am ganzen Formular, und `order-dialog.component.ts` liest das
// Ergebnis mit genau den Schlüsseln { date, time, dineLocation, name, phone }.

function setup() {
  const close = vi.fn()
  // `form()` braucht AppId und die beiden Scheduler, die sonst die Plattform stellt. Die Validierung
  // selbst sind computed-Signale und läuft ohne sie; die Stubs halten nur den Aufbau am Leben.
  const injector = createEnvironmentInjector(
    [
      { provide: ChangeDetectionScheduler, useValue: { notify: () => undefined, runningTick: false } },
      {
        provide: EffectScheduler,
        useValue: { add: () => undefined, schedule: () => undefined, remove: () => undefined, flush: () => undefined },
      },
      { provide: APP_ID, useValue: 'test' },
      { provide: MatDialogRef, useValue: { close } },
      { provide: LocationService, useValue: { activeLocation: signal(undefined) } },
      { provide: ConnectionService, useValue: {} },
    ],
    Injector.create({ providers: [] }) as EnvironmentInjector,
  )
  const dialog = runInInjectionContext(injector, () => new PreOrderQuickDialogComponent())
  return { dialog, close }
}

function type(dialog: PreOrderQuickDialogComponent, field: 'name' | 'phone', text: string) {
  dialog.setActiveField(field)
  for (const key of text) dialog.onKeyPress(key)
}

describe('PreOrderQuickDialogComponent – Formular', () => {
  it('lässt Schritt 1 erst mit gewählter Uhrzeit weiter', () => {
    const { dialog } = setup()
    expect(dialog.stepValid()).toBe(false)

    dialog.onHourChange(11)
    expect(dialog.stepValid()).toBe(false)

    dialog.onMinuteChange(30)
    expect(dialog.stepValid()).toBe(true)
  })

  it('verlangt einen Namen mit mindestens zwei Zeichen', () => {
    const { dialog } = setup()
    dialog.onHourChange(11)
    dialog.onMinuteChange(30)
    type(dialog, 'phone', '0151')

    type(dialog, 'name', 'A')
    expect(dialog.preOrderForm().valid()).toBe(false)

    dialog.onKeyPress('n')
    expect(dialog.preOrderForm().valid()).toBe(true)
  })

  it('verlangt eine Telefonnummer mit mindestens vier Zeichen', () => {
    const { dialog } = setup()
    dialog.onHourChange(11)
    dialog.onMinuteChange(30)
    type(dialog, 'name', 'Anna')

    type(dialog, 'phone', '015')
    expect(dialog.preOrderForm().valid()).toBe(false)

    dialog.onKeyPress('1')
    expect(dialog.preOrderForm().valid()).toBe(true)

    dialog.onBackspace()
    expect(dialog.preOrderForm.phone().value()).toBe('015')
    expect(dialog.preOrderForm().valid()).toBe(false)
  })

  it('schließt nicht, solange das Formular ungültig ist', () => {
    const { dialog, close } = setup()
    type(dialog, 'name', 'Anna')
    dialog.submit()
    expect(close).not.toHaveBeenCalled()
  })

  it('gibt beim Abschließen alle Eingaben mit den erwarteten Schlüsseln zurück', () => {
    const { dialog, close } = setup()
    const date = new Date(2026, 10, 3)
    dialog.onDateChange(date)
    dialog.onHourChange(9)
    dialog.onMinuteChange(5)
    dialog.setDineLocation('dine-in')
    type(dialog, 'name', 'Anna')
    type(dialog, 'phone', '01511234')

    dialog.submit()

    expect(close).toHaveBeenCalledWith({
      date,
      time: '09:05',
      dineLocation: 'dine-in',
      name: 'Anna',
      phone: '01511234',
    })
  })
})

describe('buildQuickPreOrderPayload (core#1177)', () => {
  const base = { date: new Date(2026, 10, 3), time: '09:05', name: 'Anna', phone: '01511234' }

  it('übernimmt „Im Haus“ in den Payload', () => {
    const payload = buildQuickPreOrderPayload({ ...base, dineLocation: 'dine-in' }, [{ _id: 'li-1' }])

    expect(payload).toEqual({
      customerContact: { name: 'Anna', phone: '01511234' },
      scheduledFor: new Date(2026, 10, 3, 9, 5).toISOString(),
      dineLocation: 'dine-in',
      lineItems: [{ _id: 'li-1' }],
      status: 'pending',
    })
  })

  it('übernimmt „Abholung“ in den Payload', () => {
    expect(buildQuickPreOrderPayload({ ...base, dineLocation: 'take-out' }, []).dineLocation).toBe('take-out')
  })
})
