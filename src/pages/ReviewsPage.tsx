import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTradeData } from '../components/TradeDataProvider'
import { buildReviewStats, buildPositionViews, buildWorkItems, matchesPositionSearch } from '../services/workbench'
import {
  formatAccountName,
  formatDate,
  formatDaysLabel,
  formatMoney,
  formatPercent,
} from '../services/format'
import type { ReviewFilterState } from '../types/trade'

const defaultFilters: ReviewFilterState = {
  accountType: 'all',
  product: 'all',
  reviewStatus: 'all',
  range: 'all',
  search: '',
}

function withinRange(openedAt: string, range: ReviewFilterState['range']) {
  if (range === 'all') {
    return true
  }

  const days = range === '30d' ? 30 : 90
  const opened = new Date(openedAt)
  const now = new Date()
  return now.getTime() - opened.getTime() <= days * 24 * 60 * 60 * 1000
}

export function ReviewsPage() {
  const [filters, setFilters] = useState<ReviewFilterState>(defaultFilters)
  const { bundle, isLoading } = useTradeData()

  const views = useMemo(
    () => buildPositionViews(bundle.positions, bundle.legs, bundle.events, bundle.priceSnapshots),
    [bundle],
  )

  const productOptions = useMemo(
    () =>
      [...new Set(bundle.positions.map((position) => position.product))].sort((left, right) =>
        left.localeCompare(right, 'zh-CN'),
      ),
    [bundle.positions],
  )

  const reviewQueue = useMemo(
    () =>
      buildWorkItems(views).filter((item) => ['review', 'stale', 'data_issue'].includes(item.kind)),
    [views],
  )

  const filtered = useMemo(
    () =>
      views
        .filter((view) => view.position.status === 'closed')
        .filter(
          (view) =>
            (filters.accountType === 'all' || view.position.accountType === filters.accountType) &&
            (filters.product === 'all' || view.position.product === filters.product) &&
            (filters.reviewStatus === 'all' || view.position.reviewStatus === filters.reviewStatus) &&
            withinRange(view.position.openedAt, filters.range) &&
            matchesPositionSearch(view.position, view.legs, filters.search),
        )
        .sort(
          (left, right) =>
            new Date(right.position.updatedAt).getTime() - new Date(left.position.updatedAt).getTime(),
        ),
    [filters.accountType, filters.product, filters.range, filters.reviewStatus, filters.search, views],
  )

  const stats = useMemo(() => buildReviewStats(filtered), [filtered])

  return (
    <>
      <section className="page-intro">
        <div>
          <h2>复盘工作台</h2>
          <p>集中处理待复盘队列，按结构化字段补齐执行偏差、结果归因和下次规则。</p>
        </div>
        <div className="hero-actions">
          <Link className="btn" to="/valuations">
            去估值页
          </Link>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <div>
            <h3>筛选</h3>
            <p>支持按账户、品种、复盘状态和关键字筛选。</p>
          </div>
        </div>

        <div className="filter-bar">
          <div className="field">
            <label htmlFor="reviews-account">账户</label>
            <select
              id="reviews-account"
              value={filters.accountType}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  accountType: event.target.value as ReviewFilterState['accountType'],
                }))
              }
            >
              <option value="all">全部账户</option>
              <option value="live">实盘</option>
              <option value="paper">模拟</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="reviews-product">品种</label>
            <select
              id="reviews-product"
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
            <label htmlFor="reviews-status">复盘状态</label>
            <select
              id="reviews-status"
              value={filters.reviewStatus}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  reviewStatus: event.target.value as ReviewFilterState['reviewStatus'],
                }))
              }
            >
              <option value="all">全部状态</option>
              <option value="pending">待复盘</option>
              <option value="ready">复盘中</option>
              <option value="reviewed">已复盘</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="reviews-range">时间</label>
            <select
              id="reviews-range"
              value={filters.range}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  range: event.target.value as ReviewFilterState['range'],
                }))
              }
            >
              <option value="all">全部时间</option>
              <option value="30d">近 30 天</option>
              <option value="90d">近 90 天</option>
            </select>
          </div>

          <div className="field field--wide">
            <label htmlFor="reviews-search">搜索</label>
            <input
              id="reviews-search"
              placeholder="搜索策略名、合约、标签或复盘文本"
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
          <span>已平仓笔数</span>
          <strong>{stats.totalClosed}</strong>
        </article>
        <article className="metric-card">
          <span>已复盘</span>
          <strong>{stats.reviewedCount}</strong>
        </article>
        <article className="metric-card">
          <span>待复盘</span>
          <strong>{stats.pendingCount}</strong>
        </article>
        <article className="metric-card">
          <span>胜率</span>
          <strong>{formatPercent(stats.winRate)}</strong>
        </article>
        <article className="metric-card">
          <span>平均持仓天数</span>
          <strong>{formatDaysLabel(stats.averageHoldingDays)}</strong>
        </article>
        <article className="metric-card metric-card--soft">
          <span>最大盈亏</span>
          <strong>
            {formatMoney(stats.bestPnl)} / {formatMoney(stats.worstPnl)}
          </strong>
        </article>
      </section>

      <section className="dashboard-grid">
        <div className="dashboard-grid__main">
          <section className="card">
            <div className="section-head">
              <div>
                <h3>待复盘队列</h3>
                <p>这里聚合已平仓未复盘、长期未更新和数据异常记录。</p>
              </div>
            </div>

            {reviewQueue.length ? (
              <div className="summary-list">
                {reviewQueue.map((item) => (
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
              <div className="empty-inline">当前没有待复盘队列。</div>
            )}
          </section>
        </div>

        <div className="dashboard-grid__side">
          <section className="card">
            <div className="section-head">
              <div>
                <h3>使用建议</h3>
                <p>先补交易计划，再填执行偏差和结果归因，最后沉淀 next action。</p>
              </div>
            </div>

            <div className="summary-list">
              <div className="kv-block">
                <span>字段顺序</span>
                <strong>计划 → 执行 → 归因 → 规则</strong>
              </div>
              <div className="kv-block">
                <span>最低标准</span>
                <strong>至少补 execution、attribution、next action</strong>
              </div>
              <div className="kv-block">
                <span>入口</span>
                <strong>点击下方卡片进入详情页编辑</strong>
              </div>
            </div>
          </section>
        </div>
      </section>

      {isLoading ? (
        <section className="empty-state">
          <strong>正在加载复盘数据</strong>
          <p>请稍候，系统正在整理已平仓记录。</p>
        </section>
      ) : filtered.length ? (
        <section className="group-list">
          {filtered.map((view) => (
            <article className="card group-section" key={view.position.id}>
              <div className="section-head">
                <div>
                  <h3>{view.position.strategyName}</h3>
                  <p>
                    {formatAccountName(view.position.accountType)} / {view.position.product} /{' '}
                    {view.position.underlyingSymbol} / 开仓 {formatDate(view.position.openedAt)}
                  </p>
                </div>
                <div className="tag-row">
                  <span className="pill">{view.position.reviewStatus}</span>
                  <Link className="btn btn--secondary" to={`/positions/${view.position.id}`}>
                    打开详情
                  </Link>
                </div>
              </div>

              <div className="stats-inline-grid">
                <div className="kv">
                  <span>已实现盈亏</span>
                  <strong className={view.metrics.realizedPnl >= 0 ? 'delta-positive' : 'delta-negative'}>
                    {formatMoney(view.metrics.realizedPnl)}
                  </strong>
                </div>
                <div className="kv">
                  <span>复盘状态</span>
                  <strong>{view.position.reviewStatus}</strong>
                </div>
                <div className="kv">
                  <span>最近更新</span>
                  <strong>{formatDate(view.position.updatedAt)}</strong>
                </div>
                <div className="kv">
                  <span>标签</span>
                  <strong>{view.position.tags.join(', ') || '无'}</strong>
                </div>
              </div>

              <div className="summary-list">
                <div className="kv-block">
                  <span>交易计划</span>
                  <strong>{view.position.plan || view.position.thesis || '未填写'}</strong>
                </div>
                <div className="kv-block">
                  <span>执行偏差</span>
                  <strong>{view.position.executionAssessment || view.position.deviationReason || '未填写'}</strong>
                </div>
                <div className="kv-block">
                  <span>结果归因</span>
                  <strong>{view.position.resultAttribution || view.position.reviewConclusion || '未填写'}</strong>
                </div>
                <div className="kv-block">
                  <span>下次规则</span>
                  <strong>{view.position.nextAction || '未填写'}</strong>
                </div>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="empty-state">
          <strong>当前筛选下没有复盘记录</strong>
          <p>先平仓，或调整筛选条件再查看。</p>
        </section>
      )}
    </>
  )
}
