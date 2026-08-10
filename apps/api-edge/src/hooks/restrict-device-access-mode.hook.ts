// Before-Hook fuer `users.verifyPin` und `users.changePin`: Auf einem
// zugewiesenen Geraet (PNRY-FEAT-DEVICE-ASSIGNMENT-001) darf nur der erlaubte
// Personenkreis seinen PIN eingeben.
//
// Warum ueberhaupt, wenn `users.find` schon gescoped ist: Das Scoping bestimmt,
// was der Login-Screen anzeigt. `verifyPin` braucht aber nur eine `userId` und
// ist ueber den Geraete-Socket direkt erreichbar — ohne diesen Hook koennte ein
// manipulierter Client an einem Diensthandy die PIN jedes Mitarbeiters
// durchprobieren.
//
// Laeuft als before-Hook und damit VOR dem bcrypt-Vergleich in der Methode.
// Das ist Absicht: eine Ablehnung nach dem Vergleich waere ueber die Antwortzeit
// unterscheidbar.
import { NotAuthenticated } from '@feathersjs/errors'

import { recordPinFailure } from '@panary/shared-backend'

import { getDeviceAccessScope } from './device-access-mode.util'

import type { HookContext } from '../declarations'

/**
 * Bewusst wortgleich mit der Ablehnung eines falschen PINs in der jeweiligen
 * Methode (users.ts). Ein eigener Text („Nicht fuer dieses Geraet freigegeben")
 * waere ein Oracle: Wer am Terminal steht, koennte damit die Zuweisung jedes
 * Geraets abfragen, ohne einen einzigen PIN zu kennen.
 */
const DENIAL_MESSAGE: Record<string, string> = {
  verifyPin: 'PIN ungueltig',
  changePin: 'Aktuelle PIN ist falsch',
}

export const restrictDeviceAccessMode = async (context: HookContext): Promise<HookContext> => {
  if (!context.params.provider) return context

  // Aufgeloest im before.all-Hook (resolveDeviceAccessScope), der auch fuer
  // Custom-Methods laeuft — im Integrationstest nachgewiesen.
  const allowedIds = getDeviceAccessScope(context)
  if (allowedIds === null) return context

  const targetUserId = (context.data as { userId?: unknown } | undefined)?.userId
  // Fehlender Parameter ist kein Zuweisungs-Verstoss — die Methode meldet ihn
  // selbst mit der passenden Begruendung.
  if (typeof targetUserId !== 'string' || !targetUserId) return context

  if (allowedIds.includes(targetUserId)) return context

  // Den Fehlversuch mitzaehlen ist Teil der Tarnung, nicht nur Rate-Limiting:
  // Bliebe der Zaehler stehen, waere „zehn Versuche ohne Sperre" genau die
  // Unterscheidung, die die identische Meldung oben verhindern soll.
  recordPinFailure(targetUserId)
  throw new NotAuthenticated(DENIAL_MESSAGE[context.method] ?? DENIAL_MESSAGE['verifyPin'])
}
