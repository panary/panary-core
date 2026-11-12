import '@angular/compiler'
import { Injector, runInInjectionContext } from '@angular/core'
import { TranslateService } from '@ngx-translate/core'
import { ConnectionService } from '@panary/shared/data-access'
import { POS_PIN_LENGTH } from '@panary/users/domain'
import { DeviceReverifyComponent } from './device-reverify.component'

function setup() {
  const injector = Injector.create({
    providers: [
      { provide: ConnectionService, useValue: { deviceOfflineSince: () => null, usersService: { find: vi.fn() } } },
      { provide: TranslateService, useValue: { instant: (key: string) => key } },
    ],
  })
  const component = runInInjectionContext(injector, () => new DeviceReverifyComponent())
  const verifyPin = vi
    .spyOn(component as unknown as { verifyPin: () => Promise<void> }, 'verifyPin')
    .mockResolvedValue(undefined)
  const api = component as unknown as {
    addDigit: (digit: string) => void
    deleteDigit: () => void
    pinInput: () => string
  }
  return { api, verifyPin }
}

describe('DeviceReverifyComponent — PIN-Eingabe (core#1410)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('reicht bei vollstaendiger PIN-Laenge automatisch ein', () => {
    const { api, verifyPin } = setup()

    for (const digit of '123456'.slice(0, POS_PIN_LENGTH)) api.addDigit(digit)
    vi.advanceTimersByTime(150)

    expect(api.pinInput()).toHaveLength(POS_PIN_LENGTH)
    expect(verifyPin).toHaveBeenCalledTimes(1)
  })

  it('reicht vor der vollstaendigen PIN nicht ein', () => {
    const { api, verifyPin } = setup()

    for (const digit of '123456'.slice(0, POS_PIN_LENGTH - 1)) api.addDigit(digit)
    vi.advanceTimersByTime(150)

    expect(verifyPin).not.toHaveBeenCalled()
  })

  it('nimmt keine Ziffern ueber die PIN-Laenge hinaus an (frueher Obergrenze 6, Einreichung bei 4)', () => {
    const { api } = setup()

    for (const digit of '123456789') api.addDigit(digit)

    expect(api.pinInput()).toHaveLength(POS_PIN_LENGTH)
  })

  it('loescht die letzte Stelle', () => {
    const { api } = setup()
    api.addDigit('1')
    api.addDigit('2')

    api.deleteDigit()

    expect(api.pinInput()).toBe('1')
  })
})
