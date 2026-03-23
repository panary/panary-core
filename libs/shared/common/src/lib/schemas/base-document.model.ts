import { Id } from '@feathersjs/feathers'

export interface BaseDocument {
  _id: Id
  name?: string
}
