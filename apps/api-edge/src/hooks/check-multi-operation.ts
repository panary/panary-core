import { HookContext } from "@feathersjs/feathers"
import { MethodNotAllowed } from "@feathersjs/errors"

export const checkMultiOperation = (context: HookContext) => {
    const id = context.arguments?.[0]   // Safely access the first argument

    // Check if `id` is null or undefined
    if (id == null) {
        const provider = context.params?.provider || 'unknown'  // Fallback to 'unknown' if provider is undefined
        const method = context.method || 'unknown'  // Fallback to 'unknown' if method is undefined

        throw new MethodNotAllowed(
            `Provider '${ provider }' cannot perform a multi-operation using '${ method }'. Operation disallowed.`
        )
    }
}