import { HookContext, NextFunction } from '../declarations'
import { Forbidden } from '@feathersjs/errors'
import {
  AppAction,
  AppResource,
  PermissionRule,
  RolePermissions,
  UserSystemRole
} from '@panary-core/users/domain'
import { AppError, AppErrorMessages } from '@panary-core/shared-common'
import { logger } from '../logger'

// 2. SCHICHT: Rollen-Check (RBAC)
// Prüft: Darf ein "Staff" überhaupt User sehen/bearbeiten?
// (Die Matrix entscheidet: Staff darf z.B. NICHT create/delete)
export const authorize = () => async (context: HookContext, next: NextFunction) => {
  // 1. Interne Aufrufe durchlassen (kein Provider = Systemaufruf)
  if (!context.params.provider) return next()

  // 2. User prüfen (muss authentifiziert sein)
  const { user } = context.params
  if (!user)
    throw new Forbidden(AppErrorMessages[AppError.TENANT_MISMATCH], {
      code: AppError.TENANT_MISMATCH
    })

  // --- 3. PLATFORM OWNER BYPASS (Der "Gott-Modus") ---
  // Der Eigentümer der Plattform darf technisch alles.
  if (user.role === UserSystemRole.PLATFORM_OWNER) {
    return next()
  }

  // 4. Aktion und Ressource bestimmen
  const action = getActionFromMethod(context.method)
  const resource = context.path as AppResource // z.B. 'users', 'products'

  // 5. Regeln für die Rolle aus der Matrix holen
  // Wir casten user.role, falls TS meckert, aber im Schema ist es ja ein Enum.
  const roleRules = RolePermissions[user.role as UserSystemRole] || []

  // 6. Prüfen: Hat die Rolle die Erlaubnis?
  // Wir iterieren durch die Regeln der Matrix für diese Rolle.
  const hasRolePermission = roleRules.some((rule: PermissionRule) => checkRule(rule, resource, action))

  // (Optional: Hier könnte man später noch das 'permissions' Array des Users prüfen,
  // falls wir Ausnahmen für CRUD erlauben wollen. Aktuell regelt das die Matrix.)

  if (hasRolePermission) {
    return next()
  }

  // 7. Zugriff verweigert
  logger.warn({
    message: `[Security] Zugriff verweigert: ${user.role} darf ${action} auf ${resource} nicht`,
    event: 'security.access_denied',
    userId: user._id,
    userRole: user.role,
    resource,
    action,
    service: context.path,
    method: context.method,
  })
  throw new Forbidden('Access denied', {
    code: AppError.AUTH_NO_PERMISSION,
    role: user.role,
    resource: resource,
    action: action
  })
}

// --- HILFSFUNKTIONEN (Bleiben gleich) ---

// Mappt Feathers-Methoden auf unsere AppActions
function getActionFromMethod(method: string): AppAction {
  switch (method) {
    case 'find':
    case 'get':
      return AppAction.READ
    case 'create':
      return AppAction.CREATE
    case 'update':
    case 'patch':
      return AppAction.UPDATE
    case 'remove':
      return AppAction.DELETE
    case 'convert':
      return AppAction.UPDATE
    // Tagesabschluss-Custom-Methods (Edge: businessdays-Service,
    // Cloud: business-day-reports-Service)
    case 'openDay':
      return AppAction.CREATE
    case 'closeDay':
    case 'startClosing':
    case 'cancelClosing':
    case 'reAggregate':
      return AppAction.UPDATE
    default:
      return AppAction.READ
  }
}

// Prüft eine einzelne Regel aus der Matrix
function checkRule(rule: any, resource: string, action: string): boolean {
  // Falls die Regel ein einfacher String ist (AppAbility), ignorieren wir sie hier.
  // Wir suchen nach Objekten { resource: ..., action: ... }
  if (typeof rule === 'string') return false

  // 1. Ressource muss passen (oder 'system' für globale Rechte)
  if (rule.resource !== resource && rule.resource !== AppResource.SYSTEM) {
    return false
  }

  // 2. Action muss passen
  if (rule.action === AppAction.MANAGE) return true // 'manage' schlägt alles
  if (Array.isArray(rule.action)) return rule.action.includes(action) // Array Check
  return rule.action === action // Single Check
}
