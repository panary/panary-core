// Schutz vor dem ausgesperrten Edge-Panel (#187).
//
// `reconcileStaleUsers` archiviert jeden lokalen User, dessen `_id` nicht im
// Visibility-Snapshot der Cloud steht. Rollen der Push-Blockliste koennen dort
// per Design nie stehen — sie werden nie gepusht. Ohne die Ausnahme archiviert
// der erste Initial-Pull nach dem Pairing garantiert den Edge-Owner, und seit
// #187 sperrt `ARCHIVED` auch wirklich aus.
//
// Die zweite Spec unten haelt die Kopplung an `SYNC_PUSH_BLOCKED_USER_ROLES`
// fest: Eine hier hartkodierte Rollenliste wuerde still veralten, sobald die
// Blockliste waechst.

import { describe, expect, it } from 'vitest'

import { SYNC_PUSH_BLOCKED_USER_ROLES, UserStatus, UserSystemRole } from '@panary/users/domain'

import { selectStaleUsersToArchive } from './stale-user-reconciliation'

describe('selectStaleUsersToArchive', () => {
  it('archiviert User, die nicht im Snapshot stehen', () => {
    const result = selectStaleUsersToArchive(
      [
        { _id: 'u-bleibt', role: UserSystemRole.TENANT_STAFF, status: UserStatus.ACTIVE },
        { _id: 'u-weg', role: UserSystemRole.TENANT_STAFF, status: UserStatus.ACTIVE },
      ],
      ['u-bleibt'],
    )

    expect(result.toArchive).toEqual(['u-weg'])
    expect(result.keptUnpushable).toEqual([])
  })

  it('nimmt tenant:owner aus — er steht nie im Snapshot, weil er nie gepusht wird', () => {
    const result = selectStaleUsersToArchive(
      [{ _id: 'u-owner', role: UserSystemRole.TENANT_OWNER, status: UserStatus.ACTIVE }],
      [],
    )

    expect(result.toArchive).toEqual([])
    expect(result.keptUnpushable).toEqual(['u-owner'])
  })

  it('nimmt den Owner auch dann aus, wenn der Snapshot leer bleibt (Totalausfall der Sichtbarkeit)', () => {
    // Der gefaehrlichste Fall: Ein leerer Snapshot wuerde ohne die Ausnahme den
    // gesamten Bestand archivieren — inklusive des einzigen Zugangs zum Panel.
    const result = selectStaleUsersToArchive(
      [
        { _id: 'u-owner', role: UserSystemRole.TENANT_OWNER, status: UserStatus.ACTIVE },
        { _id: 'u-staff', role: UserSystemRole.TENANT_STAFF, status: UserStatus.ACTIVE },
      ],
      [],
    )

    expect(result.toArchive).toEqual(['u-staff'])
    expect(result.keptUnpushable).toEqual(['u-owner'])
  })

  it('ist idempotent — bereits archivierte User tauchen nicht erneut auf', () => {
    const result = selectStaleUsersToArchive(
      [{ _id: 'u-alt', role: UserSystemRole.TENANT_STAFF, status: UserStatus.ARCHIVED }],
      [],
    )

    expect(result.toArchive).toEqual([])
  })

  it('behandelt fehlende Rolle als archivierbar (kein Freibrief durch Datenluecke)', () => {
    const result = selectStaleUsersToArchive([{ _id: 'u-ohne-rolle', status: UserStatus.ACTIVE }], [])

    expect(result.toArchive).toEqual(['u-ohne-rolle'])
  })

  it('nimmt JEDE Rolle der Push-Blockliste aus', () => {
    // Bindet die Ausnahme an die Blockliste statt an eine Kopie davon: waechst
    // SYNC_PUSH_BLOCKED_USER_ROLES, faellt eine vergessene Rolle hier auf.
    const roles = [...SYNC_PUSH_BLOCKED_USER_ROLES]
    const result = selectStaleUsersToArchive(
      roles.map((role, i) => ({ _id: `u-${i}`, role, status: UserStatus.ACTIVE })),
      [],
    )

    expect(result.toArchive).toEqual([])
    expect(result.keptUnpushable).toHaveLength(roles.length)
  })
})
