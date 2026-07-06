// JIT-Compiler zuerst laden: @angular/material/@angular/common sind partial-compiled;
// ohne Linker (kein analogjs-Plugin in dieser node-Vitest-Config) faellt Angular auf JIT zurueck.
import '@angular/compiler'
import { describe, expect, it, vi } from 'vitest'
import { Injector, NgZone, runInInjectionContext } from '@angular/core'
import { MatSnackBar } from '@angular/material/snack-bar'
import { TranslateService } from '@ngx-translate/core'
import { of } from 'rxjs'
import type { Pricelist } from '@panary/products/domain'
import { ConnectionService, DATA_ACCESS_AUTO_LOAD, ServiceHelper } from '@panary/shared/data-access'
import { AuthService } from '@panary/auth/data-access'
import { ProductService } from './product.service'

// applyPrices() ist der legacy Preislisten-Flow: pro Eintrag in
// `pricelist.productPrices` ein sequenzieller `patch(productId, { price })`.
//
// Bundle-Bezug: Der Patch schreibt flach `product.price`. In der Preisbildung
// (Cents-Engine, @panary/orders/domain) geht `price` nur dort ein, wo das
// Produkt selbst preisbildend ist — bei BUNDLE-Produkten mit
// `bundlePricingMode: 'ROLLUP'` ist der Bon-Preis die Summe der Komponenten,
// d.h. ein Preislisten-Preis auf dem ROLLUP-Bundle selbst bleibt fuer die
// Bon-Berechnung wirkungslos; nur FIXED_PROPORTIONAL-Bundles (und normale
// PRODUCT/MODIFIER) verkaufen ueber ihr eigenes `price`-Feld.

interface SetupOptions {
  patchImpl?: (id: unknown, data: unknown) => Promise<unknown>
}

/**
 * Baut eine echte ProductService-Instanz ohne TestBed: alle inject()-Tokens
 * werden als useValue-Mocks in einem eigenen Injector bereitgestellt.
 * DATA_ACCESS_AUTO_LOAD=false verhindert den Konstruktor-Lade-Effect
 * (effect() braeuchte sonst einen Zerstoerungs-Kontext).
 */
function setup(options: SetupOptions = {}) {
  const patch = vi.fn(options.patchImpl ?? ((id: unknown) => Promise.resolve({ _id: id })))
  // Kein `on` am Mock → BaseService.configureSocketListeners() ueberspringt die Socket-Listener.
  const feathersProductService = { patch }
  const snackOpen = vi.fn(() => ({ afterDismissed: () => of(undefined) }))
  const handleError = vi.fn()

  const injector = Injector.create({
    providers: [
      { provide: ConnectionService, useValue: { productService: feathersProductService } },
      { provide: AuthService, useValue: { fullName: () => 'Testi Tester' } },
      { provide: ServiceHelper, useValue: { handleError } },
      { provide: MatSnackBar, useValue: { open: snackOpen } },
      { provide: TranslateService, useValue: { instant: (key: string) => key } },
      { provide: NgZone, useValue: { run: (fn: () => unknown) => fn() } },
      { provide: DATA_ACCESS_AUTO_LOAD, useValue: false },
    ],
  })

  const service = runInInjectionContext(injector, () => new ProductService())
  return { service, patch, snackOpen, handleError }
}

function makePricelist(productPrices: Pricelist['productPrices']): Pricelist {
  return { _id: 'pl-1', name: 'Sommerpreise', prices: {}, productPrices }
}

