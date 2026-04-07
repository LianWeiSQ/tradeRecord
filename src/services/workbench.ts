import { nearestExpiryDays } from './calculations'
import { buildDashboardGroups } from './dashboard'
import type {
  DashboardPositionView,
  PositionEvent,
  PriceSnapshot,
  ReviewStatsView,
  StrategyLeg,
  StrategyPosition,
  WorkItemView,
} from '../types/trade'

function normalizeSearch(value: string) {
  return value.trim().toLowerCase()
}

function holdingDays(position: StrategyPosition, events: PositionEvent[]) {
  const latestEventAt = [...events]
    .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime())[0]
    ?.occurredAt

  const start = new Date(position.openedAt)
  const end = new Date(latestEventAt ?? position.updatedAt)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 0
  }

  return Math.max(Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)), 0)
}

export function buildPositionViews(
  positions: StrategyPosition[],
  legs: StrategyLeg[],
  events: PositionEvent[],
  snapshots: PriceSnapshot[],
): DashboardPositionView[] {
  return buildDashboardGroups(positions, legs, events, snapshots).flatMap((group) => group.positions)
}

export function matchesPositionSearch(
  position: StrategyPosition,
  legs: StrategyLeg[],
  query: string,
) {
  const normalized = normalizeSearch(query)
  if (!normalized) {
    return true
  }

  const haystack = [
    position.strategyName,
    position.product,
    position.underlyingSymbol,
    position.thesis,
    position.plan,
    position.expectedScenario,
    position.riskNotes,
    position.exitRule,
    position.reviewResult,
    position.reviewConclusion,
    position.executionAssessment,
    position.deviationReason,
    position.resultAttribution,
    position.nextAction,
    position.remarks,
    position.tags.join(' '),
    legs.map((leg) => leg.contractCode).join(' '),
  ]
    .join(' ')
    .toLowerCase()

  return haystack.includes(normalized)
}

export function buildWorkItems(views: DashboardPositionView[]): WorkItemView[] {
  const items: WorkItemView[] = []

  for (const view of views) {
    const { position, legs, latestSnapshot } = view
    const expiryDays = nearestExpiryDays(legs)

    if (position.workflowState.needsReview) {
      items.push({
        id: `${position.id}-review`,
        positionId: position.id,
        kind: 'review',
        title: `待复盘: ${position.strategyName}`,
        detail: `${position.product} / ${position.underlyingSymbol}`,
        priority: 'high',
        dueLabel: position.updatedAt,
      })
    }

    if (position.workflowState.needsManualValuation) {
      items.push({
        id: `${position.id}-valuation`,
        positionId: position.id,
        kind: 'valuation',
        title: `待补估值: ${position.strategyName}`,
        detail: latestSnapshot ? `最近估值 ${latestSnapshot.snapshotAt}` : '还没有正式估值快照',
        priority: 'high',
        dueLabel: latestSnapshot?.snapshotAt,
      })
    }

    if (position.status === 'open' && expiryDays != null && expiryDays <= 3) {
      items.push({
        id: `${position.id}-expiry`,
        positionId: position.id,
        kind: 'expiry',
        title: `临近到期: ${position.strategyName}`,
        detail: `${position.product} / ${position.underlyingSymbol}`,
        priority: expiryDays <= 1 ? 'high' : 'medium',
        dueLabel: `${expiryDays} 天`,
      })
    }

    if (position.status === 'open' && position.workflowState.daysSinceLastUpdate >= 3) {
      items.push({
        id: `${position.id}-stale`,
        positionId: position.id,
        kind: 'stale',
        title: `长时间未更新: ${position.strategyName}`,
        detail: `${position.workflowState.daysSinceLastUpdate} 天未记录事件或估值`,
        priority: position.workflowState.daysSinceLastUpdate >= 7 ? 'high' : 'medium',
      })
    }

    if (position.workflowState.hasDataIssue) {
      items.push({
        id: `${position.id}-data-issue`,
        positionId: position.id,
        kind: 'data_issue',
        title: `数据异常待处理: ${position.strategyName}`,
        detail: '该交易存在仓位、事件或估值异常，请检查历史记录。',
        priority: 'high',
      })
    }
  }

  const priorityRank = { high: 0, medium: 1, low: 2 }
  return items.sort((left, right) => priorityRank[left.priority] - priorityRank[right.priority])
}

export function buildReviewStats(views: DashboardPositionView[]): ReviewStatsView {
  const closedViews = views.filter((view) => view.position.status === 'closed')
  const realized = closedViews.map((view) => view.metrics.realizedPnl)
  const reviewedCount = closedViews.filter((view) => view.position.reviewStatus === 'reviewed').length
  const pendingCount = closedViews.filter((view) => view.position.reviewStatus !== 'reviewed').length
  const averageHoldingDays =
    closedViews.length === 0
      ? 0
      : Math.round(
          closedViews.reduce(
            (sum, view) => sum + holdingDays(view.position, view.events),
            0,
          ) / closedViews.length,
        )

  return {
    totalClosed: closedViews.length,
    reviewedCount,
    pendingCount,
    winRate:
      closedViews.length === 0
        ? 0
        : closedViews.filter((view) => view.metrics.realizedPnl > 0).length / closedViews.length,
    averageHoldingDays,
    bestPnl: realized.length ? Math.max(...realized) : 0,
    worstPnl: realized.length ? Math.min(...realized) : 0,
  }
}
