import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { AppAbility, AppAction, AppResource } from './permissions'
import { RolePermissions } from './roles.matrix'
import { UserSystemRole } from './user.schema'

/**
 * Gate: docs/security/rollen-matrix.md ist ein Generat dieser Matrix (core#384).
 *
 * Die handgepflegte Kurzfassung in .claude/rules/security.md §7 war gedriftet —
 * zwei Rollen falsch, eine fehlte ganz — und wurde beim Schreiben von Sichttests
 * als Wahrheit gelesen. Dieser Spec erzeugt die Tabelle aus `RolePermissions`
 * und vergleicht sie mit dem Block in der Doku-Datei. Neu schreiben:
 *
 *   ROLLEN_MATRIX_SCHREIBEN=1 pnpm nx test users-domain --skip-nx-cache
 *
 * Die Logik steht bewusst im Spec und nicht in src/lib: so landet sie nicht im
 * veröffentlichten Paket @panary/users.
 */

const DOC_PATH = resolve(__dirname, '../../../../../../docs/security/rollen-matrix.md')
const START = '<!-- rollen-matrix:start — Generat aus roles.matrix.ts, nicht von Hand ändern -->'
const END = '<!-- rollen-matrix:end -->'

const CRUD_ORDER: Array<[AppAction, string]> = [
  [AppAction.CREATE, 'C'],
  [AppAction.READ, 'R'],
  [AppAction.UPDATE, 'U'],
  [AppAction.DELETE, 'D'],
]

const ROLES = Object.values(UserSystemRole) as UserSystemRole[]

/** Aktionen einer Rolle auf einer Ressource als Kürzel: `M`, `CRUD`, `RU`, `–`. */
function cell(role: UserSystemRole, resource: AppResource): string {
  const actions = new Set<AppAction>()
  for (const rule of RolePermissions[role]) {
    if (typeof rule === 'string' || rule.resource !== resource) continue
    for (const a of Array.isArray(rule.action) ? rule.action : [rule.action]) actions.add(a)
  }
  if (actions.has(AppAction.MANAGE)) return 'M'
  const letters = CRUD_ORDER.filter(([a]) => actions.has(a))
    .map(([, l]) => l)
    .join('')
  return letters || '–'
}

function hasAbility(role: UserSystemRole, ability: AppAbility): boolean {
  return RolePermissions[role].some(rule => rule === ability)
}

function row(cells: string[]): string {
  return `| ${cells.join(' | ')} |`
}

function renderRollenMatrix(): string {
  const header = row(['Ressource', ...ROLES.map(r => `\`${r}\``)])
  const sep = row(['---', ...ROLES.map(() => ':-:')])
  const resources = (Object.values(AppResource) as AppResource[]).map(res =>
    row([`\`${res}\``, ...ROLES.map(role => cell(role, res))]),
  )
  const abilityHeader = row(['Ability', ...ROLES.map(r => `\`${r}\``)])
  const abilities = (Object.values(AppAbility) as AppAbility[]).map(ab =>
    row([`\`${ab}\``, ...ROLES.map(role => (hasAbility(role, ab) ? '✓' : '–'))]),
  )
  return [
    START,
    '',
    '### Ressourcen',
    '',
    header,
    sep,
    ...resources,
    '',
    '### Abilities',
    '',
    abilityHeader,
    sep,
    ...abilities,
    '',
    END,
  ].join('\n')
}

function extractBlock(doc: string): string | null {
  const start = doc.indexOf(START)
  const end = doc.indexOf(END)
  if (start < 0 || end < start) return null
  return doc.slice(start, end + END.length)
}

describe('rollen-matrix.md (Generat aus RolePermissions)', () => {
  const generated = renderRollenMatrix()

  it('stimmt mit der Matrix überein', () => {
    const doc = readFileSync(DOC_PATH, 'utf8')
    const block = extractBlock(doc)
    expect(block, `Marker fehlen in ${DOC_PATH}`).not.toBeNull()
    if (process.env['ROLLEN_MATRIX_SCHREIBEN'] === '1') {
      // Absichtlich ohne Assertion: Der Schreiblauf ist grün, die Prüfung macht der nächste Lauf.
      writeFileSync(DOC_PATH, doc.replace(block as string, generated))
      return
    }
    expect(
      block,
      'docs/security/rollen-matrix.md ist veraltet — neu erzeugen: ' +
        'ROLLEN_MATRIX_SCHREIBEN=1 pnpm nx test users-domain --skip-nx-cache',
    ).toBe(generated)
  })

  // Der Renderer selbst darf nichts verschlucken — sonst wäre ein grünes Gate
  // nur ein Vergleich zweier gleich lückenhafter Tabellen.
  it('führt jede Rolle als Spalte und jede verwendete Ressource als Zeile', () => {
    for (const role of ROLES) expect(generated).toContain(`\`${role}\``)
    for (const rules of Object.values(RolePermissions)) {
      for (const rule of rules) {
        const key = typeof rule === 'string' ? rule : rule.resource
        expect(generated).toContain(`| \`${key}\` |`)
      }
    }
  })

  it('kodiert Aktionen korrekt (Stichproben gegen bekannte Einträge)', () => {
    expect(cell(UserSystemRole.TENANT_MANAGER, AppResource.ORDERS)).toBe('CRUD')
    expect(cell(UserSystemRole.TENANT_OWNER, AppResource.ORDERS)).toBe('RU')
    expect(cell(UserSystemRole.TENANT_TECHNICIAN, AppResource.ORDERS)).toBe('M')
    // Zwei getrennte Regeln (CREATE und READ) werden zusammengeführt.
    expect(cell(UserSystemRole.DEVICE_KIOSK, AppResource.ORDERS)).toBe('CR')
    expect(cell(UserSystemRole.DEVICE_KDS, AppResource.USERS)).toBe('–')
    expect(hasAbility(UserSystemRole.DEVICE_POS, AppAbility.CAN_VOID_ORDER)).toBe(true)
    expect(hasAbility(UserSystemRole.TENANT_STAFF, AppAbility.CAN_VOID_ORDER)).toBe(false)
  })
})
