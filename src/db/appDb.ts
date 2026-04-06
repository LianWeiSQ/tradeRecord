import Dexie, { type Table } from 'dexie'
import { calculatePositionMetrics, inferPositionStatus } from '../services/calculations'
import { isoNow } from '../services/format'
import type {
  BackupPayload,
  DailyStat,
  PendingCloseSnapshotPayload,
  PositionEvent,
  PositionEventInput,
  PriceSnapshot,
  PriceSnapshotInput,
  StrategyLeg,
  StrategyLegInput,
  StrategyPosition,
  StrategyPositionInput,
} from '../types/trade'

class TradeRecordDb extends Dexie {
  positions!: Table<StrategyPosition, string>
  legs!: Table<StrategyLeg, string>
  events!: Table<PositionEvent, string>
  priceSnapshots!: Table<PriceSnapshot, string>
  stats!: Table<DailyStat, string>

  constructor() {
    super('trade-record-db')

    this.version(1).stores({
      positions: 'id, accountType, product, status, openedAt, updatedAt',
      legs: 'id, positionId, contractCode, expiryDate',
      events: 'id, positionId, eventType, occurredAt',
      priceSnapshots: 'id, positionId, snapshotAt',
      stats: 'id, date, sourceLabel',
    })
  }
}

export const db = new TradeRecordDb()

function createPositionRecord(input: StrategyPositionInput): StrategyPosition {
  const now = isoNow()
  return {
    id: crypto.randomUUID(),
    accountType: input.accountType,
    product: input.product.trim(),
    underlyingSymbol: input.underlyingSymbol.trim(),
    strategyName: input.strategyName.trim(),
    openedAt: input.openedAt,
    status: 'open',
    thesis: input.thesis.trim(),
    plan: input.plan.trim(),
    expectedScenario: input.expectedScenario.trim(),
    reviewResult: input.reviewResult.trim(),
    reviewConclusion: input.reviewConclusion.trim(),
    tags: input.tags,
    remarks: input.remarks.trim(),
    importNotes: input.importNotes ?? [],
    createdAt: now,
    updatedAt: now,
  }
}

function createLegRecords(positionId: string, openedAt: string, legs: StrategyLegInput[]): StrategyLeg[] {
  return legs.map((leg) => ({
    id: leg.id ?? crypto.randomUUID(),
    positionId,
    instrumentType: leg.instrumentType,
    side: leg.side,
    contractCode: leg.contractCode.trim(),
    optionType: leg.optionType,
    strikePrice: leg.strikePrice,
    expiryDate: leg.expiryDate,
    qty: leg.qty,
    entryPrice: leg.entryPrice,
    multiplier: leg.multiplier,
    createdAt: leg.createdAt ?? openedAt,
    note: leg.note?.trim(),
  }))
}

function createSnapshotRecord(input: PriceSnapshotInput): PriceSnapshot {
  return {
    id: crypto.randomUUID(),
    positionId: input.positionId,
    snapshotAt: input.snapshotAt,
    underlyingPrice: input.underlyingPrice,
    legMarks: input.legMarks,
    note: input.note.trim(),
    createdAt: isoNow(),
  }
}

export async function createStrategyPosition(input: StrategyPositionInput): Promise<string> {
  const position = createPositionRecord(input)
  const legs = createLegRecords(position.id, input.openedAt, input.legs)
  const openEvent: PositionEvent = {
    id: crypto.randomUUID(),
    positionId: position.id,
    eventType: 'open',
    occurredAt: input.openedAt,
    note: input.remarks.trim() || '初始开仓',
    legChanges: legs.map((leg) => ({
      legId: leg.id,
      quantityChange: leg.qty,
      price: leg.entryPrice,
      note: leg.note,
    })),
    newLegIds: legs.map((leg) => leg.id),
    isInitial: true,
    createdAt: isoNow(),
  }

  await db.transaction('rw', db.positions, db.legs, db.events, async () => {
    await db.positions.add(position)
    await db.legs.bulkAdd(legs)
    await db.events.add(openEvent)
  })

  return position.id
}

async function syncPositionStatus(positionId: string): Promise<void> {
  const [position, legs, events, snapshots] = await Promise.all([
    db.positions.get(positionId),
    db.legs.where('positionId').equals(positionId).toArray(),
    db.events.where('positionId').equals(positionId).toArray(),
    db.priceSnapshots.where('positionId').equals(positionId).toArray(),
  ])

  if (!position) {
    return
  }

  const latestSnapshot = [...snapshots].sort(
    (left, right) => new Date(right.snapshotAt).getTime() - new Date(left.snapshotAt).getTime(),
  )[0]
  const metrics = calculatePositionMetrics(legs, events, latestSnapshot)

  await db.positions.update(positionId, {
    status: inferPositionStatus(metrics),
    updatedAt: isoNow(),
  })
}

