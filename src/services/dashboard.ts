import { calculatePositionMetrics, nearestExpiryDays } from './calculations'
import type {
  DashboardGroupView,
  DashboardPositionView,
  PositionEvent,
  PriceSnapshot,
  StrategyLeg,
  StrategyPosition,
} from '../types/trade'

function latestSnapshotMap(snapshots: PriceSnapshot[]): Map<string, PriceSnapshot> {
  const map = new Map<string, PriceSnapshot>()

  for (const snapshot of snapshots) {
    const existing = map.get(snapshot.positionId)
    if (
      !existing ||
      new Date(snapshot.snapshotAt).getTime() > new Date(existing.snapshotAt).getTime()
    ) {
      map.set(snapshot.positionId, snapshot)
    }
  }

  return map
}

export function buildDashboardGroups(
  positions: StrategyPosition[],
  legs: StrategyLeg[],
  events: PositionEvent[],
  snapshots: PriceSnapshot[],
): DashboardGroupView[] {
  const legsByPosition = new Map<string, StrategyLeg[]>()
  const eventsByPosition = new Map<string, PositionEvent[]>()
  const snapshotByPosition = latestSnapshotMap(snapshots)

  for (const leg of legs) {
    const bucket = legsByPosition.get(leg.positionId) ?? []
    bucket.push(leg)
    legsByPosition.set(leg.positionId, bucket)
  }

  for (const event of events) {
    const bucket = eventsByPosition.get(event.positionId) ?? []
    bucket.push(event)
    eventsByPosition.set(event.positionId, bucket)
  }

  const views: DashboardPositionView[] = positions.map((position) => {
    const positionLegs = legsByPosition.get(position.id) ?? []
    const positionEvents = eventsByPosition.get(position.id) ?? []
    const latestSnapshot = snapshotByPosition.get(position.id)
    const metrics = calculatePositionMetrics(positionLegs, positionEvents, latestSnapshot)

    return {
      position,
      legs: positionLegs,
      events: positionEvents,
      latestSnapshot,
      metrics,
      nearestExpiryDays: nearestExpiryDays(positionLegs),
    }
  })

  const grouped = new Map<string, DashboardGroupView>()

  for (const view of views) {
    const key = `${view.position.accountType}::${view.position.product}`
    const current = grouped.get(key)

    if (!current) {
      grouped.set(key, {
        accountType: view.position.accountType,
        product: view.position.product,
        positions: [view],
        openCount: view.metrics.totalQty > 0 ? 1 : 0,
        totalRealizedPnl: view.metrics.realizedPnl,
        totalUnrealizedPnl: view.metrics.unrealizedPnl,
        nearestExpiryDays: view.nearestExpiryDays,
        latestSnapshotAt: view.latestSnapshot?.snapshotAt,
      })
      continue
    }

    current.positions.push(view)
    current.openCount += view.metrics.totalQty > 0 ? 1 : 0
    current.totalRealizedPnl += view.metrics.realizedPnl
    current.totalUnrealizedPnl += view.metrics.unrealizedPnl
    current.nearestExpiryDays =
      current.nearestExpiryDays == null
        ? view.nearestExpiryDays
        : view.nearestExpiryDays == null
          ? current.nearestExpiryDays
          : Math.min(current.nearestExpiryDays, view.nearestExpiryDays)

    if (
      view.latestSnapshot?.snapshotAt &&
      (!current.latestSnapshotAt ||
        new Date(view.latestSnapshot.snapshotAt).getTime() >
          new Date(current.latestSnapshotAt).getTime())
    ) {
      current.latestSnapshotAt = view.latestSnapshot.snapshotAt
    }
  }

  return [...grouped.values()]
    .map((group) => ({
      ...group,
      positions: group.positions.sort(
        (left, right) =>
          new Date(right.position.openedAt).getTime() -
          new Date(left.position.openedAt).getTime(),
      ),
    }))
    .sort((left, right) => {
      if (left.accountType !== right.accountType) {
        return left.accountType.localeCompare(right.accountType)
      }

      return left.product.localeCompare(right.product, 'zh-CN')
    })
}
