import { HookContext } from '@feathersjs/feathers'
import { BadRequest, NotAuthenticated } from '@feathersjs/errors'
import { User } from '@panary-core/users/domain'
import { Location } from '@panary-core/locations/domain'
import { AppError, AppErrorMessages } from '@panary-core/shared/common'
import { uuidv7 } from 'uuidv7'
import { logger } from '../logger'

/**
 * Calculates the absolute difference in days between two dates.
 * @param date1 - First Date
 * @param date2 - Second Date
 * @returns Difference in days
 */
const getDifferenceInDays = (date1: Date, date2: Date): number => {
  const oneDayInMs = 1000 * 60 * 60 * 24
  const utc1 = Date.UTC(date1.getFullYear(), date1.getMonth(), date1.getDate())
  const utc2 = Date.UTC(date2.getFullYear(), date2.getMonth(), date2.getDate())

  return Math.floor(Math.abs(utc2 - utc1) / oneDayInMs)
}

export function restrictOrderToBusinessDay() {
  return async (context: HookContext) => {
    const { app, params } = context
    const { user } = params

    // Determine locationId based on authentication type
    let locationId: string | undefined

    // Check for API Key authentication
    const isApiKey = params.apiKey || params.authentication?.strategy === 'apiKey'

    if (isApiKey) {
      // For API Key auth, use locationId from params (set by allowApiKey hook)
      const apiKeyLocationId =
        (params.locationId as string | undefined) || (params.connection?.locationId as string | undefined)
      if (!apiKeyLocationId)
        throw new BadRequest(AppErrorMessages[AppError.LOCATION_NOT_ASSIGNED], {
          code: AppError.LOCATION_NOT_ASSIGNED
        })
      locationId = apiKeyLocationId
    } else {
      // For user auth, get locationId from user
      if (!user)
        throw new NotAuthenticated(AppErrorMessages[AppError.AUTH_UNAUTHENTICATED], {
          code: AppError.AUTH_UNAUTHENTICATED
        })

      const query = { query: { $select: ['activeLocationId'] }, provider: undefined }
      const existingUser: User = await app.service('users').get(user.id, query)

      if (!existingUser.activeLocationId)
        throw new BadRequest(AppErrorMessages[AppError.LOCATION_NOT_ASSIGNED], {
          code: AppError.LOCATION_NOT_ASSIGNED
        })
      locationId = existingUser.activeLocationId as string
    }

    // Load the location service
    const locationService = app.service('locations')

    // Get the location (tenantId wird für Auto-Rotate benötigt)
    const activeLocation: Location = await locationService.get(locationId!, {
      query: { $select: ['_id', 'tenantId', 'currentBusinessDay'] },
      provider: undefined,
    })

    const systemMode = app.get('system')?.mode || 'standalone'
    const today = new Date().toISOString().slice(0, 10)
    const needsAutoRotate =
      !activeLocation.currentBusinessDay || activeLocation.currentBusinessDay.date !== today

    if (needsAutoRotate && systemMode === 'standalone') {
      // Auto-Rotate: Geschäftstag transparent erstellen/aktualisieren
      const newId = uuidv7()
      const now = new Date().toISOString()
      const knex = app.get('sqliteClient')

      // Vorherigen Geschäftstag schließen
      if (activeLocation.currentBusinessDay?.businessDayId) {
        await knex('businessdays')
          .where({ _id: activeLocation.currentBusinessDay.businessDayId })
          .update({ isOpen: false, closedAt: now, updatedAt: now })
      }

      // Neuen Geschäftstag erstellen
      await knex('businessdays').insert({
        _id: newId,
        tenantId: activeLocation.tenantId,
        locationId: locationId,
        date: today,
        openedAt: now,
        isOpen: true,
        createdAt: now,
        updatedAt: now,
      })

      // Location aktualisieren (intern, ohne Auth)
      await locationService.patch(
        locationId!,
        { currentBusinessDay: { businessDayId: newId, date: today } },
        { provider: undefined },
      )

      logger.info(`[AutoBusinessDay] Mitternachts-Rotation: Neuer Geschäftstag ${newId} für Location ${locationId}.`)
      context.data.businessDayId = newId
      return context
    }

    if (!activeLocation.currentBusinessDay) {
      // Enterprise-Modus: kein Geschäftstag = Fehler
      throw new BadRequest(AppErrorMessages[AppError.BUSINESS_DAY_NOT_SET], {
        code: AppError.BUSINESS_DAY_NOT_SET,
      })
    }

    // Datumsvalidierung (Enterprise-Modus)
    const businessDayDate = new Date(activeLocation.currentBusinessDay.date)
    const currentDate = new Date()
    const diffDays = getDifferenceInDays(currentDate, businessDayDate)
    const maxAllowedDifference = app.get('maxOrderDifferenceDays') || 1

    if (diffDays > maxAllowedDifference) {
      throw new BadRequest(AppErrorMessages[AppError.BUSINESS_DAY_TOO_OLD], {
        code: AppError.BUSINESS_DAY_TOO_OLD,
        diffDays,
        maxAllowedDifference,
      })
    }

    // Geschäftstag OK → businessDayId in Order schreiben
    context.data.businessDayId = activeLocation.currentBusinessDay.businessDayId

    return context
  }
}
