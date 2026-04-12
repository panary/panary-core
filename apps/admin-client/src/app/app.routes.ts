import { Routes } from '@angular/router'
import { authGuard } from './core/auth.guard'
import { AdminLayoutComponent } from './layout/admin-layout'
import { LoginComponent } from './features/login'

export const appRoutes: Routes = [
  { path: 'login', component: LoginComponent },
  {
    path: '',
    component: AdminLayoutComponent,
    canActivate: [authGuard],
    canActivateChild: [authGuard],
    children: [
      { path: 'dashboard', loadComponent: () => import('./features/dashboard/dashboard').then(m => m.DashboardComponent) },
      { path: 'users', loadComponent: () => import('./features/users/user-list').then(m => m.UserListComponent) },
      { path: 'users/:id', loadComponent: () => import('./features/users/user-form').then(m => m.UserFormComponent) },
      { path: 'location', loadComponent: () => import('./features/locations/location-detail').then(m => m.LocationDetailComponent) },
      { path: 'product-groups', loadComponent: () => import('./features/product-groups/group-list').then(m => m.GroupListComponent) },
      { path: 'product-groups/:id', loadComponent: () => import('./features/product-groups/group-form').then(m => m.GroupFormComponent) },
      { path: 'products', loadComponent: () => import('./features/products/product-list').then(m => m.ProductListComponent) },
      { path: 'products/:id', loadComponent: () => import('./features/products/product-form').then(m => m.ProductFormComponent) },
      { path: 'printers', loadComponent: () => import('./features/printers/printer-management').then(m => m.PrinterManagementComponent) },
      { path: 'apikeys', loadComponent: () => import('./features/apikeys/apikey-list').then(m => m.ApikeyListComponent) },
      { path: 'orders', loadComponent: () => import('./features/orders/order-list').then(m => m.OrderListComponent) },
      { path: 'pagers', loadComponent: () => import('./features/locations/pager-settings').then(m => m.PagerSettingsComponent) },
      { path: 'opening-hours', loadComponent: () => import('./features/locations/opening-hours').then(m => m.OpeningHoursComponent) },
      { path: 'cloud', loadComponent: () => import('./features/cloud-connection/cloud-connection').then(m => m.CloudConnectionComponent) },
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
    ],
  },
]
