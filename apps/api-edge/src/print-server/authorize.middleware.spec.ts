import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppAction, UserSystemRole } from '@panary/users/domain'

// Bewusst OHNE `vi.mock('@panary/users/domain')` (anders als auth.middleware.spec.ts):
// getestet wird gerade, dass `printServerAuthorize` die echte Matrix UND die
// Pro-User-Grants ueber `hasEffectivePermission` auswertet. Vorher las die
// Middleware die rohe `RolePermissions`-Matrix und ignorierte damit als einzige
// Stelle im Edge die vergebenen Grants.
const warn = vi.fn()
vi.mock('@panary/shared-backend', () => ({
  logger: { warn: (...args: unknown[]) => warn(...args), info: vi.fn(), error: vi.fn() },
}))

import { printServerAuthorize } from './auth.middleware'

interface FakeCtx {
  path: string
  method: string
  state: { user?: unknown }
  status: number
  body: unknown
}

const makeCtx = (user?: unknown): FakeCtx => ({
  path: '/print-server/print-order',
  method: 'POST',
  state: { user },
  status: 0,
  body: undefined,
})

const run = async (user: unknown, action: AppAction = AppAction.CREATE) => {
  const ctx = makeCtx(user)
  const next = vi.fn(async () => undefined)
  await printServerAuthorize(action)(ctx as never, next)
  return { ctx, next }
}

beforeEach(() => warn.mockClear())

describe('printServerAuthorize', () => {
  it('laesst DEVICE_POS den Bon drucken (CREATE aus der Matrix)', async () => {
    const { next, ctx } = await run({ role: UserSystemRole.DEVICE_POS })
    expect(next).toHaveBeenCalledOnce()
    expect(ctx.status).toBe(0)
  })

  it('laesst TENANT_MANAGER den Bon drucken', async () => {
    // Regression: der Manager hatte nur [READ, UPDATE] auf print-server und lief
    // damit auf `/print-order` (verlangt CREATE) in einen stillen 403.
    const { next } = await run({ role: UserSystemRole.TENANT_MANAGER })
    expect(next).toHaveBeenCalledOnce()
  })

  it('weist TENANT_STAFF ab — bewusst keine Druckberechtigung in der Matrix', async () => {
    const { ctx, next } = await run({ role: UserSystemRole.TENANT_STAFF })
    expect(next).not.toHaveBeenCalled()
    expect(ctx.status).toBe(403)
  })

  it('akzeptiert einen additiven Pro-User-Grant ohne passende Rollen-Regel', async () => {
    const { next } = await run({
      role: UserSystemRole.TENANT_STAFF,
      permissions: ['grant:print-server:create'],
    })
    expect(next).toHaveBeenCalledOnce()
  })

  it('loggt jede Abweisung — sonst ist der 403 im Edge-Log unsichtbar', async () => {
    await run({ role: UserSystemRole.TENANT_STAFF })
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'print-server.forbidden',
        role: UserSystemRole.TENANT_STAFF,
        requiredAction: AppAction.CREATE,
        path: '/print-server/print-order',
      }),
    )
  })

  it('antwortet ohne Benutzer mit 401', async () => {
    const { ctx, next } = await run(undefined)
    expect(next).not.toHaveBeenCalled()
    expect(ctx.status).toBe(401)
  })
})
