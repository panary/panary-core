import { HookContext } from '@feathersjs/feathers'
import type { OrderInteractionData } from '@panary/order-interactions/domain'

/**
 * Before-Create Hook: Extracts orderInteractions from context.data
 * and stores them in context.params for later processing.
 * Removes orderInteractions from context.data to ensure validation passes.
 */
export function extractOrderInteractions() {
  return async (context: HookContext) => {
    const { data } = context

    // Check if orderInteractions exists in the data
    if (data && 'orderInteractions' in data && Array.isArray(data.orderInteractions)) {
      // Store interactions in context.params for later use
      context.params.orderInteractions = data.orderInteractions as OrderInteractionData[]

      // Remove orderInteractions from context.data so validation passes
      delete data.orderInteractions
    }

    return context
  }
}
