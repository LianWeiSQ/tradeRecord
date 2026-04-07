import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BackupPanel } from '../components/BackupPanel'
import { useLiveQuotes } from '../components/LiveQuotesProvider'
import { useTradeData } from '../components/TradeDataProvider'
import { PositionCard } from '../components/PositionCard'
import { SummarySparkline } from '../components/SummarySparkline'
import { buildDashboardGroups } from '../services/dashboard'
import { buildRealtimePositionView } from '../services/liveQuotes'
import {
  formatAccountName,
  formatDate,
  formatDateTime,
  formatEventType,
  formatMoney,
} from '../services/format'
import { buildWorkItems, matchesPositionSearch } from '../services/workbench'
import type {
  DashboardFilterState,
  DashboardGroupView,
  RecentActivityView,
} from '../types/trade'

const defaultFilters: DashboardFilterState = {
  accountType: 'all',
  product: 'all',
  status: 'all',
  range: 'all',
  search: '',
}

function withinRange(openedAt: string, range: DashboardFilterState['range']) {
  if (range === 'all') {
    return true
  }

  const days = range === '30d' ? 30 : 90
  const opened = new Date(openedAt)
  const now = new Date()
  const diff = now.getTime() - opened.getTime()
  return diff <= days * 24 * 60 * 60 * 1000
}

function buildRecentActivities(groups: DashboardGroupView[]): RecentActivityView[] {
  const positions = groups.flatMap((group) => group.positions)
  const activities: RecentActivityView[] = []

  for (const view of positions) {
    activities.push({
      id: `open-${view.position.id}`,
      type: 'open',
      title: `开仓 / ${view.position.strategyName}`,
      subtitle: `${formatAccountName(view.position.accountType)} / ${view.position.product} / ${view.position.underlyingSymbol}`,
      occurredAt: view.position.openedAt,
      amountLabel: `${view.legs.length} 条腿`,
    })

    for (const event of view.events.filter((item) => !item.isInitial)) {
      activities.push({
        id: event.id,
        type: 'event',
        title: `${formatEventType(event.eventType)} / ${view.position.strategyName}`,
        subtitle: event.note || `${view.position.product} / ${view.position.underlyingSymbol}`,
        occurredAt: event.occurredAt,
        amountLabel: `${event.legChanges.length} 条变动`,
      })
    }

    if (view.latestSnapshot) {
      activities.push({
        id: view.latestSnapshot.id,
        type: 'valuation',
        title: `估值 / ${view.position.strategyName}`,
        subtitle: `${view.position.product} / ${view.position.underlyingSymbol}`,
        occurredAt: view.latestSnapshot.snapshotAt,
        amountLabel: formatMoney(view.metrics.unrealizedPnl),
      })
    }
  }

  return activities
    .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime())
    .slice(0, 8)
}

function coverageLabel(status: 'full' | 'partial' | 'none') {
  if (status === 'full') {
    return '自动估值完整'
  }

  if (status === 'partial') {
    return '部分自动估值'
  }

  return '仅正式估值'
}

