// core#1338: Das ✕ im Kopf des Seitenpanels geht wie Vor/Zurück und der Listenklick über den
// Dirty-Check. Vorher setzte es `selectedId` direkt, und ungespeicherte Änderungen gingen ohne
// Rückfrage verloren.
import { TestBed } from '@angular/core/testing'
import { Router } from '@angular/router'
import { TranslateModule } from '@ngx-translate/core'
import { describe, expect, it, vi } from 'vitest'

import { ApiService } from '../../core/api.service'
import { AuthService } from '../../core/auth.service'
import { UserListComponent } from './user-list'

const user = { _id: 'u-1', loginname: 'olga', firstName: 'Olga', lastName: 'B', role: 'tenant:staff', status: 'ACTIVE' }

async function render() {
  const api = {
    find: vi.fn().mockResolvedValue({ total: 1, data: [user] }),
    get: vi.fn().mockResolvedValue(user),
    patch: vi.fn().mockResolvedValue({}),
    create: vi.fn().mockResolvedValue({}),
  }
  await TestBed.configureTestingModule({
    imports: [UserListComponent, TranslateModule.forRoot()],
    providers: [
      { provide: ApiService, useValue: api },
      { provide: AuthService, useValue: { user: () => ({ _id: 'u-me' }) } },
      { provide: Router, useValue: { navigate: vi.fn() } },
    ],
  }).compileComponents()
  const fixture = TestBed.createComponent(UserListComponent)
  const component = fixture.componentInstance
  await fixture.whenStable()
  component.selectedId.set('u-1')
  // Zoneless wartet `whenStable` nicht auf das Mock-Promise von `api.get`.
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => setTimeout(resolve))
    await fixture.whenStable()
  }
  const el = fixture.nativeElement as HTMLElement
  const closeButton = () => [...el.querySelectorAll('button')].find(b => b.textContent?.trim() === '✕')!
  const form = () => (component as unknown as { formRef: () => { isDirty: () => boolean } }).formRef()
  return { fixture, component, el, closeButton, form }
}

describe('UserListComponent – Panel schließen', () => {
  it('fragt bei ungespeicherten Änderungen nach, statt das Panel zu schließen', async () => {
    const { fixture, component, el, closeButton, form } = await render()
    vi.spyOn(form(), 'isDirty').mockReturnValue(true)

    closeButton().click()
    await fixture.whenStable()

    expect(component.selectedId()).toBe('u-1')
    expect(el.querySelector('app-confirm-dialog')).not.toBeNull()
  })

  it('schließt ohne Rückfrage, wenn nichts geändert ist', async () => {
    const { fixture, component, el, closeButton, form } = await render()
    vi.spyOn(form(), 'isDirty').mockReturnValue(false)

    closeButton().click()
    await fixture.whenStable()

    expect(component.selectedId()).toBeNull()
    expect(el.querySelector('app-confirm-dialog')).toBeNull()
  })
})
