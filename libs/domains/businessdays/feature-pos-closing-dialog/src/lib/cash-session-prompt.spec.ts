import { of } from 'rxjs'
import { describe, expect, it, vi } from 'vitest'
import type { MatDialog } from '@angular/material/dialog'

// Der Dialog selbst (Material, Template) gehört nicht zu dieser Spec: Geprüft wird, was der Helfer ihm übergibt
// und wie er die Antwort deutet. Der Mock hält die Aufrufe je Test (testing.md §10).
const opened: Array<Record<string, unknown>> = []
let answer: unknown = null
vi.mock('./manager-authorize-cash-session-dialog.component', () => ({
  openManagerAuthorizeCashSessionDialog: (_dialog: unknown, data: Record<string, unknown>) => {
    opened.push(data)
    return { afterClosed: () => of(answer) }
  },
}))

import { promptCashSessionAuthorization } from './cash-session-prompt'

const dialog = {} as MatDialog
const location = {
  currentBusinessDay: { businessDayId: 'bd-1' },
  settings: { cashSessionSettings: { defaultOpeningFloatCents: 15000 } },
}
const users = [{ _id: 'u-1', firstName: 'Anna', lastName: 'Alt' }]

describe('promptCashSessionAuthorization', () => {
  it('fragt ohne Geschäftstag gar nicht erst und liefert false', async () => {
    opened.length = 0
    answer = { _id: 'cs-1' }

    await expect(promptCashSessionAuthorization(dialog, { currentBusinessDay: {} }, users, 'u-1')).resolves.toBe(false)
    await expect(promptCashSessionAuthorization(dialog, undefined, users, 'u-1')).resolves.toBe(false)

    expect(opened).toEqual([])
  })

  it('übergibt Geschäftstag, Kassierer, Namen und Wechselgeld-Vorgabe', async () => {
    opened.length = 0
    answer = { _id: 'cs-1' }

    await promptCashSessionAuthorization(dialog, location, users, 'u-1')

    expect(opened).toEqual([
      { businessDayId: 'bd-1', cashierId: 'u-1', cashierName: 'Anna Alt', defaultOpeningFloatCents: 15000 },
    ])
  })

  it('lässt den Namen weg, wenn der Kassierer nicht in der Liste steht', async () => {
    opened.length = 0
    answer = { _id: 'cs-1' }

    await promptCashSessionAuthorization(dialog, location, users, 'u-unbekannt')

    expect(opened[0]['cashierName']).toBeUndefined()
  })

  it('liefert true bei eröffneter Kasse und false bei Abbruch', async () => {
    opened.length = 0
    answer = { _id: 'cs-1' }
    await expect(promptCashSessionAuthorization(dialog, location, users, 'u-1')).resolves.toBe(true)

    answer = null
    await expect(promptCashSessionAuthorization(dialog, location, users, 'u-1')).resolves.toBe(false)
  })
})
