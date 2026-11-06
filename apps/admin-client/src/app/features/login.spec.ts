// core#1173: Das Login-Formular läuft auf Signal Forms. Geprüft wird über das gerenderte Template,
// denn dort sitzen die Bindungen, die beim Umbau still brechen können: `[formField]` an beiden
// Feldern, der gesperrte Absende-Knopf und der Submit über `[formRoot]` statt `(ngSubmit)`.
import { TestBed } from '@angular/core/testing'
import { Router } from '@angular/router'
import { TranslateModule } from '@ngx-translate/core'
import { describe, expect, it, vi } from 'vitest'

import { AuthService } from '../core/auth.service'
import { EdgeVersionService } from '../core/edge-version.service'
import { LoginComponent } from './login'

async function render(edgeVersion: string | null = null) {
  const login = vi.fn().mockResolvedValue(true)
  const navigate = vi.fn()
  await TestBed.configureTestingModule({
    imports: [LoginComponent, TranslateModule.forRoot()],
    providers: [
      { provide: AuthService, useValue: { login } },
      { provide: Router, useValue: { navigate } },
      { provide: EdgeVersionService, useValue: { load: vi.fn().mockResolvedValue(edgeVersion) } },
    ],
  }).compileComponents()
  const fixture = TestBed.createComponent(LoginComponent)
  await fixture.whenStable()
  fixture.detectChanges()
  const el = fixture.nativeElement as HTMLElement

  async function type(id: string, value: string) {
    const field = el.querySelector<HTMLInputElement>(`#${id}`)!
    field.value = value
    field.dispatchEvent(new Event('input'))
    await fixture.whenStable()
  }
  const submitButton = () => el.querySelector<HTMLButtonElement>('button[type="submit"]')!
  const formEl = () => el.querySelector('form')!

  const versionLine = () => el.querySelector('[data-testid="login-edge-version"]')

  return { fixture, login, navigate, type, submitButton, formEl, versionLine }
}

describe('LoginComponent – Formular', () => {
  it('sperrt den Absende-Knopf, solange E-Mail oder Passwort fehlt', async () => {
    const { type, submitButton } = await render()
    expect(submitButton().disabled).toBe(true)

    await type('login-email', 'chef@example.com')
    expect(submitButton().disabled).toBe(true)

    await type('login-password', 'geheim')
    expect(submitButton().disabled).toBe(false)
  })

  it('sperrt den Absende-Knopf bei Passwort ohne E-Mail', async () => {
    const { type, submitButton } = await render()
    await type('login-password', 'geheim')
    expect(submitButton().disabled).toBe(true)
  })

  it('schickt die getippten Werte an den AuthService und fängt den nativen Submit ab', async () => {
    const { fixture, type, formEl, login, navigate } = await render()
    await type('login-email', 'chef@example.com')
    await type('login-password', 'geheim')

    const event = new Event('submit', { cancelable: true })
    formEl().dispatchEvent(event)
    await fixture.whenStable()

    expect(event.defaultPrevented).toBe(true)
    expect(login).toHaveBeenCalledWith('chef@example.com', 'geheim')
    expect(navigate).toHaveBeenCalledWith(['/'])
  })
})

describe('LoginComponent – Edge-Version', () => {
  it('zeigt die Version des laufenden Edge-Servers unter dem Formular', async () => {
    const { versionLine } = await render('26.11.2')
    expect(versionLine()?.textContent?.trim()).toEqual('v26.11.2')
  })

  it('zeigt ohne Version keine Zeile, das Formular bleibt bedienbar', async () => {
    const { versionLine, type, submitButton } = await render(null)
    expect(versionLine()).toBeNull()
    await type('login-email', 'chef@example.com')
    await type('login-password', 'geheim')
    expect(submitButton().disabled).toBe(false)
  })
})
