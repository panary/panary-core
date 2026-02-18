import { HookContext, NextFunction } from '@feathersjs/feathers'
import { Mutex } from 'async-mutex'

const mutex = new Mutex()

export function assignDailySequenceNumber() {
  return async (context: HookContext, _next?: NextFunction): Promise<any> => {
    const next = typeof _next === 'function' ? _next : async () => context
    await mutex.runExclusive(async () => {
      context.data.dailySequenceNumber = await getDailySequenceNumberByTime(context)
    })

    return next()
  }

  // async function getDailySequenceNumberByInterval(context: HookContext): Promise<number> {
  //   const locationId = context.arguments[1].user.location
  //   if (!locationId) {
  //     return randomInt(9999)
  //   }
  //
  //   const locationsService = context.app.service('locations')
  //   const location = await locationsService.get(locationId)
  //   const dailySequenceNumber = location.dailySequenceNumber
  //   const newDailySequenceNumber = location.dailySequenceNumber + 1
  //   await locationsService.patch(locationId, { dailySequenceNumber: newDailySequenceNumber })
  //
  //   return newDailySequenceNumber
  // }

  async function getDailySequenceNumberByTime(context: HookContext): Promise<number> {
    const date: Date = new Date()
    const dailySequenceNumber = `${date.getMinutes()}${date.getSeconds()}`

    // Proof if the new created dailySequenceNumber is already in use
    const ordersService = context.app.service('orders')
    try {
      const count = await ordersService.find({
        query: {
          dailySequenceNumber: parseInt(`${dailySequenceNumber}`),
          $limit: 0
        }
      })

      if (count.total === 0) {
        return parseInt(`${dailySequenceNumber}`)
      } else {
        return parseInt(`${dailySequenceNumber}${count.total}`)
      }
    } catch (error) {
      return parseInt(`${dailySequenceNumber}`)
    }
  }
}
