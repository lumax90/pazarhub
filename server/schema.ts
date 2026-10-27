import type { Database } from './db'
import { randomUUID } from 'node:crypto'
import { hydrateDefinitionReferences, initializeDefinitions } from '../src/domain/definitions'
import type { AppState } from '../src/domain/types'

export async function migrate(database: Database) {
  await database.transaction(async (tx) => {
    if (database.kind === 'postgres') await tx.query('SELECT pg_advisory_xact_lock(1706298101)')
    await tx.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS workspaces (
      id uuid PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL, password_hash text NOT NULL,
      active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS memberships (
      workspace_id uuid NOT NULL REFERENCES workspaces(id), user_id uuid NOT NULL REFERENCES users(id),
      role text NOT NULL CHECK (role IN ('owner','manager','operator','accountant','viewer')),
      preferences jsonb NOT NULL DEFAULT '{}', PRIMARY KEY (workspace_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      workspace_id uuid NOT NULL REFERENCES workspaces(id), csrf_token text NOT NULL,
      expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS workspace_states (
      workspace_id uuid PRIMARY KEY REFERENCES workspaces(id), revision bigint NOT NULL DEFAULT 0,
      document jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS command_receipts (
      workspace_id uuid NOT NULL REFERENCES workspaces(id), request_key uuid NOT NULL, user_id uuid NOT NULL REFERENCES users(id),
      command_type text NOT NULL, body_hash text NOT NULL, result jsonb NOT NULL, revision bigint NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (workspace_id,request_key)
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id), user_id uuid REFERENCES users(id),
      action text NOT NULL, entity_id text, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS audit_workspace_idx ON audit_events(workspace_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS integration_connections (
      id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id), provider text NOT NULL,
      kind text NOT NULL CHECK (kind IN ('marketplace','cargo','invoice')), name text NOT NULL,
      credentials text NOT NULL, settings jsonb NOT NULL DEFAULT '{}', enabled boolean NOT NULL DEFAULT false,
      status text NOT NULL DEFAULT 'configured', last_test_at timestamptz, last_error text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz, UNIQUE(workspace_id,id)
    );
    CREATE INDEX IF NOT EXISTS connections_workspace_idx ON integration_connections(workspace_id) WHERE deleted_at IS NULL;
    CREATE TABLE IF NOT EXISTS integration_jobs (
      id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id), connection_id uuid REFERENCES integration_connections(id),
      kind text NOT NULL, entity_id text, payload jsonb NOT NULL DEFAULT '{}', deduplication_key text,
      status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','waiting','completed','failed','uncertain','cancelled')),
      attempts integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 5,
      available_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz, worker_id text,
      result jsonb, last_error text, created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
      UNIQUE(workspace_id,deduplication_key)
    );
    CREATE INDEX IF NOT EXISTS jobs_pending_idx ON integration_jobs(available_at) WHERE status IN ('queued','waiting');
    CREATE INDEX IF NOT EXISTS jobs_workspace_idx ON integration_jobs(workspace_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS external_records (
      id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id), connection_id uuid NOT NULL REFERENCES integration_connections(id),
      resource text NOT NULL, external_id text NOT NULL, document jsonb NOT NULL, local_id text,
      seen_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,connection_id,resource,external_id)
    );
    CREATE INDEX IF NOT EXISTS external_workspace_idx ON external_records(workspace_id,connection_id,resource);
    CREATE TABLE IF NOT EXISTS integration_cursors (
      workspace_id uuid NOT NULL REFERENCES workspaces(id), connection_id uuid NOT NULL REFERENCES integration_connections(id),
      resource text NOT NULL, cursor jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(workspace_id,connection_id,resource)
    );
    CREATE TABLE IF NOT EXISTS integration_rate_limits (
      connection_id uuid PRIMARY KEY REFERENCES integration_connections(id), next_request_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS invitations (
      id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id), email text NOT NULL,
      role text NOT NULL, token_hash text NOT NULL UNIQUE, created_by uuid NOT NULL REFERENCES users(id),
      expires_at timestamptz NOT NULL, accepted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS stored_files (
      id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id), user_id uuid NOT NULL REFERENCES users(id),
      name text NOT NULL, mime text NOT NULL, size integer NOT NULL, storage_key text NOT NULL,
      public_token text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS worker_heartbeats (id text PRIMARY KEY, updated_at timestamptz NOT NULL DEFAULT now());
    INSERT INTO schema_migrations(version) VALUES (1) ON CONFLICT DO NOTHING;
    `)
    const applied = await tx.query('SELECT version FROM schema_migrations WHERE version=2')
    if (!applied.rows.length)
      await tx.exec(`
      ALTER TABLE integration_jobs ADD COLUMN sequence bigserial;
      ALTER TABLE integration_connections ADD COLUMN credential_version integer NOT NULL DEFAULT 1;
      ALTER TABLE integration_jobs ADD COLUMN credential_version integer;
      CREATE UNIQUE INDEX jobs_connection_running_idx ON integration_jobs(connection_id) WHERE status='running';
      CREATE INDEX jobs_sequence_idx ON integration_jobs(connection_id,sequence) WHERE status IN ('queued','waiting','running');
      ALTER TABLE integration_jobs ADD CONSTRAINT jobs_connection_tenant_fk FOREIGN KEY(workspace_id,connection_id) REFERENCES integration_connections(workspace_id,id);
      ALTER TABLE external_records ADD CONSTRAINT records_connection_tenant_fk FOREIGN KEY(workspace_id,connection_id) REFERENCES integration_connections(workspace_id,id);
      ALTER TABLE integration_cursors ADD CONSTRAINT cursors_connection_tenant_fk FOREIGN KEY(workspace_id,connection_id) REFERENCES integration_connections(workspace_id,id);
      CREATE TABLE auth_tokens (
        token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        purpose text NOT NULL, expires_at timestamptz NOT NULL, consumed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO schema_migrations(version) VALUES(2);
    `)
    const media = await tx.query('SELECT version FROM schema_migrations WHERE version=3')
    if (!media.rows.length)
      await tx.exec(`
      ALTER TABLE stored_files ADD COLUMN contents bytea;
      ALTER TABLE stored_files ADD COLUMN purpose text NOT NULL DEFAULT 'image';
      ALTER TABLE stored_files ALTER COLUMN user_id DROP NOT NULL;
      INSERT INTO schema_migrations(version) VALUES(3);
    `)
    const publishing = await tx.query('SELECT version FROM schema_migrations WHERE version=4')
    if (!publishing.rows.length)
      await tx.exec(`
      CREATE TABLE metadata_cache (
        workspace_id uuid NOT NULL,connection_id uuid NOT NULL,cache_key text NOT NULL,
        document jsonb NOT NULL,expires_at timestamptz NOT NULL,
        PRIMARY KEY(workspace_id,connection_id,cache_key),
        FOREIGN KEY(workspace_id,connection_id) REFERENCES integration_connections(workspace_id,id)
      );
      CREATE INDEX metadata_expiry_idx ON metadata_cache(expires_at);
      INSERT INTO schema_migrations(version) VALUES(4);
    `)
    const workflows = await tx.query('SELECT version FROM schema_migrations WHERE version=5')
    if (!workflows.rows.length)
      await tx.exec(`
      ALTER TABLE external_records ADD COLUMN workflow jsonb;
      INSERT INTO schema_migrations(version) VALUES(5);
    `)
    const indexes = await tx.query('SELECT version FROM schema_migrations WHERE version=6')
    if (!indexes.rows.length)
      await tx.exec(`
      CREATE INDEX external_financial_payment_idx ON external_records(workspace_id,connection_id,(document->>'paymentOrderId')) WHERE resource='settlement';
      CREATE INDEX external_workflow_pending_idx ON external_records(seen_at) WHERE resource IN ('question','claim') AND workflow->>'state' IN ('pending','uncertain');
      INSERT INTO schema_migrations(version) VALUES(6);
    `)
    const imports = await tx.query('SELECT version FROM schema_migrations WHERE version=7')
    if (!imports.rows.length)
      await tx.exec(`
      CREATE TABLE catalog_imports(id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),user_id uuid NOT NULL REFERENCES users(id),name text NOT NULL,document jsonb NOT NULL,plan jsonb,result jsonb,expires_at timestamptz NOT NULL,applied_at timestamptz);
      CREATE INDEX catalog_import_expiry_idx ON catalog_imports(expires_at);
      INSERT INTO schema_migrations(version) VALUES(7);
    `)
    const definitions = await tx.query('SELECT version FROM schema_migrations WHERE version=8')
    if (!definitions.rows.length) {
      const rows = await tx.query<{ workspace_id: string; document: AppState }>(
        "SELECT workspace_id,document FROM workspace_states WHERE NOT(document ? 'definitions') FOR UPDATE",
      )
      for (const row of rows.rows) {
        initializeDefinitions(row.document, randomUUID)
        await tx.query(
          'UPDATE workspace_states SET document=$1,revision=revision+1,updated_at=now() WHERE workspace_id=$2',
          [JSON.stringify(row.document), row.workspace_id],
        )
      }
      await tx.exec('INSERT INTO schema_migrations(version) VALUES(8);')
    }
    const references = await tx.query('SELECT version FROM schema_migrations WHERE version=9')
    if (!references.rows.length) {
      const rows = await tx.query<{ workspace_id: string; document: AppState }>(
        'SELECT workspace_id,document FROM workspace_states FOR UPDATE',
      )
      for (const row of rows.rows) {
        const before = JSON.stringify(row.document)
        hydrateDefinitionReferences(row.document)
        if (JSON.stringify(row.document) !== before)
          await tx.query(
            'UPDATE workspace_states SET document=$1,revision=revision+1,updated_at=now() WHERE workspace_id=$2',
            [JSON.stringify(row.document), row.workspace_id],
          )
      }
      await tx.exec('INSERT INTO schema_migrations(version) VALUES(9);')
    }
    const evidence = await tx.query('SELECT version FROM schema_migrations WHERE version=10')
    if (!evidence.rows.length)
      await tx.exec(`
      ALTER TABLE external_records ADD CONSTRAINT records_workspace_id_unique UNIQUE(workspace_id,id);
      ALTER TABLE stored_files ADD CONSTRAINT files_workspace_id_unique UNIQUE(workspace_id,id);
      CREATE TABLE claim_documents (
        workspace_id uuid NOT NULL, record_id uuid NOT NULL, file_id uuid NOT NULL,
        PRIMARY KEY(record_id,file_id),
        FOREIGN KEY(workspace_id,record_id) REFERENCES external_records(workspace_id,id) ON DELETE CASCADE,
        FOREIGN KEY(workspace_id,file_id) REFERENCES stored_files(workspace_id,id) ON DELETE CASCADE
      );
      INSERT INTO schema_migrations(version) VALUES(10);
    `)
    const invoiceDefaults = await tx.query('SELECT version FROM schema_migrations WHERE version=11')
    if (!invoiceDefaults.rows.length)
      await tx.exec(`
      ALTER TABLE integration_connections ADD COLUMN is_default boolean NOT NULL DEFAULT false;
      ALTER TABLE integration_connections ADD CONSTRAINT invoice_default_kind CHECK (NOT is_default OR kind='invoice');
      CREATE UNIQUE INDEX invoice_default_workspace_idx ON integration_connections(workspace_id) WHERE is_default AND kind='invoice' AND deleted_at IS NULL;
      INSERT INTO schema_migrations(version) VALUES(11);
    `)
    const avatars = await tx.query('SELECT version FROM schema_migrations WHERE version=12')
    if (!avatars.rows.length)
      await tx.exec(`
      ALTER TABLE users ADD COLUMN avatar_seed text;
      INSERT INTO schema_migrations(version) VALUES(12);
    `)
  })
}
