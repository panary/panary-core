// Fehlerbeschreibungen ohne Nutzdaten für den POS-Mitschnitt (panary/panary-core#1359,
// `.claude/rules/pos-logging.md` §3). Je Fall die Form, die an der Aufrufstelle wirklich ankommt.
// Ein echter HttpErrorResponse lädt @angular/common/http, dessen Services in Node den JIT brauchen.
import '@angular/compiler'
import { HttpErrorResponse } from '@angular/common/http'
import { NotAuthenticated } from '@feathersjs/errors'
import { describe, expect, it } from 'vitest'

import { describeErrorForLog, errorName } from './log-safe-error'

const GEHEIM = 'eyJhbGciOiJIUzI1NiJ9.geheim'

describe('describeErrorForLog', () => {
  it('nennt beim rohen Socket-Fehler (Plain Object) Name, Code und Meldung, aber kein data', () => {
    // So liefert der `io.emit`-Callback in `ConnectionService.authenticateSocket` den Fehler:
    // serialisiert, ohne `convert()` der Feathers-Clients, also kein `instanceof Error`.
    const raw = {
      name: 'NotAuthenticated',
      message: 'jwt expired',
      code: 401,
      className: 'not-authenticated',
      data: { accessToken: GEHEIM, loginname: 'kasse1' },
    }

    expect(describeErrorForLog(raw)).toEqual('NotAuthenticated (401): jwt expired')
  })

  it('lässt beim echten FeathersError das data weg', () => {
    const error = new NotAuthenticated('Invalid login', { pin: '1234' })

    expect(describeErrorForLog(error)).toEqual('NotAuthenticated (401): Invalid login')
  })

  it('nennt beim HttpErrorResponse nur Name und Status, nicht URL, Body oder Meldung', () => {
    const error = new HttpErrorResponse({
      error: { code: 401, message: 'Invalid login', data: { password: 'hunter2' } },
      status: 401,
      statusText: 'Unauthorized',
      url: `http://192.168.1.20:3030/authentication?token=${GEHEIM}`,
    })

    expect(describeErrorForLog(error)).toEqual('HttpErrorResponse (401)')
  })

  it('nennt den Typ statt des Werts, wenn kein Objekt geworfen wurde', () => {
    expect(describeErrorForLog(GEHEIM)).toEqual('string')
    expect(describeErrorForLog(undefined)).toEqual('undefined')
    expect(describeErrorForLog(null)).toEqual('object')
  })
})

describe('errorName', () => {
  it('nennt beim JSON.parse-Fehler nur den Namen, nicht das zitierte Textstück der Eingabe', () => {
    // V8 (WebView2) zitiert die ersten zehn Zeichen, JavaScriptCore (WebKit) den ganzen ersten
    // Bezeichner — gemessen in #1359. Die Meldung darf deshalb nicht in die Zeile.
    let parseError: unknown
    try {
      JSON.parse(GEHEIM)
    } catch (error) {
      parseError = error
    }

    expect((parseError as Error).message).toContain('eyJhbGciOi')
    expect(errorName(parseError)).toEqual('SyntaxError')
  })

  it('fällt bei namenlosen Werten auf den Typ zurück', () => {
    expect(errorName({ message: GEHEIM })).toEqual('object')
    expect(errorName(42)).toEqual('number')
  })
})
