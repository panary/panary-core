// core#1173: Das Produktgruppen-Formular läuft auf Signal Forms. Geprüft wird über das gerenderte Template:
// Pflichtname, Reihenfolge und MwSt.-Grenzen sperren das Speichern, der Name vergibt beim Tippen eine Farbe,
// und die getippten Werte landen im Patch.
import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { Router } from '@angular/router'
import { TranslateModule } from '@ngx-translate/core'
import { ConnectionService } from '@panary/shared/data-access'
import { describe, expect, it, vi } from 'vitest'

import { ApiService } from '../../core/api.service'
import { CloudManagedService } from '../../core/cloud-managed.service'
import { GroupFormComponent } from './group-form'

async function render(id: string) {
  const api = {
    find: vi.fn().mockResolvedValue({ data: [] }),
    get: vi.fn().mockResolvedValue({ _id: 'g-1', name: 'Burger', acronym: 'BU', color: '#2563eb', index: 2 }),
    patch: vi.fn().mockResolvedValue({}),
    create: vi.fn().mockResolvedValue({}),
  }
  const connection = {
    healthLoaded: signal(true),
    cloudPaired: signal(false),
    emergencyOverrideActive: signal(false),
    emergencyOverrideSinceMin: signal<number | null>(null),
    cloudUnreachable: signal(false),
    cloudContactUnknown: signal(false),
    refreshHealth: vi.fn().mockResolvedValue(undefined),
  }
  await TestBed.configureTestingModule({
    imports: [GroupFormComponent, TranslateModule.forRoot()],
    providers: [
      CloudManagedService,
      { provide: ApiService, useValue: api },
      { provide: ConnectionService, useValue: connection },
      { provide: Router, useValue: { navigate: vi.fn() } },
    ],
  }).compileComponents()
  const fixture = TestBed.createComponent(GroupFormComponent)
  fixture.componentRef.setInput('id', id)
  // Zoneless wartet `whenStable` nicht auf das Mock-Promise von `api.get`.
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => setTimeout(resolve))
    await fixture.whenStable()
  }
  const el = fixture.nativeElement as HTMLElement
  async function type(fieldId: string, value: string) {
    const field = el.querySelector<HTMLInputElement>(`#${fieldId}`)!
    field.value = value
    field.dispatchEvent(new Event('input'))
    await fixture.whenStable()
  }
  const saveButton = () => el.querySelector<HTMLButtonElement>('button[type="submit"]')!
  return { fixture, el, api, type, saveButton }
}

describe('GroupFormComponent – Formular', () => {
  it('Neuanlage: sperrt ohne Namen', async () => {
    const { type, saveButton } = await render('new')
    expect(saveButton().disabled).toBe(true)
    await type('groupName', 'Getränke')
    expect(saveButton().disabled).toBe(false)
  })

  it('sperrt eine leere Reihenfolge und MwSt. über 100', async () => {
    const { type, saveButton } = await render('g-1')
    expect(saveButton().disabled).toBe(false)

    await type('groupSortOrder', '')
    expect(saveButton().disabled).toBe(true)

    await type('groupSortOrder', '3')
    await type('groupVatIn', '120')
    expect(saveButton().disabled).toBe(true)
  })

  it('vergibt beim Tippen des Namens eine Farbe über den getippten Wert', async () => {
    const { fixture, type } = await render('new')
    const assign = vi.spyOn(fixture.componentInstance, 'autoAssignColor')
    await type('groupName', 'Desserts')

    expect(assign).toHaveBeenCalledWith('Desserts')
    expect(fixture.componentInstance.colorPalette).toContain(fixture.componentInstance.group().color)
  })

  it('zeigt den geladenen Namen und schickt den getippten im Patch', async () => {
    const { fixture, el, type, api } = await render('g-1')
    expect(el.querySelector<HTMLInputElement>('#groupName')!.value).toBe('Burger')

    await type('groupName', 'Burger & Wraps')
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await fixture.whenStable()

    expect(api.patch).toHaveBeenCalledWith('product-groups', 'g-1', expect.objectContaining({ name: 'Burger & Wraps' }))
  })
})
