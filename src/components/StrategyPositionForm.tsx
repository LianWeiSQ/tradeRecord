import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { usePersistentState } from '../hooks/usePersistentState'
import { ACCOUNTS } from '../types/trade'
import type { ReviewStatus, StrategyLegInput, StrategyPositionInput } from '../types/trade'

interface StrategyPositionFormProps {
  onSubmit: (value: StrategyPositionInput) => Promise<void>
  submitting?: boolean
}

interface StrategyPositionFormDraft {
  accountType: 'live' | 'paper'
  product: string
  underlyingSymbol: string
  strategyName: string
  openedAt: string
  showAdvancedFields?: boolean
  showPlanningFields?: boolean
  thesis: string
  plan: string
  expectedScenario: string
  riskNotes: string
  exitRule: string
  remarks: string
  tags: string
  legs: StrategyLegInput[]
}

const FORM_DRAFT_STORAGE_KEY = 'trade-record:new-position:draft'
const DEFAULT_TAGS = '手动录入'

function today() {
  return new Date().toISOString().slice(0, 10)
}

function createEmptyLeg(): StrategyLegInput {
  return {
    id: crypto.randomUUID(),
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

function emptyReviewStatus(): ReviewStatus {
  return 'pending'
}

function createEmptyDraft(): StrategyPositionFormDraft {
  return {
    accountType: 'live',
    product: '',
    underlyingSymbol: '',
    strategyName: '',
    openedAt: today(),
    showAdvancedFields: false,
    thesis: '',
    plan: '',
    expectedScenario: '',
    riskNotes: '',
    exitRule: '',
    remarks: '',
    tags: DEFAULT_TAGS,
    legs: [createEmptyLeg()],
  }
}

function hasAdvancedContent(
  draft: Pick<
    StrategyPositionFormDraft,
    'thesis' | 'plan' | 'expectedScenario' | 'riskNotes' | 'exitRule' | 'remarks' | 'tags'
  >,
) {
  return Boolean(
    draft.thesis.trim() ||
      draft.plan.trim() ||
      draft.expectedScenario.trim() ||
      draft.riskNotes.trim() ||
      draft.exitRule.trim() ||
      draft.remarks.trim() ||
      draft.tags.trim() !== DEFAULT_TAGS,
  )
}

export function StrategyPositionForm({
  onSubmit,
  submitting = false,
}: StrategyPositionFormProps) {
  const [persistedDraft, setPersistedDraft] = usePersistentState<StrategyPositionFormDraft>(
    FORM_DRAFT_STORAGE_KEY,
    createEmptyDraft,
    'session',
  )
  const [accountType, setAccountType] = useState<'live' | 'paper'>(persistedDraft.accountType)
  const [product, setProduct] = useState(persistedDraft.product)
  const [underlyingSymbol, setUnderlyingSymbol] = useState(persistedDraft.underlyingSymbol)
  const [strategyName, setStrategyName] = useState(persistedDraft.strategyName)
  const [openedAt, setOpenedAt] = useState(persistedDraft.openedAt)
  const [showAdvancedFields, setShowAdvancedFields] = useState(
    persistedDraft.showAdvancedFields ??
      persistedDraft.showPlanningFields ??
      hasAdvancedContent(persistedDraft),
  )
  const [thesis, setThesis] = useState(persistedDraft.thesis)
  const [plan, setPlan] = useState(persistedDraft.plan)
  const [expectedScenario, setExpectedScenario] = useState(persistedDraft.expectedScenario)
  const [riskNotes, setRiskNotes] = useState(persistedDraft.riskNotes)
  const [exitRule, setExitRule] = useState(persistedDraft.exitRule)
  const [remarks, setRemarks] = useState(persistedDraft.remarks)
  const [tags, setTags] = useState(persistedDraft.tags)
  const [legs, setLegs] = useState<StrategyLegInput[]>(persistedDraft.legs)

  const canSubmit = useMemo(
    () =>
      product.trim() &&
      underlyingSymbol.trim() &&
      strategyName.trim() &&
      legs.every(
        (leg) =>
          leg.contractCode.trim() &&
          leg.qty > 0 &&
          leg.multiplier > 0 &&
          Number.isFinite(leg.entryPrice),
      ),
    [legs, product, strategyName, underlyingSymbol],
  )

  function updateLeg(index: number, patch: Partial<StrategyLegInput>) {
    setLegs((current) =>
      current.map((leg, currentIndex) => (currentIndex === index ? { ...leg, ...patch } : leg)),
    )
  }

  useEffect(() => {
    setPersistedDraft({
      accountType,
      product,
      underlyingSymbol,
      strategyName,
      openedAt,
      showAdvancedFields,
      thesis,
      plan,
      expectedScenario,
      riskNotes,
      exitRule,
      remarks,
      tags,
      legs,
    })
  }, [
    accountType,
    exitRule,
    expectedScenario,
    legs,
    openedAt,
    plan,
    product,
    remarks,
    riskNotes,
    setPersistedDraft,
    showAdvancedFields,
    strategyName,
    tags,
    thesis,
    underlyingSymbol,
  ])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!canSubmit) {
      return
    }

    await onSubmit({
      accountType,
      product: product.trim(),
      underlyingSymbol: underlyingSymbol.trim(),
      strategyName: strategyName.trim(),
      openedAt,
      thesis: thesis.trim(),
      plan: plan.trim(),
      expectedScenario: expectedScenario.trim(),
      riskNotes: riskNotes.trim(),
      exitRule: exitRule.trim(),
      reviewResult: '',
      reviewConclusion: '',
      executionAssessment: '',
      deviationReason: '',
      resultAttribution: '',
      nextAction: '',
      reviewStatus: emptyReviewStatus(),
      tags: tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      remarks: remarks.trim(),
      legs: legs.map((leg) => {
        const { id: _draftId, ...payload } = leg

        return {
          ...payload,
          contractCode: leg.contractCode.trim(),
          expiryDate: leg.expiryDate || undefined,
          strikePrice: leg.strikePrice || undefined,
          note: leg.note?.trim() || '',
        }
      }),
    })

    setPersistedDraft(createEmptyDraft())
  }

  return (
    <form className="card form-card" onSubmit={handleSubmit}>
      <div className="section-head">
        <div>
          <h3>开仓基础信息</h3>
          <p>默认只显示开仓必填字段，先完成基础录入。</p>
        </div>
      </div>

      <div className="form-grid form-grid--six">
        <div className="field">
          <label htmlFor="accountType">账户</label>
          <select
            id="accountType"
            value={accountType}
            onChange={(event) => setAccountType(event.target.value as 'live' | 'paper')}
          >
            {ACCOUNTS.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="product">品种</label>
          <input
            id="product"
            placeholder="例如: 股指、燃油、鸡蛋"
            required
            value={product}
            onChange={(event) => setProduct(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="underlyingSymbol">标的合约</label>
          <input
            id="underlyingSymbol"
            placeholder="例如: IH2509 / FU2602"
            required
            value={underlyingSymbol}
            onChange={(event) => setUnderlyingSymbol(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="strategyName">交易名称</label>
          <input
            id="strategyName"
            placeholder="例如: 股指保护性看跌"
            required
            value={strategyName}
            onChange={(event) => setStrategyName(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="openedAt">开仓日期</label>
          <input
            id="openedAt"
            required
            type="date"
            value={openedAt}
            onChange={(event) => setOpenedAt(event.target.value)}
          />
        </div>
      </div>

      <div className="section-head">
        <div>
          <h3>持仓明细</h3>
          <p>支持期货和期权混合录入，后续事件会在这组腿的基础上继续回算。</p>
        </div>
        <button
          className="btn btn--secondary"
          type="button"
          onClick={() => setLegs((current) => [...current, createEmptyLeg()])}
        >
          新增持仓明细
        </button>
      </div>

      <div className="list-stack">
        {legs.map((leg, index) => (
          <div className="leg-editor" key={leg.id ?? `draft-leg-${index}`}>
            <div className="leg-editor__header">
              <div>
                <strong>持仓明细 {index + 1}</strong>
                <p>录入合约、方向、数量、成本和合约属性。</p>
              </div>
              {legs.length > 1 ? (
                <button
                  className="btn btn--ghost"
                  type="button"
                  onClick={() =>
                    setLegs((current) => current.filter((_, currentIndex) => currentIndex !== index))
                  }
                >
                  删除
                </button>
              ) : null}
            </div>

            <div className="form-grid form-grid--six">
              <div className="field">
                <label>类型</label>
                <select
                  value={leg.instrumentType}
                  onChange={(event) =>
                    updateLeg(index, {
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
                    updateLeg(index, { side: event.target.value as 'long' | 'short' })
                  }
                >
                  <option value="long">多头 / 买入</option>
                  <option value="short">空头 / 卖出</option>
                </select>
              </div>

              <div className="field">
                <label>合约代码</label>
                <input
                  placeholder="例如: HO2509-C / IH2509"
                  required
                  value={leg.contractCode}
                  onChange={(event) => updateLeg(index, { contractCode: event.target.value })}
                />
              </div>

              <div className="field">
                <label>数量</label>
                <input
                  min="0.01"
                  required
                  step="0.01"
                  type="number"
                  value={leg.qty}
                  onChange={(event) => updateLeg(index, { qty: Number(event.target.value) })}
                />
              </div>

              <div className="field">
                <label>开仓价</label>
                <input
                  required
                  step="0.0001"
                  type="number"
                  value={leg.entryPrice}
                  onChange={(event) => updateLeg(index, { entryPrice: Number(event.target.value) })}
                />
              </div>

              <div className="field">
                <label>乘数</label>
                <input
                  min="0.01"
                  required
                  step="0.01"
                  type="number"
                  value={leg.multiplier}
                  onChange={(event) => updateLeg(index, { multiplier: Number(event.target.value) })}
                />
              </div>

              {leg.instrumentType === 'option' ? (
                <>
                  <div className="field">
                    <label>期权类型</label>
                    <select
                      value={leg.optionType ?? 'C'}
                      onChange={(event) =>
                        updateLeg(index, { optionType: event.target.value as 'C' | 'P' })
                      }
                    >
                      <option value="C">认购 C</option>
                      <option value="P">认沽 P</option>
                    </select>
                  </div>

                  <div className="field">
                    <label>行权价</label>
                    <input
                      step="0.01"
                      type="number"
                      value={leg.strikePrice ?? ''}
                      onChange={(event) =>
                        updateLeg(index, {
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
                      onChange={(event) => updateLeg(index, { expiryDate: event.target.value })}
                    />
                  </div>
                </>
              ) : null}

              <div className="field field--wide">
                <label>腿备注</label>
                <input
                  placeholder="这条腿的补充说明"
                  value={leg.note ?? ''}
                  onChange={(event) => updateLeg(index, { note: event.target.value })}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="section-head">
        <div>
          <h3>高级记录</h3>
          <p>标签、备注和交易计划都收在这里，想记时再展开。</p>
        </div>
        <button
          className="btn btn--secondary"
          type="button"
          onClick={() => setShowAdvancedFields((current) => !current)}
        >
          {showAdvancedFields ? '收起高级记录' : '展开高级记录'}
        </button>
      </div>

      {showAdvancedFields ? (
        <div className="form-grid">
          <div className="field field--wide">
            <label htmlFor="tags">标签</label>
            <input
              id="tags"
              placeholder="逗号分隔，例如: 趋势, 套保"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
            />
          </div>

          <div className="field field--wide">
            <label htmlFor="remarks">备注</label>
            <textarea
              id="remarks"
              placeholder="补充背景、盘前计划、新闻事件等"
              value={remarks}
              onChange={(event) => setRemarks(event.target.value)}
            />
          </div>

          <div className="field field--wide">
            <label htmlFor="thesis">交易 thesis</label>
            <textarea
              id="thesis"
              placeholder="这笔交易的核心判断是什么"
              value={thesis}
              onChange={(event) => setThesis(event.target.value)}
            />
          </div>

          <div className="field field--wide">
            <label htmlFor="plan">执行计划</label>
            <textarea
              id="plan"
              placeholder="准备怎么建仓、加减仓、观察什么信号"
              value={plan}
              onChange={(event) => setPlan(event.target.value)}
            />
          </div>

          <div className="field field--wide">
            <label htmlFor="expectedScenario">预期场景</label>
            <textarea
              id="expectedScenario"
              placeholder="理想走势、时间窗口和关键路径"
              value={expectedScenario}
              onChange={(event) => setExpectedScenario(event.target.value)}
            />
          </div>

          <div className="field field--wide">
            <label htmlFor="riskNotes">风险点</label>
            <textarea
              id="riskNotes"
              placeholder="最担心什么，哪些条件会否定原始判断"
              value={riskNotes}
              onChange={(event) => setRiskNotes(event.target.value)}
            />
          </div>

          <div className="field field--wide">
            <label htmlFor="exitRule">退出条件</label>
            <textarea
              id="exitRule"
              placeholder="止盈、止损、时间止损或结构调整规则"
              value={exitRule}
              onChange={(event) => setExitRule(event.target.value)}
            />
          </div>
        </div>
      ) : (
        <div className="kv-block">
          <span>可选说明</span>
          <strong>默认只展示基础信息和持仓明细；标签、备注和交易计划需要时再展开。</strong>
        </div>
      )}

      <div className="form-actions">
        <button className="btn" disabled={!canSubmit || submitting} type="submit">
          {submitting ? '保存中...' : '保存开仓'}
        </button>
      </div>
    </form>
  )
}
