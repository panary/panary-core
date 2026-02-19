// For more information about this file see https://dove.feathersjs.com/guides/cli/knexfile.html
import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('users', (table) => {
    table.string('_id').primary()

    table.string('tenantId').nullable()
    table.string('activeLocationId').nullable()
    table.string('stampingId').nullable()
    table.string('createdAt').nullable()
    table.string('updatedAt').nullable()

    table.string('email').unique().nullable()
    table.string('password')
    table.string('loginname')
    table.string('firstName').defaultTo('')
    table.string('lastName').defaultTo('')

    table.string('role').defaultTo('user')
    table.string('status').defaultTo('ACTIVE')

    table.string('staffRole').nullable()
    table.boolean('isPosUser').defaultTo(false)
    table.string('posPin').nullable()
    table.string('employeeNumber').unique().nullable()

    table.text('permissions').defaultTo('[]')
    table.text('allowedLocationIds').defaultTo('[]')
    table.text('discountDetails').nullable()

    table.boolean('allowStaffMealOrders').defaultTo(false)
    table.boolean('autoLogOff').defaultTo(true)
    table.boolean('mustChangePassword').defaultTo(false)
    table.string('startBreakAt').nullable()
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('users')
}
