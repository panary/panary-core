// For more information about this file see https://dove.feathersjs.com/guides/cli/knexfile.html
import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('users', (table) => {
    // WIR LÖSCHEN: table.increments('id')

    // Wir setzen den String als Primary Key.
    table.string('_id').primary()

    // Rest bleibt gleich
    table.string('tenantId').nullable()
    table.bigInteger('createdAt')
    table.bigInteger('updatedAt')
    table.string('email').unique()
    table.string('password')
    table.string('loginname')
    table.string('role').defaultTo('user')
    table.string('status').defaultTo('ACTIVE')
    table.string('staffRole').nullable()
    table.boolean('isPosUser').defaultTo(false)
    table.string('posPin').nullable()
    table.string('employeeNumber').unique()
    table.json('permissions').defaultTo('[]')
    table.json('allowedLocationIds').defaultTo('[]')
    table.json('discountDetails').nullable()
    table.boolean('allowStaffMealOrders').defaultTo(false)
    table.boolean('autoLogOff').defaultTo(true)
    table.boolean('mustChangePassword').defaultTo(false)
    table.dateTime('startBreakAt').nullable()
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('users')
}
