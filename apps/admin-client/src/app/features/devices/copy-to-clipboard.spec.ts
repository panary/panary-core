import { Clipboard } from '@angular/cdk/clipboard'
import { ChangeDetectorRef, signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { TranslateService } from '@ngx-translate/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiService } from '../../core/api.service'
import { DeviceStatusService } from '../../core/device-status.service'
import { ApikeyCreatedDialogComponent } from '../apikeys/apikey-created-dialog'
import { DeviceListComponent } from './device-list'

// Copy-Buttons im Edge-Admin (panary/panary-core#550). Die Edge liefert den
// admin-client per HTTP auf der LAN-IP aus — kein Secure Context, also kein
// `navigator.clipboard`. Bis dahin riefen beide Buttons es trotzdem auf und
// schluckten den Fehler: kein Kopieren, keine Meldung.
//
// Geprueft wird zweierlei: dass das Kopieren ohne `navigator.clipboard` geht
// (echtes CDK-Clipboard, nur `execCommand` gestubbt), und dass ein Fehlschlag
// sichtbar wird statt still zu bleiben. Ob `execCommand('copy')` im echten
// Browser ueber HTTP greift, beweist jsdom nicht — das ist der Sichttest.

type Any = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

function providers(clipboard?: Partial<Clipboard>) {
  return [
    { provide: ApiService, useValue: { find: vi.fn(), create: vi.fn(), patch: vi.fn(), remove: vi.fn() } },
    {
      provide: DeviceStatusService,
      useValue: { connectedDeviceIds: signal(new Set()), online: signal(0), total: signal(0), refresh: vi.fn() },
    },
    { provide: TranslateService, useValue: { instant: (key: string) => key } },
    { provide: ChangeDetectorRef, useValue: { markForCheck: () => undefined, detectChanges: () => undefined } },
    ...(clipboard ? [{ provide: Clipboard, useValue: clipboard }] : []),
  ]
}

function deviceList(clipboard?: Partial<Clipboard>): Any {
  TestBed.configureTestingModule({ providers: providers(clipboard) })
  const c = TestBed.runInInjectionContext(() => new DeviceListComponent()) as unknown as Any
  c['pairingCode'].set('482913')
  return c
}

function apikeyDialog(clipboard?: Partial<Clipboard>): Any {
  TestBed.configureTestingModule({ providers: providers(clipboard) })
  const c = TestBed.runInInjectionContext(() => new ApikeyCreatedDialogComponent()) as unknown as Any
  c['apikey'] = () => 'pk_live_abc123'
  return c
}

/** HTTP auf LAN-IP nachstellen: kein `navigator.clipboard`, nur `execCommand`. */
function insecureContext(execResult: boolean) {
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
  const exec = vi.fn().mockReturnValue(execResult)
  Object.defineProperty(document, 'execCommand', { value: exec, configurable: true, writable: true })
  return {
    exec,
    restore: () => {
      if (original) Object.defineProperty(navigator, 'clipboard', original)
      else delete (navigator as unknown as Any)['clipboard']
      delete (document as unknown as Any)['execCommand']
    },
  }
}

describe('Copy-Buttons ohne Secure Context (#550)', () => {
  let ctx: ReturnType<typeof insecureContext> | undefined

  afterEach(() => {
    ctx?.restore()
    ctx = undefined
    vi.useRealTimers()
    TestBed.resetTestingModule()
  })

  describe('Pairing-Code (device-list)', () => {
    it('kopiert ohne navigator.clipboard ueber den execCommand-Fallback', () => {
      ctx = insecureContext(true)
      const c = deviceList()

      c['copyCode']()

      expect(ctx.exec).toHaveBeenCalledWith('copy')
      expect(c['codeCopied']()).toBe(true)
      expect(c['codeCopyFailed']()).toBe(false)
    })

    it('kopiert genau den Code', () => {
      const copy = vi.fn().mockReturnValue(true)
      const c = deviceList({ copy })

      c['copyCode']()

      expect(copy).toHaveBeenCalledWith('482913')
    })

    it('zeigt den Fehlschlag statt still „nichts" zu tun', () => {
      ctx = insecureContext(false)
      const c = deviceList()

      c['copyCode']()

      expect(c['codeCopied']()).toBe(false)
      expect(c['codeCopyFailed']()).toBe(true)
    })

    it('ein erfolgreicher zweiter Versuch nimmt die Fehlermeldung zurueck', () => {
      const copy = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
      const c = deviceList({ copy })

      c['copyCode']()
      c['copyCode']()

      expect(c['codeCopyFailed']()).toBe(false)
      expect(c['codeCopied']()).toBe(true)
    })

    it('„Kopiert" verschwindet nach drei Sekunden', () => {
      vi.useFakeTimers()
      const c = deviceList({ copy: vi.fn().mockReturnValue(true) })

      c['copyCode']()
      vi.advanceTimersByTime(3000)

      expect(c['codeCopied']()).toBe(false)
    })
  })

  describe('API-Key-Dialog', () => {
    it('kopiert ohne navigator.clipboard ueber den execCommand-Fallback', () => {
      ctx = insecureContext(true)
      const c = apikeyDialog()

      c['copyToClipboard']()

      expect(ctx.exec).toHaveBeenCalledWith('copy')
      expect(c['copied']()).toBe(true)
      expect(c['copyFailed']()).toBe(false)
    })

    it('kopiert genau den Schluessel', () => {
      const copy = vi.fn().mockReturnValue(true)
      const c = apikeyDialog({ copy })

      c['copyToClipboard']()

      expect(copy).toHaveBeenCalledWith('pk_live_abc123')
    })

    it('zeigt den Fehlschlag statt still „nichts" zu tun', () => {
      ctx = insecureContext(false)
      const c = apikeyDialog()

      c['copyToClipboard']()

      expect(c['copied']()).toBe(false)
      expect(c['copyFailed']()).toBe(true)
    })
  })
})
