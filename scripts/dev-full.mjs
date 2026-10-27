import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const children = [
  spawn(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), 'watch', 'server/index.ts'], {
    stdio: 'inherit',
  }),
  spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '0.0.0.0'], {
    stdio: 'inherit',
  }),
]
let closing = false
function stop() {
  if (closing) return
  closing = true
  children.forEach((child) => child.kill('SIGTERM'))
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
children.forEach((child) =>
  child.on('exit', (code) => {
    if (!closing && code) {
      process.exitCode = code
      stop()
    }
  }),
)
