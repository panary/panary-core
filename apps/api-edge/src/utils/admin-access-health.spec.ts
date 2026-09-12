import { describe, expect, it, vi } from 'vitest'

vi.mock('@panary/shared-backend', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { logger } from '@panary/shared-backend'
import { UserStatus, UserSystemRole } from '@panary/users/domain'

import { assertAdminAccessAvailable, evaluateAdminAccess, readAdminAccessState } from './admin-access-health'

import type { Application } from '../declarations'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const errorLog = logger.error as unknown as ReturnType<typeof vi.fn>

const owner = { _id: 'u-owner', loginname: 'admin', role: UserSystemRole.TENANT_OWNER, status: UserStatus.ACTIVE }
const archivedOwner = { ...owner, status: UserStatus.ARCHIVED }
const staff = { _id: 'u-staff', loginname: 'kellner', role: UserSystemRole.TENANT_STAFF, status: UserStatus.ACTIVE }

const appWith = (result: unknown): Application =>
  ({
    service: () => ({ find: async () => result }),
  }) as unknown as Application

describe('evaluateAdminAccess', () => {
  it('aktiver Owner → gesund', () => {
    const state = evaluateAdminAccess([owner, staff])
    expect(state).toEqual({ healthy: true, usableCount: 1, blocked: [] })
  })

  it('einziger Owner archiviert → NICHT gesund, Konto als gesperrt gemeldet (#275)', () => {
    const state = evaluateAdminAccess([archivedOwner, staff])
    expect(state.healthy).toBe(false)
    expect(state.usableCount).toBe(0)
    expect(state.blocked).toEqual([
      { _id: 'u-owner', loginname: 'admin', role: UserSystemRole.TENANT_OWNER, status: UserStatus.ARCHIVED },
    ])
  })

  it('archivierter Owner, aber aktiver Techniker → gesund (der Weg zurueck ohne DB-Eingriff)', () => {
    const technician = {
      _id: 'u-tech',
      loginname: 'technik',
      role: UserSystemRole.TENANT_TECHNICIAN,
      status: UserStatus.ACTIVE,
    }
    const state = evaluateAdminAccess([archivedOwner, technician])
    expect(state.healthy).toBe(true)
    expect(state.usableCount).toBe(1)
    expect(state.blocked).toHaveLength(1)
  })

  it('aktiver tenant:manager zaehlt NICHT — er hat kein users:MANAGE', () => {
    const manager = {
      _id: 'u-mgr',
      loginname: 'leitung',
      role: UserSystemRole.TENANT_MANAGER,
      status: UserStatus.ACTIVE,
    }
    expect(evaluateAdminAccess([manager, staff]).healthy).toBe(false)
  })

  it('fehlender Status laesst durch — gleiche Semantik wie isLoginBlockedByStatus', () => {
    const state = evaluateAdminAccess([{ _id: 'u-alt', loginname: 'alt', role: UserSystemRole.TENANT_OWNER }])
    expect(state.healthy).toBe(true)
    expect(state.blocked).toEqual([])
  })

  it('REJECTED sperrt wie ARCHIVED', () => {
    expect(evaluateAdminAccess([{ ...owner, status: UserStatus.REJECTED }]).healthy).toBe(false)
  })

  it('leere Nutzertabelle → NICHT gesund', () => {
    expect(evaluateAdminAccess([])).toEqual({ healthy: false, usableCount: 0, blocked: [] })
  })
})

describe('readAdminAccessState', () => {
  it('paginiertes Ergebnis wird ausgepackt', async () => {
    const state = await readAdminAccessState(appWith({ data: [owner], total: 1 }))
    expect(state?.healthy).toBe(true)
  })

  it('Lesefehler → null („nicht ermittelbar"), nicht healthy:false', async () => {
    const app = {
      service: () => ({
        find: async () => {
          throw new Error('no such table: users')
        },
      }),
    } as unknown as Application
    expect(await readAdminAccessState(app)).toBeNull()
  })
})

describe('assertAdminAccessAvailable', () => {
  it('Fehlerfall: loggt laut mit event admin_access_missing und nennt das gesperrte Konto', async () => {
    errorLog.mockClear()

    const state = await assertAdminAccessAvailable(appWith([archivedOwner, staff]))

    expect(state?.healthy).toBe(false)
    expect(errorLog).toHaveBeenCalledTimes(1)
    const payload = errorLog.mock.calls[0][0]
    expect(payload.event).toBe('bootstrap.admin_access_missing')
    expect(payload.usableCount).toBe(0)
    expect(payload.blocked).toEqual([
      { loginname: 'admin', role: UserSystemRole.TENANT_OWNER, status: UserStatus.ARCHIVED },
    ])
  })

  it('Gutfall: kein error-Log', async () => {
    errorLog.mockClear()

    const state = await assertAdminAccessAvailable(appWith([owner]))

    expect(state?.healthy).toBe(true)
    expect(errorLog).not.toHaveBeenCalled()
  })

  it('wirft nie — ein Lesefehler beendet den Boot nicht', async () => {
    const app = {
      service: () => ({
        find: async () => {
          throw new Error('db kaputt')
        },
      }),
    } as unknown as Application
    await expect(assertAdminAccessAvailable(app)).resolves.toBeNull()
  })
})
