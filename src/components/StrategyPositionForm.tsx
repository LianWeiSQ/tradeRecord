import { useMemo, useState, type FormEvent } from 'react'
import { ACCOUNTS } from '../types/trade'
import type { ReviewStatus, StrategyLegInput, StrategyPositionInput } from '../types/trade'

interface StrategyPositionFormProps {
  onSubmit: (value: StrategyPositionInput) => Promise<void>
  submitting?: boolean
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function createEmptyLeg(): StrategyLegInput {
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

function emptyReviewStatus(): ReviewStatus {
  return 'pending'
}

export function StrategyPositionForm({
  onSubmit,
  submitting = false,
}: StrategyPositionFormProps) {
  const [accountType, setAccountType] = useState<'live' | 'paper'>('live')
  const [product, setProduct] = useState('')
  const [underlyingSymbol, setUnderlyingSymbol] = useState('')
  const [strategyName, setStrategyName] = useState('')
  const [openedAt, setOpenedAt] = useState(today())
  const [thesis, setThesis] = useState('')
  const [plan, setPlan] = useState('')
  const [expectedScenario, setExpectedScenario] = useState('')
  const [riskNotes, setRiskNotes] = useState('')
  const [exitRule, setExitRule] = useState('')
  const [remarks, setRemarks] = useState('')
  const [tags, setTags] = useState('手动录入')
  const [legs, setLegs] = useState<StrategyLegInput[]>([createEmptyLeg()])

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
      legs: legs.map((leg) => ({
        ...leg,
        contractCode: leg.contractCode.trim(),
        expiryDate: leg.expiryDate || undefined,
        strikePrice: leg.strikePrice || undefined,
        note: leg.note?.trim() || '',
      })),
    })
  }

  return (
    <form className="card form-card" onSubmit={handleSubmit}>
      <div className="section-head">
        <div>
          <h3>开仓基础信息</h3>
          <p>开仓时把交易计划录完整，后续事件、估值和复盘都围绕这条记录继续维护。</p>
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

        <div className="field">
          <label htmlFor="tags">标签</label>
          <input
            id="tags"
            placeholder="逗号分隔，例如: 趋势, 套保"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
          />
        </div>
      </div>

      <div className="section-head">
        <div>
          <h3>交易计划</h3>
          <p>这些字段决定后续复盘能否闭环，宁可简洁，也不要留空到收尾时再补。</p>
        </div>
      </div>

      <div className="form-grid">
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

        <div className="field field--wide">
          <label htmlFor="remarks">备注</label>
          <textarea
            id="remarks"
            placeholder="补充背景、盘前计划、新闻事件等"
            value={remarks}
            onChange={(event) => setRemarks(event.target.value)}
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
          <div className="leg-editor" key={`${leg.contractCode}-${index}`}>
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
                <label>备注</label>
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

      <div className="form-actions">
        <button className="btn" disabled={!canSubmit || submitting} type="submit">
          {submitting ? '保存中...' : '保存开仓'}
        </button>
      </div>
    </form>
  )
}
