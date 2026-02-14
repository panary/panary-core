export const SupportedTimezones = [
  'Europe/Berlin',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'Asia/Tokyo',
  'UTC',
] as const

export type SupportedTimezone = (typeof SupportedTimezones)[number]

export const DefaultTimezone = 'Europe/Berlin'
