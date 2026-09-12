import knexFactory, { type Knex } from 'knex'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SYNC_PUSH_BLOCKED_USER_ROLES, USER_MANAGE_ROLES, UserStatus, UserSystemRole } from '@panary/users/domain'

import {
  MANAGE_ROLES,
  REACTIVATABLE_ROLES,
  selectUsersToReactivate,
  up,
} from '../../migrations/20260912160000_reactivate_locked_out_owner'

// Zwei Dinge werden hier geprueft, und beide sind noetig:
//
//   1. Die Rollen-Literale der Migration gegen die Domain-Konstanten. Die
//      Migration darf @panary/users/domain zur Laufzeit NICHT importieren
//      (Assets + --bundle=false, Begruendung im Datei-Kopf), also muss der Test
//      die Kopplung halten — dasselbe Muster wie bei DEVICE_PRIVILEGED_ROLES.
//   2. Das tatsaechliche SQL gegen eine echte In-Memory-SQLite. Eine reine
//      Pruefung der Auswahlfunktion wuerde einen Tippfehler im `whereIn` oder
//      eine fehlende Spalte nicht sehen.

const makeDb = async (): Promise<Knex> => {
  const db = knexFactory({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  })
  await db.schema.createTable('users', table => {
    table.string('_id').primary()
    table.string('loginname')
    table.string('role')
    table.string('status')
    table.string('createdAt')
    table.string('updatedAt')
  })
  return db
}

const insert = (db: Knex, rows: Record<string, unknown>[]) => db('users').insert(rows)

const CREATED = '2026-07-27T10:00:00.000Z'
const owner = { _id: 'u-owner', loginname: 'admin', role: UserSystemRole.TENANT_OWNER, createdAt: CREATED }
const staff = {
  _id: 'u-staff',
  loginname: 'kellner',
  role: UserSystemRole.TENANT_STAFF,
  status: UserStatus.ACTIVE,
  createdAt: CREATED,
}

describe('Rollen-Literale gegen die Domain gelockt', () => {
  it('MANAGE_ROLES = USER_MANAGE_ROLES (users:MANAGE laut Matrix)', () => {
    expect([...MANAGE_ROLES].sort()).toEqual([...USER_MANAGE_ROLES].sort())
  })

  it('REACTIVATABLE_ROLES = Verwaltungsrollen der Push-Blockliste', () => {
    const expected = [...USER_MANAGE_ROLES].filter(role =>
      (SYNC_PUSH_BLOCKED_USER_ROLES as ReadonlySet<string>).has(role),
    )
    expect([...REACTIVATABLE_ROLES].sort()).toEqual(expected.sort())
  })

  it('tenant:technician ist ausdruecklich NICHT reaktivierbar (sein ARCHIVED traegt Information)', () => {
    expect(REACTIVATABLE_ROLES).not.toContain(UserSystemRole.TENANT_TECHNICIAN)
    expect(MANAGE_ROLES).toContain(UserSystemRole.TENANT_TECHNICIAN)
  })
})

describe('selectUsersToReactivate', () => {
  it('archivierter Owner ohne anderen Zugang → wird ausgewaehlt', () => {
    const selected = selectUsersToReactivate([{ ...owner, status: UserStatus.ARCHIVED }, staff])
    expect(selected.map(row => row._id)).toEqual(['u-owner'])
  })

  it('aktiver Techniker vorhanden → NICHTS wird angefasst', () => {
    const selected = selectUsersToReactivate([
      { ...owner, status: UserStatus.ARCHIVED },
      { _id: 'u-tech', role: UserSystemRole.TENANT_TECHNICIAN, status: UserStatus.ACTIVE },
    ])
    expect(selected).toEqual([])
  })

  it('archivierter Techniker als einziges Verwaltungskonto → NICHT reaktiviert', () => {
    const selected = selectUsersToReactivate([
      { _id: 'u-tech', role: UserSystemRole.TENANT_TECHNICIAN, status: UserStatus.ARCHIVED },
    ])
    expect(selected).toEqual([])
  })

  it('Owner mit fehlendem Status gilt als anmeldefaehig → kein Eingriff', () => {
    const selected = selectUsersToReactivate([
      { ...owner, status: null },
      { ...owner, _id: 'u-2' },
    ])
    expect(selected).toEqual([])
  })

  it('REJECTED wird nicht reaktiviert — das ist eine menschliche Entscheidung', () => {
    const selected = selectUsersToReactivate([{ ...owner, status: UserStatus.REJECTED }])
    expect(selected).toEqual([])
  })

  it('leere Tabelle → nichts zu tun', () => {
    expect(selectUsersToReactivate([])).toEqual([])
  })
})

