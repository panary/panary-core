import { effect, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core'
import { Id, Paginated } from '@feathersjs/feathers'
import { Observer } from 'rxjs'
import { BaseService, ConnectionService } from '@panary-core/shared/data-access'
import { DeviceConfigService } from '@panary-core/shared/data-access-config'
import { Location } from '@panary-core/locations/domain'

// Typ-Aliase für strukturell relevante Sub-Typen
export type PrintSettings = NonNullable<NonNullable<Location['settings']>['printSettings']>
type Printer = NonNullable<PrintSettings['printers']>[number]
type TaxDetailsSet = NonNullable<NonNullable<Location['settings']>['taxSettings']>

@Injectable({
  providedIn: 'root',
})
export class LocationService extends BaseService<Location> {
  protected override entityLabelKey = 'ENTITY.LOCATION'

  /** INJECTION */
  #deviceConfigService: DeviceConfigService = inject(DeviceConfigService)
  protected connectionService: ConnectionService = inject(ConnectionService)

  /** PRIVATE PROPERTIES */
  #locations: WritableSignal<Location[]> = signal([])
  #activeLocation: WritableSignal<Location | undefined> = signal(undefined)

  /** PUBLIC PROPERTIES */
  activeLocation: Signal<Location | undefined> = this.#activeLocation.asReadonly()

  /** GETTER */
  get locations(): Signal<Location[]> {
    return this.#locations.asReadonly()
  }

  get currentBusinessDay() {
    return this.activeLocation()?.currentBusinessDay
  }

  get currentBusinessDayDate(): string | undefined {
    return this.activeLocation()?.currentBusinessDay?.date
  }

  get printSettings(): PrintSettings | undefined {
    return this.activeLocation()?.settings?.printSettings
  }

  get printers(): Array<Printer> {
    return this.activeLocation()?.settings?.printSettings?.printers || []
  }

  get pagers(): Array<number | null> {
    return this.activeLocation()?.settings?.pagerSettings?.pagers || []
  }

  get showPagers(): boolean {
    return this.activeLocation()?.settings?.pagerSettings?.enabled || false
  }

  get tables(): Array<string> {
    const tables: Array<string> = []

    this.activeLocation()?.settings?.tableSettings?.rooms?.forEach(room => {
      room.tables?.forEach((table: string): void => {
        tables.push(table)
      })
    })

    return tables
  }

  get showTables(): boolean {
    return this.activeLocation()?.settings?.tableSettings?.enabled || false
  }

  get printServerEnabled(): boolean {
    return this.activeLocation()?.settings?.printSettings?.printServerEnabled ?? true
  }

  get backofficePrinterId(): string | undefined {
    return this.activeLocation()?.settings?.printSettings?.backofficePrinter || undefined
  }

  get separationCharacter(): string {
    return this.activeLocation()?.settings?.printSettings?.separationCharacter || '-'
  }

  get separationCharacterCount(): number {
    return this.activeLocation()?.settings?.printSettings?.separationCharacterCount || 40
  }

  get maxNameCharacters(): number {
    return this.activeLocation()?.settings?.printSettings?.maxNameCharacters || 40
  }

  get taxes(): TaxDetailsSet {
    return (
      this.activeLocation()?.settings?.taxSettings || {
        A: {
          taxRate: 19,
          name: 'Normalsteuersatz',
        },
      }
    )
  }

  get textLine1(): string {
    return this.activeLocation()?.settings?.invoiceSettings?.textLine1 || ''
  }

  get textLine2(): string {
    return this.activeLocation()?.settings?.invoiceSettings?.textLine2 || ''
  }

  get textLine3(): string {
    return this.activeLocation()?.settings?.invoiceSettings?.textLine3 || ''
  }

  get textLine4(): string {
    return this.activeLocation()?.settings?.invoiceSettings?.textLine4 || ''
  }

  get generalMenuDrinkPrice(): number {
    return this.activeLocation()?.settings?.genericProductSettings?.generalDrinkPrice || 0
  }

  get generalMenuSideDishPrice(): number {
    return this.activeLocation()?.settings?.genericProductSettings?.generalSideDishPrice || 0
  }

  get genericUserSettings() {
    return this.activeLocation()?.settings?.genericUserSettings || undefined
  }

  /** CONSTRUCTOR */
  constructor() {
    super(inject(ConnectionService).locationService, 'locationService')

    effect((): void => {
      if (!this.connectionService.isAuthenticated()) return

      // Nur ein vollständig registriertes POS-Device hat eine Location-Bindung
      // über die DeviceConfig (deviceId + apiKey vom Backend). Ohne diese Wäch-
      // ter würde im Cloud-/Web-Frontend (das `LocationService` transitiv erbt)
      // eine Legacy-`locationId` aus früheren Edge-Sessions oder ObjectId-
      // Migrationen einen `locations.get(id)` triggern und der globale
      // Error-Handler eine "No record found for id …"-Toast bei jedem Login
      // anzeigen — obwohl die Cloud die aktive Location über die Header-UI
      // (`setActiveLocation` / `loadAllowedLocations`) auswählt.
      if (!this.#deviceConfigService.isRegistered()) return

      const locationId = this.#deviceConfigService.getConfig()?.locationId
      if (!locationId) {
        console.warn('[LocationService] No Location ID found in Device Config')
        return
      }

      console.log(`[LocationService] Loading location: ${locationId} (Source: Device)`)
      this.loadDocuments()
      this.get(locationId)
        .then(response => {
          console.log(`[LocationService] Active location loaded:`, response.name)
          this.#activeLocation.set(response)
        })
        .catch(error => this.helper.handleError(this.serviceName, error))
    })
  }

  /** PRIVATE METHODS */
  protected override handleItemCreated(document: Location) {
    this.#locations.update((currentValue: Location[]) => [...currentValue, document])
  }

  protected override handleItemUpdated(document: Location) {
    this.#locations.update((currentValue: Location[]) => {
      const index: number = currentValue.findIndex((element: Location): boolean => element._id === document._id)

      if (index !== -1) {
        currentValue[index] = document
      }

      // Prüfe ob das aktualisierte Dokument die aktive Location ist
      const activeLocation = this.#activeLocation()
      if (activeLocation && activeLocation._id === document._id) {
        this.#activeLocation.set(document)
      }

      return [...currentValue]
    })
  }

  protected override handleItemRemoved(document: Location) {
    this.#locations.update((currentValue: Location[]) => {
      const index: number = currentValue.findIndex((element: Location): boolean => element._id === document._id)

      if (index !== -1) {
        currentValue.splice(index, 1)
        return [...currentValue]
      }
      return currentValue
    })
  }

  protected override loadDocuments(): void {
    this.find().then((response: Paginated<Location> | Location[]) => {
      if (Array.isArray(response)) {
        this.#locations.set(response)
      } else {
        this.#locations.set(response.data)
      }
    })
  }

  protected override fileReaderOnLoad(
    _fileReader: FileReader,
    _observer: Observer<unknown>,
    _context: {
      errorMessages: string[]
      warnMessages: string[]
      successCount: number
      multi: boolean
    },
  ): void {
    /* empty */
  }

  /** PUBLIC METHODS */

  getPrinterById(pid: string): Printer | undefined {
    return this.printers.find((printer: Printer): boolean => printer.pid === pid)
  }

  getLocationColor(locationId: Id | undefined): string {
    const defaultColor = 'bg-fuchsia-600'

    if (!locationId) return defaultColor

    const tailwindColors = [
      'bg-fuchsia-600',
      'bg-lime-600',
      'bg-red-600',
      'bg-orange-600',
      'bg-amber-600',
      'bg-yellow-600',
      'bg-green-600',
      'bg-emerald-600',
      'bg-teal-600',
      'bg-cyan-600',
      'bg-sky-600',
      'bg-blue-600',
      'bg-indigo-600',
      'bg-violet-600',
      'bg-purple-600',
      'bg-pink-600',
      'bg-rose-600',
    ]

    const locations = this.#locations()
    const index = locations.findIndex(loc => loc._id === locationId)

    if (index !== -1) {
      return tailwindColors[index % tailwindColors.length]
    }

    return defaultColor
  }
}
