import { Route } from '@angular/router'
import { setupGuard } from './guards/setup.guard'
import { posAuthGuard } from './guards/pos-auth.guard'

import { SetupComponent } from '@panary-core/system/feature-pos-setup'
import { LoginComponent } from '@panary-core/users/feature-pos-login'
import { DashboardComponent } from '@panary-core/orders/feature-pos-dashboard'
// import { PosShellComponent } from '@panary/shared/ui-layout' -> WE NEED TO MIGRATE SHELL COMPONENT TOO
import { AppPosShellComponent } from './shell/shell'
import { ActiveOrdersComponent } from '@panary-core/orders/feature-pos-active'

export const appRoutes: Route[] = [
  {
    path: '',
    redirectTo: 'setup',
    pathMatch: 'full',
  },
  {
    path: 'setup',
    component: SetupComponent,
    canActivate: [setupGuard],
  },
  {
    path: 'login',
    component: LoginComponent,
    canActivate: [posAuthGuard],
  },
  // Authenticated routes with POS Shell
  {
    path: '',
    component: AppPosShellComponent,
    canActivate: [posAuthGuard],
    children: [
      {
        path: 'dashboard',
        component: DashboardComponent,
      },
      {
        path: 'orders/active',
        component: ActiveOrdersComponent,
      },
      {
        path: 'orders/history',
        loadComponent: () => import('@panary-core/orders/feature-pos-history').then(m => m.OrderHistoryComponent),
      },
      {
        path: 'settings',
        loadComponent: () => import('@panary-core/devices/feature-pos-settings').then(m => m.SettingsComponent),
      },
      {
        path: 'working-times',
        loadComponent: () =>
          import('@panary-core/working-times/feature-pos-history').then(m => m.WorkingTimeHistoryComponent),
      },
      {
        path: 'pre-orders',
        loadComponent: () => import('@panary-core/pre-orders/feature-pos-list').then(m => m.PreOrderListComponent),
      },
    ],
  },
  {
    path: '**',
    redirectTo: 'setup',
  },
]
