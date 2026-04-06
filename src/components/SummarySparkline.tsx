import { formatCompactNumber, formatDate, formatPercent } from '../services/format'
import type { DailyStat } from '../types/trade'

interface SummarySparklineProps {
  stats: DailyStat[]
}

export function SummarySparkline({ stats }: SummarySparklineProps) {
  const series = [...stats]
    .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime())
    .slice(-24)

  if (!series.length) {
    return null
  }

  const width = 640
  const height = 180
  const padding = 18
  const equities = series.map((item) => item.equity)
  const min = Math.min(...equities)
  const max = Math.max(...equities)

  const points = series.map((item, index) => {
    const x = padding + (index / Math.max(series.length - 1, 1)) * (width - padding * 2)
    const y =
      max === min
        ? height / 2
        : height - padding - ((item.equity - min) / (max - min)) * (height - padding * 2)

    return { x, y }
  })

  const line = points.map((point) => `${point.x},${point.y}`).join(' ')
  const area = [
    `${points[0]?.x ?? padding},${height - padding}`,
    ...points.map((point) => `${point.x},${point.y}`),
    `${points.at(-1)?.x ?? width - padding},${height - padding}`,
  ].join(' ')

  const last = series.at(-1)

  return (
    <section className="card chart-card">
      <div className="section-head">
        <div>
          <h3>资金曲线</h3>
          <p>来自导入统计页的最近 24 个权益点位，用来快速看整体节奏。</p>
        </div>
        <div className="chart-card__meta">
          <strong>{formatCompactNumber(last?.equity ?? 0)}</strong>
          <span>{formatPercent(last?.returnRatio ?? 0)}</span>
        </div>
      </div>

      <svg className="sparkline" preserveAspectRatio="none" viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(92, 111, 255, 0.28)" />
            <stop offset="100%" stopColor="rgba(92, 111, 255, 0.02)" />
          </linearGradient>
        </defs>
        <polyline fill="url(#spark-fill)" points={area} stroke="none" />
        <polyline
          fill="none"
          points={line}
          stroke="rgba(92, 111, 255, 0.95)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
        />
      </svg>

      <div className="chart-axis">
        <span>{formatDate(series[0]?.date)}</span>
        <span>{formatDate(last?.date)}</span>
      </div>
    </section>
  )
}
