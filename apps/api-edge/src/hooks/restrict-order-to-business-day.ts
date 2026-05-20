import { HookContext } from '@feathersjs/feathers'
import { BadRequest, NotAuthenticated } from '@feathersjs/errors'
import { User } from '@panary/users/domain'
import { Location } from '@panary/locations/domain'
import { PairingStatus, CloudConnection } from '@panary/cloud-connection/domain'
import { AppError, AppErrorMessages } from '@panary/shared-common'
import { logger } from '@panary/shared-backend'
import {
  getDifferenceInDays,
  hasActiveOrders,
  rotateBusinessDay,
  shouldAutoRotate,
} from '../utils/business-day.utils'

/**
 * Liest die aktive `cloud-connection`-Verbindung (CONNECTED) und prueft, ob
 * der Operator gerade einen Offline-Override aktiviert hat (Banner-Action
 * im Admin-Client). Liefert `null`, wenn kein Pairing aktiv ist (= Standalone).
 *
 * Im Standalone-Modus (`null`) UND im Connected-Modus mit aktivem
 * Offline-Override darf `rotateBusinessDay()` laufen. Im Connected-Modus
 * ohne Override blockiert der Hook neue Bestellungen mit klarer Operator-
 * Message.
 */
async function getConnectedCloudConnection(
  context: HookContext,
): Promise<CloudConnection | null> {
  try {
    const result = await context.app.service('cloud-connection').find({
      provider: undefined,
      paginate: false,
      query: { pairingStatus: PairingStatus.CONNECTED, $limit: 1 },
    })
    const list = Array.isArray(result) ? result : []
    return (list[0] as CloudConnection | undefined) ?? null
  } catch {
    return null
  }
}

function isOfflineOverrideActive(connection: CloudConnection): boolean {
  const until = connection.offlineOverrideActiveUntil
  if (!until) return false
  const untilMs = new Date(until).getTime()
  if (Number.isNaN(untilMs)) return false
  return untilMs > Date.now()
}

/**
 * Ermittelt die locationId anhand des Authentifizierungstyps (API-Key oder User).
 */
async function resolveLocationId(context: HookContext): Promise<string> {
  const { app, params } = context
  const { user } = params

  const isApiKey = params.apiKey || params.authentication?.strategy === 'apiKey'

  if (isApiKey) {
    const apiKeyLocationId =
      (params.locationId as string | undefined) || (params.connection?.locationId as string | undefined)

    if (!apiKeyLocationId) {
      throw new BadRequest(AppErrorMessages[AppError.LOCATION_NOT_ASSIGNED], {
        code: AppError.LOCATION_NOT_ASSIGNED,
      })
    }
    return apiKeyLocationId
  }

  if (!user) {
    throw new NotAuthenticated(AppErrorMessages[AppError.AUTH_UNAUTHENTICATED], {
      code: AppError.AUTH_UNAUTHENTICATED,
    })
  }

  const existingUser: User = await app.service('users').get(user._id, {
    query: { $select: ['activeLocationId'] },
    provider: undefined,
  })

  if (existingUser.activeLocationId) {
    return existingUser.activeLocationId as string
  }

  // Standalone-Fallback: Einzige Location des Servers verwenden
  const systemMode = app.get('system')?.mode || 'standalone'
  if (systemMode === 'standalone') {
    const locations = (await app.service('locations').find({
      query: { $limit: 1, $select: ['_id'] },
      provider: undefined,
    })) as any
    if (locations.data?.length > 0) {
      return locations.data[0]._id
    }
  }

  throw new BadRequest(AppErrorMessages[AppError.LOCATION_NOT_ASSIGNED], {
    code: AppError.LOCATION_NOT_ASSIGNED,
  })
}

/**
 * Validiert, dass der aktuelle Geschaeftstag nicht zu alt ist (Enterprise-Modus).
 */
