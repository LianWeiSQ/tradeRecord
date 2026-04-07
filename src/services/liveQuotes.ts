import { calculatePositionMetrics } from './calculations'
import type {
  DashboardPositionView,
  LiveQuoteCoverageStatus,
  LiveQuoteState,
  PositionMetrics,
  PriceSnapshot,
  PriceSnapshotInput,
  QuoteCoverageView,
  StrategyLeg,
} from '../types/trade'

export interface RealtimePositionView {
  snapshot?: PriceSnapshot
  metrics: PositionMetrics
  coverageStatus: LiveQuoteCoverageStatus
  liveAsOf?: string
  sourceLabel?: string
  liveQuote?: LiveQuoteState
}

function buildLegMarkMap(snapshot?: PriceSnapshot) {
  return new Map(snapshot?.legMarks.map((mark) => [mark.legId, mark.markPrice]) ?? [])
}

export function buildRealtimeSnapshot(
  positionId: string,
  latestSnapshot: PriceSnapshot | undefined,
  liveQuote: LiveQuoteState | undefined,
): PriceSnapshot | undefined {
  if (!latestSnapshot && !liveQuote) {
    return undefined
  }

  const marks = buildLegMarkMap(latestSnapshot)

  if (liveQuote) {
    for (const legQuote of liveQuote.legQuotes) {
      if (legQuote.markPrice != null) {
        marks.set(legQuote.legId, legQuote.markPrice)
      }
    }
  }

  if (!marks.size && liveQuote?.underlyingPrice == null && latestSnapshot?.underlyingPrice == null) {
    return undefined
  }

  return {
    id: latestSnapshot?.id ?? `live-${positionId}`,
    positionId,
    snapshotAt: liveQuote?.asOf ?? latestSnapshot?.snapshotAt ?? new Date().toISOString(),
    underlyingPrice: liveQuote?.underlyingPrice ?? latestSnapshot?.underlyingPrice,
    legMarks: [...marks.entries()].map(([legId, markPrice]) => ({ legId, markPrice })),
    note: liveQuote ? '自动行情估值视图' : latestSnapshot?.note ?? '',
    audit:
      latestSnapshot?.audit ?? {
        sourceType: 'manual',
        sourceLabel: liveQuote ? '自动行情视图' : '正式估值',
        lastModifiedAt: latestSnapshot?.createdAt ?? liveQuote?.asOf ?? new Date().toISOString(),
        lastModifiedType: 'created',
      },
    createdAt: latestSnapshot?.createdAt ?? liveQuote?.asOf ?? new Date().toISOString(),
  }
}

export function buildRealtimePositionView(
  view: Pick<DashboardPositionView, 'position' | 'legs' | 'events' | 'latestSnapshot'>,
  liveQuote?: LiveQuoteState,
): RealtimePositionView {
  const snapshot = buildRealtimeSnapshot(view.position.id, view.latestSnapshot, liveQuote)
  const metrics = calculatePositionMetrics(view.legs, view.events, snapshot)

  return {
    snapshot,
    metrics,
    coverageStatus: liveQuote?.coverageStatus ?? 'none',
    liveAsOf: liveQuote?.asOf,
    sourceLabel: liveQuote?.sourceLabel,
    liveQuote,
  }
}

export function getLegCoverage(
  leg: StrategyLeg,
  liveQuote: LiveQuoteState | undefined,
  latestSnapshot?: PriceSnapshot,
): QuoteCoverageView {
  const liveLeg = liveQuote?.legQuotes.find((item) => item.legId === leg.id)
  if (liveLeg) {
    return liveLeg.coverage
  }

  const latestMark = latestSnapshot?.legMarks.find((item) => item.legId === leg.id)
  return latestMark ? 'manual_required' : 'missing'
}

export function buildSnapshotInputFromLiveAndManual(args: {
  positionId: string
  snapshotAt: string
  note: string
  legs: StrategyLeg[]
  liveQuote?: LiveQuoteState
  latestSnapshot?: PriceSnapshot
  manualMarks: Record<string, string>
  underlyingPrice?: string
}): PriceSnapshotInput | null {
  const latestMarks = buildLegMarkMap(args.latestSnapshot)
  const legMarks = args.legs
    .map((leg) => {
      const livePrice = args.liveQuote?.legQuotes.find((item) => item.legId === leg.id)?.markPrice
      const manualValue = args.manualMarks[leg.id]
      const fallbackManual = latestMarks.get(leg.id)
      const resolved = livePrice ?? (manualValue ? Number(manualValue) : undefined) ?? fallbackManual

      return resolved != null
        ? {
            legId: leg.id,
            markPrice: resolved,
          }
        : null
    })
    .filter((item): item is { legId: string; markPrice: number } => Boolean(item))

  if (!legMarks.length && !args.underlyingPrice && args.liveQuote?.underlyingPrice == null) {
    return null
  }

  return {
    positionId: args.positionId,
    snapshotAt: args.snapshotAt,
    underlyingPrice: args.underlyingPrice
      ? Number(args.underlyingPrice)
      : args.liveQuote?.underlyingPrice ?? args.latestSnapshot?.underlyingPrice,
    legMarks,
    note: args.note,
  }
}
