import { SyncableMasterDataService } from '@panary/edge-pairing/domain'

/**
 * Services, die der Bootstrap-Modus `merge-by-external-id` verarbeitet.
 *
 * **Allowlist, keine Ausschlussliste.** Der Merge matcht ausschliesslich ueber
 * `record.externalId`; ein Service, dessen Domain-Schema das Feld nicht kennt,
 * kann per Konstruktion nie matchen. Jeder seiner Edge-Records laeuft in den
 * `external-id-missing`-Zweig und wird zum `sync-conflict`.
 *
 * Bis #184 war das eine Ausschlussliste (`MASTER_DATA_SERVICES.filter(...)`) —
 * `users`, `customers` und `corporate-customers` standen darin, ohne `externalId`
 * je gehabt zu haben. Ein frisch aufgesetzter Edge erzeugte damit garantiert
 * mindestens einen Konflikt (den initialen Admin), der zudem unaufloesbar war:
 * `tenant:owner` steht auf der Push-Blockliste, es kann also per Design kein
 * Cloud-Pendant entstehen. Als Allowlist tut die Liste bei einem neu
 * hinzukommenden Service nichts Falsches mehr — sie ignoriert ihn schlicht.
 *
 * Ein hier nicht gelisteter Service verliert nichts: Seine Records laufen
 * unveraendert ueber den nachgelagerten `runBootstrapEdgeToCloud`-Push.
 *
 * `merge-services.spec.ts` haelt die Invariante fest, dass jeder gelistete
 * Service `externalId` in seinem Data-Schema fuehrt.
 */
export const MERGE_BY_EXTERNAL_ID_SERVICES: ReadonlyArray<string> = [
  SyncableMasterDataService.PRODUCT_GROUPS,
  SyncableMasterDataService.PRODUCTS,
]
