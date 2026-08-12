// #187: Status-Gate fuer alle Anmeldewege am Edge.
//
// Der wichtigste Fall ist der letzte: Der virtuelle Geraete-User aus
// `allowApiKey` hat gar keinen Status. Ein fail-closed an dieser Stelle wuerde
// jedes Terminal aussperren, sobald es sich per API-Key verbindet.

import { describe, expect, it } from 'vitest'

import { UserStatus } from '@panary/users/domain'

import { isLoginBlockedByStatus } from './user-login-status'

describe('isLoginBlockedByStatus', () => {
  it('laesst ACTIVE durch', () => {
    expect(isLoginBlockedByStatus({ status: UserStatus.ACTIVE })).toBe(false)
  })

  it('sperrt ARCHIVED', () => {
    expect(isLoginBlockedByStatus({ status: UserStatus.ARCHIVED })).toBe(true)
  })

  it('sperrt REJECTED', () => {
    expect(isLoginBlockedByStatus({ status: UserStatus.REJECTED })).toBe(true)
  })

  it.each([
    ['fehlendes Feld', {}],
    ['undefined', { status: undefined }],
    ['null', { status: null }],
    ['leerer String', { status: '' }],
    ['kein Objekt', null],
  ])('laesst durch bei %s — Geraete-User haben keinen Status', (_name, candidate) => {
    expect(isLoginBlockedByStatus(candidate as never)).toBe(false)
  })
})
