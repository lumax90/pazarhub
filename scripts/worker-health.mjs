import pg from 'pg'
import { hostname } from 'node:os'

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 5000,
})
try {
  const prefix = `worker-${process.env.WORKER_ID ?? process.env.HOSTNAME ?? hostname()}-`
  const result = await pool.query(
    "SELECT id FROM worker_heartbeats WHERE left(id,length($1))=$1 AND updated_at>now()-interval '90 seconds'",
    [prefix],
  )
  process.exitCode = result.rows.length ? 0 : 1
} catch {
  process.exitCode = 1
} finally {
  await pool.end()
}
