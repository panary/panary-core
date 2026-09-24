// Append-only Vorgangs-Referenzen-Service (Edge / SQLite).
//
// DSFinV-K Tz. 4.2.2 (`Bon_Referenzen`): Jeder Bezug zwischen zwei Vorgaengen
// wird als eigener Datensatz festgehalten. Erster Nutzer ist der Storno,
// Split und Umbuchung folgen mit panary/panary-core#349.
//
// - Methoden: find, get, create. update/patch/remove sind NICHT registriert
//   und werden von Feathers automatisch mit MethodNotAllowed abgelehnt.
// - `create` ist intern only: `provider` muss undefined sein, sonst Forbidden.
//   Referenzen entstehen aus Vorgaengen, nie aus einem Client-Aufruf.
// - Append-only zusaetzlich auf DB-Layer durch SQLite-Trigger
//   (Migration 20260924100000_order_references.ts).
import { authenticate } from '@feathersjs/authentication'
import { Forbidden } from '@feathersjs/errors'
import { hooks as schemaHooks, resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import { uuidv7 } from 'uuidv7'

import {
  type OrderReference,
  type OrderReferenceData,
  orderReferenceDataSchema,
  orderReferenceQuerySchema,
} from '@panary/order-references/domain'
import { authorize, dataValidator, multiTenancy, queryValidator } from '@panary/shared-backend'
import { createServiceAdapter } from '@panary/shared/data-access/server'
import { DatabaseType } from '@panary/shared-common'

import { validateData } from '../../hooks/validate-data.hook'
import type { Application, HookContext, NextFunction } from '../../declarations'

export const orderReferencesPath = 'order-references'

const orderReferenceDataValidator = getValidator(orderReferenceDataSchema, dataValidator)
const orderReferenceQueryValidator = getValidator(orderReferenceQuerySchema, queryValidator)

const orderReferenceResolver = resolve<OrderReference, HookContext>({})
const orderReferenceExternalResolver = resolve<OrderReference, HookContext>({})

const orderReferenceDataResolver = resolve<OrderReference, HookContext>({
  _id: async value => value || uuidv7(),
  createdAt: async value => value || new Date().toISOString(),
  // Trotz append-only gesetzt: Der Sync-Pull filtert ueber `updatedAt > since`.
  // Ein NULL-Wert hier fiele aus jedem Pull-Fenster und die Referenz erreichte
  // die Cloud nie — still, ohne Fehler.
  updatedAt: async value => value || new Date().toISOString(),
})

const orderReferenceQueryResolver = resolve<OrderReference, HookContext>({})

// Around-Hook: blockt externe Schreibzugriffe. Referenzen entstehen nur
// serverseitig aus einem Vorgang (Storno, Split, Umbuchung) — ein Client darf
// sie nicht erfinden, sonst ist die Belegkette manipulierbar.
const blockExternalWrites = async (context: HookContext, next: NextFunction) => {
  if (context.method === 'create' && context.params.provider) {
    throw new Forbidden('Vorgangs-Referenzen werden nur intern erzeugt')
  }
  await next()
}

export const orderReferences = (app: Application) => {
  const paginate = app.get('paginate')
  const systemConfig = app.get('system') || {}
  const dbType = systemConfig.dbType || DatabaseType.SQLITE
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let Model: any
  if (dbType === DatabaseType.SQLITE) Model = app.get('sqliteClient')

  const service = createServiceAdapter<OrderReference, OrderReferenceData>(app, {
    name: orderReferencesPath,
    Model,
    paginate,
    id: '_id',
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use(orderReferencesPath, service as any, {
    methods: ['find', 'get', 'create'],
    events: [],
  })

  app.service(orderReferencesPath).hooks({
    around: {
      all: [
        blockExternalWrites,
        authenticate('jwt'),
        authorize(),
        multiTenancy(),
        schemaHooks.resolveExternal(orderReferenceExternalResolver),
        schemaHooks.resolveResult(orderReferenceResolver),
      ],
    },
    before: {
      all: [
        schemaHooks.validateQuery(orderReferenceQueryValidator),
        schemaHooks.resolveQuery(orderReferenceQueryResolver),
      ],
      create: [validateData(orderReferenceDataValidator), schemaHooks.resolveData(orderReferenceDataResolver)],
    },
  })
}
