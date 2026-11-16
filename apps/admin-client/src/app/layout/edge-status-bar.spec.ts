import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { TranslateModule } from '@ngx-translate/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiService } from '../core/api.service'
import { DeviceStatusService } from '../core/device-status.service'
import { EdgeVersionService } from '../core/edge-version.service'
import { SyncProblemCountService } from '../core/sync-problem-count.service'
import { cloudTone, deviceTone, EdgeStatusBarComponent, syncTone } from './edge-status-bar'

describe('Edge-Statuszeile: Tönung', () => {
  it('Cloud: verbunden ok, Fehler rot, Kopplung und Funkstille gelb, ohne Kopplung neutral', () => {
    expect(cloudTone('connected')).toBe('ok')
    expect(cloudTone('error')).toBe('error')
    expect(cloudTone('pairing')).toBe('warn')
    expect(cloudTone('stale')).toBe('warn')
    expect(cloudTone('standalone')).toBe('neutral')
    expect(cloudTone('disconnected')).toBe('neutral')
  })

  it('Sync: jedes offene Problem färbt rot', () => {
    expect(syncTone(0)).toBe('ok')
    expect(syncTone(1)).toBe('error')
  })

  it('Geräte: keins gekoppelt neutral, keins verbunden gelb, mindestens eins ok', () => {
    expect(deviceTone(0, 0)).toBe('neutral')
    expect(deviceTone(0, 2)).toBe('warn')
    expect(deviceTone(1, 2)).toBe('ok')
  })
})

const info = (version: string, requiredEdgeMinVersion: string | null = null) => ({
  version,
  requiredEdgeMinVersion,
  requiredPosMinVersion: null,
})

/** Statuszeile direkt instanziiert (Muster admin-layout.spec): geprüft wird der Zustand, den das Template bindet. */
function setup(find: ReturnType<typeof vi.fn>) {
  vi.useFakeTimers()
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: { find } },
      {
        provide: EdgeVersionService,
        useValue: { loadInfo: vi.fn().mockResolvedValue(info('26.10.24')) },
      },
      { provide: SyncProblemCountService, useValue: { count: signal(0) } },
      { provide: DeviceStatusService, useValue: { online: signal(null), total: signal(null) } },
    ],
  })
  const bar = TestBed.runInInjectionContext(() => new EdgeStatusBarComponent())
  const cloudStatus = () => (bar as unknown as { cloudStatus: () => string | null }).cloudStatus()
  const poll = async () => {
    await vi.advanceTimersByTimeAsync(60_000)
  }
  return { cloudStatus, poll }
}

afterEach(() => {
  TestBed.resetTestingModule()
  vi.useRealTimers()
})

describe('Edge-Statuszeile: Cloud-Abruf', () => {
  const contactNow = () => ({
    data: [{ _id: 'c1', pairingStatus: 'connected', lastCloudContactAt: new Date().toISOString() }],
  })

  it('bleibt unbekannt, solange noch kein Abruf gelungen ist', async () => {
    const find = vi.fn().mockRejectedValue(new Error('403'))
    const { cloudStatus } = setup(find)
    await vi.advanceTimersByTimeAsync(0)
    expect(find).toHaveBeenCalled()
    expect(cloudStatus()).toBeNull()
  })

  it('hält bei einem Fehler den letzten Stand, statt „nicht gekoppelt“ zu zeigen', async () => {
    const find = vi.fn().mockResolvedValueOnce(contactNow()).mockRejectedValueOnce(new Error('503'))
    const { cloudStatus, poll } = setup(find)
    await vi.advanceTimersByTimeAsync(0)
    expect(cloudStatus()).toBe('connected')
    await poll()
    expect(find).toHaveBeenCalledTimes(2)
    expect(cloudStatus()).toBe('connected')
  })

  it('zeigt standalone nur bei einer erfolgreichen Antwort ohne Kopplungsdatensatz', async () => {
    const find = vi.fn().mockResolvedValue({ data: [] })
    const { cloudStatus } = setup(find)
    await vi.advanceTimersByTimeAsync(0)
    expect(cloudStatus()).toBe('standalone')
  })
})

describe('Edge-Statuszeile: Version', () => {
  async function render(result: ReturnType<typeof info> | null) {
    const loadInfo = vi.fn().mockResolvedValue(result)
    await TestBed.configureTestingModule({
      imports: [EdgeStatusBarComponent, TranslateModule.forRoot()],
      providers: [
        { provide: ApiService, useValue: { find: vi.fn().mockResolvedValue({ data: [] }) } },
        { provide: EdgeVersionService, useValue: { loadInfo } },
        { provide: SyncProblemCountService, useValue: { count: signal(0) } },
        { provide: DeviceStatusService, useValue: { online: signal(null), total: signal(null) } },
      ],
    }).compileComponents()
    const fixture = TestBed.createComponent(EdgeStatusBarComponent)
    await fixture.whenStable()
    fixture.detectChanges()
    return { el: fixture.nativeElement as HTMLElement, loadInfo }
  }

  it('zeigt die Version aus dem EdgeVersionService', async () => {
    const { el, loadInfo } = await render(info('26.11.2'))
    expect(loadInfo).toHaveBeenCalledTimes(1)
    expect(el.querySelector('li.font-mono')?.textContent?.trim()).toEqual('v26.11.2')
  })

  it('blendet den Eintrag aus, wenn keine Version bekannt ist', async () => {
    const { el } = await render(null)
    expect(el.querySelector('li.font-mono')).toBeNull()
  })

  it('zeigt den Hinweis, wenn der Edge unter der Mindestversion liegt', async () => {
    const { el } = await render(info('26.10.5', '26.11.1'))
    expect(el.querySelector('[data-testid="edge-below-min-version"]')).not.toBeNull()
  })

  it('zeigt keinen Hinweis bei Gleichstand, darüber, ohne Mindestversion oder nicht vergleichbar', async () => {
    for (const [version, min] of [
      ['26.11.1', '26.11.1'],
      ['26.11.2', '26.11.1'],
      ['26.10.5', null],
      ['staging-abc123', '26.11.1'],
    ] as const) {
      TestBed.resetTestingModule()
      const { el } = await render(info(version, min))
      expect(el.querySelector('[data-testid="edge-below-min-version"]')).toBeNull()
    }
  })
})