export async function addPositionEvent(input: PositionEventInput): Promise<void> {
  const createdLegs = createLegRecords(input.positionId, input.occurredAt, input.newLegs ?? [])
  const event: PositionEvent = {
    id: crypto.randomUUID(),
    positionId: input.positionId,
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    note: input.note.trim(),
    legChanges: input.legChanges,
    newLegIds: createdLegs.map((leg) => leg.id),
    createdAt: isoNow(),
  }

  await db.transaction('rw', db.events, db.legs, db.positions, async () => {
    if (createdLegs.length) {
      await db.legs.bulkAdd(createdLegs)
    }
    await db.events.add(event)
    await db.positions.update(input.positionId, { updatedAt: isoNow() })
  })

  await syncPositionStatus(input.positionId)
}

export async function savePriceSnapshot(input: PriceSnapshotInput): Promise<void> {
  const snapshot = createSnapshotRecord(input)

  await db.transaction('rw', db.priceSnapshots, db.positions, async () => {
    await db.priceSnapshots.add(snapshot)
    await db.positions.update(input.positionId, {
      latestSnapshotAt: input.snapshotAt,
      updatedAt: isoNow(),
    })
  })
}

export async function applyPendingCloseSnapshots(
  payloads: PendingCloseSnapshotPayload[],
): Promise<number> {
  if (!payloads.length) {
    return 0
  }

  let inserted = 0

  await db.transaction('rw', db.priceSnapshots, db.positions, async () => {
    for (const payload of payloads) {
      const existing = await db.priceSnapshots
        .where('positionId')
        .equals(payload.snapshot.positionId)
        .filter((snapshot) => snapshot.note.includes(`[AUTO_CLOSE:${payload.signature}]`))
        .first()

      if (existing) {
        continue
      }

      const snapshot = createSnapshotRecord({
        ...payload.snapshot,
        note: `${payload.snapshot.note}\n[AUTO_CLOSE:${payload.signature}]`,
      })

      await db.priceSnapshots.add(snapshot)
      await db.positions.update(payload.snapshot.positionId, {
        latestSnapshotAt: payload.snapshot.snapshotAt,
        updatedAt: isoNow(),
      })
      inserted += 1
    }
  })

  return inserted
}

export async function updatePositionReview(
  positionId: string,
  fields: Pick<
    StrategyPosition,
    'thesis' | 'plan' | 'expectedScenario' | 'reviewResult' | 'reviewConclusion' | 'remarks' | 'tags'
  >,
): Promise<void> {
  await db.positions.update(positionId, {
    ...fields,
    updatedAt: isoNow(),
  })
}

export async function saveImportBatch(
  inputs: StrategyPositionInput[],
  stats: DailyStat[],
): Promise<void> {
  await db.transaction('rw', db.positions, db.legs, db.events, db.stats, async () => {
    for (const input of inputs) {
      const position = createPositionRecord(input)
      const legs = createLegRecords(position.id, input.openedAt, input.legs)
      const initialEvent: PositionEvent = {
        id: crypto.randomUUID(),
        positionId: position.id,
        eventType: 'open',
        occurredAt: input.openedAt,
        note: input.remarks.trim() || '从 Excel 导入',
        legChanges: legs.map((leg) => ({
          legId: leg.id,
          quantityChange: leg.qty,
          price: leg.entryPrice,
          note: leg.note,
        })),
        newLegIds: legs.map((leg) => leg.id),
        isInitial: true,
        createdAt: isoNow(),
      }

      await db.positions.add(position)
      await db.legs.bulkAdd(legs)
      await db.events.add(initialEvent)
    }

    if (stats.length) {
      await db.stats.bulkPut(stats)
    }
  })
}

export async function exportBackupPayload(): Promise<BackupPayload> {
  const [positions, legs, events, priceSnapshots, stats] = await Promise.all([
    db.positions.toArray(),
    db.legs.toArray(),
    db.events.toArray(),
    db.priceSnapshots.toArray(),
    db.stats.toArray(),
  ])

  return {
    version: 1,
    exportedAt: isoNow(),
    positions,
    legs,
    events,
    priceSnapshots,
    stats,
  }
}

export async function clearAllData(): Promise<void> {
  await db.transaction(
    'rw',
    [db.positions, db.legs, db.events, db.priceSnapshots, db.stats],
    async () => {
      await Promise.all([
        db.positions.clear(),
        db.legs.clear(),
        db.events.clear(),
        db.priceSnapshots.clear(),
        db.stats.clear(),
      ])
    },
  )
}

export async function restoreBackupPayload(payload: BackupPayload): Promise<void> {
  await db.transaction(
    'rw',
    [db.positions, db.legs, db.events, db.priceSnapshots, db.stats],
    async () => {
      await Promise.all([
        db.positions.clear(),
        db.legs.clear(),
        db.events.clear(),
        db.priceSnapshots.clear(),
        db.stats.clear(),
      ])

      if (payload.positions.length) {
        await db.positions.bulkAdd(payload.positions)
      }
      if (payload.legs.length) {
        await db.legs.bulkAdd(payload.legs)
      }
      if (payload.events.length) {
        await db.events.bulkAdd(payload.events)
      }
      if (payload.priceSnapshots.length) {
        await db.priceSnapshots.bulkAdd(payload.priceSnapshots)
      }
      if (payload.stats.length) {
        await db.stats.bulkAdd(payload.stats)
      }
    },
  )
}
