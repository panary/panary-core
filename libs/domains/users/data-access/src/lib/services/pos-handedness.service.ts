import { computed, inject, Injectable, signal } from '@angular/core'
import type { Params } from '@feathersjs/feathers'
import { ConnectionService, currentPosOperatorToken, withPosOperatorToken } from '@panary/shared/data-access'
import { PosHandedness, resolvePosHandedness } from '@panary/users/domain'

/** Gerätelokal gemerkte Wahl, die der Edge noch nicht bestätigt hat. */
export interface PendingPosHandedness {
  readonly userId: string
  readonly posHandedness: PosHandedness
  /** Bediener-Token der Sitzung, in der gewählt wurde — nur damit darf nachgesendet werden. */
  readonly operatorToken: string
}

export const POS_HANDEDNESS_PENDING_STORAGE_KEY = 'pnry_pos_handedness_pending'

/** Ergebnis einer Wahl: am Edge gespeichert oder gerätelokal gemerkt und später nachgesendet. */
export type PosHandednessOutcome = 'saved' | 'pending'

/** Ohne Bediener-Token kann der Edge die Wahl niemandem zuordnen (ADR 0053). */
export class PosHandednessNoOperatorError extends Error {
  constructor() {
    super('POS_HANDEDNESS_NO_OPERATOR')
  }
}

/**
 * Nur Verbindungsfehler werden später erneut versucht. Eine Antwort des Edge mit 4xx (Token
 * abgelaufen, Wert abgelehnt) wird auch beim zweiten Mal nicht anders — die Wahl verfällt dann.
 */
export const isTransientHandednessError = (error: unknown): boolean => {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code !== 'number' || code === 408 || code >= 500
}

const readPending = (): PendingPosHandedness[] => {
  try {
    const raw = localStorage.getItem(POS_HANDEDNESS_PENDING_STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is PendingPosHandedness =>
            typeof entry?.userId === 'string' &&
            typeof entry?.operatorToken === 'string' &&
            Object.values(PosHandedness).includes(entry?.posHandedness),
        )
      : []
  } catch {
    return []
  }
}

const writePending = (entries: readonly PendingPosHandedness[]): void => {
  try {
    if (entries.length === 0) localStorage.removeItem(POS_HANDEDNESS_PENDING_STORAGE_KEY)
    else localStorage.setItem(POS_HANDEDNESS_PENDING_STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // Ohne Speicher bleibt die Wahl bis zum Neuladen im Speicher — besser als ein Abbruch.
  }
}

/**
 * Bedienhand am POS wählen (panary/panary-core#833): sofort wirksam, am Edge über
 * `users.setPosHandedness` gespeichert, offline gerätelokal gemerkt und nachgesendet.
 *
 * Der Edge bestimmt die Person allein aus dem Bediener-Token; deshalb wird jede gemerkte Wahl
 * mit dem Token ihrer Sitzung nachgesendet, nicht mit dem des gerade Angemeldeten. Die
 * Offline-Outbox der Bestellungen trägt das nicht — sie kennt nur `orders` und `pre-orders`.
 */
@Injectable({ providedIn: 'root' })
export class PosHandednessService {
  readonly #connection = inject(ConnectionService)

  /** Gewählt in dieser Sitzung (bestätigt oder offen) — gewinnt über den geladenen User-Datensatz. */
  readonly #chosen = signal<Readonly<Record<string, PosHandedness>>>(
    Object.fromEntries(readPending().map(entry => [entry.userId, entry.posHandedness])),
  )

  /** Verbindung zum Edge. Die Shell sendet gemerkte Wahlen nach, sobald sie zurückkommt. */
  readonly online = computed(() => {
    const status = this.#connection.connectionState().status
    return status === 'connected' || status === 'authenticated'
  })

  #flushing = false

  /** Wirksame Bedienhand eines Mitarbeiters: eigene Wahl dieser Sitzung, sonst Datensatz, sonst links. */
  effective(user: { _id?: string; posHandedness?: unknown } | null | undefined): PosHandedness {
    const chosen = user?._id ? this.#chosen()[user._id] : undefined
    return chosen ?? resolvePosHandedness(user)
  }

  async choose(userId: string, posHandedness: PosHandedness): Promise<PosHandednessOutcome> {
    const operatorToken = currentPosOperatorToken()
    if (!operatorToken) throw new PosHandednessNoOperatorError()

    const previous = this.#chosen()[userId]
    this.#setChosen(userId, posHandedness)

    const pending: PendingPosHandedness = { userId, posHandedness, operatorToken }
    if (!this.online()) {
      this.#remember(pending)
      return 'pending'
    }

    try {
      await this.#send(pending)
      this.#forget(userId)
      return 'saved'
    } catch (error) {
      if (isTransientHandednessError(error)) {
        this.#remember(pending)
        return 'pending'
      }
      this.#setChosen(userId, previous)
      throw error
    }
  }

  /** Sendet gemerkte Wahlen nach. Endgültig abgelehnte verfallen, Verbindungsfehler bleiben gemerkt. */
  async flush(): Promise<void> {
    if (this.#flushing) return
    this.#flushing = true
    try {
      for (const entry of readPending()) {
        try {
          await this.#send(entry)
          this.#forget(entry.userId)
        } catch (error) {
          if (isTransientHandednessError(error)) return
          this.#forget(entry.userId)
          this.#setChosen(entry.userId, undefined)
        }
      }
    } finally {
      this.#flushing = false
    }
  }

  #send(entry: PendingPosHandedness): Promise<unknown> {
    const service = this.#connection.userService as unknown as {
      setPosHandedness: (data: unknown, params?: Params) => Promise<unknown>
    }
    // Custom-Method am rohen Service — `BaseService` hängt das Token hier nicht an (wie openAuthorized).
    return service.setPosHandedness(
      { posHandedness: entry.posHandedness },
      withPosOperatorToken({}, entry.operatorToken),
    )
  }

  #setChosen(userId: string, value: PosHandedness | undefined): void {
    this.#chosen.update(current => {
      const { [userId]: _dropped, ...rest } = current
      return value ? { ...rest, [userId]: value } : rest
    })
  }

  #remember(entry: PendingPosHandedness): void {
    writePending([...readPending().filter(other => other.userId !== entry.userId), entry])
  }

  #forget(userId: string): void {
    writePending(readPending().filter(entry => entry.userId !== userId))
  }
}
