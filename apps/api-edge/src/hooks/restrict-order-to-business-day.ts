import { HookContext } from '@feathersjs/feathers'
import { BadRequest, NotAuthenticated } from '@feathersjs/errors'
import { User } from '@panary-core/users/domain'
import { Location } from '@panary-core/locations/domain'
import { AppError, AppErrorMessages } from '@panary-core/shared/common'

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

    // Get the location
    const activeLocation: Location = await locationService.get(locationId!, {
      query: { $select: ['currentBusinessDay'] }
    })

    const systemMode = app.get('system')?.mode || 'standalone'

    if (!activeLocation.currentBusinessDay) {
      if (systemMode === 'standalone') {
        // In standalone mode, we allow orders without a business day (Soft Fail)
        context.data.businessDayId = null
        return context
      }
      // In enterprise mode (default), we require a business day (Hard Fail)
      throw new BadRequest(AppErrorMessages[AppError.BUSINESS_DAY_NOT_SET], {
        code: AppError.BUSINESS_DAY_NOT_SET
      })
    }

    // Parse the BusinessDay date
    const businessDayDate = new Date(activeLocation.currentBusinessDay.date)
    const currentDate = new Date()

    // Calculate the difference in days
    const diffDays = getDifferenceInDays(currentDate, businessDayDate)

    // Get max allowed difference from config
    const maxAllowedDifference = app.get('maxOrderDifferenceDays') || 1

    if (diffDays > maxAllowedDifference) {
      throw new BadRequest(AppErrorMessages[AppError.BUSINESS_DAY_TOO_OLD], {
        code: AppError.BUSINESS_DAY_TOO_OLD,
        diffDays,
        maxAllowedDifference
      })
    }

    // If everything is ok, write business day in order and continue
    context.data.businessDayId = activeLocation.currentBusinessDay.businessDayId

    return context
  }
}
