import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { TranslateModule } from '@ngx-translate/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { UpdateMonitorService } from '../core/update-monitor.service'
import { UpdateBannerComponent } from './update-banner'

/** Je Test ein eigener Monitor-Stub (testing.md §10): Aufrufe werden an dieser Instanz gezählt. */
async function render(visible: boolean, latestVersion: string | null = '26.11.17') {
  const monitor = {
    visible: signal(visible),
    latestVersion: signal(latestVersion),
    start: vi.fn(),
    dismiss: vi.fn(),
    reload: vi.fn(),
  }
  await TestBed.configureTestingModule({
    imports: [UpdateBannerComponent, TranslateModule.forRoot()],
    providers: [{ provide: UpdateMonitorService, useValue: monitor }],
  }).compileComponents()
  const fixture = TestBed.createComponent(UpdateBannerComponent)
  await fixture.whenStable()
  fixture.detectChanges()
  const el = fixture.nativeElement as HTMLElement
  return { monitor, fixture, el, banner: () => el.querySelector('[data-testid="update-banner"]') }
}

afterEach(() => {
  TestBed.resetTestingModule()
})

describe('UpdateBannerComponent', () => {
  it('startet die Überwachung beim Anlegen', async () => {
    const { monitor } = await render(false)
    expect(monitor.start).toHaveBeenCalledTimes(1)
  })

  it('zeigt nichts, solange der Monitor keinen Hinweis meldet', async () => {
    const { banner } = await render(false)
    expect(banner()).toBeNull()
  })

  it('zeigt den Hinweis mit der gemeldeten Version und beiden Knöpfen', async () => {
    const { banner, el } = await render(true, '26.11.17')
    expect(banner()).not.toBeNull()
    const buttons = Array.from(el.querySelectorAll('button'))
    expect(buttons).toHaveLength(2)
  })

  it('„Neu laden“ ruft reload, „Später“ ruft dismiss', async () => {
    const { monitor, el } = await render(true)
    const [reload, later] = Array.from(el.querySelectorAll('button'))
    reload.click()
    expect(monitor.reload).toHaveBeenCalledTimes(1)
    expect(monitor.dismiss).not.toHaveBeenCalled()
    later.click()
    expect(monitor.dismiss).toHaveBeenCalledTimes(1)
  })

  it('blendet den Hinweis aus, sobald der Monitor ihn zurücknimmt', async () => {
    const { monitor, fixture, banner } = await render(true)
    expect(banner()).not.toBeNull()
    monitor.visible.set(false)
    fixture.detectChanges()
    expect(banner()).toBeNull()
  })
})
