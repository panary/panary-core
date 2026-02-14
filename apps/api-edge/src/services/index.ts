import { apikeys } from './apikeys/apikeys'
import { users } from './users/users'
// For more information about this file see https://dove.feathersjs.com/guides/cli/application.html#configure-functions
import type { Application } from '../declarations'
import { products } from './products/products'

export const services = (app: Application) => {
  app.configure(apikeys)
  app.configure(users)
  // All services will be registered here
  app.configure(products)
}
