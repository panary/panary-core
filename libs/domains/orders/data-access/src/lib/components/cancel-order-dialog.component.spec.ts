// JIT-Compiler zuerst laden: @angular/material ist partial-compiled; ohne Linker
// (kein analogjs-Plugin in dieser node-Vitest-Config) faellt Angular auf JIT zurueck.
import '@angular/compiler'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Injector, runInInjectionContext, signal } from '@angular/core'
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog'
import { MatSnackBar } from '@angular/material/snack-bar'
import { TranslateService } from '@ngx-translate/core'
import { ConnectionService } from '@panary/shared/data-access'
import { UserService } from '@panary/users/data-access'
import { OrderStatus, type Order } from '@panary/orders/domain'
import { OrderService } from '../services/order.service'
import { OrderInteractionService } from '../services/order-interaction.service'
import { CancelOrderDialogComponent } from './cancel-order-dialog.component'

// Geprueft wird das Journal-Ereignis zum Storno (panary/panary-core#591): Am Edge ist
// `params.user` der Geraete-User, deshalb schreibt der Dialog den `order-cancel` selbst.
// Echte Instanz ohne TestBed, alle inject()-Tokens als Mocks — je Test angelegt
// (testing.md §10).

const MANAGER_ID = '019dfd04-0000-7000-8000-00000000aaaa'
const STAFF_ID = '019dfd04-0000-7000-8000-00000000bbbb'

function makeOrder(): Order {
  return {
    _id: 'order-1',
    tenantId: 't-1',
    locationId: 'loc-1',
    businessDayId: 'bd-1',
    status: OrderStatus.ACTIVE,
    recordingDate: '2026-10-04T10:00:00.000Z',
    createdAt: '2026-10-04T10:00:00.000Z',
    lineItems: [{ amount: 2 }, { amount: 3 }],
  } as unknown as Order
}

function setup(opts: {
  currentUser?: { _id: string; role: string }
  /** Antwort von `users.find` — die freigabeberechtigten Nutzer laut Server. */
  authorizingUsers?: () => Promise<unknown>
  patch?: () => Promise<unknown>
  createInteraction?: () => Promise<unknown>
  verifyPin?: () => Promise<unknown>
}) {
  const patch = vi.fn(opts.patch ?? (async () => ({})))
  const createInteraction = vi.fn<(data: Record<string, unknown>) => Promise<unknown>>(
    opts.createInteraction ?? (async () => ({})),
  )
  const verifyPin = vi.fn(opts.verifyPin ?? (async () => ({ _id: MANAGER_ID, role: 'tenant:manager' })))
  const close = vi.fn()

  const injector = Injector.create({
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: makeOrder() },
      { provide: MatDialogRef, useValue: { close } },
      { provide: OrderService, useValue: { patch } },
      { provide: OrderInteractionService, useValue: { create: createInteraction } },
      { provide: UserService, useValue: { currentUser: signal(opts.currentUser) } },
      {
        provide: ConnectionService,
        useValue: { usersService: { find: opts.authorizingUsers ?? (async () => []), verifyPin } },
      },
      { provide: MatSnackBar, useValue: { open: vi.fn() } },
      { provide: TranslateService, useValue: { instant: (key: string) => key } },
    ],
  })
  const dialog = runInInjectionContext(injector, () => new CancelOrderDialogComponent())
  return { dialog, patch, createInteraction, verifyPin, close }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** Am POS: Geraete-Auth, `currentUser()` leer, der PIN-Login steht nur in `pos_current_user` — ohne `role`. */
function stubPosCurrentUser(user: Record<string, unknown> | null) {
  const store = new Map<string, string>()
  if (user) store.set('pos_current_user', JSON.stringify(user))
  vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null })
}

const OWNER = {
  _id: MANAGER_ID,
  firstName: 'Vilma',
  lastName: 'Koetter',
  role: 'tenant:owner',
  status: 'ACTIVE',
  hasPosPin: true,
}

