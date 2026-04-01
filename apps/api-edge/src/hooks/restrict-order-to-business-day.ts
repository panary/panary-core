import { HookContext } from '@feathersjs/feathers'
import { BadRequest, NotAuthenticated } from '@feathersjs/errors'
import { User } from '@panary-core/users/domain'
import { Location } from '@panary-core/locations/domain'
import { AppError, AppErrorMessages } from '@panary-core/shared/common'
import { logger } from '../logger'
import {
  getDifferenceInDays,
  hasActiveOrders,
  rotateBusinessDay,
  shouldAutoRotate,
} from '../utils/business-day.utils'

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

  const existingUser: User = await app.service('users').get(user.id, {
    query: { $select: ['activeLocationId'] },
    provider: undefined,
  })

  if (!existingUser.activeLocationId) {
    throw new BadRequest(AppErrorMessages[AppError.LOCATION_NOT_ASSIGNED], {
      code: AppError.LOCATION_NOT_ASSIGNED,
    })
  }

  return existingUser.activeLocationId as string
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

    // Standalone: Auto-Rotate durchfuehren
    if (needsRotation && systemMode === 'standalone') {
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

    // Enterprise: Geschaeftstag muss existieren
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
