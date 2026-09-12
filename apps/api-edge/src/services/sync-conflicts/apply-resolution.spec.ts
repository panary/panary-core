// Die Bausteine des Konflikt-Apply einzeln — ohne App, ohne DB.
//
// Der Ablauf als Ganzes haengt an einer echten SQLite und steht in
// `sync-conflicts.integration.spec.ts`. Hier stehen die Faelle, die dort nur
// umstaendlich herzustellen waeren: SQLite-Booleans, Schluesselreihenfolge,
// kaputter Payload.

import { describe, expect, it } from 'vitest'

import { USER_EDGE_LOCAL_FIELDS } from '@panary/users/domain'

import {
  coerceCloudRecord,
  normalizeForComparison,
  reduceToPatchableFields,
  skippedFieldsFor,
  unappliedFields,
} from './apply-resolution'
import type { SchemaShape } from '../schema-shape'

const shape = (fields: string[], closed = true): SchemaShape => ({
  fields: new Set(fields),
  required: new Set<string>(),
  closed,
})

describe('coerceCloudRecord', () => {
  it('parst den JSON-String, den SQLite aus der text-Spalte liefert', () => {
    // Der Ausgangsdefekt: ohne Parse war `cloudPayload._id` undefined, der
    // Patch lief als Multi-Patch mit einem String als Data.
    expect(coerceCloudRecord('{"_id":"a","checkoutDate":"18:45"}')).toEqual({ _id: 'a', checkoutDate: '18:45' })
  })

  it('reicht ein bereits geparstes Objekt unveraendert durch', () => {
    expect(coerceCloudRecord({ _id: 'a' })).toEqual({ _id: 'a' })
  })

  it('meldet fehlenden oder unbrauchbaren Payload als null', () => {
    expect(coerceCloudRecord(null)).toBeNull()
    expect(coerceCloudRecord(undefined)).toBeNull()
    expect(coerceCloudRecord('')).toBeNull()
    expect(coerceCloudRecord('{kaputt')).toBeNull()
    expect(coerceCloudRecord('[1,2]')).toBeNull()
    expect(coerceCloudRecord(42)).toBeNull()
  })
})

describe('reduceToPatchableFields', () => {
  it('behaelt nur die Felder des geschlossenen Patch-Schemas', () => {
    const { payload, dropped } = reduceToPatchableFields(
      { _id: 'a', userId: 'u', checkoutDate: '18:45', tenantId: 't' },
      shape(['checkoutDate', 'tenantId']),
    )
    expect(payload).toEqual({ checkoutDate: '18:45', tenantId: 't' })
    expect(dropped.sort()).toEqual(['_id', 'userId'])
  })

  it('laesst offene Schemas unveraendert — dort kann kein Zusatzfeld stoeren', () => {
    const record = { _id: 'a', irgendwas: 1 }
    expect(reduceToPatchableFields(record, shape(['_id'], false))).toEqual({ payload: record, dropped: [] })
  })

  it('reicht ohne lesbares Schema den vollen Record durch', () => {
    const record = { _id: 'a', irgendwas: 1 }
    expect(reduceToPatchableFields(record, null)).toEqual({ payload: record, dropped: [] })
  })
})

describe('normalizeForComparison', () => {
  it('behandelt SQLite-Booleans (0/1) wie echte Booleans', () => {
    // Ohne diese Normalisierung meldete die Nachkontrolle jedes Boolean-Feld
    // als „nicht angewandt", obwohl der Wert korrekt geschrieben wurde.
    expect(normalizeForComparison(true)).toBe(normalizeForComparison(1))
    expect(normalizeForComparison(false)).toBe(normalizeForComparison(0))
  })

  it('behandelt fehlendes und leeres Feld gleich', () => {
    expect(normalizeForComparison(undefined)).toBe(normalizeForComparison(null))
  })

  it('ignoriert die Schluesselreihenfolge in verschachtelten Objekten', () => {
    expect(normalizeForComparison({ a: 1, b: { c: 2, d: 3 } })).toBe(
      normalizeForComparison({ b: { d: 3, c: 2 }, a: 1 }),
    )
  })

  it('unterscheidet echte Wertaenderungen weiterhin', () => {
    expect(normalizeForComparison('17:15')).not.toBe(normalizeForComparison('18:45'))
    expect(normalizeForComparison([1, 2])).not.toBe(normalizeForComparison([2, 1]))
  })
})

describe('unappliedFields', () => {
  const cloud = { _id: 'a', checkoutDate: '18:45', checkinDate: '06:00', updatedAt: 'egal' }

  it('nennt die Felder, die der Zieldatensatz danach immer noch anders traegt', () => {
    const local = { _id: 'a', checkoutDate: '18:45', checkinDate: '07:00', updatedAt: 'anders' }
    expect(unappliedFields(cloud, local, ['createdAt', 'updatedAt'])).toEqual(['checkinDate'])
  })

  it('ist leer, wenn der Cloud-Stand vollstaendig angekommen ist', () => {
    const local = { _id: 'a', checkoutDate: '18:45', checkinDate: '06:00', updatedAt: 'anders' }
    expect(unappliedFields(cloud, local, ['createdAt', 'updatedAt'])).toEqual([])
  })

  it('wertet Cloud-only-Felder nicht als Befund', () => {
    // `_deletedAt` und Mongo-Interna gibt es lokal gar nicht — das ist eine
    // erwartete Differenz der beiden Datenmodelle, kein Fehlschlag.
    const local = { _id: 'a' }
    expect(unappliedFields({ _id: 'a', _deletedAt: null, __v: 3 }, local, [])).toEqual([])
  })
})

describe('skippedFieldsFor', () => {
  it('laesst die Server-Stempel ueberall aus', () => {
    expect(skippedFieldsFor('orders')).toEqual(['createdAt', 'updatedAt', 'updatedBy'])
  })

  it('laesst bei users zusaetzlich die geraetelokalen Time-Clock-Pointer aus', () => {
    // Sie duerfen die Edge-Cloud-Grenze nie ueberqueren (Null-Clear-Deadlock),
    // duerfen die Aufloesung deshalb aber auch nicht scheitern lassen.
    expect(skippedFieldsFor('users')).toEqual(['createdAt', 'updatedAt', 'updatedBy', ...USER_EDGE_LOCAL_FIELDS])
  })
})