function validateBusinessDayAge(app: HookContext['app'], businessDayDate: string): void {
  const currentDate = new Date()
  const diffDays = getDifferenceInDays(currentDate, new Date(businessDayDate))
  const maxAllowedDifference = app.get('maxOrderDifferenceDays') || 1

  if (diffDays > maxAllowedDifference) {
    throw new BadRequest(AppErrorMessages[AppError.BUSINESS_DAY_TOO_OLD], {
      code: AppError.BUSINESS_DAY_TOO_OLD,
      diffDays,
      maxAllowedDifference,
    })
  }
}

/**
 * Hook: Ordnet jeder neuen Bestellung einen gueltigen Geschaeftstag zu.
 *
 * Standalone-Modus: Erstellt bei Bedarf automatisch einen neuen Geschaeftstag (Auto-Rotate).
 * Enterprise-Modus: Erwartet einen bestehenden Geschaeftstag und validiert dessen Alter.
 */
export function restrictOrderToBusinessDay() {
  return async (context: HookContext) => {
    const { app } = context

    const locationId = await resolveLocationId(context)

    const activeLocation: Location = await app.service('locations').get(locationId, {
      query: { $select: ['_id', 'tenantId', 'currentBusinessDay'] },
      provider: undefined,
    })

    const systemMode = app.get('system')?.mode || 'standalone'
    const today = new Date().toISOString().slice(0, 10)
    const needsRotation = shouldAutoRotate(activeLocation.currentBusinessDay, today)

    // Im Cloud-Managed-Hybrid (siehe ADR business-days-cloud-managed):
    // `rotateBusinessDay()` darf nur laufen wenn KEIN aktives Pairing UND
    // Standalone-System-Mode, ODER wenn der Operator den Offline-Override
    // gesetzt hat (manueller Bypass bei Cloud-Outage). Sonst blockieren.
    const cloudConnection = await getConnectedCloudConnection(context)
    const overrideActive = cloudConnection ? isOfflineOverrideActive(cloudConnection) : false
    const standaloneAllowed = systemMode === 'standalone' && (!cloudConnection || overrideActive)

    if (needsRotation && standaloneAllowed) {
      // Rotation blockieren wenn noch aktive Bestellungen vorhanden
      if (activeLocation.currentBusinessDay?.businessDayId) {
        const blocked = await hasActiveOrders(app, activeLocation.currentBusinessDay.businessDayId)

        if (blocked) {
          logger.warn(
            `[AutoBusinessDay] Rotation fuer Location ${locationId} blockiert — aktive Bestellung(en) im Geschaeftstag ${activeLocation.currentBusinessDay.businessDayId}. Neue Bestellung wird dem aktuellen Geschaeftstag zugeordnet.`,
          )
          context.data.businessDayId = activeLocation.currentBusinessDay.businessDayId
          return context
        }
      }

      const newId = await rotateBusinessDay(app, activeLocation, today)
      context.data.businessDayId = newId
      return context
    }

    // Connected ohne Override: kein Auto-Rotate. Cloud ist Master fuer
    // Lifecycle — Edge wartet auf naechsten Pull oder Operator-Banner.
    if (needsRotation && cloudConnection && !overrideActive) {
      throw new BadRequest(
        'Der aktuelle Geschaeftstag wird in der Cloud verwaltet und ist nicht eroeffnet ' +
          'oder veraltet. Bitte im Cloud-Admin einen neuen Geschaeftstag eroeffnen — oder ' +
          'im Edge-Admin den Offline-Modus aktivieren (bei Cloud-Outage).',
        { code: AppError.BUSINESS_DAY_NOT_SET },
      )
    }

    // Enterprise / kein Rotations-Bedarf: Geschaeftstag muss existieren
    if (!activeLocation.currentBusinessDay) {
      throw new BadRequest(AppErrorMessages[AppError.BUSINESS_DAY_NOT_SET], {
        code: AppError.BUSINESS_DAY_NOT_SET,
      })
    }

    validateBusinessDayAge(app, activeLocation.currentBusinessDay.date)

    context.data.businessDayId = activeLocation.currentBusinessDay.businessDayId
    return context
  }
}
