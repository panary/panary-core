import { TestBed } from '@angular/core/testing'
import { APP_CONFIG } from '@panary/shared/data-access-config'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EdgeVersionService } from './edge-version.service'
import { UPDATE_POLL_INTERVAL_MS, UpdateMonitorService } from './update-monitor.service'

/** Je Test ein eigenes `load`-Handle (testing.md §10): Ein Nachzügler schreibt nie in den Folgetest. */
function setup(buildVersion: string, ...answers: (string | null)[]) {
  vi.useFakeTimers()
  const load = vi.fn()
  for (const answer of answers) load.mockResolvedValueOnce(answer)
  load.mockResolvedValue(answers[answers.length - 1] ?? null)
  TestBed.configureTestingModule({
    providers: [
      { provide: APP_CONFIG, useValue: { appVersion: buildVersion } },
      { provide: EdgeVersionService, useValue: { load } },
    ],
  })
  const monitor = TestBed.inject(UpdateMonitorService)
  monitor.start()
  return { monitor, load }
}

const poll = () => vi.advanceTimersByTimeAsync(UPDATE_POLL_INTERVAL_MS)

afterEach(() => {
  TestBed.resetTestingModule()
  vi.useRealTimers()
})

describe('UpdateMonitorService', () => {
  it('zeigt keinen Hinweis, wenn Edge und geladener Build dieselbe Version tragen', async () => {
    const { monitor } = setup('26.11.16', '26.11.16')
    await vi.advanceTimersByTimeAsync(0)
    expect(monitor.updateAvailable()).toBe(false)
    expect(monitor.visible()).toBe(false)
  })

  it('zeigt den Hinweis, sobald der Edge eine andere Version meldet, und nennt sie', async () => {
    const { monitor } = setup('26.11.16', '26.11.16', '26.11.17')
    await vi.advanceTimersByTimeAsync(0)
    expect(monitor.visible()).toBe(false)
    await poll()
    expect(monitor.visible()).toBe(true)
    expect(monitor.latestVersion()).toEqual('26.11.17')
  })

  it('zeigt keinen Hinweis, solange /health nicht antwortet', async () => {
    const { monitor, load } = setup('26.11.16', null)
    await vi.advanceTimersByTimeAsync(0)
    expect(load).toHaveBeenCalledTimes(1)
    expect(monitor.visible()).toBe(false)
    expect(monitor.latestVersion()).toBeNull()
  })

  it('behält einen schon gezeigten Hinweis, wenn der Edge im Update kurz nicht antwortet', async () => {
    const { monitor } = setup('26.11.16', '26.11.17', null)
    await vi.advanceTimersByTimeAsync(0)
    expect(monitor.visible()).toBe(true)
    await poll()
    expect(monitor.visible()).toBe(true)
    expect(monitor.latestVersion()).toEqual('26.11.17')
  })

  it('zeigt bei einem Staging-Stand ohne Versionsnummer keinen Hinweis', async () => {
    const { monitor } = setup('26.11.16', 'staging-ab12cd3')
    await vi.advanceTimersByTimeAsync(0)
    expect(monitor.updateAvailable()).toBe(false)
    expect(monitor.visible()).toBe(false)
  })

  it('„Später“ blendet für genau diese Edge-Version aus, eine neuere zeigt ihn wieder', async () => {
    const { monitor } = setup('26.11.16', '26.11.17', '26.11.17', '26.11.18')
    await vi.advanceTimersByTimeAsync(0)
    expect(monitor.visible()).toBe(true)
    monitor.dismiss()
    expect(monitor.visible()).toBe(false)
    await poll()
    expect(monitor.visible()).toBe(false)
    await poll()
    expect(monitor.latestVersion()).toEqual('26.11.18')
    expect(monitor.visible()).toBe(true)
  })

  it('start() ist idempotent: ein zweiter Aufruf startet keinen zweiten Abruf', async () => {
    const { monitor, load } = setup('26.11.16', '26.11.16')
    monitor.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(load).toHaveBeenCalledTimes(1)
  })
})
