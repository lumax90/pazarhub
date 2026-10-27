import { useId, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { compactMoney, dateLabel, dayKey, money } from '../../lib/format'
import { motionTransitions } from '../../lib/motion'

export interface ChartPoint {
  date: string
  amount: number
  orders: number
}

export function RevenueChart({ data }: { data: ChartPoint[] }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const reduced = useReducedMotion()
  const fillId = `revenue-${useId().replaceAll(':', '')}`
  const periodKey = data.map((point) => dayKey(point.date)).join('|')
  const width = 780,
    height = 200
  const max = Math.max(
    100000,
    Math.ceil(Math.max(...data.map((point) => point.amount)) / 100000) * 100000,
  )
  const points = data.map((point, index) => ({
    x: (index * width) / Math.max(1, data.length - 1),
    y: height - (point.amount / max) * (height - 14),
  }))
  const path = points
    .map((point, index) => {
      if (!index) return `M ${point.x} ${point.y}`
      const previous = points[index - 1]
      const midpoint = (previous.x + point.x) / 2
      return `C ${midpoint} ${previous.y}, ${midpoint} ${point.y}, ${point.x} ${point.y}`
    })
    .join(' ')
  const selected = hovered === null ? null : data[hovered]
  const selectedPoint = hovered === null ? null : points[hovered]
  const labels = [
    ...new Set([
      0,
      Math.round((data.length - 1) * 0.25),
      Math.round((data.length - 1) * 0.5),
      Math.round((data.length - 1) * 0.75),
      data.length - 1,
    ]),
  ]
  return (
    <div className="revenue-chart">
      <div className="chart-axis-y">
        {[1, 0.75, 0.5, 0.25, 0].map((fraction) => (
          <span key={fraction}>{compactMoney(max * fraction)}</span>
        ))}
      </div>
      <div
        className="chart-plot"
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect()
          setHovered(
            Math.min(
              data.length - 1,
              Math.max(0, Math.round(((event.clientX - box.left) / box.width) * (data.length - 1))),
            ),
          )
        }}
        onPointerLeave={() => setHovered(null)}
      >
        <svg
          viewBox={`0 0 ${width} ${height + 2}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${data.length} günlük satış grafiği. Toplam ${money(data.reduce((sum, point) => sum + point.amount, 0))}.`}
        >
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity=".18" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
            <line
              key={fraction}
              x1="0"
              x2={width}
              y1={fraction * height}
              y2={fraction * height}
              className="chart-grid-line"
            />
          ))}
          <motion.path
            key={`fill-${periodKey}`}
            d={`${path} L ${width} ${height} L 0 ${height} Z`}
            fill={`url(#${fillId})`}
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={reduced ? { duration: 0 } : motionTransitions.reveal}
          />
          <motion.path
            key={`line-${periodKey}`}
            data-chart-line="true"
            d={path}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2.6"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            initial={reduced ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={reduced ? { duration: 0 } : motionTransitions.chart}
          />
          {selectedPoint && (
            <>
              <line
                x1={selectedPoint.x}
                x2={selectedPoint.x}
                y1="0"
                y2={height}
                stroke="var(--accent)"
                strokeOpacity=".3"
                strokeDasharray="4 5"
              />
              <circle
                cx={selectedPoint.x}
                cy={selectedPoint.y}
                r="5"
                fill="var(--accent)"
                stroke="var(--surface)"
                strokeWidth="3"
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
        </svg>
        <AnimatePresence initial={false}>
          {selected && selectedPoint && (
            <motion.div
              key="tooltip"
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={reduced ? { duration: 0 } : motionTransitions.feedback}
              className={`chart-tooltip ${selectedPoint.x / width > 0.75 ? 'align-right' : ''}`}
              style={{
                left: `${(selectedPoint.x / width) * 100}%`,
                top: `${Math.min(62, (selectedPoint.y / height) * 100)}%`,
              }}
            >
              <span>{dateLabel(selected.date)}</span>
              <strong>
                <i />
                {money(selected.amount)}
              </strong>
              <small>{selected.orders} sipariş</small>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="chart-axis-x">
          {labels.map((index) => (
            <span key={index}>{dateLabel(data[index].date)}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
