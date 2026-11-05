// core#1338: Das ✕ im Kopf des Seitenpanels geht wie Vor/Zurück und der Listenklick über den
// Dirty-Check. Vorher setzte es `selectedId` direkt, und ungespeicherte Änderungen gingen ohne
// Rückfrage verloren — dieselbe Lücke wie in der Benutzerliste.
import { TestBed } from '@angular/core/testing'
import { Router } from '@angular/router'
import { TranslateModule } from '@ngx-translate/core'
import { describe, expect, it, vi } from 'vitest'

import { ApiService } from '../../core/api.service'
import { ApikeyListComponent } from './apikey-list'

const apikey = { _id: 'k-1', name: 'Kasse 1', role: 'device:pos-client', active: true }

async function render() {
  const api = {
    find: vi.fn().mockResolvedValue({ total: 1, data: [apikey] }),
    get: vi.fn().mockResolvedValue(apikey),
    patch: vi.fn().mockResolvedValue({}),
    create: vi.fn().mockResolvedValue({}),
  }
  await TestBed.configureTestingModule({
    imports: [ApikeyListComponent, TranslateModule.forRoot()],
    providers: [
      { provide: ApiService, useValue: api },
      { provide: Router, useValue: { navigate: vi.fn() } },
    ],
  }).compileComponents()
  const fixture = TestBed.createComponent(ApikeyListComponent)
  const component = fixture.componentInstance
  await fixture.whenStable()
  component.selectedId.set('k-1')
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

describe('ApikeyListComponent – Panel schließen', () => {
  it('fragt bei ungespeicherten Änderungen nach, statt das Panel zu schließen', async () => {
    const { fixture, component, el, closeButton, form } = await render()
    vi.spyOn(form(), 'isDirty').mockReturnValue(true)

    closeButton().click()
    await fixture.whenStable()

    expect(component.selectedId()).toBe('k-1')
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
