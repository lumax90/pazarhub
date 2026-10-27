import { useEffect, useState } from 'react'
import { Avatar } from '@heroui/react'

// DiceBear "Glass" (CC0): a soft gradient orb rendered locally from a seed. The
// generator carries a schema validator, so it loads as its own chunk after first paint.
let generator: Promise<(seed: string) => string> | undefined
const loadGenerator = () =>
  (generator ??= Promise.all([
    import('@dicebear/core'),
    import('@dicebear/styles/glass.json'),
  ]).then(([{ Avatar: Generated, Style }, { default: glass }]) => {
    const style = new Style(glass)
    return (seed: string) => new Generated(style, { seed }).toDataUri()
  }))
const pictures = new Map<string, string>()

function usePicture(seed: string) {
  const [loaded, setLoaded] = useState<{ seed: string; uri: string }>()
  useEffect(() => {
    if (pictures.has(seed)) return
    let live = true
    void loadGenerator().then((render) => {
      const uri = render(seed)
      pictures.set(seed, uri)
      if (live) setLoaded({ seed, uri })
    })
    return () => {
      live = false
    }
  }, [seed])
  return pictures.get(seed) ?? (loaded?.seed === seed ? loaded.uri : undefined)
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => Array.from(part)[0]?.toLocaleUpperCase('tr-TR'))
    .join('')

/**
 * A person's avatar: the same seed (user id) always gives the same picture, and
 * the initials show until it is ready. The frame is the native HeroUI Avatar.
 */
export function UserAvatar({
  name,
  seed,
  size = 'sm',
  className,
}: {
  name: string
  seed: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const src = usePicture(seed)
  return (
    <Avatar size={size} className={className}>
      {src && <Avatar.Image src={src} alt="" />}
      <Avatar.Fallback>{initials(name)}</Avatar.Fallback>
    </Avatar>
  )
}
