import { describe, expect, it } from 'vitest'

import {
  assertFeathersSecret,
  CONFIG_ENV_ALLOWLIST,
  CONFIG_ENV_DENYLIST,
  FEATHERS_SECRET_MIN_LENGTH,
  FEATHERS_SECRET_PLACEHOLDER,
  filterConfigEnv,
} from './boot-guards'

const VALID_SECRET = 'x'.repeat(FEATHERS_SECRET_MIN_LENGTH)

describe('filterConfigEnv', () => {
  it('uebertraegt erlaubte Schluessel als String', () => {
    const result = filterConfigEnv({ PORT: 3030, SYSTEM_MODE: 'cloud', TZ: 'Europe/Berlin' })

    expect(result.applied).toEqual({ PORT: '3030', SYSTEM_MODE: 'cloud', TZ: 'Europe/Berlin' })
    expect(result.rejected).toEqual([])
    expect(result.denied).toEqual([])
  })

  // Der eigentliche Hebel von #323: Der Setup-Endpunkt schreibt diese Datei,
  // und bis hierher konnte er damit den JWT-Schluessel bestimmen.
  it('verwirft FEATHERS_SECRET aus der Config-Datei', () => {
    const result = filterConfigEnv({ FEATHERS_SECRET: 'vom-angreifer-gewaehlt' })

    expect(result.applied).toEqual({})
    expect(result.denied).toContain('FEATHERS_SECRET')
  })

  it.each(CONFIG_ENV_DENYLIST)('verwirft den Denylisten-Schluessel %s', key => {
    const result = filterConfigEnv({ [key]: 'egal' })

    expect(result.applied).toEqual({})
    expect(result.denied).toEqual([key])
  })

  it('meldet unbekannte Schluessel als verworfen', () => {
    const result = filterConfigEnv({ EVIL_KEY: 'boom' })

    expect(result.applied).toEqual({})
    expect(result.rejected).toEqual(['EVIL_KEY'])
    expect(result.denied).toEqual([])
  })

  // Eine Warnung, die bei jedem normalen Boot feuert, wird ueberlesen.
  it('uebergeht die Setup-Payload-Felder still', () => {
    const result = filterConfigEnv({
      shopName: 'Baeckerei Meier',
      locationName: 'Hauptstandort',
      businessType: 'CAFE_BAKERY',
      adminEmail: 'chef@example.com',
      adminPassword: 'geheim',
      mode: 'standalone',
    })

    expect(result.applied).toEqual({})
    expect(result.rejected).toEqual([])
    expect(result.denied).toEqual([])
  })

  it('ignoriert verschachtelte Objekte und Arrays', () => {
    const result = filterConfigEnv({ nested: { a: 1 }, list: [1, 2], PORT: 3030 })

    expect(result.applied).toEqual({ PORT: '3030' })
    expect(result.rejected).toEqual([])
  })

  // Die Denyliste dokumentiert die Absicht; ueberschnitte sie sich mit der
  // Allowlist, entschiede die Reihenfolge im Code statt der Absicht.
  it('haelt Allow- und Denyliste ueberschneidungsfrei', () => {
    const overlap = CONFIG_ENV_ALLOWLIST.filter(key => CONFIG_ENV_DENYLIST.includes(key))

    expect(overlap).toEqual([])
  })
})

describe('assertFeathersSecret', () => {
  it('laesst ein ausreichend langes Secret durch', () => {
    expect(() => assertFeathersSecret(VALID_SECRET)).not.toThrow()
  })

  it.each([undefined, null, '', '   ', 42])('wirft, wenn das Secret fehlt (%s)', value => {
    expect(() => assertFeathersSecret(value)).toThrow(/nicht gesetzt/)
  })

  it('wirft beim Platzhalter aus dem oeffentlichen Repo', () => {
    expect(() => assertFeathersSecret(FEATHERS_SECRET_PLACEHOLDER)).toThrow(/Platzhalter/)
  })

  it('wirft bei zu kurzem Secret', () => {
    expect(() => assertFeathersSecret('x'.repeat(FEATHERS_SECRET_MIN_LENGTH - 1))).toThrow(/zu kurz/)
  })

  // Die Meldung landet im Container-Log eines Geraets, vor dem niemand sitzt.
  it('nennt in jeder Fehlermeldung den Behebungsweg', () => {
    for (const value of [undefined, FEATHERS_SECRET_PLACEHOLDER, 'kurz']) {
      expect(() => assertFeathersSecret(value)).toThrow(/openssl rand -base64 32/)
    }
  })

  it('akzeptiert ein Secret mit umgebenden Leerzeichen anhand seines getrimmten Werts', () => {
    expect(() => assertFeathersSecret(`  ${VALID_SECRET}  `)).not.toThrow()
    expect(() => assertFeathersSecret(`  ${FEATHERS_SECRET_PLACEHOLDER}  `)).toThrow(/Platzhalter/)
  })
})
