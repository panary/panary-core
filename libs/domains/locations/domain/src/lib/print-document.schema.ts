import { Static, StringEnum, Type } from '@feathersjs/typebox'

//#region Enums
export const PrintAlignType = {
  LEFT: 'left',
  CENTER: 'center',
  RIGHT: 'right',
} as const
const printAlign = StringEnum(Object.values(PrintAlignType))

export const BadgeStyleType = {
  INVERTED: 'inverted',
  OUTLINED: 'outlined',
  FILLED: 'filled',
} as const
const badgeStyle = StringEnum(Object.values(BadgeStyleType))
//#endregion

//#region PrintElement variants
export const textElement = Type.Object({
  type: Type.Literal('text'),
  text: Type.String(),
  bold: Type.Optional(Type.Boolean({ default: false })),
  italic: Type.Optional(Type.Boolean({ default: false })),
  underline: Type.Optional(Type.Boolean({ default: false })),
  invert: Type.Optional(Type.Boolean({ default: false })),
  font: Type.Optional(StringEnum(['A', 'B'])),
  align: Type.Optional(printAlign),
  width: Type.Optional(Type.Number({ minimum: 1, maximum: 8, default: 1 })),
  height: Type.Optional(Type.Number({ minimum: 1, maximum: 8, default: 1 })),
})

export const qrElement = Type.Object({
  type: Type.Literal('qr'),
  data: Type.String(),
  size: Type.Optional(Type.Number({ minimum: 1, maximum: 16, default: 6 })),
  align: Type.Optional(printAlign),
})

export const imageElement = Type.Object({
  type: Type.Literal('image'),
  data: Type.String({ description: 'Base64-encoded image data' }),
  width: Type.Optional(Type.Number({ minimum: 1 })),
  align: Type.Optional(printAlign),
})

export const badgeElement = Type.Object({
  type: Type.Literal('badge'),
  text: Type.String(),
  style: Type.Optional(badgeStyle),
  align: Type.Optional(printAlign),
})

export const feedElement = Type.Object({
  type: Type.Literal('feed'),
  lines: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
})

export const cutElement = Type.Object({
  type: Type.Literal('cut'),
  partial: Type.Optional(Type.Boolean({ default: false })),
})

export const ruleElement = Type.Object({
  type: Type.Literal('rule'),
  style: Type.Optional(StringEnum(['single', 'double'])),
  character: Type.Optional(Type.String({ default: '-' })),
  count: Type.Optional(Type.Number({ minimum: 1 })),
})

export const tableColumnSchema = Type.Object({
  width: Type.Number({ minimum: 1 }),
  align: Type.Optional(StringEnum(['left', 'right'])),
  marginLeft: Type.Optional(Type.Number({ minimum: 0 })),
  marginRight: Type.Optional(Type.Number({ minimum: 0 })),
})

export const tableCellSchema = Type.Object({
  text: Type.String(),
  bold: Type.Optional(Type.Boolean({ default: false })),
  width: Type.Optional(Type.Number({ minimum: 1, maximum: 8 })),
  height: Type.Optional(Type.Number({ minimum: 1, maximum: 8 })),
})

export const tableElement = Type.Object({
  type: Type.Literal('table'),
  columns: Type.Array(tableColumnSchema, { minItems: 1 }),
  rows: Type.Array(Type.Array(Type.Union([Type.String(), tableCellSchema]))),
  font: Type.Optional(StringEnum(['A', 'B'])),
})
//#endregion

//#region PrintElement union & PrintJob
export const printElementSchema = Type.Union([
  textElement,
  qrElement,
  imageElement,
  badgeElement,
  feedElement,
  cutElement,
  ruleElement,
  tableElement,
])
export type PrintElement = Static<typeof printElementSchema>

export const printJobSchema = Type.Object({
  document: Type.Array(printElementSchema, { minItems: 1 }),
  printerIds: Type.Optional(Type.Array(Type.String())),
  copies: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
})
export type PrintJob = Static<typeof printJobSchema>
//#endregion

//#region Legacy TextLine (für Rückwärtskompatibilität)
export const textLineSchema = Type.Object({
  text: Type.String(),
  type: Type.Optional(Type.String()),
  width: Type.Optional(Type.Number()),
  height: Type.Optional(Type.Number()),
  align: Type.Optional(Type.String()),
})
export type TextLine = Static<typeof textLineSchema>
//#endregion
