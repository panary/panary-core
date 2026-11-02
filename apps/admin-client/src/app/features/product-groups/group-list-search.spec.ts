// core#1173: Das Suchfeld der Produktgruppen hängt ohne `FormsModule` per `[value]` + `(input)` am
// Signal `searchText`. Geprüft wird über das gerenderte Template in beide Richtungen: Tippen filtert
// die Liste, und ein im Code geleertes Signal leert auch das Feld.
import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { TranslateModule } from '@ngx-translate/core'
import { ConnectionService } from '@panary/shared/data-access'
import { describe, expect, it, vi } from 'vitest'

import { ApiService } from '../../core/api.service'
import { CloudManagedService } from '../../core/cloud-managed.service'
import { GroupListComponent } from './group-list'

const group = (id: string, name: string) => ({
  _id: id,
  name,
  acronym: name.slice(0, 2).toUpperCase(),
  color: '#2563eb',
  index: 0,
  taxInside: 7,
  taxOutside: 7,
  excluded: false,
  status: 'ACTIVE',
})

async function render() {
  const api = {
    find: vi.fn().mockResolvedValue({ total: 2, data: [group('g-1', 'Burger'), group('g-2', 'Getränke')] }),
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
    imports: [GroupListComponent, TranslateModule.forRoot()],
    providers: [
      CloudManagedService,
      { provide: ApiService, useValue: api },
      { provide: ConnectionService, useValue: connection },
    ],
  }).compileComponents()
  const fixture = TestBed.createComponent(GroupListComponent)
  await fixture.whenStable()
  const el = fixture.nativeElement as HTMLElement
  const search = el.querySelector<HTMLInputElement>('input[type="text"]')!
  return { fixture, component: fixture.componentInstance, search }
}

describe('GroupListComponent – Suchfeld', () => {
  it('filtert die Liste mit dem getippten Suchbegriff', async () => {
    const { fixture, component, search } = await render()
    expect(component.filteredGroups()).toHaveLength(2)

    search.value = 'burg'
    search.dispatchEvent(new Event('input'))
    await fixture.whenStable()

    expect(component.searchText()).toBe('burg')
    expect(component.filteredGroups().map(g => g._id)).toEqual(['g-1'])
  })

  it('leert das Feld, wenn der Suchbegriff im Code zurückgesetzt wird', async () => {
    const { fixture, component, search } = await render()
    search.value = 'burg'
    search.dispatchEvent(new Event('input'))
    await fixture.whenStable()

    component.searchText.set('')
    await fixture.whenStable()

    expect(search.value).toBe('')
  })
})
