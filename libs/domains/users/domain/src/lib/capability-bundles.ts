// Benannte Berechtigungs-Pakete: fachlich verständliche Bündel, die auf
// konkrete `grant:<resource>:<action>`-Strings expandieren. Sie sind reine
// UI-/Seed-Sache — auf dem User-Doc landen immer die EXPANDIERTEN Grants,
// damit die Authorize-Hooks „dumm" bleiben.

import { AppAction, AppResource } from './permissions'
import { makeGrant } from './effective-permissions'

export type CapabilityBundleGroup = 'lager' | 'katalog' | 'personal' | 'controlling' | 'verkauf'

export interface CapabilityBundle {
  id: string
  /** Bereichs-Gruppe für die UI (entspricht den Settings-Nav-Bereichen). */
  group: CapabilityBundleGroup
  /** Kurzes, fachliches Label (Deutsch). */
  label: string
  /** Ein-Satz-Beschreibung für den Admin. */
  description: string
  /** Auf konkrete Grant-Strings expandierte Berechtigungen. */
  grants: string[]
}

const g = makeGrant

export const CapabilityBundles: readonly CapabilityBundle[] = [
  {
    id: 'wareneingang',
    group: 'lager',
    label: 'Wareneingang',
    description: 'Lieferungen und Belege erfassen und bearbeiten, Bestand einsehen.',
    grants: [
      g(AppResource.INCOMING_GOODS, AppAction.MANAGE),
      g(AppResource.INCOMING_GOODS_EXTRACT, AppAction.CREATE),
      g(AppResource.STOCK_LEVELS, AppAction.READ),
      g(AppResource.SUPPLIERS, AppAction.READ),
    ],
  },
  {
    id: 'inventur-bestand',
    group: 'lager',
    label: 'Inventur & Bestand',
    description: 'Inventuren durchführen, Bestände und Abschreibungen verwalten.',
    grants: [
      g(AppResource.INVENTORIES, AppAction.MANAGE),
      g(AppResource.INVENTORY_MOVEMENTS, AppAction.MANAGE),
      g(AppResource.WRITE_OFFS, AppAction.MANAGE),
      g(AppResource.STOCK_LEVELS, AppAction.READ),
    ],
  },
  {
    id: 'katalog',
    group: 'katalog',
    label: 'Katalog verwalten',
    description: 'Produkte, Produktgruppen, Rezepte, Zutaten und Preislisten pflegen.',
    grants: [
      g(AppResource.PRODUCTS, AppAction.MANAGE),
      g(AppResource.PRODUCT_GROUPS, AppAction.MANAGE),
      g(AppResource.RECIPES, AppAction.MANAGE),
      g(AppResource.INGREDIENTS, AppAction.MANAGE),
      g(AppResource.PRICELISTS, AppAction.MANAGE),
    ],
  },
  {
    id: 'zeit-auswertung',
    group: 'personal',
    label: 'Zeiterfassung & Auswertung',
    description: 'Arbeitszeiten korrigieren und Tages-/Zeitauswertungen einsehen (Backoffice).',
    grants: [
      g(AppResource.WORKING_TIMES, AppAction.UPDATE),
      g(AppResource.WORKING_TIME_REPORTS, AppAction.READ),
      g(AppResource.BUSINESS_DAY_REPORTS, AppAction.READ),
    ],
  },
]

const BUNDLE_BY_ID = new Map<string, CapabilityBundle>(CapabilityBundles.map(b => [b.id, b]))

/** Expandiert Bundle-IDs auf die deduplizierten Grant-Strings (unbekannte IDs ignoriert). */
export const expandBundles = (bundleIds: readonly string[]): string[] => {
  const out = new Set<string>()
  for (const id of bundleIds) {
    const bundle = BUNDLE_BY_ID.get(id)
    if (bundle) for (const grant of bundle.grants) out.add(grant)
  }
  return [...out]
}
