import { effect, inject, Injectable, signal, Signal, WritableSignal } from '@angular/core'
import { LocationService } from '../../../../../domains/organization/data-access/src/lib/services/location.service'
import {
  LocationModel,
  PrintSettings,
} from '../../../../../domains/organization/data-access/src/lib/models/location.model'
import { Order } from '../../../../../domains/orders/data-access/src/lib/models/order.model'
import { MatSnackBar } from '@angular/material/snack-bar'
import mqtt, { ErrorWithReasonCode, IClientOptions, MqttClient, MqttProtocol } from 'mqtt'

@Injectable({
  providedIn: 'root',
})
export class MqttService {
  /** STATIC PROPERTIES */
  static readonly SNACKBAR_ACTION: string | undefined = 'OK'
  static readonly SNACKBAR_DURATION: number = 2000

  /** INJECTION */
  #locationService: LocationService = inject(LocationService)
  #matSnackBar: MatSnackBar = inject(MatSnackBar)

  /** PRIVATE PROPERTIES */
  #isConnected: WritableSignal<boolean> = signal(false)
  #mqttClient: MqttClient | undefined = undefined
  #brokerUrl: string | undefined = undefined
  #options: IClientOptions = {}

  /** PUBLIC PROPERTIES */
  isConnected: Signal<boolean> = this.#isConnected.asReadonly()

  /** GETTER */

  /** CONSTRUCTOR */
  constructor() {
    effect((): void => {
      if (this.#locationService.activeLocation()) {
        this.initializeMqttClient(this.#locationService.printSettings)
      }
    })
  }

  private initializeMqttClient(printSettings: PrintSettings | undefined): void {
    if (printSettings) {
      const protocol: string | undefined = printSettings.mqttServerProtocol
      const host: string | undefined = printSettings.mqttServerUrl
      const port: number | undefined = printSettings.mqttServerPort

      if (!protocol || !host || !port) {
        this.#matSnackBar.open('Missing MQTT server configuration', MqttService.SNACKBAR_ACTION, {
          duration: MqttService.SNACKBAR_DURATION,
        })
        return
      } else {
        this.#brokerUrl = `${protocol}://${host}:${port}`
      }

      this.#options.protocol = protocol as MqttProtocol
      this.#options.host = host
      this.#options.port = port
      // this.#options.clientId = `mqtt_${Math.random().toString(16).substring(2,8)}`
      this.#options.clean = true
      this.#options.reconnectPeriod = 60000
      // this.#options.keepalive = 30

      if (printSettings.mqttAutoConnect) this.connect()
    }
  }

  connect(): void {
    if (!this.#brokerUrl) {
      this.#matSnackBar.open('Missing MQTT broker URL', MqttService.SNACKBAR_ACTION, {
        duration: MqttService.SNACKBAR_DURATION,
      })
      return
    }

    if (!this.#mqttClient) {
      console.log('Initialize MQTT connection...')
      for (const [key, value] of Object.entries(this.#options)) {
        console.log(`   ${key}: ${value}`)
      }

      this.#mqttClient = mqtt.connect(this.#brokerUrl, this.#options)

      this.#mqttClient.on('connect', (): void => {
        console.log('Connected to MQTT server')
        this.#isConnected.set(true)
      })
      this.#mqttClient.on('error', (error: Error | ErrorWithReasonCode): void => {
        console.error('MQTT connection error:', error)
      })
      this.#mqttClient.on('close', (): void => {
        console.log('Disconnected from MQTT server')
        this.#isConnected.set(false)
      })
    } else {
      this.#mqttClient.reconnect()
    }
  }

  disconnect(): void {
    if (this.#mqttClient) {
      this.#mqttClient.end()
    }
  }

  publishOrder(orderItem: Order, topic: string): void {
    if (this.#mqttClient && this.isConnected()) {
      const message: string = JSON.stringify(orderItem)
      this.#mqttClient.publish(topic, message)
    }
  }
}
