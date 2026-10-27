export interface ThemeInventory {
  nativeClasses: Set<string>
  nativePrefixes?: string[]
}
export const typeScale: Record<'font-weight' | 'letter-spacing' | 'line-height', RegExp>
export function componentInventory(root?: string): ThemeInventory
export function stylesheetViolations(css: string, file: string, inventory: ThemeInventory): string[]
export function spacingDebt(css: string): number
export function readSpacingBaseline(root?: string): Record<string, number>
export function spacingRatchet(
  counts: Record<string, number>,
  baseline: Record<string, number>,
): { errors: string[]; improved: string[] }
export function normalizeTheme(css: string): string
export function auditTheme(root?: string): {
  errors: string[]
  cssFiles: number
  controls: number
  spacing: Record<string, number>
  improved: string[]
}
