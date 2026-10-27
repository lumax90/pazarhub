import { useId, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Product, Variant } from '../../domain/types'
import { imagesForVariant } from '../../domain/product-images'

export function ProductArt({
  product,
  className = '',
  variant,
}: {
  product: Pick<Product, 'art' | 'color' | 'name' | 'images' | 'variantAxes' | 'imageMetadata'>
  variant?: Pick<Variant, 'options'>
  className?: string
}) {
  const uid = useId().replaceAll(':', '')
  const [failed, setFailed] = useState('')
  const image = imagesForVariant(product, variant)[0]
  if (image && failed !== image)
    return (
      <div className={`product-art product-art--photo ${className}`}>
        <img
          src={image}
          alt={product.imageMetadata?.[image]?.alt || product.name}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(image)}
        />
      </div>
    )
  return (
    <div
      className={`product-art product-art--${product.art} ${className}`}
      style={{ '--product-color': product.color } as CSSProperties}
    >
      <svg viewBox="0 0 120 120" role="img" aria-label={product.name}>
        <defs>
          <linearGradient id={`${uid}-surface`} x1="0" y1="0" x2="1" y2="0">
            <stop stopColor="white" stopOpacity=".4" />
            <stop offset=".46" stopColor="white" stopOpacity=".05" />
            <stop offset="1" stopColor="#111827" stopOpacity=".2" />
          </linearGradient>
          <filter id={`${uid}-shadow`} x="-60%" y="-60%" width="220%" height="240%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>
        <ellipse
          cx="61"
          cy="98"
          rx="29"
          ry="5"
          fill="#493a2e"
          opacity=".12"
          filter={`url(#${uid}-shadow)`}
        />
        <g fill={product.color}>
          {product.art === 'vase' && (
            <>
              <path d="M46 22h28v18c0 13 15 18 17 33 2 15-7 24-30 24S28 89 30 74c2-16 16-22 16-34Z" />
              <path
                d="M46 22h28v18c0 13 15 18 17 33 2 15-7 24-30 24S28 89 30 74c2-16 16-22 16-34Z"
                fill={`url(#${uid}-surface)`}
              />
              <ellipse cx="60" cy="22" rx="14" ry="4" fill="#716454" />
              <ellipse cx="60" cy="22" rx="11" ry="2.3" fill="#51483f" />
              <path
                d="M39 78c3-10 9-15 12-22"
                fill="none"
                stroke="white"
                opacity=".18"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </>
          )}
          {product.art === 'cup' && (
            <>
              <g transform="translate(13 5)">
                <path
                  d="M68 51c22-4 24 29 0 29"
                  fill="none"
                  stroke={product.color}
                  strokeWidth="8"
                />
                <path d="M25 45h45v37c0 17-45 17-45 0Z" />
                <path d="M25 45h45v37c0 17-45 17-45 0Z" fill={`url(#${uid}-surface)`} />
                <ellipse cx="47.5" cy="45" rx="22.5" ry="7" fill="#bdc9c5" />
                <ellipse cx="47.5" cy="45" rx="18" ry="4.5" fill="#695243" />
              </g>
              <path d="M29 89c-8-2-10-13-4-18" stroke="#c3d0c9" strokeWidth="5" fill="none" />
            </>
          )}
          {product.art === 'lamp' && (
            <>
              <ellipse cx="60" cy="95" rx="24" ry="5" />
              <path d="M56 49h8v46h-8z" />
              <path d="M24 53c1-44 71-44 72 0Z" />
              <path d="M24 53c1-44 71-44 72 0Z" fill={`url(#${uid}-surface)`} />
              <ellipse cx="60" cy="53" rx="36" ry="7" fill="#f8ecd8" />
              <ellipse cx="60" cy="53" rx="31" ry="4" fill="#ffe7aa" />
              <path
                d="M41 34c4-7 10-10 18-11"
                stroke="#fff"
                strokeOpacity=".3"
                strokeWidth="3"
                strokeLinecap="round"
                fill="none"
              />
            </>
          )}
          {product.art === 'bag' && (
            <>
              <path d="M31 42h58l-3 53H34Z" />
              <path d="M31 42h58l-3 53H34Z" fill={`url(#${uid}-surface)`} />
              <path
                d="M45 46V33c0-21 30-21 30 0v13"
                fill="none"
                stroke={product.color}
                strokeWidth="6"
              />
              <path d="M37 46v43m44-43v43" stroke="#fff" strokeOpacity=".25" fill="none" />
              <text x="60" y="70" fill="#655a4b" textAnchor="middle" fontSize="7" letterSpacing="2">
                NORTH
              </text>
              <path d="M52 75h16" stroke="#655a4b" strokeWidth=".7" />
            </>
          )}
          {product.art === 'candle' && (
            <>
              <path d="M35 36h50v53c0 13-50 13-50 0Z" />
              <path d="M35 36h50v53c0 13-50 13-50 0Z" fill={`url(#${uid}-surface)`} />
              <ellipse cx="60" cy="36" rx="25" ry="6" fill="#e8dfd2" />
              <ellipse cx="60" cy="36" rx="21" ry="4" fill="#f7edda" />
              <path d="M60 36v-6" stroke="#6c4f39" strokeWidth="1.5" />
              <path d="M60 29c-8-8 2-10 0-15 12 8 5 11 0 15" fill="#edc275" />
              <rect x="43" y="54" width="34" height="25" rx="1" fill="#f3eee5" />
              <text
                x="60"
                y="65"
                textAnchor="middle"
                fill="#59544c"
                fontSize="6"
                letterSpacing="1.4"
              >
                MYSA
              </text>
              <text
                x="60"
                y="72"
                textAnchor="middle"
                fill="#999184"
                fontSize="3.3"
                letterSpacing="1"
              >
                CEDAR & BERGAMOT
              </text>
            </>
          )}
          {product.art === 'bowl' && (
            <>
              <path d="M20 53c3 29 15 41 40 41s37-12 40-41Z" />
              <path d="M20 53c3 29 15 41 40 41s37-12 40-41Z" fill={`url(#${uid}-surface)`} />
              <ellipse cx="60" cy="53" rx="40" ry="14" fill="#d6aa94" />
              <ellipse cx="60" cy="53" rx="34" ry="10" fill="#a87961" />
              <path
                d="M29 66c5 13 12 18 21 20"
                fill="none"
                stroke="white"
                strokeOpacity=".2"
                strokeWidth="2"
              />
            </>
          )}
          {product.art === 'towel' && (
            <>
              <path d="m22 49 61-8 18 15-64 8Z" fill="#c9ccbf" />
              <path d="m23 49 14 15v29L22 80Z" fill="#989e8e" />
              <path d="m37 64 64-8v29l-64 8Z" />
              <path d="m37 64 64-8v29l-64 8Z" fill={`url(#${uid}-surface)`} />
              <path
                d="m40 78 57-7m-57 10 57-7m-57 10 57-7m-57 10 57-7"
                stroke="white"
                strokeOpacity=".25"
                strokeWidth="1.2"
              />
              <path d="m31 43 53-6 9 8-55 7Z" fill="#d8d9cf" />
            </>
          )}
          {product.art === 'tray' && (
            <>
              <ellipse cx="60" cy="71" rx="47" ry="23" fill="#906c46" />
              <ellipse cx="60" cy="65" rx="47" ry="23" />
              <ellipse cx="60" cy="65" rx="40" ry="17" fill="#d1ae80" />
              <ellipse cx="60" cy="65" rx="40" ry="17" fill={`url(#${uid}-surface)`} />
              <path
                d="M29 63c22-7 40-6 63 3M33 70c14-3 28-3 44-1M39 57c13-2 22-2 36 1"
                stroke="#a77e53"
                strokeOpacity=".4"
                strokeWidth="1.1"
                fill="none"
              />
            </>
          )}
        </g>
      </svg>
    </div>
  )
}
