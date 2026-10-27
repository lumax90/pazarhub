import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'
import type { ServerConfig } from './config'

export interface QueryResult<T> {
  rows: T[]
  rowCount: number
}
export interface Sql {
  query<T extends object = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>>
  exec(text: string): Promise<void>
}
export interface Database extends Sql {
  transaction<T>(callback: (tx: Sql) => Promise<T>): Promise<T>
  exec(text: string): Promise<void>
  close(): Promise<void>
  kind: 'postgres' | 'pglite'
}

export async function createDatabase(
  config: Pick<ServerConfig, 'databaseUrl' | 'dataDirectory' | 'environment'>,
  memory = false,
): Promise<Database> {
  if (config.databaseUrl) {
    const pool = new pg.Pool({
      connectionString: config.databaseUrl,
      max: 12,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
    })
    pool.on('error', () => console.error('PostgreSQL pool connection error.'))
    const query = async <T extends object>(text: string, values: unknown[] = []) => {
      const result = await pool.query(text, values)
      return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 }
    }
    await query('SELECT 1')
    return {
      kind: 'postgres',
      query,
      exec: async (text) => {
        await pool.query(text)
      },
      close: () => pool.end(),
      transaction: async <T>(callback: (tx: Sql) => Promise<T>) => {
        const client = await pool.connect()
        try {
          await client.query('BEGIN')
          const result = await callback({
            exec: async (text) => {
              await client.query(text)
            },
            query: async <R extends object>(text: string, values: unknown[] = []) => {
              const response = await client.query(text, values)
              return { rows: response.rows as R[], rowCount: response.rowCount ?? 0 }
            },
          })
          await client.query('COMMIT')
          return result
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined)
          throw error
        } finally {
          client.release()
        }
      },
    }
  }
  if (config.environment === 'production')
    throw new Error('Embedded development database cannot run in production.')
  const { PGlite } = await import('@electric-sql/pglite')
  if (!memory) mkdirSync(config.dataDirectory, { recursive: true })
  const database = new PGlite(memory ? 'memory://' : resolve(config.dataDirectory, 'postgres'))
  await database.waitReady
  return {
    kind: 'pglite',
    query: async <T extends object>(text: string, values: unknown[] = []) => {
      const result = await database.query<T>(text, values)
      return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length }
    },
    exec: async (text) => {
      await database.exec(text)
    },
    close: () => database.close(),
    transaction: (callback) =>
      database.transaction((tx) =>
        callback({
          exec: async (text) => {
            await tx.exec(text)
          },
          query: async <T extends object>(text: string, values: unknown[] = []) => {
            const result = await tx.query<T>(text, values)
            return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length }
          },
        }),
      ),
  }
}
