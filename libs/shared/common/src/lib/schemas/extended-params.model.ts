import type { Params } from '@feathersjs/feathers'

export interface ExtendedParams extends Params {
  paginate?: boolean
}
