// For more information about this file see https://dove.feathersjs.com/guides/cli/service.test.html
//
// Smoke-Test nach bestehendem Pattern (apikeys.test.ts / users.test.ts).
// Volle Unit-Tests fuer `reEnqueueOutboxEntry` (Edge-Cases: rejected-Guard,
// edge-record-missing, op-Preservation) stehen noch aus.
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
