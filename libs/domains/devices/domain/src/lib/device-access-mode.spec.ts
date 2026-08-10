import { describe, expect, it } from 'vitest'

import {
  checkDeviceAssignmentWrite,
  DEFAULT_DEVICE_ACCESS_MODE,
  DEVICE_ACCESS_EXEMPT_ROLES,
  DeviceAccessMode,
  intersectAllowedIds,
  isDeviceAssigned,
  isTimeClockPanelEnabled,
  MAX_ASSIGNED_USER_IDS,
  resolveAssignedUserIds,
  resolveDeviceAccessMode,
  touchesDeviceAssignment,
} from './device-access-mode'

describe('resolveDeviceAccessMode', () => {
  it.each([
    ['Bestandsgeraet ohne Feld', undefined, 'shared'],
    ['Datensatz null', null, 'shared'],
    ['Feld undefined', { deviceAccessMode: undefined }, 'shared'],
    ['Feld NULL aus SQLite', { deviceAccessMode: null }, 'shared'],
    ['explizit shared', { deviceAccessMode: 'shared' }, 'shared'],
    ['explizit assigned', { deviceAccessMode: 'assigned' }, 'assigned'],
    ['unbekannter Zukunftswert', { deviceAccessMode: 'kiosk-only' }, 'shared'],
    ['Tippfehler', { deviceAccessMode: 'assigend' }, 'shared'],
    ['falscher Case', { deviceAccessMode: 'ASSIGNED' }, 'shared'],
    ['Nicht-String', { deviceAccessMode: 1 }, 'shared'],
  ])('%s → %s', (_name, device, expected) => {
    expect(resolveDeviceAccessMode(device as never)).toBe(expected)
  })

  it('Default ist shared — die Abwaertskompatibilitaets-Garantie', () => {
    expect(DEFAULT_DEVICE_ACCESS_MODE).toBe(DeviceAccessMode.SHARED)
    expect(resolveDeviceAccessMode(undefined)).toBe(DEFAULT_DEVICE_ACCESS_MODE)
  })

  it('isDeviceAssigned / isTimeClockPanelEnabled sind Gegenstuecke', () => {
    const assigned = { deviceAccessMode: 'assigned' }
    expect(isDeviceAssigned(assigned)).toBe(true)
    expect(isTimeClockPanelEnabled(assigned)).toBe(false)
    expect(isDeviceAssigned(undefined)).toBe(false)
    expect(isTimeClockPanelEnabled(undefined)).toBe(true)
  })
})

describe('resolveAssignedUserIds', () => {
  it.each([
    ['fehlender Datensatz', undefined, []],
    ['Feld fehlt', {}, []],
    ['leeres Array', { assignedUserIds: [] }, []],
    ['saubere Liste', { assignedUserIds: ['u1', 'u2'] }, ['u1', 'u2']],
    ['Duplikate', { assignedUserIds: ['u1', 'u1', 'u2'] }, ['u1', 'u2']],
    ['leere Strings', { assignedUserIds: ['u1', '', '   '] }, ['u1']],
    ['Whitespace wird getrimmt', { assignedUserIds: [' u1 '] }, ['u1']],
    ['Nicht-Strings fallen raus', { assignedUserIds: ['u1', 42, null, {}] }, ['u1']],
    ['kein Array', { assignedUserIds: 42 }, []],
    ['JSON-String aus SQLite', { assignedUserIds: '["u1","u2"]' }, ['u1', 'u2']],
    ['kaputter JSON-String', { assignedUserIds: '["u1"' }, []],
    ['JSON-String ohne Array', { assignedUserIds: '"u1"' }, []],
  ])('%s', (_name, device, expected) => {
    expect(resolveAssignedUserIds(device as never)).toEqual(expected)
  })
})

