import { describe, expect, it } from 'vitest'

import { CodeProxyReason, codeProxyReasonForError } from './code-proxy-reason'

// cloud#1429: Jede Exception wurde zu „Cloud nicht erreichbar". Eine Auth-Ablehnung (401/403) ist
// aber kein Netzproblem — Warten hilft dort nicht, und die Meldung schickte Kassierer auf die
// falsche Fährte.
describe('codeProxyReasonForError (cloud#1429)', () => {
  it('ordnet 401 und 403 als „nicht zugelassen" ein', () => {
    expect(codeProxyReasonForError({ name: 'NotAuthenticated', code: 401 })).toEqual(CodeProxyReason.NOT_AUTHORIZED)
    expect(codeProxyReasonForError({ name: 'Forbidden', code: 403 })).toEqual(CodeProxyReason.NOT_AUTHORIZED)
  })

  it('bleibt bei Netz- und Serverfehlern bei „Cloud nicht erreichbar"', () => {
    expect(codeProxyReasonForError(new Error('socket hang up'))).toEqual(CodeProxyReason.CLOUD_UNREACHABLE)
    expect(codeProxyReasonForError({ name: 'GeneralError', code: 500 })).toEqual(CodeProxyReason.CLOUD_UNREACHABLE)
    expect(codeProxyReasonForError(undefined)).toEqual(CodeProxyReason.CLOUD_UNREACHABLE)
  })
})
