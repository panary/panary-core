import { CacheEntity } from './cache-storage.port'

export type OutboxOp = 'create' | 'patch'
export type OutboxStatus = 'pending' | 'in-flight' | 'acked' | 'rejected'

/**
 * Schlanker Client-Outbox-Eintrag (Connect-Tier). Spiegelt das `sync-outbox-entry`-Muster
 * aus `@panary/sync/domain`, ohne dessen (Edge-spezifisch reicheres) Domain-Schema zu koppeln.
 */
export interface OutboxEntry extends CacheEntity {
  readonly _id: string
  readonly service: string
  readonly op: OutboxOp
  readonly entityId: string
  readonly payload: unknown
  readonly occurredAt: string
  readonly status: OutboxStatus
  readonly attempts: number
  readonly nextAttemptAt?: string
  readonly lastError?: string
}

/** Backoff-Plan (ms) je Versuch — 30 s, 1 m, 5 m, 30 m, 2 h, danach 6 h (gedeckelt). */
export const OUTBOX_BACKOFF_MS: readonly number[] = [30_000, 60_000, 300_000, 1_800_000, 7_200_000, 21_600_000]

/** Maximale Versuche, bevor ein Eintrag terminal `rejected` wird. */
export const OUTBOX_MAX_ATTEMPTS = 10

/** Backoff-Verzögerung (ms) für den nächsten Versuch; deckelt am letzten Plan-Wert. */
export function outboxBackoffMs(attempts: number): number {
  if (attempts <= 0) return 0
  const index = Math.min(attempts - 1, OUTBOX_BACKOFF_MS.length - 1)
  return OUTBOX_BACKOFF_MS[index]
}
