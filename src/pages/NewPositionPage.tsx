import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { StrategyPositionForm } from '../components/StrategyPositionForm'
import { useTradeData } from '../components/TradeDataProvider'
import type { StrategyPositionInput } from '../types/trade'

export function NewPositionPage() {
  const navigate = useNavigate()
  const { createPosition } = useTradeData()
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')

  async function handleSubmit(value: StrategyPositionInput) {
    setSubmitting(true)
    setMessage('')

    try {
      const positionId = await createPosition(value)
      navigate(`/positions/${positionId}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '创建失败，请稍后重试。')
      setSubmitting(false)
    }
  }

  return (
    <>
      <section className="page-intro">
        <div>
          <h2>手动开仓</h2>
          <p>这里专门新建一笔交易记录。开仓后不再重复新建，后续动作统一在详情页继续维护。</p>
        </div>
      </section>

      <StrategyPositionForm onSubmit={handleSubmit} submitting={submitting} />

      {message ? <div className="notice-banner">{message}</div> : null}
    </>
  )
}