export function DashboardPage() {
  const [filters, setFilters] = useState<DashboardFilterState>(defaultFilters)
  const { health, isRefreshing, lastSynchronizedAt, liveQuotes, refreshQuotes } = useLiveQuotes()
  const { bundle, isLoading, error } = useTradeData()

  const groups = useMemo(
    () => buildDashboardGroups(bundle.positions, bundle.legs, bundle.events, bundle.priceSnapshots),
    [bundle],
  )

  const productOptions = useMemo(
    () =>
      [...new Set(groups.map((group) => group.product))].sort((left, right) =>
        left.localeCompare(right, 'zh-CN'),
      ),
    [groups],
  )

  const filteredGroups = useMemo(
    () =>
      groups
        .filter((group) => filters.accountType === 'all' || group.accountType === filters.accountType)
        .filter((group) => filters.product === 'all' || group.product === filters.product)
        .map((group) => ({
          ...group,
          positions: group.positions.filter(
            (view) =>
              (filters.status === 'all' || view.position.status === filters.status) &&
              withinRange(view.position.openedAt, filters.range) &&
              matchesPositionSearch(view.position, view.legs, filters.search),
          ),
        }))
        .filter((group) => group.positions.length),
    [filters.accountType, filters.product, filters.range, filters.search, filters.status, groups],
  )

  const realtimeGroups = useMemo(
    () =>
      filteredGroups.map((group) => {
        const positions = group.positions.map((view) => ({
          view,
          realtime: buildRealtimePositionView(view, liveQuotes.get(view.position.id)),
        }))

        return {
          ...group,
          positions,
          totalUnrealizedPnl: positions.reduce((sum, item) => sum + item.realtime.metrics.unrealizedPnl, 0),
          totalRealizedPnl: positions.reduce((sum, item) => sum + item.realtime.metrics.realizedPnl, 0),
          latestSnapshotAt: positions
            .map((item) => item.realtime.snapshot?.snapshotAt)
            .filter((value): value is string => Boolean(value))
            .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0],
        }
      }),
    [filteredGroups, liveQuotes],
  )

  const filteredViews = useMemo(
    () => filteredGroups.flatMap((group) => group.positions),
    [filteredGroups],
  )

  const workItems = useMemo(() => buildWorkItems(filteredViews).slice(0, 8), [filteredViews])
  const recentActivities = useMemo(() => buildRecentActivities(filteredGroups), [filteredGroups])

  const overview = useMemo(() => {
    const positions = realtimeGroups.flatMap((group) => group.positions)

    return {
      openCount: positions.filter((item) => item.view.position.status === 'open').length,
      totalUnrealizedPnl: positions.reduce((sum, item) => sum + item.realtime.metrics.unrealizedPnl, 0),
      totalRealizedPnl: positions.reduce((sum, item) => sum + item.realtime.metrics.realizedPnl, 0),
      totalGroups: new Set(positions.map((item) => item.view.position.product)).size,
      latestFormalSnapshotAt: positions
        .map((item) => item.view.latestSnapshot?.snapshotAt)
        .filter((value): value is string => Boolean(value))
        .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0],
      autoCoveredCount: positions.filter((item) => item.realtime.coverageStatus !== 'none').length,
    }
  }, [realtimeGroups])

  const allPositions = useMemo(
    () =>
      realtimeGroups
        .flatMap((group) => group.positions)
        .sort(
          (left, right) =>
            new Date(right.view.position.updatedAt).getTime() -
            new Date(left.view.position.updatedAt).getTime(),
        ),
    [realtimeGroups],
  )

  return (
    <>
      {error ? <div className="notice-banner">{error}</div> : null}

      <section className="page-intro">
        <div>
          <h2>交易总览</h2>
          <p>先看工作清单和当前仓位，再进入详情页补事件、估值和复盘。</p>
        </div>
        <div className="hero-actions">
          <button className="btn btn--secondary" type="button" onClick={() => void refreshQuotes()}>
            {isRefreshing ? '刷新中...' : '立即刷新行情'}
          </button>
          <Link className="btn" to="/positions/new">
            去开仓
          </Link>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <div>
            <h3>筛选与搜索</h3>
            <p>支持按账户、品种、状态、时间和关键字过滤。关键字会匹配合约、策略名、标签和备注。</p>
          </div>
        </div>

        <div className="filter-bar">
          <div className="field">
            <label htmlFor="dashboard-account">账户</label>
            <select
              id="dashboard-account"
              value={filters.accountType}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  accountType: event.target.value as DashboardFilterState['accountType'],
                }))
              }
            >
              <option value="all">全部账户</option>
              <option value="live">实盘</option>
              <option value="paper">模拟</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="dashboard-product">品种</label>
            <select
              id="dashboard-product"
              value={filters.product}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  product: event.target.value,
                }))
              }
            >
              <option value="all">全部品种</option>
              {productOptions.map((product) => (
                <option key={product} value={product}>
                  {product}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="dashboard-status">状态</label>
            <select
              id="dashboard-status"
              value={filters.status}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  status: event.target.value as DashboardFilterState['status'],
                }))
              }
            >
              <option value="all">全部状态</option>
              <option value="open">持仓中</option>
              <option value="closed">已平仓</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="dashboard-range">时间</label>
            <select
              id="dashboard-range"
              value={filters.range}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  range: event.target.value as DashboardFilterState['range'],
                }))
              }
            >
              <option value="all">全部时间</option>
              <option value="30d">近 30 天</option>
              <option value="90d">近 90 天</option>
            </select>
          </div>

          <div className="field field--wide">
            <label htmlFor="dashboard-search">搜索</label>
            <input
              id="dashboard-search"
              placeholder="搜索合约、策略名、标签或备注"
              value={filters.search}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  search: event.target.value,
                }))
              }
            />
          </div>
        </div>
      </section>

      <section className="metric-grid">
        <article className="metric-card metric-card--accent">
          <span>未平仓数</span>
          <strong>{overview.openCount}</strong>
        </article>
        <article className="metric-card">
          <span>当前实时浮盈亏</span>
          <strong className={overview.totalUnrealizedPnl >= 0 ? 'delta-positive' : 'delta-negative'}>
            {formatMoney(overview.totalUnrealizedPnl)}
          </strong>
        </article>
        <article className="metric-card">
          <span>已实现盈亏</span>
          <strong className={overview.totalRealizedPnl >= 0 ? 'delta-positive' : 'delta-negative'}>
            {formatMoney(overview.totalRealizedPnl)}
          </strong>
        </article>
        <article className="metric-card metric-card--soft">
          <span>行情更新时间</span>
          <strong>{lastSynchronizedAt ? formatDateTime(lastSynchronizedAt) : '尚未刷新'}</strong>
        </article>
        <article className="metric-card">
          <span>最近正式估值</span>
          <strong>{formatDate(overview.latestFormalSnapshotAt)}</strong>
        </article>
        <article className="metric-card">
          <span>自动估值覆盖</span>
          <strong>{overview.autoCoveredCount}</strong>
        </article>
      </section>

      <section className="dashboard-grid">
        <div className="dashboard-grid__main">
          <section className="card">
            <div className="section-head">
              <div>
                <h3>工作清单</h3>
                <p>优先处理待复盘、待补估值、临近到期和数据异常。</p>
              </div>
              <Link className="btn btn--secondary" to="/reviews">
                打开复盘台
              </Link>
            </div>

            {workItems.length ? (
              <div className="summary-list">
                {workItems.map((item) => (
                  <Link className="summary-row" key={item.id} to={`/positions/${item.positionId}`}>
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.detail}</p>
                    </div>
                    <div className="summary-row__meta">
                      <span>{item.priority.toUpperCase()}</span>
                      {item.dueLabel ? <strong>{item.dueLabel}</strong> : null}
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="empty-inline">当前筛选下没有待处理工作项。</div>
            )}
          </section>

          <section className="card">
            <div className="section-head">
              <div>
                <h3>行情状态</h3>
                <p>自动行情只负责辅助估值，正式快照和历史回算仍以后端记录为准。</p>
              </div>
            </div>

            <div className="stats-inline-grid">
              <div className="kv">
                <span>服务状态</span>
                <strong>{health.status === 'ok' ? '正常' : health.status === 'degraded' ? '待刷新' : '离线'}</strong>
              </div>
              <div className="kv">
                <span>数据源</span>
                <strong>{health.sourceLabel}</strong>
              </div>
              <div className="kv">
                <span>最近检查</span>
                <strong>{formatDateTime(health.checkedAt)}</strong>
              </div>
              <div className="kv">
                <span>说明</span>
                <strong>{health.message || '行情服务已连接'}</strong>
              </div>
            </div>
          </section>

          {bundle.stats.length ? <SummarySparkline stats={bundle.stats} /> : null}

          <section className="card">
            <div className="section-head">
              <div>
                <h3>最近记录</h3>
                <p>混合展示开仓、事件和正式估值。</p>
              </div>
            </div>

            {recentActivities.length ? (
              <div className="activity-list">
                {recentActivities.map((activity) => (
                  <article className="activity-item" key={activity.id}>
                    <div className="activity-item__type">{activity.type.toUpperCase()}</div>
                    <div className="activity-item__body">
                      <strong>{activity.title}</strong>
                      <p>{activity.subtitle}</p>
                    </div>
                    <div className="activity-item__meta">
                      <span>{formatDate(activity.occurredAt)}</span>
                      {activity.amountLabel ? <strong>{activity.amountLabel}</strong> : null}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-inline">当前筛选下没有最近记录。</div>
            )}
          </section>
        </div>

        <div className="dashboard-grid__side">
          <section className="card">
            <div className="section-head">
              <div>
                <h3>当前仓位摘要</h3>
                <p>优先展示最近更新的记录和当前估值覆盖情况。</p>
              </div>
            </div>

            {allPositions.length ? (
              <div className="summary-list">
                {allPositions.slice(0, 6).map(({ view, realtime }) => (
                  <Link className="summary-row" key={view.position.id} to={`/positions/${view.position.id}`}>
                    <div>
                      <strong>{view.position.strategyName}</strong>
                      <p>
                        {formatAccountName(view.position.accountType)} / {view.position.product} /{' '}
                        {coverageLabel(realtime.coverageStatus)}
                      </p>
                    </div>
                    <div className="summary-row__meta">
                      <span>
                        {realtime.liveAsOf
                          ? formatDateTime(realtime.liveAsOf)
                          : formatDate(view.latestSnapshot?.snapshotAt)}
                      </span>
                      <strong className={realtime.metrics.unrealizedPnl >= 0 ? 'delta-positive' : 'delta-negative'}>
                        {formatMoney(realtime.metrics.unrealizedPnl)}
                      </strong>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="empty-inline">当前筛选下没有持仓记录。</div>
            )}
          </section>

          <BackupPanel />
        </div>
      </section>

      {isLoading ? (
        <section className="empty-state">
          <strong>正在读取后端数据</strong>
          <p>请稍候，系统正在加载交易记录。</p>
        </section>
      ) : realtimeGroups.length ? (
        <section className="group-list">
          {realtimeGroups.map((group) => (
            <article className="card group-section" key={`${group.accountType}-${group.product}`}>
              <div className="section-head">
                <div>
                  <h3>
                    {formatAccountName(group.accountType)} / {group.product}
                  </h3>
                  <p>
                    未平仓 {group.positions.filter((item) => item.view.position.status === 'open').length} 笔 / 最近估值{' '}
                    {formatDate(group.latestSnapshotAt)}
                  </p>
                </div>
                <div className="group-section__meta">
                  <div className="kv">
                    <span>当前浮盈亏</span>
                    <strong className={group.totalUnrealizedPnl >= 0 ? 'delta-positive' : 'delta-negative'}>
                      {formatMoney(group.totalUnrealizedPnl)}
                    </strong>
                  </div>
                  <div className="kv">
                    <span>已实现盈亏</span>
                    <strong className={group.totalRealizedPnl >= 0 ? 'delta-positive' : 'delta-negative'}>
                      {formatMoney(group.totalRealizedPnl)}
                    </strong>
                  </div>
                </div>
              </div>

              <div className="position-grid">
                {group.positions.map(({ view, realtime }) => (
                  <PositionCard key={view.position.id} realtime={realtime} view={view} />
                ))}
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="empty-state">
          <strong>当前还没有可展示的记录</strong>
          <p>可以先手动开仓，或从固定模板 Excel 导入历史记录。</p>
          <div className="hero-actions">
            <Link className="btn" to="/positions/new">
              去开仓
            </Link>
            <Link className="btn btn--secondary" to="/import">
              打开导入页
            </Link>
          </div>
        </section>
      )}
    </>
  )
}
