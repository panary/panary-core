/**
 * Edge-Adresse des POS vor der Kopplung. Nach dem Pairing gilt `serverUrl` aus der
 * Gerätekonfiguration. Die Build-Konfiguration `sandbox` ersetzt diese Datei per
 * `fileReplacements` durch `edge-url.sandbox.ts` (panary/panary-core#691).
 */
export const EDGE_URL = 'http://localhost:3030'
