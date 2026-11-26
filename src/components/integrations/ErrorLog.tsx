import { useMemo, useState } from 'react'
import { Chip } from '@heroui/react'
import { Bug } from 'lucide-react'
import { providers } from '../../domain/integrations'
import type { IntegrationErrorEntry } from '../../domain/integrations'
import { operationLabels } from '../../domain/integration-labels'
import { useResource } from '../../lib/useResource'
import { AsyncState } from '../ui/AsyncState'
import { EmptyState, FilterTabs, Panel } from '../ui/shared'

const WORKSPACE = 'workspace'
const providerName = (entry: IntegrationErrorEntry) =>
  providers.find((provider) => provider.id === entry.provider)?.name ?? 'Çalışma alanı'
const time = (value: string) =>
  new Date(value).toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

/** Pretty-prints JSON answers; a cut-off or non-JSON answer stays as it came. */
const readable = (value: string) => {
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

/** Every failed attempt, grouped by marketplace and operation, with the raw provider answer. */
export function ErrorLog() {
  const resource = useResource<{ errors: IntegrationErrorEntry[] }>('/api/integration-errors', 5000)
  const [provider, setProvider] = useState('all'),
    [kind, setKind] = useState('all')
  const errors = useMemo(() => resource.data?.errors ?? [], [resource.data])
  const count = (list: IntegrationErrorEntry[], key: (entry: IntegrationErrorEntry) => string) =>
    list.reduce(
      (counts, entry) => counts.set(key(entry), (counts.get(key(entry)) ?? 0) + 1),
      new Map<string, number>(),
    )
  const byProvider = count(errors, (entry) => entry.provider ?? WORKSPACE)
  const inProvider = errors.filter(
    (entry) => provider === 'all' || (entry.provider ?? WORKSPACE) === provider,
  )
  const byKind = count(inProvider, (entry) => entry.kind)
  const visible = inProvider.filter((entry) => kind === 'all' || entry.kind === kind)
  return (
    <Panel flush className="list-panel">
      <FilterTabs
        label="Pazaryeri"
        value={provider}
        onChange={(value) => {
          setProvider(value)
          setKind('all')
        }}
        items={[
          { id: 'all', label: 'Tüm kaynaklar', count: errors.length },
          ...[...byProvider].map(([id, total]) => ({
            id,
            label:
              id === WORKSPACE ? 'Çalışma alanı' : (providers.find((p) => p.id === id)?.name ?? id),
            count: total,
          })),
        ]}
      />
      {byKind.size > 1 && (
        <FilterTabs
          label="İşlem türü"
          value={kind}
          onChange={setKind}
          items={[
            { id: 'all', label: 'Tüm işlemler', count: inProvider.length },
            ...[...byKind].map(([id, total]) => ({
              id,
              label: operationLabels[id as IntegrationErrorEntry['kind']] ?? id,
              count: total,
            })),
          ]}
        />
      )}
      <AsyncState
        loading={resource.loading}
        error={resource.error}
        retry={() => void resource.reload()}
      />
      {!resource.loading && !visible.length ? (
        <EmptyState
          title="Hata kaydı yok"
          description="Başarısız her deneme sağlayıcının cevabıyla birlikte burada görünür. Kayıtlar 30 gün tutulur."
          icon={<Bug size={27} />}
        />
      ) : (
        <ol className="error-log">
          {visible.map((entry) => (
            <li key={entry.id}>
              <details className="error-log-entry">
                <summary>
                  <time dateTime={entry.createdAt}>{time(entry.createdAt)}</time>
                  <span>{providerName(entry)}</span>
                  <span>{operationLabels[entry.kind] ?? entry.kind}</span>
                  <Chip size="sm" variant="soft" color="danger">
                    {entry.status ? `${entry.code} · ${entry.status}` : entry.code}
                  </Chip>
                  <span className="error-log-message">{entry.message}</span>
                </summary>
                <dl className="detail-list">
                  {entry.connectionName && (
                    <div>
                      <dt>Bağlantı</dt>
                      <dd>{entry.connectionName}</dd>
                    </div>
                  )}
                  {entry.request && (
                    <div>
                      <dt>İstek</dt>
                      <dd className="code-text">{entry.request}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Deneme</dt>
                    <dd>{entry.attempt}</dd>
                  </div>
                  {entry.jobId && (
                    <div>
                      <dt>İşlem kimliği</dt>
                      <dd className="code-text">{entry.jobId}</dd>
                    </div>
                  )}
                </dl>
                {entry.response && (
                  <section>
                    <h4>Sağlayıcının cevabı</h4>
                    <pre>{readable(entry.response)}</pre>
                  </section>
                )}
                {entry.cause && (
                  <section>
                    <h4>Uygulama hatası</h4>
                    <pre>{entry.cause}</pre>
                  </section>
                )}
              </details>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}