describe('CancelOrderDialogComponent — Journal-Ereignis zum Storno (#591)', () => {
  it('Manager storniert selbst: order-cancel mit seiner ID und den Zaehlern der Bestellung', async () => {
    const { dialog, patch, createInteraction, close } = setup({
      currentUser: { _id: MANAGER_ID, role: 'tenant:manager' },
    })

    dialog.selectReason('CANCEL_ORDER.REASON_COMPLAINT')
    await flush()

    expect(patch).toHaveBeenCalledTimes(1)
    expect(createInteraction).toHaveBeenCalledTimes(1)
    expect(createInteraction.mock.calls[0][0]).toMatchObject({
      type: 'order-cancel',
      orderId: 'order-1',
      userId: MANAGER_ID,
      businessDayId: 'bd-1',
      orderOpenedAt: '2026-10-04T10:00:00.000Z',
      hadLineItems: true,
      lineItemCountAtCancel: 2,
      totalQuantityAtCancel: 5,
    })
    expect(close).toHaveBeenCalledWith(expect.objectContaining({ success: true }))
  })

  it('Bediener mit Manager-PIN: userId ist der per verifyPin bestaetigte Manager, nicht der Bediener', async () => {
    vi.useFakeTimers()
    const { dialog, createInteraction, verifyPin } = setup({
      currentUser: { _id: STAFF_ID, role: 'tenant:staff' },
    })

    dialog.selectReason('CANCEL_ORDER.REASON_COMPLAINT')
    await vi.advanceTimersByTimeAsync(0)
    expect(dialog.step()).toBe('select-user')
    dialog.selectManager({ _id: MANAGER_ID, fullName: 'Mia Manager', initials: 'MM', role: 'tenant:manager' })
    for (const digit of ['1', '2', '3', '4']) dialog.appendDigit(digit)
    await vi.advanceTimersByTimeAsync(150)

    expect(verifyPin).toHaveBeenCalledTimes(1)
    expect(createInteraction).toHaveBeenCalledTimes(1)
    expect(createInteraction.mock.calls[0][0]['userId']).toBe(MANAGER_ID)
  })

  it('Doppel-Tipp im Manager-Pfad: ein Storno, ein Journal-Ereignis', async () => {
    const { dialog, patch, createInteraction } = setup({
      currentUser: { _id: MANAGER_ID, role: 'tenant:manager' },
    })

    dialog.selectReason('CANCEL_ORDER.REASON_COMPLAINT')
    dialog.selectReason('CANCEL_ORDER.REASON_COMPLAINT')
    await flush()

    expect(patch).toHaveBeenCalledTimes(1)
    expect(createInteraction).toHaveBeenCalledTimes(1)
  })

  it('ein scheiterndes Journal laesst den Storno gelten — Dialog schliesst mit Erfolg', async () => {
    const { dialog, close } = setup({
      currentUser: { _id: MANAGER_ID, role: 'tenant:manager' },
      createInteraction: async () => {
        throw new Error('offline')
      },
    })

    dialog.selectReason('CANCEL_ORDER.REASON_COMPLAINT')
    await flush()

    expect(close).toHaveBeenCalledWith(expect.objectContaining({ success: true }))
  })

  it('scheitert der Storno selbst, entsteht KEIN Journal-Ereignis', async () => {
    const { dialog, createInteraction, close } = setup({
      currentUser: { _id: MANAGER_ID, role: 'tenant:manager' },
      patch: async () => {
        throw new Error('abgelehnt')
      },
    })

    dialog.selectReason('CANCEL_ORDER.REASON_COMPLAINT')
    await flush()

    expect(createInteraction).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })
})

describe('CancelOrderDialogComponent — angemeldeter Manager am POS (#608)', () => {
  it('PIN-angemeldete Inhaberin ohne role in pos_current_user storniert direkt, ohne PIN-Schritt', async () => {
    stubPosCurrentUser({ _id: MANAGER_ID, firstName: 'Vilma', lastName: 'Koetter' })
    const { dialog, patch, createInteraction, verifyPin, close } = setup({
      authorizingUsers: async () => [OWNER],
    })

    dialog.selectReason('CANCEL_ORDER.REASON_COMPLAINT')
    await flush()

    expect(dialog.step()).toBe('reason')
    expect(verifyPin).not.toHaveBeenCalled()
    expect(patch).toHaveBeenCalledTimes(1)
    expect(createInteraction.mock.calls[0][0]['userId']).toBe(MANAGER_ID)
    expect(close).toHaveBeenCalledWith({ success: true, canceledBy: 'Vilma Koetter' })
  })

  it('PIN-angemeldeter Bediener, den der Server nicht als Manager fuehrt: Freigabe per PIN', async () => {
    stubPosCurrentUser({ _id: STAFF_ID, firstName: 'Sam', lastName: 'Staff' })
    const { dialog, patch } = setup({ authorizingUsers: async () => [OWNER] })

    dialog.selectReason('CANCEL_ORDER.REASON_COMPLAINT')
    await flush()

    expect(dialog.step()).toBe('select-user')
    expect(patch).not.toHaveBeenCalled()
  })

  it('liefert der Server einen Bediener ohne Freigaberolle mit, storniert er trotzdem nicht direkt', async () => {
    // Die Abfrage filtert nach `role $in`; der Dialog darf sich darauf nicht allein verlassen.
    stubPosCurrentUser({ _id: STAFF_ID })
    const { dialog, patch } = setup({
      authorizingUsers: async () => [OWNER, { ...OWNER, _id: STAFF_ID, role: 'tenant:staff' }],
    })

    dialog.selectReason('CANCEL_ORDER.REASON_COMPLAINT')
    await flush()

    expect(dialog.step()).toBe('select-user')
    expect(patch).not.toHaveBeenCalled()
  })

  it('inaktiver Manager in pos_current_user storniert nicht direkt', async () => {
    stubPosCurrentUser({ _id: MANAGER_ID })
    const { dialog, patch } = setup({ authorizingUsers: async () => [{ ...OWNER, status: 'INACTIVE' }] })

    dialog.selectReason('CANCEL_ORDER.REASON_COMPLAINT')
    await flush()

    expect(dialog.step()).toBe('select-user')
    expect(patch).not.toHaveBeenCalled()
  })

  it('scheitert das Laden der Managerliste, bleibt nur der PIN-Weg', async () => {
    stubPosCurrentUser({ _id: MANAGER_ID })
    const { dialog, patch } = setup({
      authorizingUsers: async () => {
        throw new Error('offline')
      },
    })

    dialog.selectReason('CANCEL_ORDER.REASON_COMPLAINT')
    await flush()

    expect(dialog.step()).toBe('select-user')
    expect(patch).not.toHaveBeenCalled()
  })
})
