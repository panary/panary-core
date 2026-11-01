import { describe, expect, it } from 'vitest'
import { BadRequest } from '@feathersjs/errors'
import type { HookContext } from '@feathersjs/feathers'

import { rejectArrayBody } from './reject-array-body.hook'

const buildContext = (opts: { method: string; data: unknown; multiCreate?: boolean; noAllowsMulti?: boolean }) =>
  ({
    method: opts.method,
    data: opts.data,
    service: opts.noAllowsMulti ? {} : { allowsMulti: (method: string) => method === 'create' && !!opts.multiCreate },
  }) as unknown as HookContext

describe('rejectArrayBody', () => {
  for (const method of ['patch', 'update']) {
    for (const data of [[{ a: 1 }], [], [1]]) {
      it(`weist ${JSON.stringify(data)} bei ${method} ab`, () => {
        expect(() => rejectArrayBody(buildContext({ method, data, multiCreate: true }))).toThrow(BadRequest)
      })
    }
    it(`laesst ein Objekt bei ${method} durch`, () => {
      const ctx = buildContext({ method, data: { a: 1 } })
      expect(rejectArrayBody(ctx)).toBe(ctx)
    })
  }

  it('weist ein Array bei create ab, wenn der Service kein Multi-Create erlaubt', () => {
    expect(() => rejectArrayBody(buildContext({ method: 'create', data: [{ a: 1 }] }))).toThrow(BadRequest)
    expect(() => rejectArrayBody(buildContext({ method: 'create', data: [], noAllowsMulti: true }))).toThrow(BadRequest)
  })

  it('laesst ein Array bei create durch, wenn der Service Multi-Create erlaubt', () => {
    const ctx = buildContext({ method: 'create', data: [{ a: 1 }], multiCreate: true })
    expect(rejectArrayBody(ctx)).toBe(ctx)
  })

  it('laesst ein Objekt bei create durch', () => {
    const ctx = buildContext({ method: 'create', data: { a: 1 } })
    expect(rejectArrayBody(ctx)).toBe(ctx)
  })

  it('ignoriert find/get/remove', () => {
    for (const method of ['find', 'get', 'remove']) {
      const ctx = buildContext({ method, data: [1] })
      expect(rejectArrayBody(ctx)).toBe(ctx)
    }
  })
})
