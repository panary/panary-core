import { HttpClient } from '@angular/common/http'
import { TestBed } from '@angular/core/testing'
import { of, throwError } from 'rxjs'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { API_BASE_URL } from './api-base-url'
import { EdgeVersionService } from './edge-version.service'

function setup(response: () => ReturnType<HttpClient['get']>) {
  const get = vi.fn(response)
  TestBed.configureTestingModule({ providers: [{ provide: HttpClient, useValue: { get } }] })
  return { service: TestBed.inject(EdgeVersionService), get }
}

afterEach(() => TestBed.resetTestingModule())

describe('EdgeVersionService', () => {
  it('liefert die Version aus /health', async () => {
    const { service } = setup(() => of({ status: 'ok', version: '26.11.2' }))
    expect(await service.load()).toEqual('26.11.2')
  })

  it('fragt /health am Edge mit Cache-Umgehung per Query-Parameter ab', async () => {
    const { service, get } = setup(() => of({ version: '26.11.2' }))
    await service.load()
    expect(get).toHaveBeenCalledTimes(1)
    expect(get.mock.calls[0][0]).toMatch(new RegExp(`^${API_BASE_URL}/health\\?t=\\d+$`))
  })

  it('liefert null, wenn /health scheitert', async () => {
    const { service } = setup(() => throwError(() => new Error('offline')))
    expect(await service.load()).toBeNull()
  })

  it('liefert null, wenn die Antwort kein version-Feld trägt', async () => {
    const { service } = setup(() => of({ status: 'ok' }))
    expect(await service.load()).toBeNull()
  })
})
