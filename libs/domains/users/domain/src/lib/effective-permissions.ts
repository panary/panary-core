// Zentrale RBAC-Auswertung: Rollen-Matrix + additive Pro-User-Grants.
//
// Dies ist die EINZIGE Quelle der Wahrheit für „darf Rolle X + Grants Y die
// Aktion A auf Ressource R?". Sie ersetzt die vormals drei divergenten Kopien
// der Match-Logik (cloud `ruleMatches`, edge `checkRule`, frontend `can()`).

import { AppAction, AppResource } from './permissions'
import { RolePermissions, type PermissionRule } from './roles.matrix'
import { UserSystemRole } from './user.schema'

/**
 * Präfix für additive Pro-User-Grants im `user.permissions`-Array.
 * Format: `grant:<resource>:<action>` (z. B. `grant:incoming-goods:manage`).
 * Eigener Namespace → kollisionsfrei zu den `can_*`-AppAbility-Strings im
 * selben Array. Reserviert bewusst Raum für ein künftiges `deny:`-Präfix
 * (ohne Schema-Migration).
 */
export const GRANT_PREFIX = 'grant:'

const ALL_RESOURCES = new Set<string>(Object.values(AppResource))
const ALL_ACTIONS = new Set<string>(Object.values(AppAction))

export interface ParsedGrant {
  resource: string
  action: AppAction
}

/** Baut einen Grant-String aus Ressource + Aktion. */
export const makeGrant = (resource: AppResource, action: AppAction): string =>
  `${GRANT_PREFIX}${resource}:${action}`

/**
 * Parst `grant:<resource>:<action>`. Ressourcen dürfen `/` enthalten (z. B.
 * `external/off-lookup`), aber kein `:` — daher Split am LETZTEN Doppelpunkt.
 * Liefert `null` bei Formatfehler ODER unbekannter Ressource/Aktion (defensiv:
 * unbekannte/getippte Grants gewähren nie Zugriff).
 */
export const parseGrant = (raw: string): ParsedGrant | null => {
  if (typeof raw !== 'string' || !raw.startsWith(GRANT_PREFIX)) return null
  const body = raw.slice(GRANT_PREFIX.length)
  const sep = body.lastIndexOf(':')
  if (sep <= 0 || sep === body.length - 1) return null
  const resource = body.slice(0, sep)
  const action = body.slice(sep + 1)
  if (!ALL_RESOURCES.has(resource) || !ALL_ACTIONS.has(action)) return null
  return { resource, action: action as AppAction }
}

/** Format- + Whitelist-Validierung (für den Escalation-Guard beim Vergeben). */
export const isValidGrant = (raw: string): boolean => parseGrant(raw) !== null

// Replik der Matrix-Match-Semantik (war: `ruleMatches`/`checkRule`).
const roleRuleMatches = (rule: PermissionRule, resource: string, action: AppAction): boolean => {
  if (typeof rule === 'string') return false
  if (rule.resource !== resource) return false
  const actions = Array.isArray(rule.action) ? rule.action : [rule.action]
  return actions.includes(AppAction.MANAGE) || actions.includes(action)
}

// `manage` deckt jede Aktion ab (analog Matrix-MANAGE).
const grantAllows = (grant: ParsedGrant, resource: string, action: AppAction): boolean =>
  grant.resource === resource && (grant.action === AppAction.MANAGE || grant.action === action)

/**
 * Eine Aktion ist erlaubt, wenn die ROLLE (Matrix) ODER ein additiver
 * Pro-User-Grant sie zulässt — rein additiv (Grants erweitern, entziehen nie).
 */
export const hasEffectivePermission = (
  role: UserSystemRole | undefined,
  userPermissions: readonly string[] | undefined,
  resource: string,
  action: AppAction,
): boolean => {
  const roleRules = role ? RolePermissions[role] ?? [] : []
  if (roleRules.some(rule => roleRuleMatches(rule, resource, action))) return true
  if (!userPermissions) return false
  for (const raw of userPermissions) {
    const grant = parseGrant(raw)
    if (grant && grantAllows(grant, resource, action)) return true
  }
  return false
}
