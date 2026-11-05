// core#1173: Das Suchfeld der Produkte hängt ohne `FormsModule` per `[value]` + `(input)` am Signal
// `searchText`. Geprüft wird über das gerenderte Template in beide Richtungen: Tippen filtert die
// Liste, und ein im Code geleertes Signal leert auch das Feld.
import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { TranslateModule } from '@ngx-translate/core'
import { ConnectionService } from '@panary/shared/data-access'
import { describe, expect, it, vi } from 'vitest'

import { ApiService } from '../../core/api.service'
import { CloudManagedService } from '../../core/cloud-managed.service'
import { ProductListComponent } from './product-list'

const product = (id: string, name: string, price: number) => ({
  _id: id,
  name,
  acronym: name.slice(0, 2).toUpperCase(),
  price,
  productType: 'PRODUCT',
  status: 'ACTIVE',
  categoryIds: [],
})

async function render() {
  const api = {
    find: vi.fn((service: string) =>
      Promise.resolve(
        service === 'products'
          ? { total: 2, data: [product('p-1', 'Cheeseburger', 590), product('p-2', 'Cola', 250)] }
          : { total: 0, data: [] },
      ),
    ),
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
    ],
  }).compileComponents()
  const fixture = TestBed.createComponent(ProductListComponent)
  await fixture.whenStable()
  const el = fixture.nativeElement as HTMLElement
  const search = el.querySelector<HTMLInputElement>('input[type="text"]')!
  return { fixture, component: fixture.componentInstance, search }
}

describe('ProductListComponent – Suchfeld', () => {
  it('filtert die Liste mit dem getippten Suchbegriff', async () => {
    const { fixture, component, search } = await render()
    expect(component.filteredProducts()).toHaveLength(2)

    search.value = 'cheese'
    search.dispatchEvent(new Event('input'))
    await fixture.whenStable()

    expect(component.searchText()).toBe('cheese')
    expect(component.filteredProducts().map(p => p._id)).toEqual(['p-1'])
  })

  it('leert das Feld, wenn der Suchbegriff im Code zurückgesetzt wird', async () => {
    const { fixture, component, search } = await render()
    search.value = 'cheese'
    search.dispatchEvent(new Event('input'))
    await fixture.whenStable()

    component.searchText.set('')
    await fixture.whenStable()

    expect(search.value).toBe('')
  })
})

// core#1337: Nach dem Anlegen öffnet die Liste den neuen Datensatz, statt das Formular auf „Neu“ stehen zu lassen.
describe('ProductListComponent – nach dem Speichern', () => {
  it('öffnet das neu angelegte Produkt', async () => {
    const { component } = await render()
    component.selectedId.set('new')

    await component.onItemSaved('x-new')

    expect(component.selectedId()).toBe('x-new')
  })

  it('bleibt beim Ändern auf dem bearbeiteten Datensatz', async () => {
    const { component } = await render()
    component.selectedId.set('x-1')

    await component.onItemSaved()

    expect(component.selectedId()).toBe('x-1')
  })
})
