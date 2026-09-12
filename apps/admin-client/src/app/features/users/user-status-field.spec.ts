import { ChangeDetectorRef } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { Router } from '@angular/router'
import { TranslateService } from '@ngx-translate/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiService } from '../../core/api.service'
import { AuthService } from '../../core/auth.service'
import { UserFormComponent } from './user-form'

// Kontostatus im Benutzerformular (panary/panary-core#275). Bis dahin zeigte die
// Nutzerliste archivierte Konten bewusst weiter — reaktivieren konnte man sie
// aber nicht, weil das Formular kein Status-Feld hatte. Erst damit stimmt die
// Begruendung in ADR 0028.
//
// Geprueft wird die Logik, nicht das Rendering (Muster: device-assignment.spec):
// wann das Feld erscheint und wann `status` ueberhaupt im Patch landet. Das
// Zweite ist der Teil, der sonst still schiefgeht — `status` steht nicht in
// SELF_PATCHABLE_FIELDS, ein mitgesendetes Feld quittiert der Server mit 403.

const ACTOR = { _id: 'u-me', role: 'tenant:technician' }

function setup(loaded: Record<string, unknown> = {}) {
  const patch = vi.fn().mockResolvedValue({})
  const api = {
    get: vi.fn().mockResolvedValue({
      _id: 'u-other',
      firstName: 'Olga',
      lastName: 'Owner',
      role: 'tenant:owner',
      status: 'ARCHIVED',
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

describe('Kontostatus im Benutzerformular', () => {
  beforeEach(() => TestBed.resetTestingModule())

  it('laedt den Status des Kontos ins Formular', async () => {
    const { component } = setup()
    await openRecord(component, 'u-other')

    expect(component['form'].status).toBe('ARCHIVED')
  })

  it('Konto ohne status (Altbestand) faellt auf ACTIVE zurueck', async () => {
    const { component } = setup({ status: undefined })
    await openRecord(component, 'u-other')

    expect(component['form'].status).toBe('ACTIVE')
  })

  it('fremdes Konto → Feld sichtbar', async () => {
    const { component } = setup()
    await openRecord(component, 'u-other')

    expect(component['canEditStatus']()).toBe(true)
  })

  it('eigenes Konto → Feld NICHT sichtbar (Selbst-Aussperrung)', async () => {
    const { component } = setup({ _id: ACTOR._id })
    await openRecord(component, ACTOR._id)

    expect(component['canEditStatus']()).toBe(false)
  })

  it('Neuanlage → Feld NICHT sichtbar', async () => {
    const { component } = setup()
    await openRecord(component, 'new')

    expect(component['isNew']()).toBe(true)
    expect(component['canEditStatus']()).toBe(false)
  })

  it('Reaktivieren schickt status: ACTIVE an den Server', async () => {
    const { component, patch } = setup()
    await openRecord(component, 'u-other')
    component['form'].status = 'ACTIVE'

    await component['onSave']({ invalid: false, controls: {} })

    expect(patch).toHaveBeenCalledTimes(1)
    expect(patch.mock.calls[0][2].status).toBe('ACTIVE')
  })

  it('eigenes Konto: status wird NICHT mitgeschickt (sonst 403 am Self-Patch)', async () => {
    const { component, patch } = setup({ _id: ACTOR._id, status: 'ACTIVE' })
    await openRecord(component, ACTOR._id)

    await component['onSave']({ invalid: false, controls: {} })

    expect(patch).toHaveBeenCalledTimes(1)
    expect('status' in patch.mock.calls[0][2]).toBe(false)
  })

  it('Neuanlage: status wird NICHT mitgeschickt — ein neuer Nutzer ist immer aktiv', async () => {
    const { component, api } = setup()
    await openRecord(component, 'new')
    component['form'].loginname = 'neu'

    await component['onSave']({ invalid: false, controls: {} })

    expect(api.create).toHaveBeenCalledTimes(1)
    expect('status' in api.create.mock.calls[0][1]).toBe(false)
  })
})
