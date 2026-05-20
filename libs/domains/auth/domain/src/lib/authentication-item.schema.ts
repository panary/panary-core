import { Static, Type } from '@feathersjs/typebox'
import { userSchema } from '@panary/users/domain'

export const jwtPayloadSchema = Type.Object({
  iat: Type.Number(),
  exp: Type.Number(),
  aud: Type.String(),
  iss: Type.String(),
  sub: Type.String(),
  jti: Type.String(),
})
export type JwtPayload = Static<typeof jwtPayloadSchema>

export const authenticationItemSchema = Type.Object({
  accessToken: Type.String(),
  authentication: Type.Object({
    strategy: Type.String(),
    accessToken: Type.String(),
    payload: jwtPayloadSchema,
  }),
  user: userSchema,
})
export type AuthenticationItem = Static<typeof authenticationItemSchema>
