import { describe, expect, it } from 'vitest'

import { requestPersistentStorage } from './persist-storage'

describe('requestPersistentStorage', () => {
  it('liefert false, wenn die Storage-Persistence-API fehlt (Node/Test)', async () => {
    expect(await requestPersistentStorage()).toBe(false)
  })
})
