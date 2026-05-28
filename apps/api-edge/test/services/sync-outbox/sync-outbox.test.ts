// For more information about this file see https://dove.feathersjs.com/guides/cli/service.test.html
//
// Hinweis: api-edge hat aktuell keinen Test-Runner (kein `test`-Target in
// project.json). Diese Spec folgt dem bestehenden Smoke-Test-Pattern
// (apikeys.test.ts / users.test.ts) und dient als Marker fuer kuenftige
// vitest-Integration. Volle Unit-Tests fuer `reEnqueueOutboxEntry` siehe
// Plan-Datei (Edge-Cases: rejected-Guard, edge-record-missing, op-Preservation).
import assert from 'assert'
import { app } from '../../../src/app'

describe('sync-outbox service', () => {
  it('registered the service', () => {
    const service = app.service('sync-outbox')

    assert.ok(service, 'Registered the service')
  })

  it('exposes the reEnqueue custom method', () => {
    const service = app.service('sync-outbox') as unknown as { reEnqueue?: unknown }

    assert.strictEqual(
      typeof service.reEnqueue,
      'function',
      'reEnqueue custom method should be bound on the service proxy',
    )
  })
})
