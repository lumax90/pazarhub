import { useContext } from 'react'
import { SurfaceContext } from '@heroui/react'

/** HeroUI recommends secondary fields on cards/surfaces and primary on the canvas. */
export function useFieldVariant() {
  const surface = useContext(SurfaceContext)
  return surface.variant === 'default' ? ('secondary' as const) : ('primary' as const)
}
