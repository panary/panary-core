import { ChangeDetectorRef } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { Router } from '@angular/router'
import { TranslateService } from '@ngx-translate/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiService } from '../../core/api.service'
import { AuthService } from '../../core/auth.service'
import { UserFormComponent } from './user-form'

// Nutzer ohne E-Mail sind speicherbar (panary/panary-core#288). `loadUser` macht
// aus `email: NULL` den Leerstring; der Save-Block strippte ihn — anders als
// `password`, `posPin`, `staffRole`, `employeeNumber` — nicht. AJV prueft
// `format: 'email'` (userSchema, user.schema.ts:188) auf jedem nicht-undefined-
// Wert, also endete JEDER Patch eines POS-Mitarbeiters (Personalnummer + PIN,
// keine E-Mail) in 400 `must match format "email"` — auf einem Feld, das der
// Bediener nie angefasst hatte. Gemessen am 2026-09-12 auf v26.9.3: 2 von 5
// Konten der Dev-DB betroffen, darunter der Reparaturweg aus ADR 0028
// (archivierten Mitarbeiter reaktivieren).
//
// Geprueft wird der Patch-Body, nicht das Rendering (Muster:
// user-status-field.spec) — was gesendet wird, ist der Teil, der still
// schiefgeht.

const ACTOR = { _id: 'u-me', role: 'tenant:technician' }

function setup(loaded: Record<string, unknown> = {}) {
  const patch = vi.fn().mockResolvedValue({})
  const api = {
    get: vi.fn().mockResolvedValue({
      _id: 'u-other',
      firstName: 'Kelly',
      lastName: 'Kasse',
      role: 'tenant:staff',
      status: 'ARCHIVED',
      employeeNumber: '100042',
      hasPosPin: true,
      email: null,
      ...loaded,
    }),
    patch,
    create: vi.fn().mockResolvedValue({ _id: 'u-new' }),
  }

  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: AuthService, useValue: { user: () => ACTOR } },
      { provide: Router, useValue: { navigate: vi.fn() } },
      { provide: TranslateService, useValue: { instant: (key: string) => key } },
      { provide: ChangeDetectorRef, useValue: { markForCheck: () => undefined, detectChanges: () => undefined } },
    ],
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component = TestBed.runInInjectionContext(() => new UserFormComponent()) as unknown as Record<string, any>
  return { component, api, patch }
}

/** Formular in den Zustand „bearbeitet Datensatz X" versetzen, ohne Rendering. */
const openRecord = async (component: Record<string, unknown>, id: string) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = component as any
  c['id'] = () => id
  await c['loadUser'](id)
}

describe('Benutzerformular: Konto ohne E-Mail', () => {
  beforeEach(() => TestBed.resetTestingModule())

  it('laedt email: NULL als Leerstring ins Formular (Ausgangslage des Defekts)', async () => {
    const { component } = setup()
    await openRecord(component, 'u-other')

    expect(component['form'].email).toBe('')
  })

  it('Patch enthaelt KEIN email-Feld — sonst 400 an format: email', async () => {
    const { component, patch } = setup()
    await openRecord(component, 'u-other')

    await component['onSave']({ invalid: false, controls: {} })

    expect(patch).toHaveBeenCalledTimes(1)
    expect('email' in patch.mock.calls[0][2]).toBe(false)
  })

  it('Reaktivieren eines Kontos ohne E-Mail schickt status, aber kein email (ADR 0028)', async () => {
    const { component, patch } = setup()
    await openRecord(component, 'u-other')
    component['form'].status = 'ACTIVE'

    await component['onSave']({ invalid: false, controls: {} })

    const body = patch.mock.calls[0][2]
    expect(body.status).toBe('ACTIVE')
    expect('email' in body).toBe(false)
  })

  it('Neuanlage ohne E-Mail: create-Body traegt kein email-Feld', async () => {
    const { component, api } = setup()
    await openRecord(component, 'new')
    component['form'].firstName = 'Neu'

    await component['onSave']({ invalid: false, controls: {} })

    expect(api.create).toHaveBeenCalledTimes(1)
    expect('email' in api.create.mock.calls[0][1]).toBe(false)
  })

  it('gesetzte E-Mail bleibt unveraendert im Patch', async () => {
    const { component, patch } = setup({ email: 'kelly@example.com' })
    await openRecord(component, 'u-other')

    await component['onSave']({ invalid: false, controls: {} })

    expect(patch.mock.calls[0][2].email).toBe('kelly@example.com')
  })

  it('neu eingegebene E-Mail wird gesendet', async () => {
    const { component, patch } = setup()
    await openRecord(component, 'u-other')
    component['form'].email = 'neu@example.com'

    await component['onSave']({ invalid: false, controls: {} })

    expect(patch.mock.calls[0][2].email).toBe('neu@example.com')
  })

  it('bewusste Folge: eine gesetzte E-Mail laesst sich nicht leeren', async () => {
    const { component, patch } = setup({ email: 'kelly@example.com' })
    await openRecord(component, 'u-other')
    component['form'].email = ''

    await component['onSave']({ invalid: false, controls: {} })

    // Kein `email: ''` im Body — der Server behaelt den alten Wert. Leeren
    // erforderte `''`/`null` im geteilten userSchema (#288, Entscheidung
    // 2026-09-12: bewusst nicht).
    expect('email' in patch.mock.calls[0][2]).toBe(false)
  })
})
