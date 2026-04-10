import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BackupPanel } from '../components/BackupPanel'
import { useTradeData } from '../components/TradeDataProvider'
import { calculatePositionMetrics } from '../services/calculations'
import { formatAccountName, formatDate, formatMoney } from '../services/format'
import type { AccountType, PositionStatus, StrategyPosition } from '../types/trade'

export function PositionListPage() {
  const { bundle, isLoading, error } = useTradeData()
  const [search, setSearch] = useState('')
  const [accountType, setAccountType] = useState<AccountType | 'all'>('all')
  const [status, setStatus] = useState<PositionStatus | 'all'>('all')

  const positions = useMemo(() => {
    let items = bundle.positions

    if (accountType !== 'all') {
      items = items.filter((p) => p.accountType === accountType)
    }

    if (status !== 'all') {
      items = items.filter((p) => p.status === status)
    }

    if (search.trim()) {
      const keyword = search.trim().toLowerCase()
      items = items.filter((p) => matchesSearch(p, keyword, bundle.legs.map((l) => l.contractCode)))
    }

    return items
      .map((p) => {
        const legs = bundle.legs.filter((l) => l.positionId === p.id)
        const events = bundle.events.filter((e) => e.positionId === p.id)
        const snapshots = bundle.priceSnapshots.filter((s) => s.positionId === p.id)
        const latestSnapshot = snapshots.length
          ? snapshots.reduce((a, b) => (a.snapshotAt > b.snapshotAt ? a : b))
          : undefined
        const metrics = calculatePositionMetrics(legs, events, latestSnapshot)
        return { position: p, metrics }
      })
      .sort((a, b) => {
        if (a.position.status === 'open' && b.position.status !== 'open') return -1
        if (a.position.status !== 'open' && b.position.status === 'open') return 1
        return new Date(b.position.openedAt).getTime() - new Date(a.position.openedAt).getTime()
      })
  }, [bundle, search, accountType, status])

  const counts = useMemo(() => {
    const open = bundle.positions.filter((p) => p.status === 'open').length
    const closed = bundle.positions.filter((p) => p.status === 'closed').length
    return { total: bundle.positions.length, open, closed }
  }, [bundle.positions])

  if (isLoading) {
    return <div className="empty-state">加载中...</div>
  }

  if (error) {
    return <div className="notice-banner">{error}</div>
  }

  return (
    <div className="page-sections">
      <div className="card">
        <div className="section-head">
          <h3>筛选</h3>
        </div>
        <div className="filter-bar">
          <input
            className="input"
            placeholder="搜索策略名、品种、合约、标签..."
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="input"
            value={accountType}
            onChange={(e) => setAccountType(e.target.value as AccountType | 'all')}
          >
            <option value="all">全部账户</option>
            <option value="live">实盘</option>
            <option value="paper">模拟</option>
          </select>
          <select
            className="input"
            value={status}
            onChange={(e) => setStatus(e.target.value as PositionStatus | 'all')}
          >
            <option value="all">全部状态</option>
            <option value="open">持仓中</option>
            <option value="closed">已平仓</option>
          </select>
        </div>
        <p className="subtle">
          共 {counts.total} 条记录，{counts.open} 条持仓中，{counts.closed} 条已平仓
        </p>
      </div>

      {positions.length === 0 ? (
        <div className="empty-state">
          <p>{bundle.positions.length === 0 ? '暂无持仓记录，点击上方「开仓」开始' : '没有匹配的记录'}</p>
        </div>
      ) : (
        <div className="position-list">
          {positions.map(({ position, metrics }) => (
            <Link
              key={position.id}
              className="position-list__item"
              to={`/positions/${position.id}`}
            >
              <div className="position-list__header">
                <strong>{position.strategyName}</strong>
                <span className={`status-chip status-chip--${position.status}`}>
                  {position.status === 'open' ? '持仓中' : '已平仓'}
                </span>
              </div>
              <div className="position-list__meta">
                <span>{formatAccountName(position.accountType)}</span>
                <span>{position.product}</span>
                <span>{position.underlyingSymbol}</span>
                <span>{formatDate(position.openedAt)}</span>
              </div>
              <div className="position-list__pnl">
                {metrics.unrealizedPnl !== 0 && (
                  <span className={metrics.unrealizedPnl >= 0 ? 'text-profit' : 'text-loss'}>
                    浮盈 {formatMoney(metrics.unrealizedPnl)}
                  </span>
                )}
                {metrics.realizedPnl !== 0 && (
                  <span className={metrics.realizedPnl >= 0 ? 'text-profit' : 'text-loss'}>
                    已实现 {formatMoney(metrics.realizedPnl)}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      <details className="card card--soft">
        <summary className="section-head">
          <h3>数据管理</h3>
        </summary>
        <BackupPanel />
      </details>
    </div>
  )
}

function matchesSearch(position: StrategyPosition, keyword: string, contractCodes: string[]): boolean {
  const fields = [
    position.strategyName,
    position.product,
    position.underlyingSymbol,
    position.remarks,
    ...position.tags,
    ...contractCodes,
  ]
  return fields.some((field) => field?.toLowerCase().includes(keyword))
}
