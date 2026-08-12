// Der Bootstrap-Report weist lokale User mit cloud-gesperrter Rolle aus (#184).
//
// Er ersetzt die frueheren `external-id-missing`-Konflikte, die der Merge-Modus
// fuer jeden dieser User erzeugte — unaufloesbar, weil `tenant:owner` nie zur
// Cloud gepusht wird und damit kein Cloud-Pendant entstehen kann. Entschieden
// wurde: stehenlassen, aber im Report benennen. Ohne diese Spec faellt der
// Hinweis still weg, sobald jemand den Read oder die Rollen-Pruefung anfasst —
// und dann ist der verwaiste Owner wieder unsichtbar.

import { describe, expect, it } from 'vitest'

import { collectEdgeOnlyUserIssue } from './edge-only-users'

type MockUser = { _id: string; role?: string; loginname?: string }

function makeApp(users: MockUser[], shouldThrow = false) {
  return {
    service: (path: string) => {
      if (path !== 'users') throw new Error(`unexpected service ${path}`)
      return {
        find: async () => {
          if (shouldThrow) throw new Error('DB weg')
          return users
        },
      }
    },
  }
}

describe('collectEdgeOnlyUserIssue', () => {
  it('meldet den initialen tenant:owner als WARN', async () => {
    const issue = await collectEdgeOnlyUserIssue(
      makeApp([{ _id: 'u1', role: 'tenant:owner', loginname: 'admin' }]) as never,
    )

    expect(issue?.severity).toBe('WARN')
    expect(issue?.message).toContain('admin')
    expect(issue?.message).toContain('1 lokale(r) User')
  })

  it('schweigt, wenn alle lokalen User pushbar sind', async () => {
    const issue = await collectEdgeOnlyUserIssue(
      makeApp([
        { _id: 'u1', role: 'tenant:staff', loginname: 'kellner' },
        { _id: 'u2', role: 'tenant:manager', loginname: 'leitung' },
      ]) as never,
    )

    expect(issue).toBeNull()
  })

  it('zaehlt mehrere gesperrte User und nennt beide Namen', async () => {
    const issue = await collectEdgeOnlyUserIssue(
      makeApp([
        { _id: 'u1', role: 'tenant:owner', loginname: 'admin' },
        { _id: 'u2', role: 'platform:support', loginname: 'support' },
        { _id: 'u3', role: 'tenant:staff', loginname: 'kellner' },
      ]) as never,
    )

    expect(issue?.message).toContain('2 lokale(r) User')
    expect(issue?.message).toContain('admin')
    expect(issue?.message).toContain('support')
    expect(issue?.message).not.toContain('kellner')
  })

  it('kommt ohne loginname zurecht', async () => {
    const issue = await collectEdgeOnlyUserIssue(makeApp([{ _id: 'u1', role: 'tenant:owner' }]) as never)

    expect(issue?.message).toContain('ohne loginname')
  })

  it('schweigt bei leerer User-Tabelle', async () => {
    expect(await collectEdgeOnlyUserIssue(makeApp([]) as never)).toBeNull()
  })

  it('meldet einen fehlgeschlagenen Read, statt ihn zu verschlucken', async () => {
    const issue = await collectEdgeOnlyUserIssue(makeApp([], true) as never)

    expect(issue?.severity).toBe('WARN')
    expect(issue?.message).toContain('Edge-only-User-Check fehlgeschlagen')
    expect(issue?.message).toContain('DB weg')
  })
})
