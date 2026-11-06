import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { feathers } from '@feathersjs/feathers'
import socketio from '@feathersjs/socketio-client'
import io, { type Socket } from 'socket.io-client'

import {
  applySocketDeadline,
  isSocketDeadlineError,
  SOCKET_DEFAULT_DEADLINE_MS,
  SOCKET_LONG_DEADLINE_MS,
  socketDeadlineMs,
} from './socket-deadlines'

type Settled = { state: 'pending' } | { state: 'resolved'; value: unknown } | { state: 'rejected'; error: any }

/** Zustand eines Promise abfragen, ohne darauf zu warten — ein hängender Aufruf bleibt sonst unsichtbar. */
const track = (promise: Promise<unknown>) => {
  let settled: Settled = { state: 'pending' }
  promise.then(
    value => (settled = { state: 'resolved', value }),
    error => (settled = { state: 'rejected', error }),
  )
  return () => settled
}

/**
 * Echter Feathers-Client auf einem echten, nie verbundenen socket.io-Socket: Jeder Aufruf landet im `sendBuffer`
 * und bekommt nie ein Ack, genau wie bei der Edge, die nicht antwortet.
 */
const buildClient = (withDeadline: boolean) => {
  const socket = io('http://127.0.0.1:1', { autoConnect: false })
  const client = socketio(socket)
  const app = feathers()
  app.configure(client)
  if (withDeadline) app.mixins.push((service: unknown, path: string) => applySocketDeadline(service, path))
  // `orders` wie im Konstruktor per `use` registriert, `products` entsteht erst über `defaultService`.
  app.use('orders', client.service('orders'), { methods: ['find', 'get', 'create', 'patch', 'split'] })
  app.use('businessdays', client.service('businessdays'), { methods: ['find', 'closeDay'] })
  return { app: app as any, socket: socket as Socket & { sendBuffer: unknown[]; _clearAcks(): void } }
}

describe('socketDeadlineMs', () => {
  it('nennt für Geschäftstag-Wechsel die lange Frist, sonst die Standardfrist', () => {
    expect(socketDeadlineMs('businessdays', 'closeDay')).toBe(SOCKET_LONG_DEADLINE_MS)
    expect(socketDeadlineMs('businessdays', 'openDay')).toBe(SOCKET_LONG_DEADLINE_MS)
    expect(socketDeadlineMs('businessdays', 'getClosedDayStatus')).toBe(SOCKET_DEFAULT_DEADLINE_MS)
    expect(socketDeadlineMs('orders', 'create')).toBe(SOCKET_DEFAULT_DEADLINE_MS)
  })
})

describe('applySocketDeadline', () => {
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.useFakeTimers()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    warn.mockRestore()
  })

  it('Ausgangslage ohne Frist: ein Aufruf ohne Ack hängt endlos', async () => {
    const { app } = buildClient(false)
    const call = track(app.service('orders').create({ total: 1 }))
    await vi.advanceTimersByTimeAsync(10 * SOCKET_LONG_DEADLINE_MS)
    expect(call()).toEqual({ state: 'pending' })
  })

  it('lehnt einen per use registrierten Service nach der Frist mit 408 ab und nimmt das Paket aus dem Puffer', async () => {
    const { app, socket } = buildClient(true)
    const call = track(app.service('orders').create({ total: 1, secret: 'bestelldaten' }))
    expect(socket.sendBuffer).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(SOCKET_DEFAULT_DEADLINE_MS - 1)
    expect(call()).toEqual({ state: 'pending' })

    await vi.advanceTimersByTimeAsync(1)
    const settled = call()
    expect(settled.state).toBe('rejected')
    const error = (settled as { error: any }).error
    expect(error.code).toBe(408)
    expect(error.data).toEqual({ path: 'orders', method: 'create', timeoutMs: SOCKET_DEFAULT_DEADLINE_MS, reason: 'frist' })
    expect(isSocketDeadlineError(error)).toBe(true)
    // Nach dem Reconnect darf die schon als gescheitert gemeldete Bestellung nicht mehr rausgehen.
    expect(socket.sendBuffer).toEqual([])
    expect(warn).toHaveBeenCalledWith(`[socket] Keine Antwort: orders.create nach ${SOCKET_DEFAULT_DEADLINE_MS} ms`)
    expect(JSON.stringify(warn.mock.calls)).not.toContain('bestelldaten')
  })

  it('erfasst auch einen Service, der erst über defaultService entsteht', async () => {
    const { app } = buildClient(true)
    const call = track(app.service('products').find({ query: {} }))
    await vi.advanceTimersByTimeAsync(SOCKET_DEFAULT_DEADLINE_MS)
    expect(call()).toMatchObject({ state: 'rejected', error: { code: 408, data: { path: 'products', method: 'find' } } })
  })

  it('gibt Custom Methods des Geschäftstags die lange Frist', async () => {
    const { app } = buildClient(true)
    const call = track(app.service('businessdays').closeDay({ businessDayId: 'x' }))
    await vi.advanceTimersByTimeAsync(SOCKET_LONG_DEADLINE_MS - 1)
    expect(call()).toEqual({ state: 'pending' })
    await vi.advanceTimersByTimeAsync(1)
    expect(call()).toMatchObject({ state: 'rejected', error: { code: 408, data: { method: 'closeDay' } } })
  })

  it('meldet eine Trennung nach dem Senden sofort als 503 mit Grund trennung', async () => {
    const { app, socket } = buildClient(true)
    // Verbunden vortäuschen, damit das Paket gesendet statt gepuffert wird; danach die Trennung auslösen.
    ;(socket as any).connected = true
    ;(socket as any).packet = vi.fn()
    const call = track(app.service('orders').patch('o-1', { status: 'paid' }))
    expect(socket.sendBuffer).toEqual([])

    socket._clearAcks()
    await vi.advanceTimersByTimeAsync(0)
    expect(call()).toMatchObject({
      state: 'rejected',
      error: { code: 503, data: { path: 'orders', method: 'patch', reason: 'trennung' } },
    })
    expect(warn).toHaveBeenCalledWith('[socket] Verbindung getrennt: orders.patch ohne Antwort')
  })

  it('lässt eine Antwort und einen Serverfehler unverändert durch', async () => {
    const { app, socket } = buildClient(true)
    ;(socket as any).connected = true
    const sent: any[] = []
    ;(socket as any).packet = (packet: any) => sent.push(packet)

    const ok = app.service('orders').get('o-1')
    ;(socket as any).onack({ id: sent[0].id, data: [null, { _id: 'o-1' }] })
    await expect(ok).resolves.toEqual({ _id: 'o-1' })

    const rejected = app.service('orders').get('o-2')
    ;(socket as any).onack({ id: sent[1].id, data: [{ name: 'NotFound', message: 'weg', code: 404 }] })
    await expect(rejected).rejects.toMatchObject({ code: 404, message: 'weg' })
    expect(warn).not.toHaveBeenCalled()
  })
})
