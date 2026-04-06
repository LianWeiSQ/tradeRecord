import type {
  LegMetrics,
  PositionEvent,
  PositionMetrics,
  PriceSnapshot,
  StrategyLeg,
} from '../types/trade'

function sideSign(side: StrategyLeg['side']): 1 | -1 {
  return side === 'long' ? 1 : -1
}

export function calculateLegMetrics(
  leg: StrategyLeg,
  events: PositionEvent[],
  snapshot?: PriceSnapshot,
): LegMetrics {
  const sign = sideSign(leg.side)
  let positionQty = sign * leg.qty
  let avgCost = leg.entryPrice
  let realizedPnl = 0
  const changeEvents = [...events]
    .filter((event) => !event.isInitial)
    .sort(
      (left, right) =>
        new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime(),
    )

  for (const event of changeEvents) {
    const change = event.legChanges.find((item) => item.legId === leg.id)

    if (!change || change.quantityChange === 0) {
      continue
    }

    const tradeQty = sign * change.quantityChange
    const tradePrice = change.price

    if (positionQty === 0 || Math.sign(positionQty) === Math.sign(tradeQty)) {
      const currentAbs = Math.abs(positionQty)
      const tradeAbs = Math.abs(tradeQty)
      const totalAbs = currentAbs + tradeAbs
      avgCost =
        totalAbs === 0
          ? tradePrice
          : (currentAbs * avgCost + tradeAbs * tradePrice) / totalAbs
      positionQty += tradeQty
      continue
    }

    const closeQty = Math.min(Math.abs(positionQty), Math.abs(tradeQty))
    realizedPnl += closeQty * (tradePrice - avgCost) * leg.multiplier * Math.sign(positionQty)
    positionQty += tradeQty

    if (positionQty === 0) {
      avgCost = 0
    } else if (Math.sign(positionQty) === Math.sign(tradeQty)) {
      avgCost = tradePrice
    }
  }

  const markPrice = snapshot?.legMarks.find((mark) => mark.legId === leg.id)?.markPrice
  const unrealizedPnl =
    markPrice == null ? 0 : positionQty * (markPrice - avgCost) * leg.multiplier
  const currentQty = Math.abs(positionQty)
  const currentValue =
    markPrice == null ? currentQty * avgCost * leg.multiplier : currentQty * markPrice * leg.multiplier

  return {
    legId: leg.id,
    currentQty,
    avgCost,
    markPrice,
    realizedPnl,
    unrealizedPnl,
    currentValue,
  }
}

export function calculatePositionMetrics(
  legs: StrategyLeg[],
  events: PositionEvent[],
  snapshot?: PriceSnapshot,
): PositionMetrics {
  const legMetrics = legs.map((leg) => calculateLegMetrics(leg, events, snapshot))

  return {
    totalQty: legMetrics.reduce((sum, leg) => sum + leg.currentQty, 0),
    realizedPnl: legMetrics.reduce((sum, leg) => sum + leg.realizedPnl, 0),
    unrealizedPnl: legMetrics.reduce((sum, leg) => sum + leg.unrealizedPnl, 0),
    latestMarkAt: snapshot?.snapshotAt,
    legMetrics,
  }
}

export function inferPositionStatus(metrics: PositionMetrics): 'open' | 'closed' {
  return metrics.totalQty > 0 ? 'open' : 'closed'
}

export function nearestExpiryDays(legs: StrategyLeg[], now = new Date()): number | undefined {
  const diffs = legs
    .filter((leg) => leg.expiryDate)
    .map((leg) => {
      const expiryDate = new Date(leg.expiryDate as string)
      return Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    })
    .filter((days) => Number.isFinite(days))

  if (!diffs.length) {
    return undefined
  }

  return Math.min(...diffs)
}
