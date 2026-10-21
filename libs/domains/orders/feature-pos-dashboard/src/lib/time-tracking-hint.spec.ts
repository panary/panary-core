import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { timeTrackingBlockedHintKey } from './time-tracking-hint'

// core#797: Stempel- und Pausen-Einträge waren bei Kontosperre deaktiviert, nannten den Grund aber
// nicht — der Tooltip kannte nur „offline". Die Schnellaktionen nennen die Sperre seit core#489.
describe('timeTrackingBlockedHintKey (core#797)', () => {
  it('nennt die Kontosperre, auch wenn das Gerät zugleich offline ist', () => {
    expect(timeTrackingBlockedHintKey(true, false)).toEqual('CLOUD_STATUS.TENANT_SUSPENDED')
    expect(timeTrackingBlockedHintKey(true, true)).toEqual('CLOUD_STATUS.TENANT_SUSPENDED')
  })

  it('nennt offline, wenn nur die Verbindung fehlt', () => {
    expect(timeTrackingBlockedHintKey(false, true)).toEqual('DASHBOARD.TIME_TRACKING_OFFLINE_BLOCKED')
  })

  it('gibt keinen Hinweis, wenn nichts sperrt', () => {
    expect(timeTrackingBlockedHintKey(false, false)).toBeNull()
  })
})

describe('Dashboard-Template — Stempel-/Pausen-Einträge (core#797)', () => {
  const template = readFileSync(fileURLToPath(new URL('./dashboard.component.html', import.meta.url)), 'utf8')

  it('jeder wegen der Sperre deaktivierte Eintrag trägt den gemeinsamen Hinweis', () => {
    const disabled = template.match(/\[disabled\]="isOffline\(\) \|\| bookingSuspended\(\)"/g) ?? []
    const titled =
      template.match(
        /\[disabled\]="isOffline\(\) \|\| bookingSuspended\(\)"\s*\[title\]="timeTrackingBlockedKey\(\) \| translate"/g,
      ) ?? []
    expect(disabled.length).toEqual(5)
    expect(titled.length).toEqual(disabled.length)
  })
})
