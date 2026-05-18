import { MqttProtocolType, Settings } from './location.schema'

// Letzter Arbeitstag der Woche (JS Date.getDay()-Konvention, 0=So…6=Sa).
// 5 = Freitag entspricht dem DACH-Standard. Wird im Service-Resolver für
// neue Locations gesetzt und in der Zeiterfassungs-UI als Fallback verwendet,
// wenn das Feld auf einer bestehenden Location noch nicht gepflegt ist.
export const DEFAULT_LAST_WORKDAY_OF_WEEK = 5

export const generateDefaultLocationSettings: Settings = {
  generalSettings: {
    systemOfUnits: 'metric',
    defaultWeightUnit: 'kg',
    defaultVolumeUnit: 'L',
    timezone: 'Europe/Berlin',
  },
  printSettings: {
    printServerEnabled: true,
    maxNameCharacters: 42,
    mqttServerProtocol: MqttProtocolType.WS,
    mqttServerUrl: 'localhost',
    mqttServerPort: 9001,
    printerSequence: [],
    printers: [],
    separationCharacter: '_',
    separationCharacterCount: 47,
    showDialogAfterOrder: true,
  },
  serverSettings: {
    path: '/ws',
    timeout: 2000,
    reconnection: true,
    autoConnect: true,
  },
  discountSettings: {
    enabled: false,
    discounts: [],
  },
  pagerSettings: {
    enabled: false,
    pagers: [],
  },
  tableSettings: {
    enabled: false,
    rooms: [],
  },
  genericUserSettings: {
    autoLogOffTime: 30,
    autoLogOffTimeUnit: 'sec',
  },
  genericProductSettings: {
    generalSideDishPrice: 0,
    generalDrinkPrice: 0,
  },
  taxSettings: {
    A: {
      taxRate: 19,
      name: 'Normalsteuersatz',
    },
    B: {
      taxRate: 7,
      name: 'Ermäßigter Steuersatz',
    },
  },
  openingHoursSettings: {
    enabled: false,
    regular: [
      { day: 0, open: '10:00', close: '22:00', closed: true },
      { day: 1, open: '10:00', close: '22:00', closed: false },
      { day: 2, open: '10:00', close: '22:00', closed: false },
      { day: 3, open: '10:00', close: '22:00', closed: false },
      { day: 4, open: '10:00', close: '22:00', closed: false },
      { day: 5, open: '10:00', close: '22:00', closed: false },
      { day: 6, open: '10:00', close: '22:00', closed: false },
    ],
  },
  invoiceSettings: {
    invoiceTemplate: null,
  },
}
