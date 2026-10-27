import { build } from 'esbuild'

await build({
  entryPoints: ['server/index.ts', 'server/worker-entry.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  outdir: 'server-dist',
  sourcemap: true,
  logLevel: 'info',
})
