import { apikeys } from './apikeys/apikeys'
import { users } from './users/users'
import { organizations } from './organizations/organizations'
// For more information about this file see https://dove.feathersjs.com/guides/cli/application.html#configure-functions
import type { Application } from '../declarations'
import { products } from './products/products'
import { corporateCustomers } from './corporate-customers/corporate-customers'
import { customers } from './customers/customers'
import { devices } from './devices/devices'
import { productGroups } from './product-groups/product-groups'
import { locations } from './locations/locations'
import { orders } from './orders/orders'
import { orderInteractions } from './order-interactions/order-interactions'
import { userPreferences } from './user-preferences/user-preferences'
import { workingTimes } from './working-times/working-times'
import { preOrders } from './pre-orders/pre-orders'
import { cloudConnection } from './cloud-connection/cloud-connection'

export const services = (app: Application) => {
  app.configure(organizations)
  app.configure(apikeys)
  app.configure(users)
  app.configure(products)
  app.configure(corporateCustomers)
  app.configure(customers)
  app.configure(devices)
  app.configure(productGroups)
  app.configure(locations)
  app.configure(orders)
  app.configure(orderInteractions)
  app.configure(userPreferences)
  app.configure(workingTimes)
  app.configure(preOrders)
  app.configure(cloudConnection)
}
