// Löst den Login-Nachweis der Cloud (ALTCHA, panary/panary-cloud#1299) im POS-Setup (core#755).
//
// Dasselbe Verfahren wie das Dashboard (panary/panary-cloud#1300): `altcha-lib` ohne Widget, die
// PBKDF2-Ableitung über WebCrypto (`algorithms/web/pbkdf2`). Kein Worker, kein Blob, kein WASM,
// also keine CSP-Ausnahme dafür. `solveChallenge` gibt alle 200 ms die Kontrolle ab, der
// Spinner läuft weiter.
//
// Die Datei wird nur per dynamischem `import()` aus der Komponente geladen: Ohne verlangten
// Nachweis kommt das Paket nie ins Hauptbundle.

import { solveChallenge, type Challenge } from 'altcha-lib'
import { deriveKey } from 'altcha-lib/algorithms/web/pbkdf2'
import type { LoginProofChallenge, LoginProofPayload } from '@panary/shared/data-access-config'

// Die Challenge gilt 5 min. Wer nach 20 s nicht fertig ist, koppelt besser per Code (Plan core#755).
export const LOGIN_PROOF_TIMEOUT_MS = 20_000

/** Wirft, wenn das Gerät die Challenge nicht löst (Zeit überschritten, kein WebCrypto). */
export const solveLoginProof = async (
  challenge: LoginProofChallenge,
  timeoutMs = LOGIN_PROOF_TIMEOUT_MS,
): Promise<LoginProofPayload> => {
  const solution = await solveChallenge({ challenge: challenge as unknown as Challenge, deriveKey, timeout: timeoutMs })
  if (!solution) throw new Error(`Login-Nachweis nach ${timeoutMs} ms nicht gelöst`)
  return { challenge, solution }
}
