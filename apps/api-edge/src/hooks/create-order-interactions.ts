import { HookContext } from '@feathersjs/feathers'
import { OrderInteraction } from '@panary-core/order-interactions/domain'

/**
 * After-Create Hook: Creates order-interactions entries from the stored interactions.
 * Uses the newly created order's _id to link each interaction to the order.
 */
export function createOrderInteractions() {
    return async (context: HookContext) => {
        const { app, result, params } = context

        // Check if orderInteractions were stored in params during before-create
        if (!params.orderInteractions || !Array.isArray(params.orderInteractions)) {
            return context
        }

        const orderInteractions = params.orderInteractions as OrderInteraction[]

        // Get the created order's _id
        const orderId = result._id

        if (!orderId) {
            return context
        }

        // Get the order-interactions service
        const orderInteractionsService = app.service('order-interactions')

        // Create each order-interaction entry with the order's _id
        for (const interaction of orderInteractions) {
            await orderInteractionsService.create({
                ...interaction,
                orderId
            }, params)
        }

        return context
    }
}
