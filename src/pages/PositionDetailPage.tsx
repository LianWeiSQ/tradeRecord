import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { EventTimeline } from '../components/EventTimeline'
import { useLiveQuotes } from '../components/LiveQuotesProvider'
import { useTradeData } from '../components/TradeDataProvider'
import { nearestExpiryDays } from '../services/calculations'
import { buildRealtimePositionView, buildSnapshotInputFromLiveAndManual, getLegCoverage } from '../services/liveQuotes'
import { clampText, formatAccountName, formatDate, formatDateTime, formatDaysLabel, formatMoney, formatQuoteCoverage } from '../services/format'
import { POSITION_EVENT_ACTIONS } from '../types/trade'
import type { PositionEvent, PositionEventActionType, PriceSnapshot, StrategyLegInput, StrategyPosition } from '../types/trade'

function today() {
  return new Date().toISOString().slice(0, 10)
}

function emptyLeg(): StrategyLegInput {
  return {
    id: crypto.randomUUID(),
    instrumentType: 'option',
    side: 'long',
    contractCode: '',
    optionType: 'C',
    qty: 1,
    entryPrice: 0,
    multiplier: 1,
    expiryDate: '',
    note: '',
  }
}

function sanitizeLeg(leg: StrategyLegInput): StrategyLegInput {
  return {
    ...leg,
    id: leg.id || crypto.randomUUID(),
    contractCode: leg.contractCode.trim(),
    expiryDate: leg.expiryDate || undefined,
    strikePrice: leg.strikePrice || undefined,
    note: leg.note?.trim() || '',
  }
}

function createReviewDraft(position: StrategyPosition) {
  return {
    thesis: position.thesis,
    plan: position.plan,
    expectedScenario: position.expectedScenario,
    riskNotes: position.riskNotes,
    exitRule: position.exitRule,
    reviewResult: position.reviewResult,
    reviewConclusion: position.reviewConclusion,
    executionAssessment: position.executionAssessment,
    deviationReason: position.deviationReason,
    resultAttribution: position.resultAttribution,
    nextAction: position.nextAction,
    reviewStatus: position.reviewStatus,
    remarks: position.remarks,
    tags: position.tags.join(', '),
  }
}

function createSnapshotDraft(snapshot: PriceSnapshot | undefined) {
  return {
    snapshotAt: snapshot?.snapshotAt.slice(0, 10) ?? today(),
    underlyingPrice: snapshot?.underlyingPrice != null ? String(snapshot.underlyingPrice) : '',
    note: snapshot?.note ?? '手动保存正式估值',
    marks: Object.fromEntries(snapshot?.legMarks.map((mark) => [mark.legId, String(mark.markPrice)]) ?? []),
  }
}

