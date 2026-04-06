import { describe, expect, it } from 'vitest'
import { buildRealtimePositionView, buildSnapshotInputFromLiveAndManual } from '../services/liveQuotes'
import type { LiveQuoteState, PositionEvent, PriceSnapshot, StrategyLeg, StrategyPosition } from '../types/trade'

describe('live quote helpers', () => {
  const position: StrategyPosition = {
    id: 'position-1',
    accountType: 'live',
    product: '股指',
    underlyingSymbol: 'IH2509',
    strategyName: '股指保护',
    openedAt: '2026-04-01',
    status: 'open',
    thesis: '',
    plan: '',
    expectedScenario: '',
    reviewResult: '',
    reviewConclusion: '',
    tags: [],
    remarks: '',
    importNotes: [],
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
  }

  const legs: StrategyLeg[] = [
    {
      id: 'future-1',
      positionId: 'position-1',
      instrumentType: 'future',
      side: 'long',
      contractCode: 'IH2509',
      optionType: null,
      qty: 1,
      entryPrice: 2800,
      multiplier: 300,
      createdAt: '2026-04-01',
    },
    {
      id: 'option-1',
      positionId: 'position-1',
      instrumentType: 'option',
      side: 'short',
      contractCode: 'HO2509-P-2750',
      optionType: 'P',
      strikePrice: 2750,
      expiryDate: '2026-04-25',
      qty: 1,
      entryPrice: 50,
      multiplier: 100,
      createdAt: '2026-04-01',
    },
  ]

  const events: PositionEvent[] = [
    {
      id: 'open-1',
      positionId: 'position-1',
      eventType: 'open',
      occurredAt: '2026-04-01',
      note: '初始开仓',
      legChanges: [],
      newLegIds: ['future-1', 'option-1'],
      isInitial: true,
      createdAt: '2026-04-01T00:00:00.000Z',
    },
  ]

  const latestSnapshot: PriceSnapshot = {
    id: 'snapshot-1',
    positionId: 'position-1',
    snapshotAt: '2026-04-05T15:00:00.000Z',
    underlyingPrice: 2830,
    legMarks: [
      { legId: 'future-1', markPrice: 2832 },
      { legId: 'option-1', markPrice: 48 },
    ],
    note: '收盘估值',
    createdAt: '2026-04-05T15:00:00.000Z',
  }

  const liveQuote: LiveQuoteState = {
    positionId: 'position-1',
    asOf: '2026-04-06T10:12:00.000Z',
    underlyingPrice: 2850,
    legQuotes: [
      {
        legId: 'future-1',
        contractCode: 'IH2509',
        instrumentType: 'future',
        markPrice: 2850,
        coverage: 'auto',
        sourceLabel: 'AkShare',
      },
      {
        legId: 'option-1',
        contractCode: 'HO2509-P-2750',
        instrumentType: 'option',
        coverage: 'manual_required',
        sourceLabel: 'AkShare',
        message: '期权需手动估值',
      },
    ],
    coverageStatus: 'partial',
    sourceLabel: 'AkShare',
  }

  it('merges live quotes with latest formal snapshot for realtime pnl', () => {
    const realtime = buildRealtimePositionView(
      {
        position,
        legs,
        events,
        latestSnapshot,
      },
      liveQuote,
    )

    expect(realtime.coverageStatus).toBe('partial')
    expect(realtime.snapshot?.snapshotAt).toBe(liveQuote.asOf)
    expect(realtime.snapshot?.underlyingPrice).toBe(2850)
    expect(realtime.snapshot?.legMarks).toEqual([
      { legId: 'future-1', markPrice: 2850 },
      { legId: 'option-1', markPrice: 48 },
    ])
    expect(realtime.metrics.unrealizedPnl).toBe(15200)
  })

  it('builds a formal snapshot payload from live futures plus manual option prices', () => {
    const payload = buildSnapshotInputFromLiveAndManual({
      positionId: 'position-1',
      snapshotAt: '2026-04-06',
      note: '手动保存正式估值',
      legs,
      liveQuote,
      latestSnapshot,
      manualMarks: {
        'future-1': '',
        'option-1': '46',
      },
      underlyingPrice: '2860',
    })

    expect(payload).toEqual({
      positionId: 'position-1',
      snapshotAt: '2026-04-06',
      underlyingPrice: 2860,
      legMarks: [
        { legId: 'future-1', markPrice: 2850 },
        { legId: 'option-1', markPrice: 46 },
      ],
      note: '手动保存正式估值',
    })
  })
})
