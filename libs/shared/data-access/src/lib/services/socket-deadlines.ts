import { Timeout, Unavailable } from '@feathersjs/errors'

/**
 * Fristen für Socket-Aufrufe des POS (Device-Strategie, panary/panary-core#1342, ADR 0069 Nr. 2).
 *
 * Ohne Frist wartet der Feathers-Socket-Client endlos auf ein Ack (`transport-commons/lib/client.js`): Bestellen
 * (#1216) und Bezahlen (#1314) hingen so stumm. Die Frist geht je Aufruf als socket.io-Flag `timeout` mit. Damit
 * entfernt socket.io bei Ablauf auch ein noch gepuffertes Paket aus dem `sendBuffer`: Eine Bestellung, die der Nutzer
 * schon als gescheitert gesehen hat, geht nach dem Reconnect nicht mehr raus. Und bei einer Trennung lehnt socket.io
 * jeden schon gesendeten Aufruf sofort ab (`_clearAcks`), statt bis zur Frist zu warten.
 *
 * Gemessen (Dev-Edge, 2026-10-29 bis 2026-11-05, 4016 Socket-Aufrufe): längster Aufruf 425 ms (`users.verifyPin`).
 * Die Standardfrist liegt bewusst weit darüber, weil Sunmi, Windows-Kassen und cloud-direct über das Internet
 * langsamer sind und eine zu kurze Frist eine Buchung abbricht, die am Server weiterläuft.
 */
export const SOCKET_DEFAULT_DEADLINE_MS = 20_000

/**
 * Geschäftstag-Wechsel rufen am Server selbst die Cloud (Fristen 10 s und 30 s, `business-days.ts`) und die TSE auf.
 * In den Messdaten kommen sie nicht vor; die Frist ist eine Obergrenze aus dem Code, kein Messwert.
 */
export const SOCKET_LONG_DEADLINE_MS = 120_000

const LONG_RUNNING: Readonly<Record<string, readonly string[]>> = {
  businessdays: ['openDay', 'closeDay', 'refreshClosingStatus', 'approveClosedDay'],
}

export const socketDeadlineMs = (path: string, method: string): number =>
  LONG_RUNNING[path]?.includes(method) ? SOCKET_LONG_DEADLINE_MS : SOCKET_DEFAULT_DEADLINE_MS

// Fehlertexte von socket.io-client (`socket.js`, `_registerAckCallback` und `_clearAcks`).
const SOCKET_IO_TIMEOUT = 'operation has timed out'
const SOCKET_IO_DISCONNECTED = 'socket has been disconnected'

export type SocketDeadlineReason = 'frist' | 'trennung'

interface DeadlineConnection {
  timeout(ms: number): unknown
}

interface SendingService {
  connection: DeadlineConnection
  send(method: string, ...args: unknown[]): Promise<unknown>
}

const isSendingService = (service: unknown): service is SendingService => {
  const candidate = service as Partial<SendingService> | null
  return typeof candidate?.send === 'function' && typeof candidate.connection?.timeout === 'function'
}

/**
 * Hängt die Frist an einen Feathers-Socket-Client-Service. Gedacht als App-Mixin, damit auch Services erfasst sind,
 * die erst über `defaultService` beim ersten `app.service(path)` entstehen.
 */
export const applySocketDeadline = (service: unknown, path: string): void => {
  if (!isSendingService(service)) return
  const send = service.send
  service.send = function (this: SendingService, method: string, ...args: unknown[]) {
    const ms = socketDeadlineMs(path, method)
    // `send` liest das Flag synchron im Promise-Executor und emittiert sofort; socket.io setzt es danach zurück.
    // Dazwischen kann kein anderer Aufruf das Flag verbrauchen.
    this.connection.timeout(ms)
    return send.call(this, method, ...args).catch((error: unknown) => {
      throw toDeadlineError(error, path, method, ms)
    })
  }
}

const toDeadlineError = (error: unknown, path: string, method: string, ms: number): unknown => {
  const message = (error as { message?: unknown } | null)?.message
  const data = (reason: SocketDeadlineReason) => ({ path, method, timeoutMs: ms, reason })
  if (message === SOCKET_IO_TIMEOUT) {
    // Der Console-Patch des LogService spiegelt die Zeile in die native Logdatei. Keine Nutzdaten.
    console.warn(`[socket] Keine Antwort: ${path}.${method} nach ${ms} ms`)
    return new Timeout(`Keine Antwort von ${path}.${method} nach ${ms} ms`, data('frist'))
  }
  if (message === SOCKET_IO_DISCONNECTED) {
    console.warn(`[socket] Verbindung getrennt: ${path}.${method} ohne Antwort`)
    return new Unavailable(`Verbindung getrennt, ${path}.${method} ohne Antwort`, data('trennung'))
  }
  return error
}

/** Wahr für einen Fehler aus `applySocketDeadline`, egal ob Frist oder Trennung. */
export const isSocketDeadlineError = (error: unknown): boolean => {
  const reason = (error as { data?: { reason?: unknown } } | null)?.data?.reason
  return reason === 'frist' || reason === 'trennung'
}
