import { describe, expect, it } from 'vitest'
import { buildDashboardGroups } from '../services/dashboard'
import type { StrategyLeg } from '../types/trade'
import { makePosition, makeSnapshot } from './fixtures'

describe('buildDashboardGroups', () => {
  it('groups positions by account and product', () => {
    const positions = [
      makePosition({
        id: 'a',
        accountType: 'live',
        product: '股指',
        underlyingSymbol: 'IH2509',
        strategyName: '股指多头',
      }),
      makePosition({
        id: 'b',
        accountType: 'paper',
        product: '燃油',
        underlyingSymbol: 'FU2602',
        strategyName: '燃油保护',
      }),
    ]

    const legs: StrategyLeg[] = [
      {
        id: 'leg-a',
        positionId: 'a',
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
        id: 'leg-b',
        positionId: 'b',
        instrumentType: 'option',
        side: 'long',
        contractCode: 'FU2602P',
        optionType: 'P',
        strikePrice: 2600,
        qty: 2,
        entryPrice: 90,
        multiplier: 100,
        createdAt: '2026-04-02',
      },
    ]

    const snapshots = [
      makeSnapshot({
        id: 's-a',
        positionId: 'a',
        snapshotAt: '2026-04-05',
        underlyingPrice: 2840,
        legMarks: [{ legId: 'leg-a', markPrice: 2840 }],
      }),
    ]

    const groups = buildDashboardGroups(positions, legs, [], snapshots)

    expect(groups).toHaveLength(2)
    expect(groups[0].positions).toHaveLength(1)
    expect(groups[1].positions).toHaveLength(1)
    expect(groups[0].accountType).toBe('live')
    expect(groups[1].accountType).toBe('paper')
  })
})
