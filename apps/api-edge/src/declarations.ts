// For more information about this file see https://dove.feathersjs.com/guides/cli/typescript.html
import { Application as FeathersApplication, Koa } from '@feathersjs/koa'
import { HookContext as FeathersHookContext, NextFunction } from '@feathersjs/feathers'
import { ApplicationConfiguration } from './configuration'
import { UserService } from './services/users/users.class'
import { ApiKeyService } from './services/apikeys/apikeys.class'
import { ProductService } from './services/products/products.class'
import { CorporateCustomerService } from './services/corporate-customers/corporate-customers.class'
import { CustomerService } from './services/customers/customers.class'
import { DiscountService } from './services/discounts/discounts.class'
import { DeviceService } from './services/devices/devices.class'
import { BusinessDayService } from './services/business-days/business-days.class'
import { CashSessionService } from './services/cash-sessions/cash-sessions.class'
import { ProductGroupService } from './services/product-groups/product-groups.class'
import { LocationService } from './services/locations/locations.class'
import { OrderService } from './services/orders/orders.class'
import { OrderInteractionService } from './services/order-interactions/order-interactions.class'
import { UserPreferenceService } from './services/user-preferences/user-preferences.class'
import { WorkingTimeService } from './services/working-times/working-times.class'
import { PreOrderService } from './services/pre-orders/pre-orders.class'
import { CloudConnectionService } from './services/cloud-connection/cloud-connection.class'
import { OpeningHourExceptionService } from './services/opening-hour-exceptions/opening-hour-exceptions.class'
import type {
  SyncConflict,
  SyncCursor,
  SyncOutboxEntry,
  SyncRun,
} from '@panary/sync/domain'
import type { BootstrapReport } from '@panary/cloud-connection/domain'
import type { AuditEvent } from '@panary/audit-events/domain'
import type { FiscalCounter, TsePort } from '@panary/tse/domain'
import type { Receipt } from '@panary/receipts/domain'

export type { NextFunction }
export type NextHook = NextFunction

// Generischer Service-Adapter-Typ fuer SQLite-Tabellen ohne dedizierte
// Service-Klasse (sync-conflicts, sync-outbox, sync-cursor). Reicht aus, damit
// `app.service('...')`-Aufrufe TypeScript-typed bleiben.
type GenericService<TEntity> = {
  find(params?: any): Promise<TEntity[] | { data: TEntity[]; total: number }>
  get(id: string, params?: any): Promise<TEntity>
  create(data: Partial<TEntity>, params?: any): Promise<TEntity>
  patch(id: string | null, data: Partial<TEntity>, params?: any): Promise<TEntity | TEntity[]>
  remove(id: string | null, params?: any): Promise<TEntity | TEntity[]>
  _get?(id: string, params?: any): Promise<TEntity>
  _patch?(id: string | null, data: Partial<TEntity>, params?: any): Promise<TEntity | TEntity[]>
}

declare module '@feathersjs/feathers' {
  interface ServiceOptions {
    docs?: any
  }
}

// The types for app.get(name) and app.set(name)
export interface Configuration extends ApplicationConfiguration {
  // Laufzeit-Instanz des TSE-Ports (Fiskalisierung), beim Bootstrap via
  // `createTsePort` gesetzt. Optional — in Produktion ohne echten Provider inaktiv.
  tsePort?: TsePort
}

export interface ServiceTypes {
  users: UserService
  apikeys: ApiKeyService
  products: ProductService
  'corporate-customers': CorporateCustomerService
  customers: CustomerService
  discounts: DiscountService
  devices: DeviceService
  'product-groups': ProductGroupService
  locations: LocationService
  orders: OrderService
  'order-interactions': OrderInteractionService
  'user-preferences': UserPreferenceService
  'working-times': WorkingTimeService
  'pre-orders': PreOrderService
  organizations: {
    find(params?: any): Promise<{ _id: string; name: string }[]>
  }
  'cloud-connection': CloudConnectionService
  'opening-hour-exceptions': OpeningHourExceptionService
  'sync-conflicts': GenericService<SyncConflict>
  'sync-outbox': GenericService<SyncOutboxEntry>
  'sync-cursor': GenericService<SyncCursor>
  'sync-runs': GenericService<SyncRun>
  'bootstrap-reports': GenericService<BootstrapReport>
  'audit-events': GenericService<AuditEvent>
  businessdays: BusinessDayService
  'cash-sessions': CashSessionService
  'fiscal-counters': GenericService<FiscalCounter>
  receipts: GenericService<Receipt>
  'log-export': {
    find(params?: any): Promise<{
      total: number
      limit: number
      skip: number
      data: Array<{
        filename: string
        contentType: string
        sha256: string
        lineCount: number
        fileCount: number
        generatedAt: string
        contentBase64: string
      }>
    }>
  }
}

// The application instance type that will be used everywhere else
export type Application = FeathersApplication<ServiceTypes, Configuration> & Omit<Koa, 'listen'>

// The context for hook functions - can be typed with a service class
export type HookContext<S = any> = FeathersHookContext<Application, S>
