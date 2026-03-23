export type NotificationType = 'success' | 'info' | 'warning' | 'error'

export type Notification = {
  id: number
  type: NotificationType
  title: string
  message: string
  duration?: number
}
