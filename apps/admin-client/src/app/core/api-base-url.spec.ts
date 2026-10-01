import { describe, expect, it } from 'vitest'

import { DEV_SERVER_API_URL, resolveApiUrl } from './api-base-url'

// Regression panary/panary-core#460: REST-Services nahmen fix den eigenen Origin und
// schickten die Anmeldung im Dev-Server an `localhost:4202/authentication` (404).
describe('resolveApiUrl', () => {
  it('nimmt im Production-Build (baseHref /admin/) den eigenen Origin', () => {
    expect(resolveApiUrl('http://10.10.100.3:3030/admin/', 'http://10.10.100.3:3030')).toBe('http://10.10.100.3:3030')
  })

  it('zeigt im Dev-Server (baseHref /) auf den Edge statt auf den eigenen Origin', () => {
    expect(resolveApiUrl('http://localhost:4202/', 'http://localhost:4202')).toBe(DEV_SERVER_API_URL)
  })
})
