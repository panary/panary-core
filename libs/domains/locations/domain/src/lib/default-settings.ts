import { MqttProtocolType, Settings } from './location.schema'

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
    mqttServerProtocol: MqttProtocolType.MQTT,
    mqttServerUrl: 'localhost',
    mqttServerPort: 1883,
    mqttAutoConnect: false,
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
  invoiceSettings: {
    invoiceTemplate: null,
  },
}
