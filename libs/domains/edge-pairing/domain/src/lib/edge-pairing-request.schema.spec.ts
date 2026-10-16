import { SyncableMasterDataService, SyncableTransactionService } from './edge-pairing-request.schema'

describe('SyncableTransactionService', () => {
  // Abschreibungen entstehen am Edge (POS-Dialog) und gehen per Edge→Cloud-Push
  // in die Cloud, die den Bestand beim Sync-Eingang einmal bucht (panary/panary-core#635).
  // Ohne den Eintrag lehnt die Cloud-Allowlist den Push ab.
  it('fuehrt write-offs als Edge→Cloud-Transaktion', () => {
    expect(SyncableTransactionService.WRITE_OFFS).toEqual('write-offs')
    expect(Object.values(SyncableTransactionService)).toContain('write-offs')
  })

  it('fuehrt write-offs nicht zugleich als Master-Data (kein Pull zurueck an den Edge)', () => {
    expect(Object.values(SyncableMasterDataService)).not.toContain('write-offs')
  })
})