export function PositionDetailPage() {
  const { positionId = '' } = useParams()
  const { liveQuotes } = useLiveQuotes()
  const { bundle, isLoading, addEvent, editEvent, removeEvent, saveSnapshot, editSnapshot, removeSnapshot, updateReview } = useTradeData()
  const [message, setMessage] = useState('')
  const [eventType, setEventType] = useState<PositionEventActionType>('add')
  const [eventDate, setEventDate] = useState(today())
  const [eventNote, setEventNote] = useState('')
  const [changeInputs, setChangeInputs] = useState<Record<string, { quantity: string; price: string }>>({})
  const [newLegs, setNewLegs] = useState<StrategyLegInput[]>([])
  const [editingEventId, setEditingEventId] = useState<string>()
  const [editingEventType, setEditingEventType] = useState<PositionEventActionType>('add')
  const [editingEventDate, setEditingEventDate] = useState(today())
  const [editingEventNote, setEditingEventNote] = useState('')
  const [editingChangeInputs, setEditingChangeInputs] = useState<Record<string, { quantity: string; price: string }>>({})
  const [snapshotDraft, setSnapshotDraft] = useState(createSnapshotDraft(undefined))
  const [editingSnapshotId, setEditingSnapshotId] = useState<string>()
  const [editingSnapshotDraft, setEditingSnapshotDraft] = useState(createSnapshotDraft(undefined))
  const [reviewDraft, setReviewDraft] = useState({
    thesis: '',
    plan: '',
    expectedScenario: '',
    riskNotes: '',
    exitRule: '',
    reviewResult: '',
    reviewConclusion: '',
    executionAssessment: '',
    deviationReason: '',
    resultAttribution: '',
    nextAction: '',
    reviewStatus: 'pending' as StrategyPosition['reviewStatus'],
    remarks: '',
    tags: '',
  })

  const detail = useMemo(() => {
    const position = bundle.positions.find((item) => item.id === positionId)
    if (!position) return null
    const legs = bundle.legs.filter((item) => item.positionId === positionId)
    const events = bundle.events.filter((item) => item.positionId === positionId).sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime())
    const snapshots = bundle.priceSnapshots.filter((item) => item.positionId === positionId).sort((a, b) => new Date(b.snapshotAt).getTime() - new Date(a.snapshotAt).getTime())
    return { position, legs, events, snapshots }
  }, [bundle, positionId])

  const latestSnapshot = detail?.snapshots[0]
  const realtime = useMemo(() => {
    if (!detail) return undefined
    return buildRealtimePositionView({ position: detail.position, legs: detail.legs, events: detail.events, latestSnapshot }, liveQuotes.get(detail.position.id))
  }, [detail, latestSnapshot, liveQuotes])

  useEffect(() => {
    if (!detail) return
    setReviewDraft(createReviewDraft(detail.position))
    setSnapshotDraft(createSnapshotDraft(latestSnapshot))
  }, [detail, latestSnapshot])

  if (isLoading) return <div className="notice-banner">加载中...</div>
  if (!detail || !realtime) {
    return <section className="empty-state"><strong>没有找到这笔记录</strong><p>它可能还没有创建，或者已经被清空。</p></section>
  }

  const currentDetail = detail
  const currentRealtime = realtime
  const metrics = currentRealtime.metrics
  const workflow = currentDetail.position.workflowState
  const expiryDays = nearestExpiryDays(currentDetail.legs)

  function setChangeValue(legId: string, quantity: string, price: string, editing = false) {
    if (editing) {
      setEditingChangeInputs((current) => ({ ...current, [legId]: { quantity, price } }))
      return
    }
    setChangeInputs((current) => ({ ...current, [legId]: { quantity, price } }))
  }

  function startEditEvent(event: PositionEvent) {
    setEditingEventId(event.id)
    setEditingEventType(event.eventType as PositionEventActionType)
    setEditingEventDate(event.occurredAt.slice(0, 10))
    setEditingEventNote(event.note)
    setEditingChangeInputs(Object.fromEntries(event.legChanges.map((change) => [change.legId, { quantity: String(change.quantityChange), price: String(change.price) }])))
  }

  function startEditSnapshot(snapshot: PriceSnapshot) {
    setEditingSnapshotId(snapshot.id)
    setEditingSnapshotDraft(createSnapshotDraft(snapshot))
  }

  async function handleSaveReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await updateReview(currentDetail.position.id, {
      thesis: reviewDraft.thesis,
      plan: reviewDraft.plan,
      expectedScenario: reviewDraft.expectedScenario,
      riskNotes: reviewDraft.riskNotes,
      exitRule: reviewDraft.exitRule,
      reviewResult: reviewDraft.reviewResult,
      reviewConclusion: reviewDraft.reviewConclusion,
      executionAssessment: reviewDraft.executionAssessment,
      deviationReason: reviewDraft.deviationReason,
      resultAttribution: reviewDraft.resultAttribution,
      nextAction: reviewDraft.nextAction,
      reviewStatus: reviewDraft.reviewStatus,
      remarks: reviewDraft.remarks,
      tags: reviewDraft.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
    })
    setMessage('复盘已保存。')
  }

  async function handleSaveSnapshot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const payload = buildSnapshotInputFromLiveAndManual({
      positionId: currentDetail.position.id,
      snapshotAt: snapshotDraft.snapshotAt,
      note: snapshotDraft.note,
      legs: currentDetail.legs,
      liveQuote: currentRealtime.liveQuote,
      latestSnapshot,
      manualMarks: snapshotDraft.marks,
      underlyingPrice: snapshotDraft.underlyingPrice,
    })
    if (!payload) return void setMessage('请至少填写一条价格。')
    await saveSnapshot(payload)
    setMessage('正式估值已保存。')
  }

  async function handleUpdateSnapshot(snapshot: PriceSnapshot) {
    const legMarks = currentDetail.legs.map((leg) => editingSnapshotDraft.marks[leg.id] ? ({ legId: leg.id, markPrice: Number(editingSnapshotDraft.marks[leg.id]) }) : null).filter((item): item is { legId: string; markPrice: number } => Boolean(item))
    await editSnapshot(snapshot.id, { positionId: currentDetail.position.id, snapshotAt: editingSnapshotDraft.snapshotAt, underlyingPrice: editingSnapshotDraft.underlyingPrice ? Number(editingSnapshotDraft.underlyingPrice) : undefined, legMarks, note: editingSnapshotDraft.note })
    setEditingSnapshotId(undefined)
    setMessage('历史估值已更新。')
  }

  async function handleDeleteSnapshot(snapshot: PriceSnapshot) {
    if (!window.confirm('确认删除这条正式估值吗？')) return
    await removeSnapshot(snapshot.id)
    setMessage('正式估值已删除。')
  }

  async function handleAddEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const legChanges = Object.entries(changeInputs).map(([legId, value]) => ({ legId, quantityChange: Number(value.quantity), price: Number(value.price) })).filter((item) => item.quantityChange !== 0 && Number.isFinite(item.price))
    const appendedLegs = newLegs.filter((leg) => leg.contractCode.trim()).map(sanitizeLeg)
    if (!legChanges.length && !appendedLegs.length) return void setMessage('请至少填写一条数量变动或新增一条腿。')
    await addEvent({ positionId: currentDetail.position.id, eventType, occurredAt: eventDate, note: eventNote, legChanges, newLegs: appendedLegs })
    setChangeInputs({})
    setNewLegs([])
    setEventNote('')
    setEventType('add')
    setMessage('仓位事件已保存。')
  }

  async function handleUpdateEvent() {
    if (!editingEventId) return
    const legChanges = Object.entries(editingChangeInputs).map(([legId, value]) => ({ legId, quantityChange: Number(value.quantity), price: Number(value.price) })).filter((item) => item.quantityChange !== 0 && Number.isFinite(item.price))
    await editEvent(editingEventId, { positionId: currentDetail.position.id, eventType: editingEventType, occurredAt: editingEventDate, note: editingEventNote, legChanges })
    setEditingEventId(undefined)
    setMessage('历史事件已更新。')
  }

  async function handleDeleteEvent(event: PositionEvent) {
    if (!window.confirm('确认删除这条事件吗？')) return
    await removeEvent(event.id)
    setMessage('历史事件已删除。')
  }

  return (
    <>
      <section className="page-intro">
        <div>
          <h2>{detail.position.strategyName}</h2>
          <p>{formatAccountName(detail.position.accountType)} / {detail.position.product} / {detail.position.underlyingSymbol} / 开仓 {formatDate(detail.position.openedAt)}</p>
        </div>
        <div className="tag-row">
          <span className={`status-chip ${detail.position.status === 'closed' ? 'status-chip--closed' : ''}`}>{detail.position.status === 'open' ? '持仓中' : '已平仓'}</span>
          <span className="pill">review: {detail.position.reviewStatus}</span>
          {detail.position.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}
        </div>
      </section>

      <section className="metric-grid">
        <article className="metric-card metric-card--accent"><span>当前浮盈亏</span><strong className={metrics.unrealizedPnl >= 0 ? 'delta-positive' : 'delta-negative'}>{formatMoney(metrics.unrealizedPnl)}</strong></article>
        <article className="metric-card"><span>已实现盈亏</span><strong className={metrics.realizedPnl >= 0 ? 'delta-positive' : 'delta-negative'}>{formatMoney(metrics.realizedPnl)}</strong></article>
        <article className="metric-card"><span>最近行情</span><strong>{realtime.liveAsOf ? formatDateTime(realtime.liveAsOf) : '使用正式估值'}</strong></article>
        <article className="metric-card metric-card--soft"><span>到期提醒</span><strong>{formatDaysLabel(expiryDays)}</strong></article>
      </section>

      {message ? <div className="notice-banner">{message}</div> : null}

      <section className="detail-grid">
        <article className="card">
          <div className="section-head"><div><h3>概览与审计</h3><p>工作流状态、导入信息和审计信息都放在这里。</p></div></div>
          <div className="summary-list">
            <div className="kv-block"><span>工作流</span><strong>{[workflow.needsReview ? '待复盘' : '', workflow.needsManualValuation ? '待估值' : '', workflow.hasDataIssue ? '有异常' : ''].filter(Boolean).join(' / ') || '正常'} / {workflow.daysSinceLastUpdate} 天未更新</strong></div>
            <div className="kv-block"><span>最近修改</span><strong>{detail.position.audit.sourceLabel} / {detail.position.audit.lastModifiedType} / {formatDateTime(detail.position.audit.lastModifiedAt)}</strong></div>
            <div className="kv-block"><span>计划</span><strong>{clampText(detail.position.plan || detail.position.thesis, '未填写')}</strong></div>
            <div className="kv-block"><span>导入附注</span><strong>{clampText(detail.position.importNotes.join('；'), '暂无导入附注')}</strong></div>
          </div>
        </article>

        <article className="card">
          <div className="section-head"><div><h3>持仓明细</h3><p>这里看当前数量、估值覆盖和盈亏。</p></div></div>
          <div className="list-stack">
            {detail.legs.map((leg) => {
              const legMetric = metrics.legMetrics.find((item) => item.legId === leg.id)
              return <article className="holding-card" key={leg.id}><div className="holding-card__top"><div><strong>{leg.contractCode}</strong><p>{leg.side} / {formatQuoteCoverage(getLegCoverage(leg, realtime.liveQuote, latestSnapshot))}</p></div></div><div className="stats-inline-grid"><div className="kv"><span>数量</span><strong>{legMetric?.currentQty ?? leg.qty}</strong></div><div className="kv"><span>均价</span><strong>{formatMoney(legMetric?.avgCost ?? leg.entryPrice)}</strong></div><div className="kv"><span>估值</span><strong>{legMetric?.markPrice != null ? formatMoney(legMetric.markPrice) : '未估值'}</strong></div><div className="kv"><span>未实现盈亏</span><strong className={(legMetric?.unrealizedPnl ?? 0) >= 0 ? 'delta-positive' : 'delta-negative'}>{formatMoney(legMetric?.unrealizedPnl ?? 0)}</strong></div></div></article>
            })}
          </div>
        </article>
      </section>

      <section className="detail-grid">
        <form className="card form-card" onSubmit={handleSaveSnapshot}>
          <div className="section-head"><div><h3>新建正式估值</h3><p>自动价格和手动价格会合并成正式快照。</p></div></div>
          <div className="form-grid form-grid--three"><div className="field"><label>估值日期</label><input type="date" value={snapshotDraft.snapshotAt} onChange={(event) => setSnapshotDraft((current) => ({ ...current, snapshotAt: event.target.value }))} /></div><div className="field"><label>标的价格</label><input step="0.0001" type="number" value={snapshotDraft.underlyingPrice} onChange={(event) => setSnapshotDraft((current) => ({ ...current, underlyingPrice: event.target.value }))} /></div><div className="field field--wide"><label>说明</label><input value={snapshotDraft.note} onChange={(event) => setSnapshotDraft((current) => ({ ...current, note: event.target.value }))} /></div></div>
          <div className="list-stack">{detail.legs.map((leg) => <div className="field" key={leg.id}><label>{leg.contractCode} 价格</label><input step="0.0001" type="number" value={snapshotDraft.marks[leg.id] ?? ''} onChange={(event) => setSnapshotDraft((current) => ({ ...current, marks: { ...current.marks, [leg.id]: event.target.value } }))} /></div>)}</div>
          <div className="form-actions"><button className="btn" type="submit">保存正式估值</button></div>
        </form>

        <article className="card">
          <div className="section-head"><div><h3>历史估值</h3><p>手工快照支持编辑和删除，自动收盘快照只读。</p></div></div>
          <div className="list-stack">
            {detail.snapshots.length ? detail.snapshots.map((snapshot) => <article className="holding-card" key={snapshot.id}><div className="holding-card__top"><div><strong>{formatDateTime(snapshot.snapshotAt)}</strong><p>{snapshot.audit.sourceLabel}</p></div><div className="tag-row">{snapshot.audit.sourceType !== 'auto_close' ? <><button className="btn btn--ghost" type="button" onClick={() => startEditSnapshot(snapshot)}>编辑</button><button className="btn btn--ghost" type="button" onClick={() => void handleDeleteSnapshot(snapshot)}>删除</button></> : <span className="pill">自动收盘快照</span>}</div></div>{editingSnapshotId === snapshot.id ? <div className="list-stack"><div className="form-grid form-grid--three"><div className="field"><label>日期</label><input type="date" value={editingSnapshotDraft.snapshotAt} onChange={(event) => setEditingSnapshotDraft((current) => ({ ...current, snapshotAt: event.target.value }))} /></div><div className="field"><label>标的</label><input step="0.0001" type="number" value={editingSnapshotDraft.underlyingPrice} onChange={(event) => setEditingSnapshotDraft((current) => ({ ...current, underlyingPrice: event.target.value }))} /></div><div className="field field--wide"><label>说明</label><input value={editingSnapshotDraft.note} onChange={(event) => setEditingSnapshotDraft((current) => ({ ...current, note: event.target.value }))} /></div></div><div className="list-stack">{detail.legs.map((leg) => <div className="field" key={leg.id}><label>{leg.contractCode}</label><input step="0.0001" type="number" value={editingSnapshotDraft.marks[leg.id] ?? ''} onChange={(event) => setEditingSnapshotDraft((current) => ({ ...current, marks: { ...current.marks, [leg.id]: event.target.value } }))} /></div>)}</div><div className="form-actions"><button className="btn" type="button" onClick={() => void handleUpdateSnapshot(snapshot)}>保存修改</button><button className="btn btn--secondary" type="button" onClick={() => setEditingSnapshotId(undefined)}>取消</button></div></div> : <div className="summary-list"><div className="kv-block"><span>说明</span><strong>{snapshot.note || '无备注'}</strong></div><div className="kv-block"><span>标的</span><strong>{snapshot.underlyingPrice != null ? formatMoney(snapshot.underlyingPrice) : '未记录'}</strong></div></div>}</article>) : <div className="empty-inline">还没有正式估值记录。</div>}
          </div>
        </article>
      </section>

      <form className="card form-card" onSubmit={handleSaveReview}>
        <div className="section-head"><div><h3>结构化复盘</h3><p>把计划、执行偏差、结果归因和下次规则补齐。</p></div></div>
        <div className="form-grid">
          <div className="field field--wide"><label>Thesis</label><textarea value={reviewDraft.thesis} onChange={(event) => setReviewDraft((current) => ({ ...current, thesis: event.target.value }))} /></div>
          <div className="field field--wide"><label>Plan</label><textarea value={reviewDraft.plan} onChange={(event) => setReviewDraft((current) => ({ ...current, plan: event.target.value }))} /></div>
          <div className="field field--wide"><label>Expected</label><textarea value={reviewDraft.expectedScenario} onChange={(event) => setReviewDraft((current) => ({ ...current, expectedScenario: event.target.value }))} /></div>
          <div className="field field--wide"><label>Risk Notes</label><textarea value={reviewDraft.riskNotes} onChange={(event) => setReviewDraft((current) => ({ ...current, riskNotes: event.target.value }))} /></div>
          <div className="field field--wide"><label>Exit Rule</label><textarea value={reviewDraft.exitRule} onChange={(event) => setReviewDraft((current) => ({ ...current, exitRule: event.target.value }))} /></div>
          <div className="field field--wide"><label>Execution</label><textarea value={reviewDraft.executionAssessment} onChange={(event) => setReviewDraft((current) => ({ ...current, executionAssessment: event.target.value }))} /></div>
          <div className="field field--wide"><label>Deviation</label><textarea value={reviewDraft.deviationReason} onChange={(event) => setReviewDraft((current) => ({ ...current, deviationReason: event.target.value }))} /></div>
          <div className="field field--wide"><label>Result</label><textarea value={reviewDraft.reviewResult} onChange={(event) => setReviewDraft((current) => ({ ...current, reviewResult: event.target.value }))} /></div>
          <div className="field field--wide"><label>Attribution</label><textarea value={reviewDraft.resultAttribution} onChange={(event) => setReviewDraft((current) => ({ ...current, resultAttribution: event.target.value }))} /></div>
          <div className="field field--wide"><label>Conclusion</label><textarea value={reviewDraft.reviewConclusion} onChange={(event) => setReviewDraft((current) => ({ ...current, reviewConclusion: event.target.value }))} /></div>
          <div className="field field--wide"><label>Next Action</label><textarea value={reviewDraft.nextAction} onChange={(event) => setReviewDraft((current) => ({ ...current, nextAction: event.target.value }))} /></div>
          <div className="field"><label>Review Status</label><select value={reviewDraft.reviewStatus} onChange={(event) => setReviewDraft((current) => ({ ...current, reviewStatus: event.target.value as StrategyPosition['reviewStatus'] }))}><option value="pending">pending</option><option value="ready">ready</option><option value="reviewed">reviewed</option></select></div>
          <div className="field field--wide"><label>Tags</label><input value={reviewDraft.tags} onChange={(event) => setReviewDraft((current) => ({ ...current, tags: event.target.value }))} /></div>
          <div className="field field--wide"><label>Remarks</label><textarea value={reviewDraft.remarks} onChange={(event) => setReviewDraft((current) => ({ ...current, remarks: event.target.value }))} /></div>
        </div>
        <div className="form-actions"><button className="btn" type="submit">保存复盘</button></div>
      </form>

      {editingEventId ? <article className="card form-card"><div className="section-head"><div><h3>编辑历史事件</h3><p>修改后会重算成本和盈亏。</p></div></div><div className="form-grid form-grid--three"><div className="field"><label>类型</label><select value={editingEventType} onChange={(event) => setEditingEventType(event.target.value as PositionEventActionType)}>{POSITION_EVENT_ACTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div><div className="field"><label>日期</label><input type="date" value={editingEventDate} onChange={(event) => setEditingEventDate(event.target.value)} /></div><div className="field field--wide"><label>说明</label><input value={editingEventNote} onChange={(event) => setEditingEventNote(event.target.value)} /></div></div><div className="list-stack">{detail.legs.map((leg) => <article className="holding-card" key={leg.id}><div className="holding-card__top"><div><strong>{leg.contractCode}</strong><p>仅编辑数量和成交价</p></div></div><div className="form-grid form-grid--three"><div className="field"><label>数量</label><input step="0.01" type="number" value={editingChangeInputs[leg.id]?.quantity ?? ''} onChange={(event) => setChangeValue(leg.id, event.target.value, editingChangeInputs[leg.id]?.price ?? '', true)} /></div><div className="field"><label>价格</label><input step="0.0001" type="number" value={editingChangeInputs[leg.id]?.price ?? ''} onChange={(event) => setChangeValue(leg.id, editingChangeInputs[leg.id]?.quantity ?? '', event.target.value, true)} /></div></div></article>)}</div><div className="form-actions"><button className="btn" type="button" onClick={() => void handleUpdateEvent()}>保存修改</button><button className="btn btn--secondary" type="button" onClick={() => setEditingEventId(undefined)}>取消</button></div></article> : null}

      <form className="card form-card" onSubmit={handleAddEvent}>
        <div className="section-head"><div><h3>新增仓位事件</h3><p>后续加仓、减仓、平仓、移仓都在这条记录下追加。</p></div></div>
        <div className="form-grid form-grid--three"><div className="field"><label>类型</label><select value={eventType} onChange={(event) => setEventType(event.target.value as PositionEventActionType)}>{POSITION_EVENT_ACTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div><div className="field"><label>日期</label><input type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} /></div><div className="field field--wide"><label>说明</label><input value={eventNote} onChange={(event) => setEventNote(event.target.value)} /></div></div>
        <div className="list-stack">{detail.legs.map((leg) => <article className="holding-card" key={leg.id}><div className="holding-card__top"><div><strong>{leg.contractCode}</strong><p>当前剩余 {metrics.legMetrics.find((item) => item.legId === leg.id)?.currentQty ?? leg.qty}</p></div></div><div className="form-grid form-grid--three"><div className="field"><label>数量</label><input step="0.01" type="number" value={changeInputs[leg.id]?.quantity ?? ''} onChange={(event) => setChangeValue(leg.id, event.target.value, changeInputs[leg.id]?.price ?? '')} /></div><div className="field"><label>价格</label><input step="0.0001" type="number" value={changeInputs[leg.id]?.price ?? ''} onChange={(event) => setChangeValue(leg.id, changeInputs[leg.id]?.quantity ?? '', event.target.value)} /></div></div></article>)}</div>
        <div className="section-head"><div><h3>本次事件新增腿</h3><p>移仓到新合约时在这里补。</p></div><button className="btn btn--secondary" type="button" onClick={() => setNewLegs((current) => [...current, emptyLeg()])}>新增持仓明细</button></div>
        {newLegs.length ? <div className="list-stack">{newLegs.map((leg, index) => <div className="leg-editor" key={leg.id ?? `draft-leg-${index}`}><div className="leg-editor__header"><div><strong>新增腿 {index + 1}</strong></div><button className="btn btn--ghost" type="button" onClick={() => setNewLegs((current) => current.filter((_, currentIndex) => currentIndex !== index))}>删除</button></div><div className="form-grid form-grid--six"><div className="field"><label>类型</label><select value={leg.instrumentType} onChange={(event) => setNewLegs((current) => current.map((item, currentIndex) => currentIndex === index ? { ...item, instrumentType: event.target.value as 'future' | 'option', optionType: event.target.value === 'future' ? null : item.optionType ?? 'C' } : item))}><option value="option">期权</option><option value="future">期货</option></select></div><div className="field"><label>方向</label><select value={leg.side} onChange={(event) => setNewLegs((current) => current.map((item, currentIndex) => currentIndex === index ? { ...item, side: event.target.value as 'long' | 'short' } : item))}><option value="long">多头</option><option value="short">空头</option></select></div><div className="field"><label>合约</label><input value={leg.contractCode} onChange={(event) => setNewLegs((current) => current.map((item, currentIndex) => currentIndex === index ? { ...item, contractCode: event.target.value } : item))} /></div><div className="field"><label>数量</label><input step="0.01" type="number" value={leg.qty} onChange={(event) => setNewLegs((current) => current.map((item, currentIndex) => currentIndex === index ? { ...item, qty: Number(event.target.value) } : item))} /></div><div className="field"><label>价格</label><input step="0.0001" type="number" value={leg.entryPrice} onChange={(event) => setNewLegs((current) => current.map((item, currentIndex) => currentIndex === index ? { ...item, entryPrice: Number(event.target.value) } : item))} /></div><div className="field"><label>乘数</label><input step="0.01" type="number" value={leg.multiplier} onChange={(event) => setNewLegs((current) => current.map((item, currentIndex) => currentIndex === index ? { ...item, multiplier: Number(event.target.value) } : item))} /></div></div></div>)}</div> : null}
        <div className="form-actions"><button className="btn" type="submit">保存仓位事件</button></div>
      </form>

      <EventTimeline events={detail.events} legs={detail.legs} onEditEvent={startEditEvent} onDeleteEvent={(event) => void handleDeleteEvent(event)} />
    </>
  )
}
