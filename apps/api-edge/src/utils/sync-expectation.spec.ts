import { describe, expect, it } from 'vitest'

import { SyncMode } from '@panary/cloud-connection/domain'

import { computeSyncExpectation } from './sync-expectation'

// Fester Bezugspunkt: 2026-08-04 14:00:00 Europe/Berlin (= 12:00 UTC, CEST).
const NOW = new Date('2026-08-04T12:00:00.000Z')

describe('computeSyncExpectation', () => {
  it('liefert ohne Connection keine Erwartung', () => {
    expect(computeSyncExpectation(null, NOW)).toEqual({ mode: SyncMode.AUTO, nextExpectedSyncAt: null })
  })

  it('erwartet in MANUAL und DISABLED gar keinen automatischen Abgleich', () => {
    // Kernaussage des Fixes: hier darf nie ein „Sync veraltet"-Banner entstehen,
    // egal wie alt `lastSyncAt` ist — der Zustand ist gewollt.
    for (const mode of [SyncMode.MANUAL, SyncMode.DISABLED]) {
      const result = computeSyncExpectation({ syncMode: mode, lastSyncAt: '2026-07-01T00:00:00.000Z' }, NOW)
      expect(result).toEqual({ mode, nextExpectedSyncAt: null })
    }
  })

  it('rechnet in AUTO mit dem konfigurierten Intervall ab dem letzten Abgleich', () => {
    const result = computeSyncExpectation(
      { syncMode: SyncMode.AUTO, syncIntervalSec: 3600, lastSyncAt: '2026-08-04T11:30:00.000Z' },
      NOW,
    )
    // 11:30 + 60 min = 12:30 — also 30 Minuten in der Zukunft. Mit den alten
    // Fixschwellen (warn ab 5 min) haette dieser Edge dauerhaft gewarnt.
    expect(result).toEqual({ mode: SyncMode.AUTO, nextExpectedSyncAt: '2026-08-04T12:30:00.000Z' })
  })

  it('faellt in AUTO auf das Default-Intervall zurueck', () => {
    const result = computeSyncExpectation({ syncMode: SyncMode.AUTO, lastSyncAt: '2026-08-04T11:58:00.000Z' }, NOW)
    expect(result.nextExpectedSyncAt).toBe('2026-08-04T12:03:00.000Z')
  })

  it('rechnet in AUTO ohne bekannten letzten Abgleich ab jetzt', () => {
    // Frisch gepairter Edge: darf nicht sofort als ueberfaellig gelten.
    const result = computeSyncExpectation({ syncMode: SyncMode.AUTO, syncIntervalSec: 60 }, NOW)
    expect(result.nextExpectedSyncAt).toBe('2026-08-04T12:01:00.000Z')
  })

  it('behandelt unbekannte Modi wie AUTO — identisch zum Scheduler-default-Zweig', () => {
    const result = computeSyncExpectation({ syncMode: 'turbo', lastSyncAt: '2026-08-04T11:58:00.000Z' }, NOW)
    expect(result.mode).toBe(SyncMode.AUTO)
    expect(result.nextExpectedSyncAt).toBe('2026-08-04T12:03:00.000Z')
  })

  it('erwartet in SCHEDULED den naechsten Slot, nicht das Alter des letzten Syncs', () => {
    const result = computeSyncExpectation(
      {
        syncMode: SyncMode.SCHEDULED,
        syncSchedule: { times: ['22:00'], timezone: 'Europe/Berlin' },
        // Der 22:00-Slot von gestern ist abgearbeitet.
        lastScheduledSyncAt: '2026-08-03T20:00:00.000Z',
        lastSyncAt: '2026-08-03T20:00:12.000Z',
      },
      NOW,
    )
    // Naechster Slot: heute 22:00 Berlin = 20:00 UTC.
    expect(result.mode).toBe(SyncMode.SCHEDULED)
    expect(result.nextExpectedSyncAt).toBe('2026-08-04T20:00:00.000Z')
  })

  it('meldet einen faelligen, aber nicht gelaufenen Slot als sofort erwartet', () => {
    const result = computeSyncExpectation(
      {
        syncMode: SyncMode.SCHEDULED,
        syncSchedule: { times: ['09:00'], timezone: 'Europe/Berlin' },
        // 09:00 Berlin (07:00 UTC) ist erreicht, aber nie abgearbeitet worden.
        lastScheduledSyncAt: null,
      },
      NOW,
    )
    expect(result.nextExpectedSyncAt).toBe(NOW.toISOString())
  })

  it('faellt bei unbrauchbarem Zeitplan auf AUTO-Verhalten zurueck — wie der Worker', () => {
    // Ohne Uhrzeit liefert computeScheduledSlot null; der Scheduler fuehrt dann
    // einen AUTO-Cycle aus. Die Erwartung muss dieselbe Auslegung treffen,
    // sonst behauptet die UI „planmaessig", waehrend der Edge minuetlich syncen
    // sollte.
    const result = computeSyncExpectation(
      {
        syncMode: SyncMode.SCHEDULED,
        syncSchedule: { times: [], timezone: 'Europe/Berlin' },
        syncIntervalSec: 300,
        lastSyncAt: '2026-08-04T11:58:00.000Z',
      },
      NOW,
    )
    expect(result.mode).toBe(SyncMode.SCHEDULED)
    expect(result.nextExpectedSyncAt).toBe('2026-08-04T12:03:00.000Z')
  })
})
