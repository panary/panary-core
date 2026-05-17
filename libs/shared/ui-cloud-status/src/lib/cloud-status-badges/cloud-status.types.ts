export type CloudStatusLevel = 'ok' | 'warn' | 'crit'

export interface SyncStaleness {
  /** Sekunden seit letztem erfolgreichen Sync, `null` wenn noch nie gesynct. */
  ageSec: number | null
  level: CloudStatusLevel
}

export interface TokenExpiry {
  /** Sekunden bis Token-Ablauf (negativ wenn schon abgelaufen), `null` wenn kein Datum bekannt. */
  remainingSec: number | null
  level: CloudStatusLevel
}