describe('intersectAllowedIds', () => {
  const allowed = ['u1', 'u2', 'u3']

  it('ohne Query-Wert → volle erlaubte Menge', () => {
    expect(intersectAllowedIds(undefined, allowed)).toEqual({ $in: allowed })
  })

  it('erlaubte Einzel-ID bleibt erhalten', () => {
    expect(intersectAllowedIds('u2', allowed)).toEqual({ $in: ['u2'] })
  })

  it('fremde Einzel-ID → leere Menge (get-by-id ist kein Umweg)', () => {
    expect(intersectAllowedIds('fremd', allowed)).toEqual({ $in: [] })
  })

  it('$in wird geschnitten, nicht erweitert', () => {
    expect(intersectAllowedIds({ $in: ['u1', 'fremd'] }, allowed)).toEqual({ $in: ['u1'] })
    expect(intersectAllowedIds({ $in: [] }, allowed)).toEqual({ $in: [] })
    expect(intersectAllowedIds({ $in: ['u1', 42, null] }, allowed)).toEqual({ $in: ['u1'] })
  })

  it('$ne/$nin werden verworfen — Ergebnis bleibt Teilmenge', () => {
    expect(intersectAllowedIds({ $ne: 'u1' }, allowed)).toEqual({ $in: allowed })
    expect(intersectAllowedIds({ $nin: ['u1'] }, allowed)).toEqual({ $in: allowed })
    expect(intersectAllowedIds({ $in: ['u1'], $ne: 'u2' }, allowed)).toEqual({ $in: ['u1'] })
  })

  it('leere erlaubte Menge erlaubt niemanden', () => {
    expect(intersectAllowedIds(undefined, [])).toEqual({ $in: [] })
    expect(intersectAllowedIds('u1', [])).toEqual({ $in: [] })
    expect(intersectAllowedIds({ $in: ['u1'] }, [])).toEqual({ $in: [] })
  })

  it('das Ergebnis ist unter allen Eingaben Teilmenge der erlaubten IDs', () => {
    const inputs: unknown[] = [undefined, null, 'u1', 'fremd', 42, [], {}, { $in: ['u1', 'fremd'] }, { $ne: 'u1' }]
    for (const input of inputs) {
      const result = intersectAllowedIds(input, allowed)
      expect(
        result.$in.every(id => allowed.includes(id)),
        JSON.stringify(input),
      ).toBe(true)
    }
  })
})

describe('touchesDeviceAssignment', () => {
  it.each([
    [{ uiScale: { density: 'large' } }, false],
    [{}, false],
    [undefined, false],
    ['nicht-objekt', false],
    [{ deviceAccessMode: 'shared' }, true],
    [{ assignedUserIds: [] }, true],
    [{ deviceAccessMode: undefined }, true],
  ])('%o → %s', (data, expected) => {
    expect(touchesDeviceAssignment(data)).toBe(expected)
  })
})

