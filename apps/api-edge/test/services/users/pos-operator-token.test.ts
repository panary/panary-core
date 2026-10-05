// Bediener-Token (panary/panary-core#619, ADR 0053): `verifyPin` stellt es am
// Geraet aus, `resolvePosOperator` prueft es. Laeuft gegen die echte App, damit
// Signatur, Audience und Ablauf vom echten AuthenticationService kommen — ein
// gestubbter Signierer bewiese genau die Trennung von Access-Token und
// Bediener-Token nicht, um die es geht.
//
// Jeder Test legt seinen User selbst an und raeumt ihn per `onTestFinished` ab
// (testing.md §10.2).
import { NotAuthenticated } from '@feathersjs/errors'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest'

import { UserStatus } from '@panary/users/domain'

import { app } from '../../../src/app'
import { resolvePosOperator } from '../../../src/hooks/resolve-pos-operator.hook'
import {
  POS_OPERATOR_TOKEN_AUDIENCE,
  POS_OPERATOR_TOKEN_EXPIRES_IN_SECONDS,
  POS_OPERATOR_TOKEN_TYPE,
  verifyPosOperatorToken,
} from '../../../src/utils/pos-operator-token'

import type { HookContext } from '../../../src/declarations'

type VerifyPinResult = Record<string, unknown> & { operatorToken?: string; operatorTokenExpiresAt?: string }
type VerifyPinService = {
  verifyPin: (data: { userId: string; pin: string }, params?: Record<string, unknown>) => Promise<VerifyPinResult>
}

const PIN = '4711'

const createPosUser = async (): Promise<{ _id: string; tenantId: string | null }> => {
  const created = (await app
    .service('users')
    .create(
      { firstName: 'Bediener', lastName: uuidv7(), role: 'tenant:manager', isPosUser: true, posPin: PIN } as never,
      { provider: undefined },
    )) as unknown as { _id: string; tenantId?: string | null }
  onTestFinished(async () => {
    await app.service('users').remove(created._id, { provider: undefined })
  })
  return { _id: created._id, tenantId: created.tenantId ?? null }
}

/** Was der Geraete-Handshake in channels.ts auf die Socket-Connection stempelt. */
const deviceConnection = (tenantId: string | null, deviceId = uuidv7()) => ({
  apiKey: true,
  deviceId,
  deviceRole: 'device:pos',
  tenantId,
})

const verifyPin = (userId: string, params?: Record<string, unknown>) =>
  (app.service('users') as unknown as VerifyPinService).verifyPin({ userId, pin: PIN }, params)

const issueFor = async (connection: ReturnType<typeof deviceConnection>) => {
  const user = await createPosUser()
  const conn = { ...connection, tenantId: user.tenantId }
  const result = await verifyPin(user._id, { connection: conn })
  return { user, conn, token: result.operatorToken as string }
}

const authService = () =>
  app.service('authentication') as unknown as {
    createAccessToken: (payload: Record<string, unknown>, opts?: Record<string, unknown>) => Promise<string>
    verifyAccessToken: (token: string, opts?: Record<string, unknown>) => Promise<unknown>
    create: (data: Record<string, unknown>, params?: Record<string, unknown>) => Promise<unknown>
  }

const expectRejected = (promise: Promise<unknown>) => expect(promise).rejects.toBeInstanceOf(NotAuthenticated)

beforeAll(async () => {
  await app.setup()
})

afterAll(async () => {
  await app.teardown()
})

describe('verifyPin — Ausstellung des Bediener-Tokens', () => {
  it('stellt am Geraet ein Token mit Ablaufzeit aus, das genau diesen User belegt', async () => {
    const { user, conn, token } = await issueFor(deviceConnection(null))

    expect(typeof token).toBe('string')
    const operator = await verifyPosOperatorToken(app, token, conn)
    expect(operator).toEqual({ userId: user._id, role: 'tenant:manager', tenantId: user.tenantId })
  })

  it('nennt die Ablaufzeit als ISO-String rund 12 h in der Zukunft', async () => {
    const user = await createPosUser()
    const before = Date.now()
    const result = await verifyPin(user._id, { connection: deviceConnection(user.tenantId) })

    const expiresAt = Date.parse(result.operatorTokenExpiresAt as string)
    expect(expiresAt - before).toBeGreaterThanOrEqual(POS_OPERATOR_TOKEN_EXPIRES_IN_SECONDS * 1000 - 1000)
    expect(expiresAt - before).toBeLessThanOrEqual(POS_OPERATOR_TOKEN_EXPIRES_IN_SECONDS * 1000 + 5000)
  })

  it('stellt ohne Geraete-Verbindung kein Token aus (interner Aufruf, z. B. Kassen-Freigabe)', async () => {
    const user = await createPosUser()
    const result = await verifyPin(user._id)

    expect(result['_id']).toBe(user._id)
    expect(result).not.toHaveProperty('operatorToken')
    expect(result).not.toHaveProperty('operatorTokenExpiresAt')
  })
})

