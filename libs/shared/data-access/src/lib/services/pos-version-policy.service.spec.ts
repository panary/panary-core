// JIT-Compiler zuerst laden: @angular/common (über den ConnectionService) ist partial-compiled.
import '@angular/compiler'
import { Injector, runInInjectionContext, signal } from '@angular/core'
import { AppConfigService } from '@panary/shared/data-access-config'
import { describe, expect, it, vi } from 'vitest'
import { ConnectionService } from './connection.service'
import { PosVersionPolicyService } from './pos-version-policy.service'

function setup(
  options: { posVersion?: string; edge?: string | null; min?: string | null; refreshFails?: boolean } = {},
) {
  const { posVersion = '26.8.1', edge = '26.11.19', min = '26.11.1', refreshFails = false } = options
  const edgeVersion = signal<string | null>(edge)
  const requiredPosMinVersion = signal<string | null>(min)
  const refreshHealth = vi.fn(async () => {
    if (refreshFails) throw new Error('Edge nicht erreichbar')
    // Der frische Health-Stand kommt erst nach dem Roundtrip an und hebt die Mindestversion an.
    await Promise.resolve()
    requiredPosMinVersion.set('26.12.1')
  })
  const injector = Injector.create({
    providers: [
      { provide: ConnectionService, useValue: { edgeVersion, requiredPosMinVersion, refreshHealth } },
      { provide: AppConfigService, useValue: { appVersion: posVersion } },
    ],
  })
  const service = runInInjectionContext(injector, () => new PosVersionPolicyService())
  return { service, edgeVersion, requiredPosMinVersion, refreshHealth }
}

describe('PosVersionPolicyService', () => {
  it('warnt ab einem Monatsstand Rückstand hinter dem Edge', () => {
    expect(setup({ posVersion: '26.8.1', edge: '26.11.19' }).service.warn()).toBe(true)
    expect(setup({ posVersion: '26.11.1', edge: '26.11.19' }).service.warn()).toBe(false)
  })

  it('warnt nicht, solange die Edge-Version unbekannt ist', () => {
    expect(setup({ edge: null }).service.warn()).toBe(false)
  })

  it('verdictFresh urteilt nach dem frisch geholten Health-Stand, nicht nach dem alten', async () => {
    const { service, refreshHealth } = setup({ posVersion: '26.11.19', min: '26.11.1' })
    expect(service.verdict().belowMinimum).toBe(false)

    const verdict = await service.verdictFresh()

    expect(refreshHealth).toHaveBeenCalledTimes(1)
    expect(verdict.belowMinimum).toBe(true)
  })

  it('verdictFresh bleibt beim letzten Stand, wenn der Health-Abruf scheitert', async () => {
    const { service } = setup({ posVersion: '26.8.1', min: '26.11.1', refreshFails: true })

    const verdict = await service.verdictFresh()

    expect(verdict.belowMinimum).toBe(true)
  })
})