describe('ProductService.applyPrices — partielle Fehler', () => {
  it('patcht alle Eintraege sequenziell und markiert Erfolge mit UPDATED/updatedAt/updatedBy', async () => {
    const { service, patch } = setup()
    const pricelist = makePricelist([
      { productId: 'p1', newPrice: 2.5 },
      { productId: 'p2', newPrice: 3.9 },
    ])

    const result = await service.applyPrices(pricelist)

    expect(patch).toHaveBeenCalledTimes(2)
    // Drittes Argument {} = Default-`params` von BaseService.patch
    expect(patch).toHaveBeenNthCalledWith(1, 'p1', { price: 2.5 }, {})
    expect(patch).toHaveBeenNthCalledWith(2, 'p2', { price: 3.9 }, {})
    for (const entry of result.productPrices) {
      expect(entry.updateStatus).toBe('UPDATED')
      expect(entry.updatedAt).toBeInstanceOf(Date)
      expect(entry.updatedBy).toBe('Testi Tester')
    }
    // applyPrices mutiert die uebergebene Preisliste und gibt dieselbe Referenz zurueck
    expect(result).toBe(pricelist)
  })

  it('ein fehlschlagender Patch bricht NICHT ab: Nachbarn werden gepatcht, Fehlertext landet im updateStatus', async () => {
    const { service, patch, handleError } = setup({
      patchImpl: (id: unknown) =>
        id === 'p2' ? Promise.reject(new Error('Patch fehlgeschlagen')) : Promise.resolve({ _id: id }),
    })
    const pricelist = makePricelist([
      { productId: 'p1', newPrice: 2.5 },
      { productId: 'p2', newPrice: 3.9 },
      { productId: 'p3', newPrice: 1.2 },
    ])

    const result = await service.applyPrices(pricelist)

    expect(patch).toHaveBeenCalledTimes(3)
    expect(result.productPrices[0].updateStatus).toBe('UPDATED')
    expect(result.productPrices[1].updateStatus).toBe('Patch fehlgeschlagen')
    expect(result.productPrices[1].updatedBy).toBeUndefined()
    expect(result.productPrices[2].updateStatus).toBe('UPDATED')
    // BaseService.patch meldet den Fehler an den ServiceHelper und re-throwt (Pflicht-catch beim Aufrufer)
    expect(handleError).toHaveBeenCalledTimes(1)
  })

  it('Snackbar meldet auch dann Erfolg, wenn alle Patches fehlschlagen (Ist-Verhalten, Befund)', async () => {
    const { service, snackOpen } = setup({
      patchImpl: () => Promise.reject(new Error('offline')),
    })
    const pricelist = makePricelist([{ productId: 'p1', newPrice: 2.5 }])

    const result = await service.applyPrices(pricelist)

    expect(result.productPrices[0].updateStatus).toBe('offline')
    // "Preise erfolgreich angewendet" ist unabhaengig vom Ergebnis — der
    // Fehlerstatus ist nur pro Zeile in der Preislisten-UI sichtbar.
    expect(snackOpen).toHaveBeenCalledTimes(1)
    expect(snackOpen).toHaveBeenCalledWith('Preise erfolgreich angewendet', 'OK', { duration: 2500 })
  })
})

describe('ProductService.applyPrices — Falsy-Skip von newPrice', () => {
  it('newPrice=0 und newPrice=undefined werden still uebersprungen (kein Patch, kein Status)', async () => {
    const { service, patch } = setup()
    // BEFUND (geLOCKtes Ist-Verhalten): `if (product.newPrice)` ist ein
    // Truthy-Check — ein bewusster 0-EUR-Preis (Freigetraenk, Aktionspreis)
    // ist ueber Preislisten STILL nicht anwendbar: kein Patch, kein
    // updateStatus, keine Fehlermeldung. Wer 0-Preise braucht, muss den
    // Check auf `newPrice != null` aendern (Verhaltensaenderung, hier nur
    // dokumentiert).
    const pricelist = makePricelist([
      { productId: 'p-null-preis', newPrice: 0 },
      { productId: 'p-ohne-preis' },
      { productId: 'p-normal', newPrice: 2 },
    ])

    const result = await service.applyPrices(pricelist)

    expect(patch).toHaveBeenCalledTimes(1)
    expect(patch).toHaveBeenCalledWith('p-normal', { price: 2 }, {})
    expect(result.productPrices[0].updateStatus).toBeUndefined()
    expect(result.productPrices[1].updateStatus).toBeUndefined()
    expect(result.productPrices[2].updateStatus).toBe('UPDATED')
  })

  it('leere Preisliste: kein Patch, aber Erfolgs-Snackbar', async () => {
    const { service, patch, snackOpen } = setup()

    await service.applyPrices(makePricelist([]))

    expect(patch).not.toHaveBeenCalled()
    expect(snackOpen).toHaveBeenCalledTimes(1)
  })
})
