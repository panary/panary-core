// core#1338: Das ✕ im Kopf des Seitenpanels geht wie Vor/Zurück und der Listenklick über den
// Dirty-Check. Vorher setzte es `selectedId` direkt, und ungespeicherte Änderungen gingen ohne
// Rückfrage verloren — dieselbe Lücke wie in der Benutzerliste.
import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { Router } from '@angular/router'
import { TranslateModule } from '@ngx-translate/core'
import { ConnectionService } from '@panary/shared/data-access'
import { describe, expect, it, vi } from 'vitest'

import { ApiService } from '../../core/api.service'
import { CloudManagedService } from '../../core/cloud-managed.service'
import { ProductListComponent } from './product-list'

const product = {
  _id: 'p-1',
  name: 'Cola',
  acronym: 'CO',
  price: 250,
  productType: 'PRODUCT',
  status: 'ACTIVE',
  categoryIds: [],
}

async function render() {
  const api = {
    find: vi.fn((service: string) =>
      Promise.resolve(service === 'products' ? { total: 1, data: [product] } : { total: 0, data: [] }),
    ),
    get: vi.fn().mockResolvedValue(product),
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
    imports: [ProductListComponent, TranslateModule.forRoot()],
    providers: [
      CloudManagedService,
      { provide: ApiService, useValue: api },
      { provide: ConnectionService, useValue: connection },
      { provide: Router, useValue: { navigate: vi.fn() } },
    ],
  }).compileComponents()
  const fixture = TestBed.createComponent(ProductListComponent)
  const component = fixture.componentInstance
  await fixture.whenStable()
  component.selectedId.set('p-1')
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

describe('ProductListComponent – Panel schließen', () => {
  it('fragt bei ungespeicherten Änderungen nach, statt das Panel zu schließen', async () => {
    const { fixture, component, el, closeButton, form } = await render()
    vi.spyOn(form(), 'isDirty').mockReturnValue(true)

    closeButton().click()
    await fixture.whenStable()

    expect(component.selectedId()).toBe('p-1')
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