describe('checkDeviceAssignmentWrite', () => {
  const admin = { role: 'tenant:owner' }

  it('Body ohne Zuweisungs-Felder → immer erlaubt (auch fuer POS-Geraet)', () => {
    expect(checkDeviceAssignmentWrite({ role: 'device:pos-client' }, { uiScale: { density: 'large' } })).toBeNull()
  })

  it('nicht-exempte Rolle → FORBIDDEN_ROLE', () => {
    for (const role of ['device:pos-client', 'tenant:staff', undefined]) {
      expect(checkDeviceAssignmentWrite({ role }, { deviceAccessMode: 'shared' })?.reason, String(role)).toBe(
        'FORBIDDEN_ROLE',
      )
    }
    expect(checkDeviceAssignmentWrite(undefined, { deviceAccessMode: 'shared' })?.reason).toBe('FORBIDDEN_ROLE')
  })

  it('jede exempte Rolle darf schreiben', () => {
    for (const role of DEVICE_ACCESS_EXEMPT_ROLES) {
      expect(checkDeviceAssignmentWrite({ role }, { deviceAccessMode: 'shared' }), role).toBeNull()
    }
  })

  it('interner Aufruf umgeht das Rollen-Gate (Pairing-Redeem)', () => {
    expect(
      checkDeviceAssignmentWrite({ internal: true }, { deviceAccessMode: 'assigned', assignedUserIds: ['u1'] }),
    ).toBeNull()
  })

  it.each([
    ['unbekannter Modus', { deviceAccessMode: 'kiosk-only' }, 'INVALID_MODE'],
    ['null als Modus', { deviceAccessMode: null }, 'INVALID_MODE'],
    ['Modus als Zahl', { deviceAccessMode: 1 }, 'INVALID_MODE'],
    ['IDs kein Array', { assignedUserIds: 'u1' }, 'INVALID_IDS'],
    ['IDs mit Nicht-String', { assignedUserIds: ['u1', 42] }, 'INVALID_IDS'],
    ['IDs mit Leerstring', { assignedUserIds: ['u1', '  '] }, 'INVALID_IDS'],
    ['doppelte IDs', { assignedUserIds: ['u1', 'u1'] }, 'DUPLICATE_IDS'],
  ])('%s → %s', (_name, data, reason) => {
    expect(checkDeviceAssignmentWrite(admin, data)?.reason).toBe(reason)
  })

  it(`mehr als ${MAX_ASSIGNED_USER_IDS} Mitarbeiter → TOO_MANY_IDS`, () => {
    const ids = Array.from({ length: MAX_ASSIGNED_USER_IDS + 1 }, (_, i) => `u${i}`)
    expect(checkDeviceAssignmentWrite(admin, { assignedUserIds: ids })?.reason).toBe('TOO_MANY_IDS')
    expect(checkDeviceAssignmentWrite(admin, { assignedUserIds: ids.slice(0, -1) })).toBeNull()
  })

  it('assigned ohne Mitarbeiter → EMPTY_ASSIGNMENT statt stillem Downgrade', () => {
    expect(checkDeviceAssignmentWrite(admin, { deviceAccessMode: 'assigned' })?.reason).toBe('EMPTY_ASSIGNMENT')
    expect(checkDeviceAssignmentWrite(admin, { deviceAccessMode: 'assigned', assignedUserIds: [] })?.reason).toBe(
      'EMPTY_ASSIGNMENT',
    )
  })

  it('Teil-Patch wird gegen den Bestand geprueft — der subtilste Fall', () => {
    const assignedDevice = { deviceAccessMode: 'assigned', assignedUserIds: ['u1'] }

    // Nur die Liste leeren, Modus bleibt `assigned` → wuerde das Terminal
    // dauerhaft aussperren.
    expect(checkDeviceAssignmentWrite(admin, { assignedUserIds: [] }, assignedDevice)?.reason).toBe('EMPTY_ASSIGNMENT')

    // Nur den Modus setzen, Bestandsliste traegt den Wert → erlaubt.
    expect(checkDeviceAssignmentWrite(admin, { deviceAccessMode: 'assigned' }, { assignedUserIds: ['u1'] })).toBeNull()

    // Gleichzeitig auf shared drehen und leeren → erlaubt.
    expect(
      checkDeviceAssignmentWrite(admin, { deviceAccessMode: 'shared', assignedUserIds: [] }, assignedDevice),
    ).toBeNull()
  })

  it('shared mit stehengebliebener Liste ist erlaubt (Hin- und Herschalten)', () => {
    expect(checkDeviceAssignmentWrite(admin, { deviceAccessMode: 'shared' }, { assignedUserIds: ['u1'] })).toBeNull()
  })

  it('gueltige Neu-Zuweisung → erlaubt', () => {
    expect(
      checkDeviceAssignmentWrite(admin, { deviceAccessMode: 'assigned', assignedUserIds: ['u1', 'u2'] }),
    ).toBeNull()
  })
})

describe('Invarianten (Regressionsanker)', () => {
  it('DEVICE_ACCESS_EXEMPT_ROLES ist exakt der Freigabe-Kreis', () => {
    expect([...DEVICE_ACCESS_EXEMPT_ROLES].sort()).toEqual([
      'platform:admin',
      'platform:owner',
      'platform:support',
      'tenant:manager',
      'tenant:owner',
      'tenant:technician',
    ])
  })

  it('keine Geraete-Rolle ist exempt — sonst waere die Zuweisung wirkungslos', () => {
    for (const role of DEVICE_ACCESS_EXEMPT_ROLES) {
      expect(role.startsWith('device:'), role).toBe(false)
    }
  })

  it('MAX_ASSIGNED_USER_IDS deckt das mobile Szenario ab, ohne shared zu ersetzen', () => {
    expect(MAX_ASSIGNED_USER_IDS).toBe(5)
  })
})
