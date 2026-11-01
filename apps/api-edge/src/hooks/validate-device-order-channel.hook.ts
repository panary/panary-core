// Before-Hook fuer `devices.create` und `devices.patch`: Rollen-Gate fuer die
// Standard-Bestellart (panary/panary-core#1166).
//
// Duenner Feathers-Adapter um `checkDeviceOrderChannelWrite` (@panary/devices/domain,
// Single Source of Truth). Registriert VOR `validateData`: Ein Verstoss soll mit seiner
// eigenen Meldung scheitern und nicht mit einer generischen Schema-Meldung. Der Techniker
// hat `devices: MANAGE`, nur dieses Feld ist fuer ihn gesperrt.
import { BadRequest, Forbidden } from '@feathersjs/errors'

import { checkDeviceOrderChannelWrite, touchesDeviceOrderChannel } from '@panary/devices/domain'

import type { HookContext } from '../declarations'

export const validateDeviceOrderChannel = async (context: HookContext): Promise<HookContext> => {
  if (!touchesDeviceOrderChannel(context.data)) return context

  const actor = context.params.user as { role?: string } | undefined
  const violation = checkDeviceOrderChannelWrite(
    { role: actor?.role, internal: !context.params.provider },
    context.data,
  )
  if (violation) {
    throw violation.reason === 'FORBIDDEN_ROLE' ? new Forbidden(violation.message) : new BadRequest(violation.message)
  }
  return context
}
