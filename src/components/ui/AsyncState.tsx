import { Button } from '@heroui/react'
import { CircleAlert, RefreshCw } from 'lucide-react'

export function AsyncState({
  loading,
  error,
  retry,
}: {
  loading?: boolean
  error?: string
  retry?: () => void
}) {
  if (error)
    return (
      <div className="resource-error" role="alert">
        <CircleAlert size={20} />
        <span>{error}</span>
        {retry && (
          <Button size="sm" variant="secondary" onPress={retry}>
            Yeniden dene
          </Button>
        )}
      </div>
    )
  if (loading)
    return (
      <div className="resource-loading" role="status">
        <RefreshCw size={18} className="spin" />
        Veriler yükleniyor…
      </div>
    )
  return null
}
