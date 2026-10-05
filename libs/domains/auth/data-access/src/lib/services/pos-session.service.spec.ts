// JIT-Compiler zuerst laden: @angular/material ist partial-compiled; ohne
// Linker faellt Angular auf JIT zurueck.
import '@angular/compiler'
import { Injector, runInInjectionContext, signal } from '@angular/core'
import { MatDialog } from '@angular/material/dialog'
import { ConnectionService } from '@panary/shared/data-access'
import { describe, expect, it, vi } from 'vitest'

import { AuthService } from './auth.service'
import { PosSessionService } from './pos-session.service'

// Der Grund des Sitzungsendes traegt den Inaktivitaets-Hinweis am Login
// (panary/panary-core#604). Er muss VOR der Navigation stehen und darf genau
// einmal abgeholt werden.

function setup(status = 'authenticated') {
  const auth = { logout: vi.fn().mockResolvedValue(true) }
  const injector = Injector.create({
    providers: [
      { provide: AuthService, useValue: auth },
      { provide: ConnectionService, useValue: { connectionState: signal({ status }) } },
      { provide: MatDialog, useValue: { closeAll: vi.fn() } },
    ],
  })
  const service = runInInjectionContext(injector, () => new PosSessionService())
  return { service, auth }
}

describe('PosSessionService — Grund des Sitzungsendes (#604)', () => {
  it('liefert nach einem Inaktivitaets-Logout einmal "idle", danach null', async () => {
    const { service } = setup()

    await service.endSession('idle')

    expect(service.consumeEndReason()).toBe('idle')
    expect(service.consumeEndReason()).toBeNull()
  })

  it('hat den Grund schon gesetzt, wenn logout() auf /login navigiert', async () => {
    // Der Login-Screen entsteht waehrend dieser Navigation und liest den Grund
    // in `ngOnInit` — also noch innerhalb von `logout()`.
    const { service, auth } = setup()
    let reasonDuringLogout: string | null = null
    auth.logout.mockImplementationOnce(async () => {
      reasonDuringLogout = service.consumeEndReason()
      return true
    })

    await service.endSession('idle')

    expect(reasonDuringLogout).toBe('idle')
  })

  it('unterscheidet den Button-Logout', async () => {
    const { service } = setup()

    await service.endSession('button')

    expect(service.consumeEndReason()).toBe('button')
  })

  it('setzt offline keinen Grund — die Sitzung endet dann gar nicht', async () => {
    const { service, auth } = setup('disconnected')

    expect(await service.endSession('idle')).toBe(false)

    expect(auth.logout).not.toHaveBeenCalled()
    expect(service.consumeEndReason()).toBeNull()
  })

  it('ist ohne Sitzungsende null', () => {
    const { service } = setup()

    expect(service.consumeEndReason()).toBeNull()
  })
})
