import { Link } from 'react-router-dom'
import { formatDate, formatDateTime, formatDaysLabel, formatEventType, formatMoney } from '../services/format'
import type { DashboardPositionView, LiveQuoteCoverageStatus } from '../types/trade'
import type { RealtimePositionView } from '../services/liveQuotes'

interface PositionCardProps {
  view: DashboardPositionView
  realtime?: RealtimePositionView
}

function coverageLabel(status: LiveQuoteCoverageStatus) {
  if (status === 'full') {
    return '自动估值完整'
  }

  if (status === 'partial') {
    return '部分自动估值'
  }

  return '使用正式估值'
}

export function PositionCard({ view, realtime }: PositionCardProps) {
  const latestEvent = [...view.events].sort(
    (left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime(),
  )[0]
  const metrics = realtime?.metrics ?? view.metrics
  const latestSnapshot = realtime?.snapshot ?? view.latestSnapshot
  const activeLegCount = metrics.legMetrics.filter((item) => item.currentQty > 0).length
  const liveAsOf = realtime?.liveAsOf
  const coverageStatus = realtime?.coverageStatus ?? 'none'

  return (
    <Link className="position-card" to={`/positions/${view.position.id}`}>
      <div className="position-card__header">
        <div>
          <h4>{view.position.strategyName}</h4>
          <p>
            {view.position.underlyingSymbol} · 开仓于 {formatDate(view.position.openedAt)}
          </p>
        </div>
        <span
          className={`status-chip ${view.position.status === 'closed' ? 'status-chip--closed' : ''}`}
        >
          {view.position.status === 'open' ? '持仓中' : '已平仓'}
        </span>
      </div>

      <div className="stats-inline-grid">
        <div className="kv">
          <span>当前浮盈亏</span>
          <strong className={metrics.unrealizedPnl >= 0 ? 'delta-positive' : 'delta-negative'}>
            {formatMoney(metrics.unrealizedPnl)}
          </strong>
        </div>
        <div className="kv">
          <span>已实现盈亏</span>
          <strong className={metrics.realizedPnl >= 0 ? 'delta-positive' : 'delta-negative'}>
            {formatMoney(metrics.realizedPnl)}
          </strong>
        </div>
        <div className="kv">
          <span>持仓明细</span>
          <strong>{activeLegCount}</strong>
        </div>
        <div className="kv">
          <span>到期提醒</span>
          <strong>{formatDaysLabel(view.nearestExpiryDays)}</strong>
        </div>
      </div>

      <div className="position-card__footer">
        <div className="tag-row">
          <span className="pill">{coverageLabel(coverageStatus)}</span>
          {view.position.tags.map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>

        <div className="card-hint">
          <span>
            {liveAsOf ? `行情时间 ${formatDateTime(liveAsOf)}` : `正式估值 ${formatDate(latestSnapshot?.snapshotAt)}`}
          </span>
          {latestEvent ? (
            <span>
              最近事件 {formatEventType(latestEvent.eventType)} · {formatDate(latestEvent.occurredAt)}
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  )
}
