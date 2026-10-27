import { useState } from 'react'
import { Button, Chip } from '@heroui/react'
import { Copy, Plus, ShieldCheck, Users } from 'lucide-react'
import { useApp } from '../app/AppProvider'
import { roleLabels, rolePermissions } from '../domain/permissions'
import type { Role } from '../domain/permissions'
import { apiRequest } from '../lib/api'
import { useResource } from '../lib/useResource'
import { dateLabel } from '../lib/format'
import { DataTable } from '../components/ui/DataTable'
import { AsyncState } from '../components/ui/AsyncState'
import { Dialog, EmptyState, Field, PageHeader, Panel, SelectButton } from '../components/ui/shared'

interface Member {
  id: string
  name: string
  email: string
  role: Role
  active: boolean
}
interface Invitation {
  id: string
  email: string
  role: Role
  expires_at: string
}
export function TeamPage() {
  const { session, mode, notify, can } = useApp()
  const resource = useResource<{ members: Member[]; invitations: Invitation[] }>(
    can('team.manage') ? '/api/team' : null,
  )
  const [open, setOpen] = useState(false),
    [email, setEmail] = useState(''),
    [role, setRole] = useState<Role>('operator'),
    [link, setLink] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const roles = Object.entries(roleLabels)
    .filter(([id]) => id !== 'owner' && (session?.user?.role === 'owner' || id !== 'manager'))
    .map(([id, label]) => ({ id, label }))
  const invite = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = await apiRequest<{ url: string }>('/api/team/invitations', {
        method: 'POST',
        body: { email, role },
      })
      setLink(result.url)
      await resource.reload()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Davet oluşturulamadı.')
    } finally {
      setBusy(false)
    }
  }
  const changeRole = async (member: Member, next: Role) => {
    try {
      await apiRequest(`/api/team/${member.id}`, { method: 'PATCH', body: { role: next } })
      notify('Kullanıcı rolü güncellendi.')
      await resource.reload()
    } catch (problem) {
      notify(problem instanceof Error ? problem.message : 'Rol güncellenemedi.', 'error')
    }
  }
  const revoke = async (path: string) => {
    try {
      await apiRequest(path, { method: 'DELETE' })
      await resource.reload()
      notify('Erişim kaldırıldı.')
    } catch (problem) {
      notify(problem instanceof Error ? problem.message : 'Erişim kaldırılamadı.', 'error')
    }
  }
  if (mode === 'demo' || !can('team.manage'))
    return (
      <>
        <PageHeader title="Kullanıcılar ve Roller" />
        <Panel>
          <EmptyState
            title={
              mode === 'demo'
                ? 'Ekibinizi gerçek çalışma alanına davet edin'
                : 'Bu sayfa için yönetici yetkisi gerekli'
            }
            description="Her kullanıcıya görevine uygun erişim verilir."
            icon={<Users size={26} />}
          />
        </Panel>
      </>
    )
  return (
    <>
      <PageHeader
        title="Kullanıcılar ve Roller"
        description="Ekibinizin çalışma alanı erişimini tek yerden yönetin."
        actions={
          <Button
            variant="primary"
            onPress={() => {
              setOpen(true)
              setLink('')
              setError('')
            }}
          >
            <Plus size={16} />
            Kullanıcı davet et
          </Button>
        }
      />
      <AsyncState
        loading={resource.loading}
        error={resource.error}
        retry={() => void resource.reload()}
      />
      <Panel flush className="list-panel">
        <DataTable
          label="Çalışma alanı ekibi"
          items={resource.data?.members ?? []}
          columns={[
            {
              id: 'name',
              label: 'Kullanıcı',
              rowHeader: true,
              cell: (m) => (
                <div>
                  <strong>{m.name}</strong>
                  <span className="cell-secondary">{m.email}</span>
                </div>
              ),
            },
            {
              id: 'role',
              label: 'Rol',
              cell: (m) =>
                m.role === 'owner' || m.id === session?.user?.id ? (
                  <Chip variant="soft" color="accent" size="sm">
                    {roleLabels[m.role]}
                  </Chip>
                ) : (
                  <SelectButton
                    label={`${m.name} rolü`}
                    value={m.role}
                    onChange={(value) => void changeRole(m, value as Role)}
                    options={roles}
                  />
                ),
            },
            {
              id: 'permissions',
              label: 'Erişim',
              cell: (m) => (
                <span className="muted-cell">{rolePermissions[m.role].length} yetki</span>
              ),
            },
            {
              id: 'remove',
              label: '',
              cell: (m) =>
                m.role !== 'owner' &&
                m.id !== session?.user?.id && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onPress={() => void revoke(`/api/team/${m.id}`)}
                  >
                    Erişimi kaldır
                  </Button>
                ),
            },
          ]}
        />
      </Panel>
      <Panel flush title="Bekleyen davetler" className="accounting-secondary">
        <DataTable
          label="Bekleyen kullanıcı davetleri"
          items={resource.data?.invitations ?? []}
          columns={[
            { id: 'email', label: 'E-posta', rowHeader: true, cell: (i) => i.email },
            { id: 'role', label: 'Rol', cell: (i) => roleLabels[i.role] },
            { id: 'expires', label: 'Geçerlilik', cell: (i) => dateLabel(i.expires_at, true) },
            {
              id: 'cancel',
              label: '',
              cell: (i) => (
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() => void revoke(`/api/team/invitations/${i.id}`)}
                >
                  Daveti iptal et
                </Button>
              ),
            },
          ]}
        />
      </Panel>
      {open && (
        <Dialog
          open
          title="Kullanıcı davet et"
          description="Bağlantı 24 saat geçerlidir ve davet edilen e-posta hesabına özeldir."
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button variant="secondary" onPress={() => setOpen(false)}>
                Kapat
              </Button>
              {!link && (
                <Button variant="primary" isDisabled={busy} onPress={() => void invite()}>
                  Davet oluştur
                </Button>
              )}
            </>
          }
        >
          {link ? (
            <div className="form-section">
              <span className="team-link">{link}</span>
              <Button
                variant="secondary"
                onPress={() =>
                  void navigator.clipboard
                    .writeText(link)
                    .then(() => notify('Davet bağlantısı kopyalandı.'))
                    .catch(() => notify('Bağlantıyı seçerek kopyalayabilirsiniz.', 'info'))
                }
              >
                <Copy size={15} />
                Bağlantıyı kopyala
              </Button>
            </div>
          ) : (
            <div className="form-section">
              <Field type="email" label="E-posta" value={email} onChange={setEmail} required />
              <SelectButton
                label="Davet edilecek rol"
                value={role}
                onChange={(value) => setRole(value as Role)}
                options={roles}
              />
              <p className="description field-description">
                <ShieldCheck size={14} /> Roller sunucu tarafında her işlemde kontrol edilir.
              </p>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
            </div>
          )}
        </Dialog>
      )}
    </>
  )
}
