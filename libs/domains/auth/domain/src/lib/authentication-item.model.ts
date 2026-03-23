import { User } from '@panary/domains/users/domain'

export type AuthenticationItem = {
  accessToken: string
  authentication: {
    strategy: string
    accessToken: string
    payload: {
      iat: number
      exp: number
      aud: string
      iss: string
      sub: string
      jti: string
    }
  }
  user: User
}