describe('up() gegen eine echte SQLite', () => {
  let db: Knex

  beforeEach(async () => {
    db = await makeDb()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await db.destroy()
  })

  it('einziger Owner archiviert → ACTIVE, updatedAt gesetzt, Log-Zeile geschrieben', async () => {
    await insert(db, [{ ...owner, status: UserStatus.ARCHIVED, updatedAt: CREATED }, staff])

    await up(db)

    const row = await db('users').where({ _id: 'u-owner' }).first()
    expect(row.status).toBe(UserStatus.ACTIVE)
    expect(row.updatedAt).not.toBe(CREATED)
    expect(console.warn).toHaveBeenCalledTimes(1)
    expect(String((console.warn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain('u-owner')
  })

  it('aktiver Owner vorhanden → kein Schreibzugriff, kein Log', async () => {
    await insert(db, [
      { ...owner, status: UserStatus.ACTIVE, updatedAt: CREATED },
      { ...owner, _id: 'u-owner-2', loginname: 'alt', status: UserStatus.ARCHIVED, updatedAt: CREATED },
    ])

    await up(db)

    const archived = await db('users').where({ _id: 'u-owner-2' }).first()
    expect(archived.status).toBe(UserStatus.ARCHIVED)
    expect(archived.updatedAt).toBe(CREATED)
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('idempotent: ein zweiter Lauf aendert nichts mehr', async () => {
    await insert(db, [{ ...owner, status: UserStatus.ARCHIVED, updatedAt: CREATED }])

    await up(db)
    const first = await db('users').where({ _id: 'u-owner' }).first()
    await up(db)
    const second = await db('users').where({ _id: 'u-owner' }).first()

    expect(second.status).toBe(UserStatus.ACTIVE)
    expect(second.updatedAt).toBe(first.updatedAt)
    expect(console.warn).toHaveBeenCalledTimes(1)
  })

  it('archivierter Mitarbeiter bleibt gesperrt — nur Verwaltungsrollen werden geheilt', async () => {
    await insert(db, [
      { ...owner, status: UserStatus.ARCHIVED, updatedAt: CREATED },
      { ...staff, status: UserStatus.ARCHIVED, updatedAt: CREATED },
    ])

    await up(db)

    const staffRow = await db('users').where({ _id: 'u-staff' }).first()
    expect(staffRow.status).toBe(UserStatus.ARCHIVED)
  })

  it('fehlende users-Tabelle → laeuft durch, ohne zu werfen', async () => {
    const empty = knexFactory({ client: 'better-sqlite3', connection: { filename: ':memory:' } })
    await expect(up(empty)).resolves.toBeUndefined()
    await empty.destroy()
  })

  it('users-Tabelle ohne status-Spalte → laeuft durch, ohne zu werfen', async () => {
    const legacy = knexFactory({ client: 'better-sqlite3', connection: { filename: ':memory:' } })
    await legacy.schema.createTable('users', table => {
      table.string('_id').primary()
      table.string('role')
    })
    await expect(up(legacy)).resolves.toBeUndefined()
    await legacy.destroy()
  })
})
