import { existsSync } from 'node:fs'
import { loadEnvFile } from 'node:process'
import { createApp } from './app'
import { loadConfig } from './config'

if (existsSync('.env')) loadEnvFile('.env')
const config = loadConfig()
const { app } = await createApp(config)
await app.listen({ port: config.port, host: config.host })
console.log(`Pazarhub API: http://${config.host}:${config.port} (${config.environment})`)
const close = async () => {
  await app.close()
  process.exit(0)
}
process.once('SIGINT', () => void close())
process.once('SIGTERM', () => void close())
