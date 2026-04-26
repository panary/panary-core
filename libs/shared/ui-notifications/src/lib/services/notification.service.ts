import { Injectable, Signal, signal } from '@angular/core'
import { Notification } from '../models/notification.types'

@Injectable({
  providedIn: 'root',
})
export class NotificationService {
  #notifications = signal<Notification[]>([])
  #idCounter = 0

  /** GETTER **/
  get notifications(): Signal<Notification[]> {
    return this.#notifications.asReadonly()
  }

  /**
   * Show a new notification.
   * @param type 'success' | 'info' | 'warning' | 'error'
   * @param message The message to display
   * @param duration Duration in ms (default 5000)
   * @param title Optional title
   */
  show(type: Notification['type'], message: string, duration = 5000, title?: string): void {
    const newNotification: Notification = {
      id: ++this.#idCounter,
      type,
      message,
      title: title || this.getDefaultTitle(type),
      duration,
    }

    this.#notifications.update(notifications => [...notifications, newNotification])
  }

  /**
   * Removes a notification based on its ID.
   * @param id The ID of the notification to be removed.
   */
  remove(id: number): void {
    this.#notifications.update(notifications => notifications.filter(n => n.id !== id))
  }

  private getDefaultTitle(type: Notification['type']): string {
    switch (type) {
      case 'success':
        return 'Erfolg'
      case 'error':
        return 'Fehler'
      case 'warning':
        return 'Warnung'
      case 'info':
        return 'Info'
    }
  }
}
