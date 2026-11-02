// JIT-Compiler zuerst laden: @angular/forms/signals zieht das partial-compiled @angular/common.
import '@angular/compiler'
import { describe, expect, it } from 'vitest'
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
import { form } from '@angular/forms/signals'
import { EMPTY_PIN_CHANGE, type PinChange, pinChangeError, pinChangeSchema } from './pin-change-form'

// core#1174: Die PIN-Änderung der POS-Einstellungen läuft auf Signal Forms. Die Regeln stehen im Schema,
// die Meldung der ersten verletzten Regel liefert `pinChangeError` in der Reihenfolge der früheren
// Handler-Prüfungen. Das Template rendert diese Lib (environment: 'node') nicht.

function setup(values: Partial<PinChange>) {
  // `form()` braucht AppId und die beiden Scheduler, die sonst die Plattform stellt.
  const injector = createEnvironmentInjector(
    [
      { provide: ChangeDetectionScheduler, useValue: { notify: () => undefined, runningTick: false } },
      {
        provide: EffectScheduler,
        useValue: { add: () => undefined, schedule: () => undefined, remove: () => undefined, flush: () => undefined },
      },
      { provide: APP_ID, useValue: 'test' },
    ],
    Injector.create({ providers: [] }) as EnvironmentInjector,
  )
  const model = signal<PinChange>({ ...EMPTY_PIN_CHANGE, ...values })
  return runInInjectionContext(injector, () => form(model, p => pinChangeSchema(p, 4)))
}

describe('PIN-Änderung – Schema', () => {
  it('ist mit vierstelligem neuem PIN, passender Wiederholung und anderem alten PIN gültig', () => {
    const f = setup({ currentPin: '1234', newPin: '5678', confirmPin: '5678' })
    expect(f().invalid()).toBe(false)
    expect(pinChangeError(f)).toBeNull()
  })

  it.each([
    [{ currentPin: '12', newPin: '5678', confirmPin: '5678' }, 'SETTINGS.PIN_CURRENT_REQUIRED'],
    [{ currentPin: '1234', newPin: '567', confirmPin: '567' }, 'SETTINGS.PIN_LENGTH_EXACT'],
    [{ currentPin: '1234', newPin: '5678', confirmPin: '5679' }, 'SETTINGS.PIN_MISMATCH'],
    [{ currentPin: '1234', newPin: '1234', confirmPin: '1234' }, 'SETTINGS.PIN_SAME_AS_OLD'],
  ])('meldet %o als %s', (values, key) => {
    expect(pinChangeError(setup(values))).toBe(key)
  })

  it('meldet bei mehreren Verstößen zuerst den fehlenden alten PIN', () => {
    expect(pinChangeError(setup({ currentPin: '', newPin: '', confirmPin: '1' }))).toBe('SETTINGS.PIN_CURRENT_REQUIRED')
  })
})
