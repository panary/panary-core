import { Route } from '@angular/router'

export const appRoutes: Route[] = [
  {
    path: '',
    loadChildren: () => import('@panary/apps/pos-client/shell').then(m => m.shellRoutes),
  },
]
