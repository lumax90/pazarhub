import { existsSync } from 'node:fs'
import { loadEnvFile } from 'node:process'
import { loadConfig } from './config'
import { createDatabase } from './db'
import { migrate } from './schema'
import { IntegrationService } from './integration-service'
import { IntegrationWorker } from './worker'

if (existsSync('.env')) loadEnvFile('.env')
const config = loadConfig()
if (!config.databaseUrl)
  throw new Error(
    'A separate worker requires DATABASE_URL. Local PGlite uses the embedded API worker.',
  )
const database = await createDatabase(config)
await migrate(database)
const worker = new IntegrationWorker(new IntegrationService(database, config))
worker.start()
console.log('Pazarhub integration worker started.')
const alive = setInterval(() => undefined, 3600000)
const stop = async () => {
  clearInterval(alive)
  await worker.stop()
  await database.close()
  process.exit(0)
}
process.once('SIGINT', () => void stop())
process.once('SIGTERM', () => void stop())
