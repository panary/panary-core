import { HookContext } from '@feathersjs/feathers'
import { OrderInteraction } from '@panary/order-interactions/domain'
import { logger } from '@panary/shared-backend'

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

        // Der Service ist mit multi:[] registriert → ein Array-Create würde
        // MethodNotAllowed werfen. Jede Interaction einzeln anlegen (gleicher
        // Pfad wie order-cancel). try/catch, damit das Audit-Tracking die bereits
        // gespeicherte Order nie scheitern lässt und Fehler sichtbar bleiben.
        try {
            await Promise.all(
                orderInteractions.map(interaction => orderInteractionsService.create({ ...interaction, orderId }, params)),
            )
        } catch (error) {
            logger.error({
                message: 'order-interactions konnten nicht angelegt werden',
                event: 'order.interactions_failed',
                orderId,
                error,
            })
        }

        return context
    }
}
