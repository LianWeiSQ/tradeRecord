import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { EventTimeline } from '../components/EventTimeline'
import { useLiveQuotes } from '../components/LiveQuotesProvider'
import { useTradeData } from '../components/TradeDataProvider'
import { nearestExpiryDays } from '../services/calculations'
import {
  buildRealtimePositionView,
  buildSnapshotInputFromLiveAndManual,
  getLegCoverage,
} from '../services/liveQuotes'
import {
  clampText,
  formatAccountName,
  formatDate,
  formatDateTime,
  formatDaysLabel,
  formatMoney,
  formatQuoteCoverage,
} from '../services/format'
import { POSITION_EVENT_ACTIONS } from '../types/trade'
import type { PositionEventActionType, StrategyLegInput } from '../types/trade'

function today() {
  return new Date().toISOString().slice(0, 10)
}

function emptyNewLeg(): StrategyLegInput {
  return {
    instrumentType: 'option',
    side: 'long',
    contractCode: '',
    optionType: 'C',
    qty: 1,
    entryPrice: 0,
    multiplier: 1,
    strikePrice: undefined,
    expiryDate: '',
    note: '',
  }
}

export function PositionDetailPage() {
  const { positionId = '' } = useParams()
  const { liveQuotes } = useLiveQuotes()
  const { bundle, isLoading, addEvent, saveSnapshot, updateReview } = useTradeData()
  const [eventType, setEventType] = useState<PositionEventActionType>('add')
  const [eventDate, setEventDate] = useState(today())
  const [eventNote, setEventNote] = useState('')
  const [changeInputs, setChangeInputs] = useState<Record<string, { quantity: string; price: string }>>({})
  const [newLegs, setNewLegs] = useState<StrategyLegInput[]>([])
  const [snapshotDate, setSnapshotDate] = useState(today())
  const [snapshotUnderlyingPrice, setSnapshotUnderlyingPrice] = useState('')
  const [snapshotNote, setSnapshotNote] = useState('手动保存正式估值')
  const [snapshotMarks, setSnapshotMarks] = useState<Record<string, string>>({})
  const [reviewDraft, setReviewDraft] = useState({
    reviewResult: '',
    reviewConclusion: '',
    tags: '',
  })
  const [message, setMessage] = useState('')

  const detailBundle = useMemo(() => {
    const position = bundle.positions.find((item) => item.id === positionId)
    if (!position) {
      return null
    }

    const legs = bundle.legs.filter((leg) => leg.positionId === positionId)
    const events = bundle.events.filter((event) => event.positionId === positionId)
    const snapshots = bundle.priceSnapshots
      .filter((snapshot) => snapshot.positionId === positionId)
      .sort((left, right) => new Date(right.snapshotAt).getTime() - new Date(left.snapshotAt).getTime())

    return { position, legs, events, snapshots }
  }, [bundle, positionId])

  const latestSnapshot = detailBundle?.snapshots[0]
  const realtime = useMemo(() => {
    if (!detailBundle) {
      return undefined
    }

    return buildRealtimePositionView(
      {
        position: detailBundle.position,
        legs: detailBundle.legs,
        events: detailBundle.events,
        latestSnapshot,
      },
      liveQuotes.get(detailBundle.position.id),
    )
  }, [detailBundle, latestSnapshot, liveQuotes])

  useEffect(() => {
    if (!detailBundle) {
      return
    }

    setReviewDraft({
      reviewResult: detailBundle.position.reviewResult,
      reviewConclusion: detailBundle.position.reviewConclusion,
      tags: detailBundle.position.tags.join(', '),
    })
    setSnapshotUnderlyingPrice(String(latestSnapshot?.underlyingPrice ?? ''))
    setSnapshotMarks(
      Object.fromEntries(
        detailBundle.legs.map((leg) => [
          leg.id,
          String(latestSnapshot?.legMarks.find((mark) => mark.legId === leg.id)?.markPrice ?? ''),
        ]),
      ),
    )
  }, [detailBundle, latestSnapshot])

  if (isLoading) {
    return <div className="notice-banner">加载中...</div>
  }

  if (!detailBundle || !realtime) {
    return (
      <section className="empty-state">
        <strong>没有找到这笔记录</strong>
        <p>它可能还没有创建，或者已经被清空和恢复操作覆盖。</p>
      </section>
    )
  }

  const currentBundle = detailBundle
  const currentRealtime = realtime
  const metrics = currentRealtime.metrics
  const nearestExpiry = nearestExpiryDays(currentBundle.legs)

  function updateNewLeg(index: number, patch: Partial<StrategyLegInput>) {
    setNewLegs((current) =>
      current.map((leg, currentIndex) => (currentIndex === index ? { ...leg, ...patch } : leg)),
    )
  }

  async function handleSaveReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    await updateReview(currentBundle.position.id, {
      thesis: currentBundle.position.thesis,
      plan: currentBundle.position.plan,
      expectedScenario: currentBundle.position.expectedScenario,
      reviewResult: reviewDraft.reviewResult,
      reviewConclusion: reviewDraft.reviewConclusion,
      remarks: currentBundle.position.remarks,
      tags: reviewDraft.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    })

    setMessage('复盘内容已保存。')
  }

  async function handleSaveSnapshot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const payload = buildSnapshotInputFromLiveAndManual({
      positionId: currentBundle.position.id,
      snapshotAt: snapshotDate,
      note: snapshotNote,
      legs: currentBundle.legs,
      liveQuote: currentRealtime.liveQuote,
      latestSnapshot,
      manualMarks: snapshotMarks,
      underlyingPrice: snapshotUnderlyingPrice,
    })

    if (!payload) {
      setMessage('请至少填写一条价格，或先刷新自动行情。')
      return
    }

    await saveSnapshot(payload)
    setMessage('正式估值已保存。')
  }

  async function handleAddEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const legChanges = Object.entries(changeInputs)
      .map(([legId, value]) => ({
        legId,
        quantityChange: Number(value.quantity),
        price: Number(value.price),
      }))
      .filter((item) => item.quantityChange !== 0 && Number.isFinite(item.price))

    const appendedLegs = newLegs
      .filter((leg) => leg.contractCode.trim())
      .map((leg) => ({
        ...leg,
        id: crypto.randomUUID(),
        contractCode: leg.contractCode.trim(),
        expiryDate: leg.expiryDate || undefined,
        strikePrice: leg.strikePrice || undefined,
        note: '',
      }))

    if (!legChanges.length && !appendedLegs.length) {
      setMessage('请至少填写一条数量变动，或者新增一条持仓明细。')
      return
    }

    await addEvent({
      positionId: currentBundle.position.id,
      eventType,
      occurredAt: eventDate,
      note: eventNote,
      legChanges,
      newLegs: appendedLegs,
    })

    setChangeInputs({})
    setNewLegs([])
    setEventNote('')
    setEventType('add')
    setMessage('仓位事件已保存。')
  }

  return (
    <>
      <section className="page-intro">
        <div>
          <h2>{currentBundle.position.strategyName}</h2>
          <p>
            {formatAccountName(currentBundle.position.accountType)} · {currentBundle.position.product} ·{' '}
            {currentBundle.position.underlyingSymbol} · 开仓于 {formatDate(currentBundle.position.openedAt)}
          </p>
        </div>
        <div className="tag-row">
          <span className={`status-chip ${currentBundle.position.status === 'closed' ? 'status-chip--closed' : ''}`}>
            {currentBundle.position.status === 'open' ? '持仓中' : '已平仓'}
          </span>
          <span className="pill">
            {realtime.coverageStatus === 'full'
              ? '自动估值完整'
              : realtime.coverageStatus === 'partial'
                ? '部分自动估值'
                : '仅正式估值'}
          </span>
          {currentBundle.position.tags.map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>
      </section>

      <section className="metric-grid">
        <article className="metric-card metric-card--accent">
          <span>当前浮盈亏</span>
          <strong className={metrics.unrealizedPnl >= 0 ? 'delta-positive' : 'delta-negative'}>
            {formatMoney(metrics.unrealizedPnl)}
          </strong>
        </article>
        <article className="metric-card">
          <span>已实现盈亏</span>
          <strong className={metrics.realizedPnl >= 0 ? 'delta-positive' : 'delta-negative'}>
            {formatMoney(metrics.realizedPnl)}
          </strong>
        </article>
        <article className="metric-card">
          <span>最新行情时间</span>
          <strong>{realtime.liveAsOf ? formatDateTime(realtime.liveAsOf) : '使用正式估值'}</strong>
        </article>
        <article className="metric-card metric-card--soft">
          <span>到期提醒</span>
          <strong>{formatDaysLabel(nearestExpiry)}</strong>
        </article>
      </section>

      {message ? <div className="notice-banner">{message}</div> : null}

      <section className="detail-grid">
        <article className="card">
          <div className="section-head">
            <div>
              <h3>概览</h3>
              <p>展示基础信息、正式估值时间和导入附注，所有记录都由 Python 后端持有。</p>
            </div>
          </div>

          <div className="stats-inline-grid">
            <div className="kv">
              <span>账户</span>
              <strong>{formatAccountName(currentBundle.position.accountType)}</strong>
            </div>
            <div className="kv">
              <span>品种</span>
              <strong>{currentBundle.position.product}</strong>
            </div>
            <div className="kv">
              <span>标的合约</span>
              <strong>{currentBundle.position.underlyingSymbol}</strong>
            </div>
            <div className="kv">
              <span>最近正式估值</span>
              <strong>{formatDate(latestSnapshot?.snapshotAt)}</strong>
            </div>
          </div>

          <div className="summary-list">
            <div className="kv-block">
              <span>导入附注</span>
              <strong>{clampText(currentBundle.position.importNotes.join('；'), '暂无导入附注')}</strong>
            </div>
            <div className="kv-block">
              <span>复盘标签</span>
              <strong>{clampText(reviewDraft.tags, '暂无标签')}</strong>
            </div>
          </div>
        </article>

        <article className="card">
          <div className="section-head">
            <div>
              <h3>持仓明细</h3>
              <p>这里看当前数量、成本、价格、盈亏和估值覆盖状态。</p>
            </div>
          </div>

          <div className="list-stack">
            {currentBundle.legs.map((leg) => {
              const legMetric = metrics.legMetrics.find((item) => item.legId === leg.id)
              const coverage = getLegCoverage(leg, currentRealtime.liveQuote, latestSnapshot)
              const liveLeg = currentRealtime.liveQuote?.legQuotes.find((item) => item.legId === leg.id)

              return (
                <article className="holding-card" key={leg.id}>
                  <div className="holding-card__top">
                    <div>
                      <strong>{leg.contractCode}</strong>
                      <p>
                        {leg.instrumentType === 'option'
                          ? `${leg.optionType ?? ''} ${leg.strikePrice ?? '-'}`
                          : '期货持仓'}
                      </p>
                    </div>
                    <div className="tag-row">
                      <span className="pill">{leg.side === 'long' ? '多头' : '空头'}</span>
                      <span className="pill">{formatQuoteCoverage(coverage)}</span>
                    </div>
                  </div>

                  <div className="stats-inline-grid">
                    <div className="kv">
                      <span>当前数量</span>
                      <strong>{legMetric?.currentQty ?? leg.qty}</strong>
                    </div>
                    <div className="kv">
                      <span>平均成本</span>
                      <strong>{formatMoney(legMetric?.avgCost ?? leg.entryPrice)}</strong>
                    </div>
                    <div className="kv">
                      <span>当前价格</span>
                      <strong>{legMetric?.markPrice != null ? formatMoney(legMetric.markPrice) : '未估值'}</strong>
                    </div>
                    <div className="kv">
                      <span>未实现盈亏</span>
                      <strong className={(legMetric?.unrealizedPnl ?? 0) >= 0 ? 'delta-positive' : 'delta-negative'}>
                        {formatMoney(legMetric?.unrealizedPnl ?? 0)}
                      </strong>
                    </div>
                  </div>

                  {liveLeg?.message ? (
                    <div className="kv-block">
                      <span>自动行情提示</span>
                      <strong>{liveLeg.message}</strong>
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>
        </article>
      </section>

      <section className="detail-grid">
        <article className="card">
          <div className="section-head">
            <div>
              <h3>自动行情概览</h3>
              <p>自动行情只负责读价和算收益，不会替代仓位事件。</p>
            </div>
          </div>

          <div className="summary-list">
            <div className="kv-block">
              <span>标的价格</span>
              <strong>
                {currentRealtime.liveQuote?.underlyingPrice != null
                  ? formatMoney(currentRealtime.liveQuote.underlyingPrice)
                  : '暂无自动价格'}
              </strong>
            </div>
            <div className="kv-block">
              <span>行情时间</span>
              <strong>{realtime.liveAsOf ? formatDateTime(realtime.liveAsOf) : '未读取到自动行情'}</strong>
            </div>
            <div className="kv-block">
              <span>正式估值时间</span>
              <strong>{formatDate(latestSnapshot?.snapshotAt)}</strong>
            </div>
          </div>

          <div className="summary-list">
            {currentBundle.legs.map((leg) => {
              const liveLeg = realtime.liveQuote?.legQuotes.find((item) => item.legId === leg.id)
              return (
                <div className="kv-block" key={leg.id}>
                  <span>{leg.contractCode}</span>
                  <strong>
                    {liveLeg?.markPrice != null ? formatMoney(liveLeg.markPrice) : liveLeg?.message || '需手动估值'}
                  </strong>
                </div>
              )
            })}
          </div>
        </article>

        <form className="card form-card" onSubmit={handleSaveSnapshot}>
          <div className="section-head">
            <div>
              <h3>手动补录正式估值</h3>
              <p>期权和自动缺失的价格在这里补录。保存后会形成正式估值记录。</p>
            </div>
          </div>

          <div className="form-grid form-grid--three">
            <div className="field">
              <label htmlFor="detail-snapshot-date">估值日期</label>
              <input
                id="detail-snapshot-date"
                type="date"
                value={snapshotDate}
                onChange={(event) => setSnapshotDate(event.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="detail-underlying-price">手动补录标的价格</label>
              <input
                id="detail-underlying-price"
                placeholder={
                  currentRealtime.liveQuote?.underlyingPrice != null
                    ? `已自动读取 ${currentRealtime.liveQuote.underlyingPrice}`
                    : '自动价格缺失时可填写'
                }
                step="0.0001"
                type="number"
                value={snapshotUnderlyingPrice}
                onChange={(event) => setSnapshotUnderlyingPrice(event.target.value)}
              />
            </div>

            <div className="field field--wide">
              <label htmlFor="detail-snapshot-note">说明</label>
              <input
                id="detail-snapshot-note"
                placeholder="例如：收盘后确认，期权价格手动补录"
                value={snapshotNote}
                onChange={(event) => setSnapshotNote(event.target.value)}
              />
            </div>
          </div>

          <div className="list-stack">
            {currentBundle.legs.map((leg) => {
              const coverage = getLegCoverage(leg, currentRealtime.liveQuote, latestSnapshot)

              return (
                <div className="field" key={leg.id}>
                  <label htmlFor={`detail-mark-${leg.id}`}>
                    {leg.contractCode} 手动价格（{formatQuoteCoverage(coverage)}）
                  </label>
                  <input
                    id={`detail-mark-${leg.id}`}
                    step="0.0001"
                    type="number"
                    value={snapshotMarks[leg.id] ?? ''}
                    onChange={(event) =>
                      setSnapshotMarks((current) => ({
                        ...current,
                        [leg.id]: event.target.value,
                      }))
                    }
                  />
                </div>
              )
            })}
          </div>

          <div className="form-actions">
            <button className="btn" type="submit">
              保存正式估值
            </button>
          </div>
        </form>

        <form className="card form-card" onSubmit={handleSaveReview}>
          <div className="section-head">
            <div>
              <h3>复盘</h3>
              <p>第一版只保留结果、复盘结论和标签，方便收尾时快速回看。</p>
            </div>
          </div>

          <div className="form-grid">
            <div className="field field--wide">
              <label htmlFor="review-result">结果</label>
              <textarea
                id="review-result"
                value={reviewDraft.reviewResult}
                onChange={(event) =>
                  setReviewDraft((current) => ({
                    ...current,
                    reviewResult: event.target.value,
                  }))
                }
              />
            </div>

            <div className="field field--wide">
              <label htmlFor="review-conclusion">复盘结论</label>
              <textarea
                id="review-conclusion"
                value={reviewDraft.reviewConclusion}
                onChange={(event) =>
                  setReviewDraft((current) => ({
                    ...current,
                    reviewConclusion: event.target.value,
                  }))
                }
              />
            </div>

            <div className="field field--wide">
              <label htmlFor="review-tags">标签</label>
              <input
                id="review-tags"
                placeholder="逗号分隔"
                value={reviewDraft.tags}
                onChange={(event) =>
                  setReviewDraft((current) => ({
                    ...current,
                    tags: event.target.value,
                  }))
                }
              />
            </div>
          </div>

          <div className="form-actions">
            <button className="btn" type="submit">
              保存复盘
            </button>
          </div>
        </form>
      </section>

      <form className="card form-card" onSubmit={handleAddEvent}>
        <div className="section-head">
          <div>
            <h3>新增仓位事件</h3>
            <p>开仓后不再新建第二笔交易，后续加仓、减仓、平仓、移仓都在这里追加。</p>
          </div>
        </div>

        <div className="form-grid form-grid--three">
          <div className="field">
            <label htmlFor="event-type">事件类型</label>
            <select
              id="event-type"
              value={eventType}
              onChange={(event) => setEventType(event.target.value as PositionEventActionType)}
            >
              {POSITION_EVENT_ACTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="event-date">事件日期</label>
            <input
              id="event-date"
              type="date"
              value={eventDate}
              onChange={(event) => setEventDate(event.target.value)}
            />
          </div>

          <div className="field field--wide">
            <label htmlFor="event-note">说明</label>
            <input
              id="event-note"
              placeholder="例如：止盈减半，或移到下月合约"
              value={eventNote}
              onChange={(event) => setEventNote(event.target.value)}
            />
          </div>
        </div>

        <div className="list-stack">
          {currentBundle.legs.map((leg) => (
            <article className="holding-card" key={leg.id}>
              <div className="holding-card__top">
                <div>
                  <strong>{leg.contractCode}</strong>
                  <p>
                    当前剩余 {metrics.legMetrics.find((item) => item.legId === leg.id)?.currentQty ?? leg.qty}
                  </p>
                </div>
              </div>

              <div className="form-grid form-grid--three">
                <div className="field">
                  <label htmlFor={`change-qty-${leg.id}`}>数量变动</label>
                  <input
                    id={`change-qty-${leg.id}`}
                    step="0.01"
                    type="number"
                    value={changeInputs[leg.id]?.quantity ?? ''}
                    onChange={(event) =>
                      setChangeInputs((current) => ({
                        ...current,
                        [leg.id]: {
                          quantity: event.target.value,
                          price: current[leg.id]?.price ?? '',
                        },
                      }))
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor={`change-price-${leg.id}`}>成交价</label>
                  <input
                    id={`change-price-${leg.id}`}
                    step="0.0001"
                    type="number"
                    value={changeInputs[leg.id]?.price ?? ''}
                    onChange={(event) =>
                      setChangeInputs((current) => ({
                        ...current,
                        [leg.id]: {
                          quantity: current[leg.id]?.quantity ?? '',
                          price: event.target.value,
                        },
                      }))
                    }
                  />
                </div>
              </div>
            </article>
          ))}
        </div>

        <div className="section-head">
          <div>
            <h3>本次事件新增的持仓明细</h3>
            <p>移仓到新合约，或本次事件顺带新增新腿时，可以直接补在这里。</p>
          </div>
          <button
            className="btn btn--secondary"
            type="button"
            onClick={() => setNewLegs((current) => [...current, emptyNewLeg()])}
          >
            新增持仓明细
          </button>
        </div>

        {newLegs.length ? (
          <div className="list-stack">
            {newLegs.map((leg, index) => (
              <div className="leg-editor" key={`${leg.contractCode}-${index}`}>
                <div className="leg-editor__header">
                  <div>
                    <strong>新增持仓明细 {index + 1}</strong>
                    <p>用于移仓或扩展持仓结构。</p>
                  </div>
                  <button
                    className="btn btn--ghost"
                    type="button"
                    onClick={() =>
                      setNewLegs((current) => current.filter((_, currentIndex) => currentIndex !== index))
                    }
                  >
                    删除
                  </button>
                </div>

                <div className="form-grid form-grid--six">
                  <div className="field">
                    <label>类型</label>
                    <select
                      value={leg.instrumentType}
                      onChange={(event) =>
                        updateNewLeg(index, {
                          instrumentType: event.target.value as 'future' | 'option',
                          optionType: event.target.value === 'future' ? null : leg.optionType ?? 'C',
                        })
                      }
                    >
                      <option value="option">期权</option>
                      <option value="future">期货</option>
                    </select>
                  </div>

                  <div className="field">
                    <label>方向</label>
                    <select
                      value={leg.side}
                      onChange={(event) =>
                        updateNewLeg(index, { side: event.target.value as 'long' | 'short' })
                      }
                    >
                      <option value="long">多头</option>
                      <option value="short">空头</option>
                    </select>
                  </div>

                  <div className="field">
                    <label>合约代码</label>
                    <input
                      value={leg.contractCode}
                      onChange={(event) => updateNewLeg(index, { contractCode: event.target.value })}
                    />
                  </div>

                  <div className="field">
                    <label>数量</label>
                    <input
                      step="0.01"
                      type="number"
                      value={leg.qty}
                      onChange={(event) => updateNewLeg(index, { qty: Number(event.target.value) })}
                    />
                  </div>

                  <div className="field">
                    <label>价格</label>
                    <input
                      step="0.0001"
                      type="number"
                      value={leg.entryPrice}
                      onChange={(event) => updateNewLeg(index, { entryPrice: Number(event.target.value) })}
                    />
                  </div>

                  <div className="field">
                    <label>乘数</label>
                    <input
                      step="0.01"
                      type="number"
                      value={leg.multiplier}
                      onChange={(event) => updateNewLeg(index, { multiplier: Number(event.target.value) })}
                    />
                  </div>

                  {leg.instrumentType === 'option' ? (
                    <>
                      <div className="field">
                        <label>期权类型</label>
                        <select
                          value={leg.optionType ?? 'C'}
                          onChange={(event) =>
                            updateNewLeg(index, {
                              optionType: event.target.value as 'C' | 'P',
                            })
                          }
                        >
                          <option value="C">认购</option>
                          <option value="P">认沽</option>
                        </select>
                      </div>

                      <div className="field">
                        <label>行权价</label>
                        <input
                          step="0.01"
                          type="number"
                          value={leg.strikePrice ?? ''}
                          onChange={(event) =>
                            updateNewLeg(index, {
                              strikePrice: event.target.value ? Number(event.target.value) : undefined,
                            })
                          }
                        />
                      </div>

                      <div className="field">
                        <label>到期日</label>
                        <input
                          type="date"
                          value={leg.expiryDate ?? ''}
                          onChange={(event) => updateNewLeg(index, { expiryDate: event.target.value })}
                        />
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <div className="form-actions">
          <button className="btn" type="submit">
            保存仓位事件
          </button>
        </div>
      </form>

      <EventTimeline events={currentBundle.events} legs={currentBundle.legs} />
    </>
  )
}
