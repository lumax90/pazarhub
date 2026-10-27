export interface ThemeInventory {
  nativeClasses: Set<string>
  nativePrefixes?: string[]
}
export function componentInventory(root?: string): ThemeInventory
export function stylesheetViolations(css: string, file: string, inventory: ThemeInventory): string[]
export function normalizeTheme(css: string): string
export function auditTheme(root?: string): { errors: string[]; cssFiles: number; controls: number }
