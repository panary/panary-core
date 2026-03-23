import { Injectable, signal } from '@angular/core'

export interface Ingredient {
  _id: string
  name: string
  unit: string
  externalId?: string | null
}

@Injectable({ providedIn: 'root' })
export class IngredientService {
  #items = signal<Ingredient[]>([])
  items = this.#items.asReadonly()

  async loadDocuments(): Promise<void> {
    // Stub – keine API-Anbindung vorhanden
  }
}
