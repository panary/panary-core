import { TestBed } from '@angular/core/testing'
import { TranslateModule } from '@ngx-translate/core'
import { of } from 'rxjs'
import { SetupService } from '../setup.service'
import { Wizard } from './wizard'

// core#1017: Das Konfigurationsformular läuft auf Signal Forms. Geprüft wird über das gerenderte
// Template, denn dort sitzen die Bindungen, die beim Umbau brechen können: `[formField]` an jedem
// Feld, der gesperrte Absende-Knopf und der Submit über `[formRoot]` statt `(ngSubmit)`.

const VALID = {
  setupToken: 'token-123',
  shopName: 'Bäckerei',
  locationName: 'Hauptfiliale',
  businessType: 'CAFE_BAKERY',
  adminEmail: 'chef@example.com',
  adminPassword: 'geheim123',
  adminPasswordConfirm: 'geheim123',
}

async function render() {
  const setup = vi.fn(() => of({}))
  await TestBed.configureTestingModule({
    imports: [Wizard, TranslateModule.forRoot()],
    providers: [{ provide: SetupService, useValue: { setup } }],
  }).compileComponents()
  const fixture = TestBed.createComponent(Wizard)
  const wizard = fixture.componentInstance
  wizard.mode.set('standalone')
  wizard.step.set(3)
  await fixture.whenStable()
  const el = fixture.nativeElement as HTMLElement

  async function type(id: keyof typeof VALID, value: string) {
    const field = el.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!
    field.value = value
    // Der Browser feuert bei Eingabe und Auswahl `input`; darauf hört `[formField]`.
    field.dispatchEvent(new Event('input'))
    await fixture.whenStable()
  }
  async function fill(values: Partial<typeof VALID> = {}) {
    for (const [id, value] of Object.entries({ ...VALID, ...values })) {
      await type(id as keyof typeof VALID, value)
    }
  }
  const submitButton = () => el.querySelector<HTMLButtonElement>('button[type="submit"]')!

  return { fixture, wizard, el, setup, fill, submitButton }
}

describe('Wizard – Konfigurationsformular', () => {
  beforeEach(() => {
    // Wie app.spec.ts: Das globale localStorage von Node 25+ hat ohne --localstorage-file kein getItem.
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('gibt den Absende-Knopf erst mit vollständigen, gültigen Eingaben frei', async () => {
    const { fill, submitButton } = await render()
    expect(submitButton().disabled).toBe(true)

    await fill()
    expect(submitButton().disabled).toBe(false)
  })

  it('sperrt bei abweichender Passwort-Wiederholung', async () => {
    const { fill, submitButton } = await render()
    await fill({ adminPasswordConfirm: 'geheim124' })
    expect(submitButton().disabled).toBe(true)
  })

  it('sperrt bei zu kurzem Passwort', async () => {
    const { fill, submitButton } = await render()
    await fill({ adminPassword: 'kurz123', adminPasswordConfirm: 'kurz123' })
    expect(submitButton().disabled).toBe(true)
  })

  it('sperrt bei ungültiger E-Mail', async () => {
    const { fill, submitButton } = await render()
    await fill({ adminEmail: 'chef-at-example' })
    expect(submitButton().disabled).toBe(true)
  })

  it('sendet beim Absenden die Eingaben, das Token getrennt vom Payload', async () => {
    const { el, fill, setup } = await render()
    await fill()

    const event = new Event('submit', { cancelable: true })
    el.querySelector('form')!.dispatchEvent(event)

    // Ohne preventDefault lüde der Browser die Seite neu, statt den Setup-Aufruf abzuwarten.
    expect(event.defaultPrevented).toBe(true)
    expect(setup).toHaveBeenCalledWith(
      {
        mode: 'standalone',
        shopName: 'Bäckerei',
        locationName: 'Hauptfiliale',
        businessType: 'CAFE_BAKERY',
        adminEmail: 'chef@example.com',
        adminPassword: 'geheim123',
      },
      'token-123',
    )
  })
})
