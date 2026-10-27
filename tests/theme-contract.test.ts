import { describe, expect, it } from 'vitest'
import {
  auditTheme,
  componentInventory,
  normalizeTheme,
  spacingDebt,
  spacingRatchet,
  stylesheetViolations,
} from '../scripts/theme-contract.mjs'

describe('native theme ownership', () => {
  const inventory = componentInventory()
  it('checks all application styles and conditional component classes, including unopened overlays', () => {
    const result = auditTheme()
    expect(result.controls).toBeGreaterThan(1000)
    expect(result.errors).toEqual([])
  })
  it('rejects the old hidden-state overrides, even when they are in a lower layer', () => {
    for (const rule of [
      '.notification-dropdown .notification-item[data-hovered] { background: var(--surface); }',
      '.search-select-popover [role="option"] { border-radius: var(--radius-sm); }',
      '.bundle-price-choice[data-selected="true"] { border: 1px solid var(--accent); }',
      '.status-chip--pending { color: var(--accent); }',
      '.metric-card { box-shadow: none; }',
      '.button { @apply bg-blue-500; }',
      '.settings :is(.button, .other)::after { background: var(--accent); }',
    ])
      expect(
        stylesheetViolations(`@layer app-layout { ${rule} }`, 'src/styles/legacy.css', inventory),
      ).not.toEqual([])
  })
  it('keeps theme appearance separate from legitimate component layout and paper output', () => {
    expect(
      stylesheetViolations(
        '.app-dialog--wide { max-width: min(860px, 100vw); }',
        'src/styles/structure.css',
        inventory,
      ),
    ).toEqual([])
    expect(
      stylesheetViolations(
        '@media print { .table__cell { color: #000; } }',
        'src/styles/print.css',
        inventory,
      ),
    ).toEqual([])
    expect(
      stylesheetViolations(
        '.channel-icon--amazon { color: white; background: #344054; }',
        'src/styles/content.css',
        inventory,
      ),
    ).toEqual([])
    expect(
      stylesheetViolations('.button { color: #fff; }', 'src/styles/content.css', inventory),
    ).not.toEqual([])
    expect(
      stylesheetViolations(
        '.product-art { border-radius: 9px; }',
        'src/styles/content.css',
        inventory,
      ),
    ).not.toEqual([])
  })
  it('rejects parallel palettes, shadowed theme tokens and fixed visual scales', () => {
    for (const css of [
      '.panel { background: #ffffff; }',
      ':root { --accent: red; }',
      '.title { color: var(--text); }',
      '.tile { border-radius: 11px; }',
    ])
      expect(stylesheetViolations(css, 'src/styles/layout.css', inventory)).not.toEqual([])
  })
  it('binds weight, tracking and leading to the --app-* type scale', () => {
    for (const css of [
      '.report-heading { font-weight: 550; }',
      '.report-heading { font-weight: var(--font-weight-semibold); }',
      '.report-heading { letter-spacing: -0.4px; }',
      '.report-heading { line-height: 1.7; }',
      '.report-heading { line-height: 16px; }',
      '.company-badge { font: 600 var(--text-sm)/1 var(--font-sans); }',
    ])
      expect(stylesheetViolations(css, 'src/styles/layout.css', inventory)).not.toEqual([])
    expect(
      stylesheetViolations(
        '.report-heading { font-weight: var(--app-weight-semibold); letter-spacing: var(--app-tracking-tight); line-height: var(--app-leading-tight); } .company-badge { line-height: 1; letter-spacing: 0; }',
        'src/styles/layout.css',
        inventory,
      ),
    ).toEqual([])
  })
  it('lets pixel spacing only shrink, and starts new files at zero', () => {
    expect(
      spacingDebt(
        '.a { padding: 12px 0; gap: 6px; margin: 0px; width: 40px; } .b { gap: var(--app-space-2); }',
      ),
    ).toBe(2)
    const baseline = { 'src/styles/layout.css': 10 }
    expect(spacingRatchet({ 'src/styles/layout.css': 10 }, baseline).errors).toEqual([])
    expect(spacingRatchet({ 'src/styles/layout.css': 11 }, baseline).errors).toHaveLength(1)
    expect(spacingRatchet({ 'src/styles/layout.css': 7 }, baseline).improved).toEqual([
      'src/styles/layout.css: 10 → 7',
    ])
    expect(spacingRatchet({ 'src/styles/new.css': 1 }, baseline).errors).toHaveLength(1)
  })
  it('accepts a named HeroUI export and maps its modes once, without component edits', () => {
    const exportCss =
      '@layer base { :root { --radius: 0.75rem; } [data-theme="ocean"] { color-scheme: light; --accent: oklch(0.45 0.15 230); } [data-theme="ocean-dark"] { color-scheme: dark; --accent: oklch(0.86 0.08 230); } }'
    const css = normalizeTheme(exportCss)
    expect(css).toContain('[data-theme="light"]')
    expect(css).toContain('[data-theme="dark"]')
    expect(css).toContain('--radius: 0.75rem')
    expect(css).toContain('oklch(0.86 0.08 230)')
    expect(() => normalizeTheme('@layer components { .button { color: red; } }')).toThrow()
    expect(() =>
      normalizeTheme(':root { --accent: red; } .button { --button-bg: blue; }'),
    ).toThrow()
  })
})
