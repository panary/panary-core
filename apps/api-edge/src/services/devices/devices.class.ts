import type { Params, ServiceInterface } from '@feathersjs/feathers'
import type { KnexAdapterParams } from '@feathersjs/knex'
import type { MongoDBAdapterParams } from '@feathersjs/mongodb'

// Domain Imports
import type { Device, DeviceData, DevicePatch, DeviceQuery } from '@panary-core/devices/domain'

export type { Device, DeviceData, DevicePatch, DeviceQuery }

// Combined parameter type for SQL & NoSQL
export type DeviceParams = KnexAdapterParams<DeviceQuery> & MongoDBAdapterParams & Params

// Service Interface - can be either KnexService or MongoDBService
export interface DeviceService extends ServiceInterface<Device, DeviceData, DeviceParams, DevicePatch> {}