describe('Bediener-Token und Access-Token vertreten sich nicht', () => {
  it('das Bediener-Token taugt nicht als Access-Token (sonst bekaeme das Geraet die JWT-Session des Users)', async () => {
    const { token } = await issueFor(deviceConnection(null))

    await expectRejected(authService().verifyAccessToken(token))
    await expectRejected(authService().create({ strategy: 'jwt', accessToken: token }, { provider: undefined }))
  })

  it('ein regulaeres Access-Token taugt nicht als Bediener-Token', async () => {
    const user = await createPosUser()
    const conn = deviceConnection(user.tenantId)
    const accessToken = await authService().createAccessToken(
      { typ: POS_OPERATOR_TOKEN_TYPE, deviceId: conn.deviceId, tenantId: conn.tenantId },
      { subject: user._id },
    )

    await expectRejected(verifyPosOperatorToken(app, accessToken, conn))
  })

  it('ein Token mit passender Audience, aber ohne Bediener-Typ wird abgelehnt', async () => {
    const user = await createPosUser()
    const conn = deviceConnection(user.tenantId)
    const foreignType = await authService().createAccessToken(
      { deviceId: conn.deviceId, tenantId: conn.tenantId },
      { subject: user._id, audience: POS_OPERATOR_TOKEN_AUDIENCE },
    )

    await expectRejected(verifyPosOperatorToken(app, foreignType, conn))
  })
})

describe('verifyPosOperatorToken — Bindung an Geraet, Mandant, Konto und Zeit', () => {
  it('lehnt das Token an einem anderen Geraet ab', async () => {
    const { conn, token } = await issueFor(deviceConnection(null))

    await expectRejected(verifyPosOperatorToken(app, token, { ...conn, deviceId: uuidv7() }))
  })

  it('lehnt das Token an einer Verbindung eines anderen Mandanten ab', async () => {
    const { conn, token } = await issueFor(deviceConnection(null))

    await expectRejected(verifyPosOperatorToken(app, token, { ...conn, tenantId: 'fremder-tenant' }))
  })

  it('lehnt das Token ohne Geraete-Verbindung ab (JWT-Session, interner Aufruf)', async () => {
    const { conn, token } = await issueFor(deviceConnection(null))

    await expectRejected(verifyPosOperatorToken(app, token, undefined))
    await expectRejected(verifyPosOperatorToken(app, token, { ...conn, apiKey: false }))
  })

  it('lehnt das Token ab, sobald das Konto archiviert ist — nicht erst nach Ablauf', async () => {
    const { user, conn, token } = await issueFor(deviceConnection(null))
    await app.service('users').patch(user._id, { status: UserStatus.ARCHIVED } as never, { provider: undefined })

    await expectRejected(verifyPosOperatorToken(app, token, conn))
  })

  it('lehnt das Token nach Ablauf ab', async () => {
    const { conn, token } = await issueFor(deviceConnection(null))
    vi.useFakeTimers({ toFake: ['Date'] })
    onTestFinished(() => {
      vi.useRealTimers()
    })
    vi.setSystemTime(Date.now() + (POS_OPERATOR_TOKEN_EXPIRES_IN_SECONDS + 60) * 1000)

    await expectRejected(verifyPosOperatorToken(app, token, conn))
  })

  it('lehnt ein manipuliertes Token ab', async () => {
    const { conn, token } = await issueFor(deviceConnection(null))
    const [header, payload, signature] = token.split('.')
    const forged = JSON.parse(Buffer.from(payload, 'base64url').toString())
    forged.sub = uuidv7()
    const tampered = [header, Buffer.from(JSON.stringify(forged)).toString('base64url'), signature].join('.')

    await expectRejected(verifyPosOperatorToken(app, tampered, conn))
  })
})

describe('resolvePosOperator — Hook', () => {
  const runHook = async (query: Record<string, unknown> | undefined, connection: unknown) => {
    const context = { app, params: { provider: 'socketio', query, connection } } as unknown as HookContext
    const next = vi.fn(async () => undefined)
    let error: unknown
    await resolvePosOperator()(context, next).catch((e: unknown) => {
      error = e
    })
    return { context, next, error }
  }

  it('ohne Token: Query und Params unveraendert, Aufruf laeuft weiter', async () => {
    const { context, next, error } = await runHook({ status: 'OPEN' }, deviceConnection(null))

    expect(error).toBeUndefined()
    expect(next).toHaveBeenCalledOnce()
    expect(context.params.query).toEqual({ status: 'OPEN' })
    expect(context.params.posOperator).toBeUndefined()
  })

  it('mit gueltigem Token: setzt params.posOperator und entfernt das Token aus der Query', async () => {
    const { user, conn, token } = await issueFor(deviceConnection(null))
    const { context, next, error } = await runHook({ status: 'OPEN', operatorToken: token }, conn)

    expect(error).toBeUndefined()
    expect(next).toHaveBeenCalledOnce()
    expect(context.params.query).toEqual({ status: 'OPEN' })
    expect(context.params.posOperator).toEqual({ userId: user._id, role: 'tenant:manager', tenantId: user.tenantId })
  })

  it('mit ungueltigem Token: bricht ab, ruft next nicht auf, Token trotzdem aus der Query', async () => {
    const { conn } = await issueFor(deviceConnection(null))
    const { context, next, error } = await runHook({ status: 'OPEN', operatorToken: 'kein.gueltiges.token' }, conn)

    expect(error).toBeInstanceOf(NotAuthenticated)
    expect(next).not.toHaveBeenCalled()
    expect(context.params.query).toEqual({ status: 'OPEN' })
    expect(context.params.posOperator).toBeUndefined()
  })
})
