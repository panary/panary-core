import { describe, expect, it } from 'vitest'

import {
  EMERGENCY_OVERRIDE_AFTER_MS,
  isManualOverrideStillValid,
  isOverrideSuppressed,
  MANUAL_EMERGENCY_OVERRIDE_TTL_MS,
  shouldActivateEmergencyOverride,
  shouldAutoDeactivateEmergencyOverride,
} from './emergency-override'

const NOW = Date.parse('2026-07-28T12:00:00.000Z')
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString()

describe('shouldActivateEmergencyOverride', () => {
  it('aktiviert bei drei konsekutiven Heartbeat-Fehlern', () => {
    expect(shouldActivateEmergencyOverride({}, { failureCount: 3, elapsedMsSinceLastOk: 0 }, NOW)).toBe(true)
  })

  it('aktiviert nicht bei zwei Fehlern und frischem Heartbeat', () => {
    expect(shouldActivateEmergencyOverride({}, { failureCount: 2, elapsedMsSinceLastOk: 1000 }, NOW)).toBe(false)
  })

  // Zweiter Trigger: faengt Faelle, in denen das Scheduling pausiert war und
  // der Fehlerzaehler gar nicht erst hochlaeuft.
  it('aktiviert bei einem Fehler, wenn der letzte Erfolg zu lange her ist', () => {
    expect(
      shouldActivateEmergencyOverride({}, { failureCount: 1, elapsedMsSinceLastOk: EMERGENCY_OVERRIDE_AFTER_MS }, NOW),
    ).toBe(true)
  })

  it('aktiviert nicht erneut, wenn der Modus bereits laeuft', () => {
    expect(
      shouldActivateEmergencyOverride({ emergencyOverride: true }, { failureCount: 9, elapsedMsSinceLastOk: 0 }, NOW),
    ).toBe(false)
  })

  // Ohne diese Sperre waere der manuelle Schalter wirkungslos:
  // consecutiveHeartbeatFailures wird nur bei ERFOLG zurueckgesetzt, steht also
  // waehrend des Ausfalls weiter ueber der Schwelle.
  it('aktiviert nicht, solange die Automatik nach manueller Deaktivierung stillgelegt ist', () => {
    expect(
      shouldActivateEmergencyOverride(
        { emergencyOverrideSuppressedUntil: iso(60_000) },
        { failureCount: 9, elapsedMsSinceLastOk: EMERGENCY_OVERRIDE_AFTER_MS },
        NOW,
      ),
    ).toBe(false)
  })

  it('aktiviert wieder, sobald die Stilllegung abgelaufen ist', () => {
    expect(
      shouldActivateEmergencyOverride(
        { emergencyOverrideSuppressedUntil: iso(-1) },
        { failureCount: 3, elapsedMsSinceLastOk: 0 },
        NOW,
      ),
    ).toBe(true)
  })
})

describe('shouldAutoDeactivateEmergencyOverride', () => {
  it('deaktiviert eine Auto-Aktivierung, wenn nichts mehr offen ist', () => {
    expect(
      shouldAutoDeactivateEmergencyOverride(
        { emergencyOverride: true, emergencyOverrideSource: 'AUTO' },
        { pendingCount: 0, conflictCount: 0 },
        NOW,
      ),
    ).toBe(true)
  })

  it('deaktiviert nicht, solange Overrides ausstehen', () => {
    expect(
      shouldAutoDeactivateEmergencyOverride(
        { emergencyOverride: true, emergencyOverrideSource: 'AUTO' },
        { pendingCount: 2, conflictCount: 0 },
        NOW,
      ),
    ).toBe(false)
  })

  it('deaktiviert nicht bei offenen Konflikten', () => {
    expect(
      shouldAutoDeactivateEmergencyOverride(
        { emergencyOverride: true, emergencyOverrideSource: 'AUTO' },
        { pendingCount: 0, conflictCount: 1 },
        NOW,
      ),
    ).toBe(false)
  })

  // Der Reconcile-Fast-Path laeuft OHNE Cloud-Call, sobald null Overrides offen
  // sind — ohne diesen Schutz waere eine manuelle Aktivierung nach einem
  // einzigen Sync-Tick wieder weg.
  it('raeumt eine gueltige manuelle Aktivierung nicht weg', () => {
    expect(
      shouldAutoDeactivateEmergencyOverride(
        { emergencyOverride: true, emergencyOverrideSource: 'MANUAL', emergencyOverrideSince: iso(-60_000) },
        { pendingCount: 0, conflictCount: 0 },
        NOW,
      ),
    ).toBe(false)
  })

  it('deaktiviert eine manuelle Aktivierung nach Ablauf der TTL', () => {
    expect(
      shouldAutoDeactivateEmergencyOverride(
        {
          emergencyOverride: true,
          emergencyOverrideSource: 'MANUAL',
          emergencyOverrideSince: iso(-MANUAL_EMERGENCY_OVERRIDE_TTL_MS - 1),
        },
        { pendingCount: 0, conflictCount: 0 },
        NOW,
      ),
    ).toBe(true)
  })
})

describe('Hilfspraedikate', () => {
  it('behandelt eine manuelle Aktivierung ohne verwertbares Datum als abgelaufen', () => {
    // Ein Modus, der sich nie wieder selbst schliesst, ist das schlechtere Versagen.
    expect(isManualOverrideStillValid({ emergencyOverrideSource: 'MANUAL' }, NOW)).toBe(false)
    expect(
      isManualOverrideStillValid({ emergencyOverrideSource: 'MANUAL', emergencyOverrideSince: 'kaputt' }, NOW),
    ).toBe(false)
  })

  it('erkennt eine abgelaufene Stilllegung als nicht mehr aktiv', () => {
    expect(isOverrideSuppressed({ emergencyOverrideSuppressedUntil: iso(-1) }, NOW)).toBe(false)
    expect(isOverrideSuppressed({ emergencyOverrideSuppressedUntil: iso(1) }, NOW)).toBe(true)
    expect(isOverrideSuppressed({}, NOW)).toBe(false)
  })
})
