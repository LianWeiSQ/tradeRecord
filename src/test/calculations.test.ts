import { describe, expect, it } from 'vitest'
import { calculatePositionMetrics } from '../services/calculations'
import type { StrategyLeg } from '../types/trade'
import { makeEvent, makeSnapshot } from './fixtures'

describe('calculatePositionMetrics', () => {
  it('calculates realized and unrealized pnl for long and short legs', () => {
    const legs: StrategyLeg[] = [
      {
        id: 'future-1',
        positionId: 'position-1',
        instrumentType: 'future',
        side: 'long',
        contractCode: 'IH2509',
        optionType: null,
        qty: 2,
        entryPrice: 2800,
        multiplier: 300,
        createdAt: '2026-04-01',
      },
      {
        id: 'put-1',
        positionId: 'position-1',
        instrumentType: 'option',
        side: 'short',
        contractCode: 'HO2509-P',
        optionType: 'P',
        strikePrice: 2750,
        qty: 3,
        entryPrice: 42,
        multiplier: 100,
        createdAt: '2026-04-01',
      },
    ]

    const events = [
      makeEvent({
        id: 'open',
        positionId: 'position-1',
        note: 'initial',
      }),
      makeEvent({
        id: 'reduce',
        positionId: 'position-1',
        eventType: 'reduce',
        occurredAt: '2026-04-03',
        note: 'trim',
        isInitial: false,
        legChanges: [
          { legId: 'future-1', quantityChange: -1, price: 2850 },
          { legId: 'put-1', quantityChange: -1, price: 38 },
        ],
      }),
    ]

    const snapshot = makeSnapshot({
      id: 'snap-1',
      positionId: 'position-1',
      snapshotAt: '2026-04-05',
      underlyingPrice: 2865,
      legMarks: [
        { legId: 'future-1', markPrice: 2865 },
        { legId: 'put-1', markPrice: 35 },
      ],
    })

    const metrics = calculatePositionMetrics(legs, events, snapshot)

    expect(metrics.realizedPnl).toBe(15400)
    expect(metrics.unrealizedPnl).toBe(20900)
    expect(metrics.totalQty).toBe(3)
  })
})
