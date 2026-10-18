// Der WebCrypto-Löser des POS-Setups gegen den Prüfer des Servers (node:crypto), core#755.
//
// Geprüft wird das Zusammenspiel beider Ableitungen: Löst das POS mit einer anderen
// Zähler-Kodierung oder einem anderen Hash, verwirft die Cloud jede Lösung als `invalid`, und der
// Admin-Login fiele unter Druck still aus. Kosten 1, damit die Spec in Millisekunden läuft.
// Vorlage: `login-proof-solver.spec.ts` in panary-cloud (#1300).

import { createChallenge, verifySolution } from 'altcha-lib'
import { deriveKey as deriveKeyNode } from 'altcha-lib/algorithms/pbkdf2'
import { describe, expect, it } from 'vitest'

import { solveLoginProof } from './login-proof-solver'

const SECRET = 'spec-login-proof-secret-0123456789abcdef'

// Wie die Challenge in apps/api-cloud/src/lib/login-proof.ts (panary-cloud), nur billig.
const serverChallenge = () =>
  createChallenge({
    algorithm: 'PBKDF2/SHA-256',
    cost: 1,
    deriveKey: deriveKeyNode,
    keyPrefix: '00',
    expiresAt: new Date(Date.now() + 5 * 60_000),
    data: { b: 'bindung' },
    hmacSignatureSecret: SECRET,
  })

describe('solveLoginProof (POS-Setup)', () => {
  it('liefert eine Lösung, die die Prüfung des Servers besteht', async () => {
    const challenge = await serverChallenge()

    const { solution, challenge: echoed } = await solveLoginProof(challenge)

    expect(echoed).toBe(challenge)
    const result = await verifySolution({
      challenge,
      solution: solution as Parameters<typeof verifySolution>[0]['solution'],
      deriveKey: deriveKeyNode,
      hmacSignatureSecret: SECRET,
    })
    expect(result.verified).toBe(true)
  })

  it('wirft nach Ablauf der Zeit, statt zu hängen', async () => {
    const challenge = await serverChallenge()
    // Ein Präfix, das kein Schlüssel trifft: Ohne Zeitgrenze liefe die Schleife unbegrenzt.
    const impossible = { ...challenge, parameters: { ...challenge.parameters, keyPrefix: 'ffffffff' } }

    await expect(solveLoginProof(impossible, 1)).rejects.toThrow('Login-Nachweis nach 1 ms nicht gelöst')
  })
})
