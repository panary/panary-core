import { Route } from '@angular/router'

export const appRoutes: Route[] = [
  {
    path: '',
    loadChildren: () => import('@panary-core/apps/pos/shell').then(m => m.shellRoutes),
  },
]
