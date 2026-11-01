/**
 * Reject-Array-Body-Hook (#1256, #1260).
 *
 * Weist einen Array-Body zentral ab, bevor ein Service-Hook ihn sieht. Rollen-
 * und Validierungs-Gates lesen `'feld' in data`; fuer ein Array ist das immer
 * `false` und das Gate wird uebersprungen. Gemessen an der echten Edge ist die
 * Folge ohne diesen Hook ein 500 (Knex: `SqliteError: no such column: 0`,
 * `[]` → „Empty .update() call"), und davor laufen schon Seiteneffekt-Hooks.
 *
 *   - `patch` / `update`: Array immer abweisen — kein Adapter kennt dort einen
 *     Array-Body (Multi-Patch heisst `id === null`, nicht Array-Daten).
 *   - `create`: Array nur dort zulaessig, wo der Service `allowsMulti('create')`
 *     erlaubt (z. B. `products`); sonst abweisen.
 *
 * Gilt auch fuer interne Aufrufe: Es gibt keinen legitimen internen Array-Patch.
 * Als App-Hook registriert er sich vor allen Service-Hooks.
 */
import type { HookContext } from '@feathersjs/feathers'
import { BadRequest } from '@feathersjs/errors'

export const rejectArrayBody = (context: HookContext): HookContext => {
  if (!Array.isArray(context.data)) return context

  if (context.method === 'create') {
    const service = context.service as { allowsMulti?: (method: string) => boolean }
    if (typeof service.allowsMulti === 'function' && service.allowsMulti('create')) return context
  } else if (context.method !== 'patch' && context.method !== 'update') {
    return context
  }

  throw new BadRequest(`Ein Array als Body ist bei '${context.method}' nicht erlaubt — erwartet wird ein Objekt.`)
}
