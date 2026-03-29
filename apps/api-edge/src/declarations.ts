// For more information about this file see https://dove.feathersjs.com/guides/cli/typescript.html
import { Application as FeathersApplication, Koa } from '@feathersjs/koa'
import { HookContext as FeathersHookContext, NextFunction } from '@feathersjs/feathers'
import { ApplicationConfiguration } from './configuration'
import { UserService } from './services/users/users.class'
import { ApiKeyService } from './services/apikeys/apikeys.class'
import { ProductService } from './services/products/products.class'
import { CorporateCustomerService } from './services/corporate-customers/corporate-customers.class'
import { CustomerService } from './services/customers/customers.class'
import { DeviceService } from './services/devices/devices.class'
import { ProductGroupService } from './services/product-groups/product-groups.class'
import { LocationService } from './services/locations/locations.class'
import { OrderService } from './services/orders/orders.class'
import { OrderInteractionService } from './services/order-interactions/order-interactions.class'
import { UserPreferenceService } from './services/user-preferences/user-preferences.class'
import { WorkingTimeService } from './services/working-times/working-times.class'
import { PreOrderService } from './services/pre-orders/pre-orders.class'

export type { NextFunction }

declare module '@feathersjs/feathers' {
  interface ServiceOptions {
    docs?: any
  }
}

// The types for app.get(name) and app.set(name)
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Configuration extends ApplicationConfiguration {}

export interface ServiceTypes {
  users: UserService
  apikeys: ApiKeyService
  products: ProductService
  'corporate-customers': CorporateCustomerService
  customers: CustomerService
  devices: DeviceService
  'product-groups': ProductGroupService
  locations: LocationService
  orders: OrderService
  'order-interactions': OrderInteractionService
  'user-preferences': UserPreferenceService
  'working-times': WorkingTimeService
  'pre-orders': PreOrderService
  organizations: { find(params?: any): Promise<{ _id: string; name: string }[]> }
}

// The application instance type that will be used everywhere else
export type Application = FeathersApplication<ServiceTypes, Configuration> & Omit<Koa, 'listen'>

// The context for hook functions - can be typed with a service class
export type HookContext<S = any> = FeathersHookContext<Application, S>
