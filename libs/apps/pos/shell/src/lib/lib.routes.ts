import { appRoutes } from './app.routes'

// Export appRoutes as shellRoutes so the lazy loading in apps/pos/src/app/app.routes.ts picks up the full route config
export const shellRoutes = appRoutes
