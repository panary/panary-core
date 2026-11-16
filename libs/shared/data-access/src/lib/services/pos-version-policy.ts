import { compareVersions, monthsBehind } from '@panary/shared-common'

/**
 * Versionspolitik des POS (ADR 0070, core#1441): Der POS wird nie im laufenden Betrieb gesperrt. Während der
 * Schicht gibt es nur einen Warnhinweis, Login und Start der Kassensitzung verweigert allein die von Hand
 * gesetzte Mindestversion.
 *
 * Jede Seite, die keine `YY.MM.INDEX`-Version ist (`staging-<sha>`, `0.0.0`, fehlender Wert, alter Edge ohne
 * Feld), heißt „nicht prüfbar" und löst weder Warnung noch Sperre aus.
 */

/** Ab so vielen Monatsständen Rückstand hinter dem Edge erscheint der Warnhinweis (`M-1` oder älter). */
export const POS_VERSION_WARN_MONTHS = 1

export interface PosVersionInput {
  /** Version dieses POS-Builds (`APP_CONFIG.appVersion`). */
  posVersion: string | null | undefined
  /** Version des Edge-Servers aus `/health`. */
  edgeVersion: string | null | undefined
  /** Von Hand gesetzte Mindestversion für den POS aus `/health`. */
  requiredPosMinVersion: string | null | undefined
}

export interface PosVersionVerdict {
  /** Der POS liegt unter der Mindestversion. Nur das darf Login und Start der Kassensitzung verweigern. */
  belowMinimum: boolean
  /** Der POS liegt mindestens einen Monatsstand hinter dem Edge. Nur Hinweis, nie Sperre. */
  behindEdge: boolean
  /** Rückstand in Monatsständen, `null` wenn nicht prüfbar. */
  monthsBehindEdge: number | null
}

export function evaluatePosVersion(input: PosVersionInput): PosVersionVerdict {
  const behind = monthsBehind(input.edgeVersion, input.posVersion)
  return {
    // Die Mindestversion ist ein exakter Stand: Verglichen wird mit Index, nicht nur der Monat.
    belowMinimum: compareVersions(input.posVersion, input.requiredPosMinVersion) === -1,
    behindEdge: behind !== null && behind >= POS_VERSION_WARN_MONTHS,
    monthsBehindEdge: behind,
  }
}

/**
 * Darf der Login oder der Start einer Kassensitzung wegen der Version verweigert werden?
 *
 * Nur ohne offene Kassensitzung: Wer mitten in der Schicht (etwa nach dem Inaktivitäts-Logout) wieder
 * einsteigt, wird nicht ausgesperrt. Der laufende Verkauf selbst fragt diese Funktion nie.
 */
export function versionBlocksStart(verdict: PosVersionVerdict, hasOpenCashSession: boolean): boolean {
  return verdict.belowMinimum && !hasOpenCashSession
}

/**
 * Liest Edge-Version und Mindestversion aus der `/health`-Antwort. Alles außer einem nichtleeren Text ist `null`
 * („nicht bekannt"): Ein fehlendes Feld lässt den alten Wert nicht stehen, sonst gälte eine in der Cloud
 * zurückgenommene Mindestversion am POS weiter.
 */
export function parseHealthVersions(data: unknown): {
  edgeVersion: string | null
  requiredPosMinVersion: string | null
} {
  const source = (data ?? {}) as { version?: unknown; requiredPosMinVersion?: unknown }
  const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)
  return { edgeVersion: text(source.version), requiredPosMinVersion: text(source.requiredPosMinVersion) }
}
