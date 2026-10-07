// Sichtbarkeits-Schalter der Produktgruppen (panary/panary-core#636).
//
// Zwei schnelle Klicks schickten zweimal `excluded: 1`: Der Zielwert kam aus dem Signal der Liste,
// das erst nach dem ersten PATCH nachzog. Gefunden im Sichttest-Durchlauf panary/panary-core#623.
import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { TranslateService } from '@ngx-translate/core'
import { ConnectionService } from '@panary/shared/data-access'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiService } from '../../core/api.service'
import { CloudManagedService } from '../../core/cloud-managed.service'
import { GroupListComponent } from './group-list'

const GROUP = {
  _id: 'g-1',
  name: 'Burger',
  acronym: 'B',
  color: '#2563eb',
  index: 0,
  taxInside: 7,
  taxOutside: 7,
  excluded: false,
  status: 'ACTIVE',
}

/** Ein PATCH, dessen Antwort der Test selbst freigibt — so lässt sich „zweiter Klick vor der ersten Antwort" bauen. */
function deferred() {
  let resolve!: (v: unknown) => void
  let reject!: (e: unknown) => void
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup(patch: (id: string, data: { excluded: boolean }) => Promise<unknown>, serverExcluded = false) {
  const api = {
    find: vi.fn().mockResolvedValue({ total: 1, data: [{ ...GROUP }] }),
    get: vi.fn().mockResolvedValue({ ...GROUP, excluded: serverExcluded }),
    patch: vi.fn((_service: string, id: string, data: { excluded: boolean }) => patch(id, data)),
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
  TestBed.configureTestingModule({
    providers: [
      CloudManagedService,
      { provide: ApiService, useValue: api },
      { provide: ConnectionService, useValue: connection },
      { provide: TranslateService, useValue: { instant: (k: string) => k } },
    ],
  })
  const component = TestBed.runInInjectionContext(() => new GroupListComponent())
  return { component, api, connection }
}

/** Der Klick auf die native Checkbox hat sie schon umgeschaltet, bevor `(change)` feuert. */
const click = (checked: boolean) => ({ target: { checked } }) as unknown as Event

const excludedOf = (component: GroupListComponent) => component.groups().find(g => g._id === 'g-1')?.excluded

/** Mikrotasks abarbeiten lassen, ohne auf einen bestimmten Promise zu warten. */
const flush = () => new Promise(r => setTimeout(r, 0))

beforeEach(() => {
  TestBed.resetTestingModule()
  vi.clearAllMocks()
})

describe('GroupListComponent — Sichtbarkeits-Schalter (#636)', () => {
  it('schickt bei zwei schnellen Klicks erst ausblenden, dann einblenden', async () => {
    const first = deferred()
    const answers = [first.promise, Promise.resolve({})]
    const { component, api } = setup(() => answers.shift()!)
    await component.ngOnInit()

    const p1 = component.toggleExcluded(GROUP, click(false))
    const p2 = component.toggleExcluded(GROUP, click(true))
    first.resolve({})
    await Promise.all([p1, p2])

    expect(api.patch.mock.calls.map(c => c[2])).toEqual([{ excluded: true }, { excluded: false }])
    expect(excludedOf(component)).toBe(false)
  })

  it('startet den zweiten PATCH erst nach der Antwort auf den ersten', async () => {
    const first = deferred()
    const answers = [first.promise, Promise.resolve({})]
    const { component, api } = setup(() => answers.shift()!)
    await component.ngOnInit()

    const p1 = component.toggleExcluded(GROUP, click(false))
    const p2 = component.toggleExcluded(GROUP, click(true))
    await flush()

    // Liefen beide parallel, könnte der Server sie in falscher Reihenfolge anwenden.
    expect(api.patch).toHaveBeenCalledTimes(1)

    first.resolve({})
    await Promise.all([p1, p2])
    expect(api.patch).toHaveBeenCalledTimes(2)
  })

  it('zeigt den neuen Zustand sofort, noch bevor der Server antwortet', async () => {
    const first = deferred()
    const { component } = setup(() => first.promise)
    await component.ngOnInit()

    const p1 = component.toggleExcluded(GROUP, click(false))

    expect(excludedOf(component)).toBe(true)
    first.resolve({})
    await p1
  })

  it('übernimmt nach einem Fehler den Stand des Servers und frischt bei CLOUD_MANAGED den Pairing-Zustand auf', async () => {
    const err = Object.assign(new Error('Forbidden'), { data: { code: 'CLOUD_MANAGED' } })
    const { component, api, connection } = setup(() => Promise.reject(err), false)
    await component.ngOnInit()

    await component.toggleExcluded(GROUP, click(false))

    expect(api.get).toHaveBeenCalledWith('product-groups', 'g-1')
    expect(excludedOf(component)).toBe(false)
    expect(connection.refreshHealth).toHaveBeenCalled()
  })
})
