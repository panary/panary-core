import { apikeys } from './apikeys/apikeys'
import { users } from './users/users'
import { organizations } from './organizations/organizations'
// For more information about this file see https://dove.feathersjs.com/guides/cli/application.html#configure-functions
import type { Application } from '../declarations'
import { products } from './products/products'
import { corporateCustomers } from './corporate-customers/corporate-customers'
import { customers } from './customers/customers'
import { discounts } from './discounts/discounts'
import { devices } from './devices/devices'
import { deviceConnections } from './device-connections/device-connections'
import { productGroups } from './product-groups/product-groups'
import { locations } from './locations/locations'
import { orders } from './orders/orders'
import { orderInteractions } from './order-interactions/order-interactions'
import { userPreferences } from './user-preferences/user-preferences'
import { workingTimes } from './working-times/working-times'
import { preOrders } from './pre-orders/pre-orders'
import { cloudConnection } from './cloud-connection/cloud-connection'
import { openingHourExceptions } from './opening-hour-exceptions/opening-hour-exceptions'
import { syncConflicts } from './sync-conflicts/sync-conflicts'
import { syncOutbox } from './sync-outbox/sync-outbox'
import { syncCursor } from './sync-cursor/sync-cursor'
import { syncRuns } from './sync-runs/sync-runs'
import { bootstrapReports } from './bootstrap-reports/bootstrap-reports'
import { auditEvents } from './audit-events/audit-events'
import { businessDays } from './business-days/business-days'
import { cashSessions } from './cash-sessions/cash-sessions'
import { fiscalCounters } from './fiscal-counters/fiscal-counters'
import { logExport } from './log-export/log-export'

export const services = (app: Application) => {
  app.configure(organizations)
  app.configure(apikeys)
  app.configure(users)
  app.configure(products)
  app.configure(corporateCustomers)
  app.configure(customers)
  app.configure(discounts)
  app.configure(devices)
  // Live-Verbindungszählung der Geräte (Channel-Registry). NACH `devices`
  // registriert, weil der Service intern app.service('devices').find aufruft.
  app.configure(deviceConnections)
  app.configure(productGroups)
  app.configure(locations)
  // VOR orders: signOrderTseStart vergibt die Fiskal-Vorgangsnummer über
  // app.service('fiscal-counters') (Vergabe zur Request-Zeit, Registrierung hier).
  app.configure(fiscalCounters)
  app.configure(orders)
  app.configure(orderInteractions)
  app.configure(userPreferences)
  app.configure(workingTimes)
  app.configure(preOrders)
  app.configure(cloudConnection)
  app.configure(openingHourExceptions)
  app.configure(syncConflicts)
  app.configure(syncOutbox)
  app.configure(syncCursor)
  app.configure(syncRuns)
  app.configure(bootstrapReports)
  app.configure(auditEvents)
  app.configure(businessDays)
  app.configure(cashSessions)
  app.configure(logExport)
}
