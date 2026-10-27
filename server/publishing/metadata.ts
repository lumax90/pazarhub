import type { CatalogOption, MetadataQuery, MetadataResult } from '../../src/domain/publishing'
import type { AdapterContext } from '../integrations/contracts'
import type { Database } from '../db'
import { canonicalJson, sha256 } from '../security'
import type { PublicationAdapter } from './types'

export class CatalogMetadata {
  constructor(
    private readonly database: Database,
    private readonly adapter: PublicationAdapter,
    private readonly credentialVersion: number,
  ) {}
  private key(query: MetadataQuery) {
    return `catalog:${this.credentialVersion}:${sha256(canonicalJson(query))}`
  }
  async get(context: AdapterContext, query: MetadataQuery): Promise<MetadataResult> {
    const key = this.key(query)
    const cached = (
      await this.database.query<{ document: MetadataResult }>(
        `SELECT document FROM metadata_cache WHERE workspace_id=$1 AND connection_id=$2 AND cache_key=$3 AND expires_at>now()`,
        [context.workspaceId, context.connectionId, key],
      )
    ).rows[0]
    if (cached) return cached.document
    const result = await this.adapter.metadata(context, query)
    await this.database.query(
      `INSERT INTO metadata_cache(workspace_id,connection_id,cache_key,document,expires_at) VALUES($1,$2,$3,$4,now()+interval '6 hours')
      ON CONFLICT(workspace_id,connection_id,cache_key) DO UPDATE SET document=EXCLUDED.document,expires_at=EXCLUDED.expires_at`,
      [context.workspaceId, context.connectionId, key, JSON.stringify(result)],
    )
    if (result.options) await this.remember(context, query, result.options)
    if (result.schema)
      for (const attribute of result.schema.attributes)
        if (attribute.values)
          await this.remember(
            context,
            { resource: 'values', categoryId: result.schema.id, attributeId: attribute.id },
            attribute.values,
          )
    return result
  }
  private valueKey(query: MetadataQuery, id: string) {
    return `option:${this.credentialVersion}:${query.resource}:${query.categoryId ?? ''}:${query.attributeId ?? ''}:${id}`
  }
  async remember(context: AdapterContext, query: MetadataQuery, options: CatalogOption[]) {
    if (!options.length) return
    await this.database.query(
      `INSERT INTO metadata_cache(workspace_id,connection_id,cache_key,document,expires_at)
      SELECT $1::uuid,$2::uuid,item->>'key',item->'value',now()+interval '6 hours' FROM jsonb_array_elements($3::jsonb) item
      ON CONFLICT(workspace_id,connection_id,cache_key) DO UPDATE SET document=EXCLUDED.document,expires_at=EXCLUDED.expires_at`,
      [
        context.workspaceId,
        context.connectionId,
        JSON.stringify(
          options.map((option) => ({ key: this.valueKey(query, option.id), value: option })),
        ),
      ],
    )
  }
  async findOption(context: AdapterContext, query: MetadataQuery, id: string) {
    const cached = (
      await this.database.query<{ document: CatalogOption }>(
        `SELECT document FROM metadata_cache WHERE workspace_id=$1 AND connection_id=$2 AND cache_key=$3 AND expires_at>now()`,
        [context.workspaceId, context.connectionId, this.valueKey(query, id)],
      )
    ).rows[0]
    return cached?.document ?? null
  }
  async findValue(context: AdapterContext, categoryId: string, attributeId: string, id: string) {
    const query = { resource: 'values' as const, categoryId, attributeId }
    const cached = await this.findOption(context, query, id)
    if (cached) return cached
    for (let page = 0; page < 100; page++) {
      const result = await this.get(context, {
        ...query,
        ...(['trendyol', 'hepsiburada'].includes(context.provider) ? { page } : {}),
      })
      const found = result.options?.find((option) => option.id === id)
      if (found) return found
      if (!result.hasMore) break
    }
    return null
  }
}
