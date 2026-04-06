import { useMemo, useState, type FormEvent } from 'react'
import { useLiveQuotes } from '../components/LiveQuotesProvider'
import { useTradeData } from '../components/TradeDataProvider'
import {
  buildRealtimePositionView,
  buildSnapshotInputFromLiveAndManual,
  getLegCoverage,
} from '../services/liveQuotes'
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatQuoteCoverage,
} from '../services/format'

function today() {
  return new Date().toISOString().slice(0, 10)
}

export function ValuationPage() {
  const [messages, setMessages] = useState<Record<string, string>>({})
  const { bundle, isLoading, saveSnapshot } = useTradeData()
  const {
    health,
    isRefreshing,
    isRunningCloseSnapshot,
    lastSynchronizedAt,
    liveQuotes,
    refreshQuotes,
    runCloseSnapshot,
  } = useLiveQuotes()

  const positions = useMemo(() => {
    const items = bundle.positions.filter((position) => position.status === 'open')

    return items.map((position) => {
      const positionLegs = bundle.legs.filter((leg) => leg.positionId === position.id)
      const latestSnapshot = [...bundle.priceSnapshots]
        .filter((snapshot) => snapshot.positionId === position.id)
        .sort((left, right) => new Date(right.snapshotAt).getTime() - new Date(left.snapshotAt).getTime())[0]
      const positionEvents = bundle.events.filter((event) => event.positionId === position.id)

      return {
        position,
        legs: positionLegs,
        events: positionEvents,
        latestSnapshot,
        realtime: buildRealtimePositionView(
          {
            position,
            legs: positionLegs,
            events: positionEvents,
            latestSnapshot,
          },
          liveQuotes.get(position.id),
        ),
      }
    })
  }, [bundle, liveQuotes])

  const ordered = useMemo(
    () =>
      [...positions].sort(
        (left, right) =>
          new Date(right.position.openedAt).getTime() - new Date(left.position.openedAt).getTime(),
      ),
    [positions],
  )

  async function handleSubmit(event: FormEvent<HTMLFormElement>, positionId: string) {
    event.preventDefault()

    const form = new FormData(event.currentTarget)
    const snapshotAt = String(form.get('snapshotAt') || today())
    const underlyingValue = String(form.get('underlyingPrice') || '')
    const note = String(form.get('note') || '')
    const current = ordered.find((item) => item.position.id === positionId)

    if (!current) {
      return
    }

    const manualMarks = Object.fromEntries(
      current.legs.map((leg) => [leg.id, String(form.get(`mark-${leg.id}`) || '')]),
    )

    const payload = buildSnapshotInputFromLiveAndManual({
      positionId,
      snapshotAt,
      note,
      legs: current.legs,
      liveQuote: current.realtime.liveQuote,
      latestSnapshot: current.latestSnapshot,
      manualMarks,
      underlyingPrice: underlyingValue,
    })

    if (!payload) {
      setMessages((currentMessages) => ({
        ...currentMessages,
        [positionId]: '至少需要一条自动或手动估值数据后才能保存。',
      }))
      return
    }

    await saveSnapshot(payload)

    setMessages((currentMessages) => ({
      ...currentMessages,
      [positionId]: '正式估值已保存。',
    }))
  }

  return (
    <>
      <section className="page-intro">
        <div>
          <h2>估值更新</h2>
          <p>自动读取期货腿和标的价格，期权继续手动补录。所有正式估值都写回 Python 后端。</p>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <div>
            <h3>自动读取行情</h3>
            <p>自动刷新只更新当前实时估值。正式快照在你手动保存，或工作日 15:05 自动生成。</p>
          </div>
          <div className="hero-actions">
            <button className="btn btn--secondary" type="button" onClick={() => void refreshQuotes()}>
              {isRefreshing ? '刷新中...' : '立即刷新行情'}
            </button>
            <button className="btn" type="button" onClick={() => void runCloseSnapshot()}>
              {isRunningCloseSnapshot ? '生成中...' : '补跑收盘快照'}
            </button>
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
            <span>最近刷新</span>
            <strong>{lastSynchronizedAt ? formatDateTime(lastSynchronizedAt) : '尚未刷新'}</strong>
          </div>
          <div className="kv">
            <span>说明</span>
            <strong>{health.message || '工作日 15:05 自动保存一条正式收盘快照'}</strong>
          </div>
        </div>
      </section>

      {isLoading ? (
        <section className="empty-state">
          <strong>正在读取后端数据</strong>
          <p>请稍候，系统正在加载未平仓记录。</p>
        </section>
      ) : ordered.length ? (
        <section className="card-list">
          {ordered.map(({ position, legs, latestSnapshot, realtime, events }) => (
            <form
              key={position.id}
              className="card form-card"
              onSubmit={(event) => void handleSubmit(event, position.id)}
            >
              <div className="section-head">
                <div>
                  <h3>{position.strategyName}</h3>
                  <p>
                    {position.product} · {position.underlyingSymbol} · {events.length} 个仓位事件
                  </p>
                </div>
                <div className="tag-row">
                  <span className="pill">
                    {realtime.coverageStatus === 'full'
                      ? '自动估值完整'
                      : realtime.coverageStatus === 'partial'
                        ? '部分自动估值'
                        : '需依赖正式估值'}
                  </span>
                  <span className="pill">最近正式估值 {formatDate(latestSnapshot?.snapshotAt)}</span>
                </div>
              </div>

              <div className="metric-grid metric-grid--three">
                <article className="metric-card">
                  <span>当前浮盈亏</span>
                  <strong className={realtime.metrics.unrealizedPnl >= 0 ? 'delta-positive' : 'delta-negative'}>
                    {formatMoney(realtime.metrics.unrealizedPnl)}
                  </strong>
                </article>
                <article className="metric-card">
                  <span>已实现盈亏</span>
                  <strong className={realtime.metrics.realizedPnl >= 0 ? 'delta-positive' : 'delta-negative'}>
                    {formatMoney(realtime.metrics.realizedPnl)}
                  </strong>
                </article>
                <article className="metric-card metric-card--soft">
                  <span>行情时间</span>
                  <strong>{realtime.liveAsOf ? formatDateTime(realtime.liveAsOf) : '使用正式估值'}</strong>
                </article>
              </div>

              <div className="detail-grid">
                <article className="card card--soft">
                  <div className="section-head">
                    <div>
                      <h3>自动行情</h3>
                      <p>期货腿和标的合约会优先展示自动读取结果，期权腿会标记为需手动估值。</p>
                    </div>
                  </div>

                  <div className="summary-list">
                    <div className="kv-block">
                      <span>标的合约</span>
                      <strong>
                        {position.underlyingSymbol}
                        {realtime.liveQuote?.underlyingPrice != null
                          ? ` · ${formatMoney(realtime.liveQuote.underlyingPrice)}`
                          : ' · 暂无自动价格'}
                      </strong>
                    </div>

                    {legs.map((leg) => {
                      const coverage = getLegCoverage(leg, realtime.liveQuote, latestSnapshot)
                      const liveLeg = realtime.liveQuote?.legQuotes.find((item) => item.legId === leg.id)

                      return (
                        <div className="kv-block" key={leg.id}>
                          <span>{leg.contractCode}</span>
                          <strong>
                            {liveLeg?.markPrice != null
                              ? `${formatMoney(liveLeg.markPrice)} · ${formatQuoteCoverage(coverage)}`
                              : formatQuoteCoverage(coverage)}
                          </strong>
                        </div>
                      )
                    })}
                  </div>
                </article>

                <article className="card card--soft">
                  <div className="section-head">
                    <div>
                      <h3>正式估值保存</h3>
                      <p>期货自动价格会直接参与保存，期权和缺失行情的持仓请在下方手动补录。</p>
                    </div>
                  </div>

                  <div className="form-grid form-grid--three">
                    <div className="field">
                      <label htmlFor={`snapshotAt-${position.id}`}>估值日期</label>
                      <input defaultValue={today()} id={`snapshotAt-${position.id}`} name="snapshotAt" required type="date" />
                    </div>

                    <div className="field">
                      <label htmlFor={`underlyingPrice-${position.id}`}>手动补录标的价格</label>
                      <input
                        id={`underlyingPrice-${position.id}`}
                        name="underlyingPrice"
                        placeholder={
                          realtime.liveQuote?.underlyingPrice != null
                            ? `已自动读取 ${realtime.liveQuote.underlyingPrice}`
                            : '自动价格缺失时可填写'
                        }
                        step="0.0001"
                        type="number"
                      />
                    </div>

                    <div className="field field--wide">
                      <label htmlFor={`note-${position.id}`}>说明</label>
                      <input
                        defaultValue="手动保存正式估值"
                        id={`note-${position.id}`}
                        name="note"
                        placeholder="例如：收盘后确认，期权价格手动补录"
                      />
                    </div>
                  </div>

                  <div className="list-stack">
                    {legs.map((leg) => {
                      const coverage = getLegCoverage(leg, realtime.liveQuote, latestSnapshot)
                      const liveLeg = realtime.liveQuote?.legQuotes.find((item) => item.legId === leg.id)
                      const shouldInput = coverage !== 'auto'

                      return (
                        <article className="holding-card" key={leg.id}>
                          <div className="holding-card__top">
                            <div>
                              <strong>{leg.contractCode}</strong>
                              <p>
                                开仓价 {formatMoney(leg.entryPrice)} · 数量 {leg.qty}
                              </p>
                            </div>
                            <span className="pill">{formatQuoteCoverage(coverage)}</span>
                          </div>

                          {liveLeg?.markPrice != null ? (
                            <div className="kv-block">
                              <span>自动价格</span>
                              <strong>{formatMoney(liveLeg.markPrice)}</strong>
                            </div>
                          ) : null}

                          {shouldInput ? (
                            <div className="field">
                              <label htmlFor={`mark-${leg.id}`}>手动价格</label>
                              <input
                                defaultValue={
                                  latestSnapshot?.legMarks.find((mark) => mark.legId === leg.id)?.markPrice ?? ''
                                }
                                id={`mark-${leg.id}`}
                                name={`mark-${leg.id}`}
                                placeholder={leg.instrumentType === 'option' ? '期权需手动估值' : '自动价格缺失时可填写'}
                                step="0.0001"
                                type="number"
                              />
                            </div>
                          ) : (
                            <div className="kv-block">
                              <span>手动录入</span>
                              <strong>已自动估值，无需填写</strong>
                            </div>
                          )}
                        </article>
                      )
                    })}
                  </div>

                  <div className="form-actions">
                    <button className="btn" type="submit">
                      保存正式估值
                    </button>
                    {messages[position.id] ? <span className="pill">{messages[position.id]}</span> : null}
                  </div>
                </article>
              </div>
            </form>
          ))}
        </section>
      ) : (
        <section className="empty-state">
          <strong>目前没有未平仓记录</strong>
          <p>当你开仓或导入持仓后，这里会出现待估值的交易列表。</p>
        </section>
      )}
    </>
  )
}
