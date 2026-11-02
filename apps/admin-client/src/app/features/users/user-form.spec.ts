// core#1173: Das Benutzerformular läuft auf Signal Forms. Geprüft wird über das gerenderte Template:
// Pflicht- und Formatregeln sperren das Speichern (Passwort nur bei Neuanlage, Personalnummer und PIN
// nur für POS-Benutzer, Rabattgrenze je Rabattart), und ein geladener Datensatz steht in den Feldern.
import { TestBed } from '@angular/core/testing'
import { Router } from '@angular/router'
import { TranslateModule } from '@ngx-translate/core'
import { describe, expect, it, vi } from 'vitest'

import { ApiService } from '../../core/api.service'
import { AuthService } from '../../core/auth.service'
import { UserFormComponent } from './user-form'

async function render(id: string, loaded: Record<string, unknown> = {}) {
  const api = {
    get: vi
      .fn()
      .mockResolvedValue({ _id: 'u-other', loginname: 'olga', role: 'tenant:staff', status: 'ACTIVE', ...loaded }),
    patch: vi.fn().mockResolvedValue({}),
    create: vi.fn().mockResolvedValue({ _id: 'u-new' }),
  }
  await TestBed.configureTestingModule({
    imports: [UserFormComponent, TranslateModule.forRoot()],
    providers: [
      { provide: ApiService, useValue: api },
      { provide: AuthService, useValue: { user: () => ({ _id: 'u-me' }) } },
      { provide: Router, useValue: { navigate: vi.fn() } },
    ],
  }).compileComponents()
  const fixture = TestBed.createComponent(UserFormComponent)
  fixture.componentRef.setInput('id', id)
  // Zoneless wartet `whenStable` nicht auf das Mock-Promise von `api.get`.
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => setTimeout(resolve))
    await fixture.whenStable()
  }
  const el = fixture.nativeElement as HTMLElement

  async function type(fieldId: string, value: string) {
    const field = el.querySelector<HTMLInputElement | HTMLSelectElement>(`#${fieldId}`)!
    field.value = value
    field.dispatchEvent(new Event('input'))
    await fixture.whenStable()
  }
  async function check(label: string, checked: boolean) {
    const box = [...el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(b =>
      b.closest('label')?.textContent?.includes(label),
    )!
    if (box.checked !== checked) box.click()
    await fixture.whenStable()
  }
  const saveButton = () => el.querySelector<HTMLButtonElement>('button[type="submit"]')!

  return { fixture, el, api, type, check, saveButton }
}

describe('UserFormComponent – Formular', () => {
  it('Neuanlage: sperrt ohne Loginname und ohne Passwort', async () => {
    const { type, saveButton } = await render('new')
    expect(saveButton().disabled).toBe(true)

    await type('userLoginname', 'neu')
    expect(saveButton().disabled).toBe(true)

    await type('userPassword', 'geheim')
    expect(saveButton().disabled).toBe(false)
  })

  it('Bearbeiten: zeigt den geladenen Loginnamen und verlangt kein Passwort', async () => {
    const { el, saveButton } = await render('u-other')
    expect(el.querySelector<HTMLInputElement>('#userLoginname')!.value).toBe('olga')
    expect(saveButton().disabled).toBe(false)
  })

  it('sperrt eine ungültige E-Mail', async () => {
    const { type, saveButton } = await render('u-other')
    await type('userEmail', 'keine-adresse')
    expect(saveButton().disabled).toBe(true)
  })

  it('prüft Personalnummer nur für POS-Benutzer', async () => {
    const { type, check, saveButton } = await render('u-other')
    await type('employeeNumber', '12')
    expect(saveButton().disabled).toBe(true)

    await check('USERS.POS_USER', false)
    expect(saveButton().disabled).toBe(false)
  })

  it('sperrt eine PIN mit weniger als vier Ziffern', async () => {
    const { type, saveButton } = await render('new')
    await type('userLoginname', 'neu')
    await type('userPassword', 'geheim')
    await type('posPin', '12')
    expect(saveButton().disabled).toBe(true)

    await type('posPin', '1234')
    expect(saveButton().disabled).toBe(false)
  })

  it('begrenzt den Rabatt in Prozent auf 100', async () => {
    const { type, check, saveButton } = await render('u-other')
    await check('USERS.STAFF_MEAL_ELIGIBLE', true)
    await type('discountValue', '120')
    expect(saveButton().disabled).toBe(true)

    await type('discountType', 'amount')
    expect(saveButton().disabled).toBe(false)
  })

  it('schickt den getippten Loginnamen im Patch', async () => {
    const { fixture, el, type, api } = await render('u-other')
    await type('userLoginname', 'olga.k')
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await fixture.whenStable()

    expect(api.patch).toHaveBeenCalledWith('users', 'u-other', expect.objectContaining({ loginname: 'olga.k' }))
  })
})
