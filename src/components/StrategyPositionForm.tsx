import { useMemo, useState, type FormEvent } from 'react'
import { ACCOUNTS } from '../types/trade'
import type { StrategyLegInput, StrategyPositionInput } from '../types/trade'

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

export function StrategyPositionForm({
  onSubmit,
  submitting = false,
}: StrategyPositionFormProps) {
  const [accountType, setAccountType] = useState<'live' | 'paper'>('live')
  const [product, setProduct] = useState('')
  const [underlyingSymbol, setUnderlyingSymbol] = useState('')
  const [strategyName, setStrategyName] = useState('')
  const [openedAt, setOpenedAt] = useState(today())
  const [tags, setTags] = useState('手动录入')
  const [legs, setLegs] = useState<StrategyLegInput[]>([createEmptyLeg()])

  const canSubmit = useMemo(
    () =>
      product.trim() &&
      underlyingSymbol.trim() &&
      strategyName.trim() &&
      legs.every((leg) => leg.contractCode.trim() && leg.qty > 0),
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
      thesis: '',
      plan: '',
      expectedScenario: '',
      reviewResult: '',
      reviewConclusion: '',
      tags: tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      remarks: '',
      legs: legs.map((leg) => ({
        ...leg,
        contractCode: leg.contractCode.trim(),
        expiryDate: leg.expiryDate || undefined,
        strikePrice: leg.strikePrice || undefined,
        note: '',
      })),
    })
  }

  return (
    <form className="card form-card" onSubmit={handleSubmit}>
      <div className="section-head">
        <div>
          <h3>开仓信息</h3>
          <p>开仓页只录建立交易所需的最小字段，提交后直接写入 Python 后端。</p>
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
            placeholder="例如：股指、燃油、鸡蛋"
            required
            value={product}
            onChange={(event) => setProduct(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="underlyingSymbol">标的合约</label>
          <input
            id="underlyingSymbol"
            placeholder="例如：IH2509 / FU2602"
            required
            value={underlyingSymbol}
            onChange={(event) => setUnderlyingSymbol(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="strategyName">交易名称</label>
          <input
            id="strategyName"
            placeholder="例如：股指保护性看跌"
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
            placeholder="逗号分隔，例如：波段, 套保"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
          />
        </div>
      </div>

      <div className="section-head">
        <div>
          <h3>持仓明细</h3>
          <p>默认先录 1 条持仓明细，支持期货和期权混合录入。</p>
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
                <p>录入合约、方向、数量、开仓价、乘数和期权信息。</p>
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
                  placeholder="例如：HO2509-C / IH2509"
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
