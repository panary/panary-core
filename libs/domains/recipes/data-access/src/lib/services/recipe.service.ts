import { Injectable, signal } from '@angular/core'

export interface Recipe {
  _id: string
  name: string
  externalId?: string | null
}

@Injectable({ providedIn: 'root' })
export class RecipeService {
  #items = signal<Recipe[]>([])
  items = this.#items.asReadonly()

  async loadDocuments(): Promise<void> {
    // Stub – keine API-Anbindung vorhanden
  }
}
