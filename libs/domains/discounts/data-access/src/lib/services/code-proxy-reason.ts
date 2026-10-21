/**
 * Technische Gründe, aus denen die Kasse einen Code nicht prüfen konnte — im Gegensatz zu den
 * fachlichen Ablehnungen der Cloud (`CodeRedeemReason`). Bewusst ohne Angular-Abhängigkeit, damit
 * die Zuordnung ohne TestBed prüfbar bleibt.
 */
export const CodeProxyReason = {
  NOT_PAIRED: 'not_paired',
  CLOUD_UNREACHABLE: 'cloud_unreachable',
  NOT_AUTHORIZED: 'not_authorized',
} as const
export type CodeProxyReason = (typeof CodeProxyReason)[keyof typeof CodeProxyReason]

/**
 * Ordnet eine Exception beim Prüfen/Einlösen einem Grund zu. 401/403 sind eine Ablehnung des
 * Zugangs, kein Netzproblem — vorher erschienen sie als „Cloud nicht erreichbar" (cloud#1429).
 */
export function codeProxyReasonForError(error: unknown): CodeProxyReason {
  const code = (error as { code?: unknown } | null | undefined)?.code
  return code === 401 || code === 403 ? CodeProxyReason.NOT_AUTHORIZED : CodeProxyReason.CLOUD_UNREACHABLE
}
