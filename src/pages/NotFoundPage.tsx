import { Button } from '@heroui/react'
import { ArrowLeft, SearchX } from 'lucide-react'
import { useNavigate } from 'react-router'
import { EmptyState } from '../components/ui/shared'

export function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <div className="not-found-page">
      <EmptyState
        title="Bu sayfa yerinde yok."
        description="Adres değişmiş olabilir. Çalışma alanınıza geri dönelim."
        icon={<SearchX size={32} />}
        action={
          <Button variant="primary" onPress={() => navigate('/dashboard')}>
            <ArrowLeft size={16} />
            Dashboard’a dön
          </Button>
        }
      />
    </div>
  )
}
