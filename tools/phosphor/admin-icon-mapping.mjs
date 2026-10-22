// Quelle der Wahrheit für Material Symbols → Phosphor Regular im Core-Admin (core#825).
// Gleiche Form wie pos-icon-mapping.mjs: Material-Name → [Phosphor-Name (ohne Gewichts-Suffix), Anmerkung | ''].
// Was der POS schon festgelegt hat, wird übernommen statt neu entschieden — beide Oberflächen sprechen dieselbe
// Bildsprache, nur das Gewicht unterscheidet sich. Neue Admin-Icons: hier ergänzen, dann `pnpm icons:build`.
import { MAPPING as POS } from './pos-icon-mapping.mjs'

const FROM_POS = [
  'check',
  'chevron_left',
  'chevron_right',
  'cloud',
  'cloud_off',
  'cloud_sync',
  'content_copy',
  'dns',
  'emergency_home',
  'error',
  'event',
  'key',
  'lan',
  'logout',
  'menu',
  'more_horiz',
  'people',
  'person',
  'print',
  'receipt_long',
  'restaurant',
  'schedule',
  'store',
  'table_restaurant',
  'warning',
]

const ADMIN_ONLY = {
  category: ['stack', 'Warengruppen'],
  cloud_done: ['cloud-check', ''],
  cloud_download: ['cloud-arrow-down', 'Hinweis „Daten aus der Cloud"'],
  dashboard: ['squares-four', ''],
  description: ['file-text', 'Protokolle'],
  devices: ['devices', ''],
  inventory_2: ['package', 'Produkte'],
  sync_problem: ['cloud-warning', 'Sync-Status und Sync-Probleme'],
  unfold_more: ['caret-up-down', 'Sprachauswahl'],
  vibration: ['vibrate', 'Pager'],
}

const missing = FROM_POS.filter(name => !POS[name])
if (missing.length > 0) throw new Error(`Im POS-Mapping fehlen: ${missing.join(', ')}`)

export const MAPPING = {
  ...Object.fromEntries(FROM_POS.map(name => [name, POS[name]])),
  ...ADMIN_ONLY,
}
